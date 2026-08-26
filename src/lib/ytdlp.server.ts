import { spawn, type ChildProcess } from "node:child_process";
import "@/lib/ipv4-bind.server";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRetry } from "@/lib/retry";
import {
  readCookieSession,
  socksClientsForItag,
  ytdlpArgv,
  ytdlpClients,
  ytdlpRunTimeoutMs,
  mapYtdlpExit,
  formatYtdlpFailure,
  isAudioItag,
  pythonBin,
  classifyPythonProbe,
  type PythonProbe,
  type YtdlpFailure,
} from "@/lib/ytdlp-auth";
import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";
import { ytdlpJsonToFormats, type YtDlpJsonFormat } from "@/lib/ytdlp-formats";
import type { VideoFormat } from "@/lib/youtube";
import {
  acquireYtdlpSlot,
  coalesceFile,
  looksLikeMediaFile,
  mediaFileResponse,
  muxCacheGet,
  muxCachePut,
  type FileHit,
} from "@/lib/download-pool.server";

function killTree(child: ChildProcess) {
  const pid = child.pid;
  if (pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* setsid not ready / already reaped */
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
  try {
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch {
    /* ignore */
  }
  child.kill("SIGKILL");
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      killed = true;
      killTree(child);
      finish(() => reject(new Error("aborted")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      killTree(child);
    }, timeoutMs);
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 48_000) stderr = stderr.slice(-48_000);
    });
    child.on("error", (err) => {
      finish(() => reject(err));
    });
    child.on("close", (code, sig) => {
      const forced = timedOut || killed;
      finish(() =>
        resolve({
          code: forced ? 137 : (code ?? (sig === "SIGKILL" ? 137 : sig === "SIGTERM" ? 143 : 1)),
          signal: forced ? "SIGKILL" : (sig ?? null),
          stderr,
          timedOut,
        }),
      );
    });
  });
}

/** Plenty for `--version`; a caption-heavy `-J` dump needs JSON_STDOUT_MAX. */
const STDOUT_MAX_DEFAULT = 2_000_000;
/**
 * `yt-dlp -J` emits every format URL plus the automatic_captions/subtitles URL
 * set for ~150 languages, which passes 2 MB on long or caption-heavy videos. Cut
 * short, the JSON no longer parses and format enrichment silently returned []
 * after burning a pool slot, a POT mint and four 40s runs.
 */
const JSON_STDOUT_MAX = 24_000_000;

function runCapture(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  stdoutMax = STDOUT_MAX_DEFAULT,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdoutBytes = 0;
    let truncated = false;
    const stdoutChunks: Buffer[] = [];
    const STDOUT_MAX = stdoutMax;
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      killed = true;
      killTree(child);
      finish(() => reject(new Error("aborted")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      killTree(child);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= STDOUT_MAX) {
        truncated = true;
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const room = STDOUT_MAX - stdoutBytes;
      if (room < buf.length) truncated = true;
      stdoutChunks.push(room < buf.length ? buf.subarray(0, room) : buf);
      stdoutBytes += Math.min(room, buf.length);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 48_000) stderr = stderr.slice(-48_000);
    });
    child.on("error", (err) => {
      finish(() => reject(err));
    });
    child.on("close", (code, sig) => {
      const forced = timedOut || killed;
      finish(() =>
        resolve({
          code: forced ? 137 : (code ?? (sig === "SIGKILL" ? 137 : sig === "SIGTERM" ? 143 : 1)),
          stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8"),
          stderr,
          signal: forced ? "SIGKILL" : (sig ?? null),
          timedOut,
          truncated,
        }),
      );
    });
  });
}

/**
 * Is the Python side usable at all?
 *
 * Without this, a host with no Python ran the whole ladder — every client, then
 * every SOCKS hop — spawning a process that could never start, and reported it
 * as `spawn python3 ENOENT · spawn python3 ENOENT · …`. The cause is permanent
 * and knowable in one spawn, so check once and say which of the two things is
 * actually missing.
 *
 * Success is cached for the process; failure is re-probed after a cooldown, so
 * installing yt-dlp does not require a restart to take effect.
 */
