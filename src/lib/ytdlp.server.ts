import "@/lib/ipv4-bind.server";
import { run } from "@/lib/ytdlp-proc.server";
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
  type YtdlpFailure,
} from "@/lib/ytdlp-auth";
import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";
import { ensurePython, requirePython, ensurePySocks, ensureImpersonate, TMP_PREFIX } from "@/lib/ytdlp-python.server";
import {
  acquireYtdlpSlot,
  coalesceFile,
  looksLikeMediaFile,
  mediaFileResponse,
  muxCacheGet,
  muxCachePut,
  type FileHit,
} from "@/lib/download-pool.server";

export { ensurePython, resetPythonProbe } from "@/lib/ytdlp-python.server";
export { fetchSubtitlesViaYtdlp, listYtdlpFormats } from "@/lib/ytdlp-meta.server";

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
  /** Set for a user-configured proxy: it MAY carry the session (cookies). */
  trustedProxy?: boolean;
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

    const attempt = async (client: string, proxy?: string, trustedProxy = false): Promise<MuxResult> => {
      const filename = await runClient({
        dir,
        id: opts.id,
        itag: opts.itag,
        client,
        // A user-configured (trusted) proxy may carry the session — it is the
        // operator's own hop. Pool-SOCKS hops keep the strict no-cookie rule.
        cookiePath: proxy && !trustedProxy ? undefined : cookiePath,
        pot: gvsPot,
        playerPot,
        visitorData: session?.visitorData,
        dataSyncId: session?.dataSyncId,
        proxy,
        trustedProxy,
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

    // The operator's own proxy, before any free hop. It is a trusted hop: the
    // session MAY ride it (that is the point on a datacenter origin IP), and a
    // healthy-proxy "stop" verdict (private video) must not poison it — same
    // rule as the pool loop below. Its own stage, outside `!loggedIn`, so a
    // logged-in session also gets the proxy hop.
    const [{ userProxyLadder }, { attemptSelectedRoutes }] = await Promise.all([
      import("@/lib/user-proxy.server"), import("@/lib/proxy-selector.server"),
    ]);
    const userProxies = await userProxyLadder("ytdlp");
    const savedRoutes = userProxies.map((route) => ({ kind: "proxy", id: route.id, protocol: route.protocol, trusted: true } as const));
    const savedOutcome = await attemptSelectedRoutes<MuxResult>(savedRoutes, async (selected) => {
      if (selected.kind !== "proxy") return { ok: false };
      const userProxy = userProxies.find((route) => route.id === selected.id);
      if (userProxy === undefined) return { ok: false };
      const result = await userProxy.run(async (url): Promise<MuxResult | null> => {
        for (const client of clients) {
          if (opts.signal?.aborted) throw new Error("aborted");
          try {
            const completed = await attempt(client, url, true);
            await userProxy.mark({ ok: true, exitIp: null });
            return completed;
          } catch (err) {
            const fail = (err as { ytdlp?: YtdlpFailure }).ytdlp;
            const message = err instanceof Error ? err.message : String(err);
            if (/abort/i.test(message)) throw err;
            errors.push(`${client}@proxy: ${message}`.slice(0, 180));
            if (fail?.next === "stop") throw err;
            if (!fail || fail.next === "next-socks") {
              await userProxy.mark({ ok: false, exitIp: null });
              break;
            }
          }
        }
        return null;
      });
      return result === null ? { ok: false } : { ok: true, value: result };
    }, { allowDirectFallback: false });
    if (savedOutcome.result !== null) return savedOutcome.result;

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

    // Direct is the final fallback, after every configured and free route.
    for (const client of clients) {
      if (opts.signal?.aborted) throw new Error("aborted");
      try { return await attempt(client); }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/abort/i.test(message)) throw err;
        errors.push(message);
        if ((err as { ytdlp?: YtdlpFailure }).ytdlp?.next === "stop") throw err;
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

/**
 * Fetch a caption track through yt-dlp over SOCKS — bypasses IP-based 429
 * throttling on YouTube's timedtext endpoint because the request comes from a
 * different IP. Returns the VTT text, or null if yt-dlp can't fetch it.
 *
 * For `tlang` (auto-translate): yt-dlp lists translated tracks under
 * `automatic_captions` with language codes like "af", "sq", etc. We ask for
 * `--sub-langs <lang>` which picks up the auto-translated version when the
 * original track supports translation.
 */