const PROBE_RETRY_MS = 30_000;
let pythonProbe: { at: number; result: Promise<PythonProbe> } | null = null;

export function ensurePython(): Promise<PythonProbe> {
  const bin = pythonBin();
  if (pythonProbe && Date.now() - pythonProbe.at < PROBE_RETRY_MS) return pythonProbe.result;
  const result = (async (): Promise<PythonProbe> => {
    try {
      const probe = await runCapture(bin, ["-m", "yt_dlp", "--version"], 15_000);
      return classifyPythonProbe({
        bin,
        code: probe.code,
        stdout: probe.stdout,
        stderr: probe.stderr,
      });
    } catch (err) {
      return classifyPythonProbe({ bin, spawnError: err });
    }
  })();
  pythonProbe = { at: Date.now(), result };
  // A usable runtime does not change under us; a broken one might be fixed.
  void result.then((value) => {
    if (value.ok && pythonProbe) pythonProbe.at = Number.POSITIVE_INFINITY;
  });
  return result;
}

/** Throw the actionable message when Python cannot run yt-dlp. */
async function requirePython(): Promise<void> {
  const probe = await ensurePython();
  if (!probe.ok) throw new Error(probe.message);
}

/**
 * Probe for an optional Python package, installing it once if absent.
 *
 * Cached per process, but a failure is retried after a cooldown rather than
 * remembered forever — one transient pip failure otherwise disabled SOCKS (or
 * impersonation) for the life of the server.
 */
function optionalModule(module: string, pipName: string): () => Promise<boolean> {
  let state: { at: number; result: Promise<boolean> } | null = null;
  return () => {
    if (state && Date.now() - state.at < PROBE_RETRY_MS) return state.result;
    const result = (async () => {
      const bin = pythonBin();
      const probe = await ensurePython();
      if (!probe.ok) return false;
      const check = await run(bin, ["-c", `import ${module}`], 8_000).catch(() => ({ code: 1 }));
      if (check.code === 0) return true;
      const install = await run(bin, ["-m", "pip", "install", "--quiet", pipName], 90_000).catch(
        () => ({ code: 1 }),
      );
      return install.code === 0;
    })();
    // Hold at a far-future stamp WHILE the probe is in flight so a second caller
    // arriving mid-install (the pip step can run ~90s, longer than PROBE_RETRY_MS)
    // gets this same promise instead of kicking off a concurrent pip install into
    // the same site-packages. Mutate this entry directly (not the module-level
    // `state`, which a racing call may have replaced) so the settle pins the
    // right probe: forever on success, `now` on failure so the cooldown runs
    // from when it failed rather than caching `false` until restart.
    const entry = { at: Number.POSITIVE_INFINITY, result };
    state = entry;
    void result.then(
      (ok) => {
        entry.at = ok ? Number.POSITIVE_INFINITY : Date.now();
      },
      () => {
        entry.at = Date.now();
      },
    );
    return result;
  };
}

const ensurePySocks = optionalModule("socks", "PySocks");
const ensureImpersonate = optionalModule("curl_cffi", "curl_cffi");

async function runClient(opts: {
  dir: string;
  id: string;
  itag: number;
  client: string;
  cookiePath?: string;
  pot?: string;
  playerPot?: string;
  visitorData?: string | null;
  dataSyncId?: string | null;
  proxy?: string;
  impersonate?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const args = ytdlpArgv(opts);
  return withRetry(
    async () => {
      const leftovers = (await readdir(opts.dir)).filter((name) => name.startsWith("media."));
      await Promise.all(leftovers.map((name) => rm(join(opts.dir, name), { force: true })));
      let result = await run(pythonBin(), args, ytdlpRunTimeoutMs(opts), opts.signal);
      if (result.code !== 0 && /requested format is not available/i.test(result.stderr)) {
        const altArgs = [...args];
        const fIdx = altArgs.indexOf("-f");
        if (fIdx >= 0) {
          if (isAudioItag(opts.itag)) {
            altArgs[fIdx + 1] =
              `${altArgs[fIdx + 1]}/${opts.itag}-7/${opts.itag}-0/bestaudio[ext=m4a]/251-7/251-0/bestaudio`;
          } else {
            altArgs[fIdx + 1] =
              `${altArgs[fIdx + 1]}/${opts.itag}+140-7/${opts.itag}+140-0/${opts.itag}+ba[ext=m4a]/${opts.itag}+251-7/${opts.itag}+ba/bv[height<=1080]+ba/270/614/96/${opts.itag}`;
          }
          result = await run(pythonBin(), altArgs, ytdlpRunTimeoutMs(opts), opts.signal);
        }
      }
      if (result.code !== 0 || result.timedOut) {
        const fail = mapYtdlpExit(result.code, result.stderr, {
          signal: result.signal,
          timedOut: result.timedOut,
        });
        throw Object.assign(new Error(formatYtdlpFailure(opts.client, fail)), { ytdlp: fail });
      }
      const files = (await readdir(opts.dir)).filter((name) => name.startsWith("media."));
      if (!files[0]) throw new Error(`${opts.client}: produced no file.`);
      return files[0];
    },
    {
      attempts: 2,
      baseMs: 600,
      maxMs: 2000,
      retryOn: (err) => {
        const text = String(err);
        if (opts.signal?.aborted || /abort/i.test(text)) return false;
        const fail = (err as { ytdlp?: YtdlpFailure }).ytdlp;
        if (fail) return fail.retryable;
        return false;
      },
    },
  );
}

const TMP_PREFIX = "velo-ytdl-";
const TMP_MAX_AGE_MS = 30 * 60_000;
const FORMAT_TTL_MS = 10 * 60_000;
const formatCache = new Map<string, { value: VideoFormat[]; expires: number }>();
const formatInflight = new Map<string, Promise<VideoFormat[]>>();

async function sweepStaleYtdlpDirs() {
  const root = tmpdir();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    names
      .filter((name) => name.startsWith(TMP_PREFIX))
      .map(async (name) => {
        const full = join(root, name);
        try {
          const st = await stat(full);
          if (now - st.mtimeMs >= TMP_MAX_AGE_MS) await rm(full, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }),
  );
}

void sweepStaleYtdlpDirs();

// A one-shot sweep at module load misses dirs leaked at runtime (an abort racing
// a SIGKILL'd yt-dlp, a crash) — including written cookies.txt session cookies —
// until the next process start, and formatCache rows expire logically but are
// never deleted, so the Map grows one entry per unique video id for the process
// lifetime. Sweep both on an interval that never keeps the process alive.
const ytdlpSweepTimer = setInterval(
  () => {
    void sweepStaleYtdlpDirs();
    const now = Date.now();
    for (const [id, entry] of formatCache) {
      if (entry.expires <= now) formatCache.delete(id);
    }
  },
  10 * 60 * 1000,
);
ytdlpSweepTimer.unref?.();

type MuxResult = FileHit & { client: string; auth: string; tmpDir: string };

async function muxOne(opts: {
  id: string;
  itag: number;
  cookies?: string;
  pot?: string;
  signal?: AbortSignal;
}): Promise<MuxResult> {
  // Before the tmpdir, the client ladder and the SOCKS hops: none of that can
  // succeed if the interpreter cannot run yt-dlp, and the reason is knowable now.
  await requirePython();
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  const errors: string[] = [];
  try {
    const session = (() => {
      try {
        return readCookieSession(opts.cookies);
      } catch {
        return null;
      }
    })();
    let cookiePath: string | undefined;
    if (session?.loggedIn) {
      cookiePath = join(dir, "cookies.txt");
      await writeFile(cookiePath, session.netscape, "utf8");
    }

    const loggedIn = Boolean(session?.loggedIn);
    const clients = ytdlpClients(loggedIn);
    const impersonate = await ensureImpersonate().catch(() => false);
    let gvsPot = opts.pot;
    let playerPot = opts.pot;
    try {
      const { mintDualPoTokens } = await import("@/lib/po-token.server");
      const dual = await mintDualPoTokens({ visitor: session?.visitorData, videoId: opts.id });
      gvsPot = dual.gvs || opts.pot;
      playerPot = dual.player || opts.pot;
    } catch {
      /* yt-dlp still runs without POT */
    }

    const attempt = async (client: string, proxy?: string): Promise<MuxResult> => {
      const filename = await runClient({
        dir,
        id: opts.id,
        itag: opts.itag,
        client,
        cookiePath: proxy ? undefined : cookiePath,
        pot: gvsPot,
        playerPot,
        visitorData: session?.visitorData,
        dataSyncId: session?.dataSyncId,
        proxy,
        impersonate,
        signal: opts.signal,
      });
      const filePath = join(dir, filename);
      if (!(await looksLikeMediaFile(filePath))) throw new Error(`${client}: not a media file.`);
      const size = (await stat(filePath)).size;
      return {
        path: filePath,
        filename,
        size,
        client,
        auth: proxy ? "socks" : session?.loggedIn ? "cookies" : session ? "visitor" : "anon",
        tmpDir: dir,
      };
    };

    for (const client of clients) {
      if (opts.signal?.aborted) throw new Error("aborted");
      try {
        return await attempt(client);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/abort/i.test(message)) throw err;
        errors.push(message);
        // A "stop" verdict (private / members-only) is permanent and needs
        // cookies — no other anonymous client or proxy hop can help. Abort the
        // whole ladder now instead of burning the remaining clients and, below,
        // three SOCKS hops (each a full re-download for the ffmpeg-missing case).
        if ((err as { ytdlp?: YtdlpFailure }).ytdlp?.next === "stop") throw err;
      }
    }

    if (!loggedIn) {
      await ensurePySocks().catch(() => undefined);
      const hopClients = socksClientsForItag(opts.itag);
      for (let hop = 0; hop < 3; hop++) {
        if (opts.signal?.aborted) throw new Error("aborted");
        const socks = await takeSocks(1);
        const proxy = socks[0];
        if (!proxy) break;
        try {
          for (const client of hopClients) {
            if (opts.signal?.aborted) throw new Error("aborted");
            try {
              const result = await attempt(client, proxy);
              void markSocksGood(proxy);
              return result;
            } catch (err) {
              const fail = (err as { ytdlp?: YtdlpFailure }).ytdlp;
              const message = err instanceof Error ? err.message : "failed";
              if (/abort/i.test(message)) throw err;
              errors.push(`${client}@socks: ${message}`.slice(0, 180));
              // "stop" is a permanent per-video verdict, not this hop's fault —
              // marking the proxy dead would poison a healthy proxy for every
              // user (persisted 15 min) and the outer loop would repeat it on
              // two more proxies. Abort the ladder without touching the proxy.
              if (fail?.next === "stop") throw err;
              if (!fail || fail.next === "next-socks") {
                markSocksDead(proxy);
                break;
              }
            }
          }
        } finally {
          releaseSocks(socks);
        }
      }
    }

    throw new Error(errors.slice(0, 4).join(" · ") || "All yt-dlp clients failed.");
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function downloadWithYtdlp(opts: {
  id: string;
  itag: number;
  cookies?: string;
  pot?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const privateMux = Boolean(opts.cookies?.trim());
  if (!privateMux) {
    const cached = await muxCacheGet(opts.id, opts.itag);
    if (cached) {
      if (opts.signal?.aborted) throw new Error("aborted");
      return mediaFileResponse(cached.path, cached.filename, "cache", "anon", cached.size);
    }
  }

  const runMux = async () => {
    const release = await acquireYtdlpSlot(privateMux ? opts.signal : undefined);
    try {
      return await muxOne({ ...opts, signal: privateMux ? opts.signal : undefined });
    } finally {
      release();
    }
  };

  if (privateMux) {
    const produced = await runMux();
    return mediaFileResponse(
      produced.path,
      produced.filename,
      produced.client,
      produced.auth,
      produced.size,
      () => {
        void rm(produced.tmpDir, { recursive: true, force: true }).catch(() => undefined);
      },
    );
  }

  const stored = await coalesceFile(`${opts.id}.${opts.itag}`, async () => {
    const cached = await muxCacheGet(opts.id, opts.itag);
    if (cached) return cached;
    const produced = await runMux();
    try {
      return await muxCachePut(opts.id, opts.itag, produced.path, produced.filename);
    } finally {
      void rm(produced.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
  if (opts.signal?.aborted) throw new Error("aborted");
  return mediaFileResponse(stored.path, stored.filename, "cache", "anon", stored.size);
}

async function listYtdlpFormatsOnce(id: string): Promise<VideoFormat[]> {
  // Best-effort enrichment: no Python means no extra formats, but it should not
  // cost a pool slot, a SOCKS hop and a PO token mint to find that out.
  if (!(await ensurePython()).ok) return [];
  const release = await acquireYtdlpSlot();
  try {
    await ensurePySocks().catch(() => undefined);
    const impersonate = await ensureImpersonate().catch(() => false);
    let dual: { gvs: string | null; player: string | null } = { gvs: null, player: null };
    try {
      const { mintDualPoTokens } = await import("@/lib/po-token.server");
      dual = await mintDualPoTokens({ videoId: id });
    } catch {
      /* list without POT */
    }
    const {
      extractorArgs,
      ytdlpHeaderArgs,
      ytdlpImpersonateArgs,
      ytdlpFamilyArgs: familyArgs,
    } = await import("@/lib/ytdlp-auth");
    const { THROTTLE_FLAGS } = await import("@/lib/throttle");
    const clients = ["web_embedded", "tv_simply"];
    for (let hop = 0; hop < 2; hop++) {
      const socks = await takeSocks(1);
      const proxy = socks[0];
      if (!proxy) return [];
      try {
        for (const client of clients) {
          try {
            const result = await runCapture(
              pythonBin(),
              [
                "-m",
                "yt_dlp",
                "--no-js-runtimes",
                "--js-runtimes",
                "node",
                ...familyArgs(proxy),
                "--proxy",
                proxy,
                ...ytdlpHeaderArgs(),
                ...(impersonate ? ytdlpImpersonateArgs(client) : []),
                "--remote-components",
                "ejs:github",
                "--extractor-args",
                extractorArgs(client, dual.gvs ?? undefined, null, dual.player ?? undefined),
                "--newline",
                ...THROTTLE_FLAGS,
                "-J",
                "--no-download",
                `https://www.youtube.com/watch?v=${id}`,
              ],
              40_000,
              undefined,
              JSON_STDOUT_MAX,
            );
            if (result.code !== 0 || result.timedOut) {
              const fail = mapYtdlpExit(result.code, result.stderr, {
                signal: result.signal,
                timedOut: result.timedOut,
              });
              if (fail.next === "next-socks") {
                markSocksDead(proxy);
                break;
              }
              continue;
            }
            if (result.truncated) {
              // Not the hop's fault and not fixable by retrying: every client and
              // hop would overflow identically. Say so and stop instead of
              // failing four runs with an opaque SyntaxError.
              console.warn(`[ytdlp] -J output exceeded ${JSON_STDOUT_MAX} bytes for ${id}`);
              return [];
            }
            const json = JSON.parse(result.stdout) as { formats?: YtDlpJsonFormat[] };
            const mapped = ytdlpJsonToFormats(json.formats ?? []);
            if (mapped.length) {
              void markSocksGood(proxy);
              formatCache.set(id, { value: mapped, expires: Date.now() + FORMAT_TTL_MS });
              return mapped;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (/abort/i.test(message)) return [];
            if (/timed out|proxy|Unable to connect/i.test(message)) {
              markSocksDead(proxy);
              break;
            }
          }
        }
      } finally {
        releaseSocks(socks);
      }
    }
    return [];
  } finally {
    release();
  }
}

export async function listYtdlpFormats(id: string, signal?: AbortSignal): Promise<VideoFormat[]> {
  if (signal?.aborted) return [];
  const hit = formatCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  let shared = formatInflight.get(id);
  if (!shared) {
    shared = listYtdlpFormatsOnce(id).finally(() => {
      if (formatInflight.get(id) === shared) formatInflight.delete(id);
    });
    formatInflight.set(id, shared);
  }
  const mapped = await shared;
  if (signal?.aborted) return [];
  return mapped;
}
