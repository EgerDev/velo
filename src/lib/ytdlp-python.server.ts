import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, runCapture } from "@/lib/ytdlp-proc.server";
import { pythonBin, classifyPythonProbe, type PythonProbe } from "@/lib/ytdlp-auth";

export const TMP_PREFIX = "velo-ytdl-";
const TMP_MAX_AGE_MS = 30 * 60_000;

export async function sweepStaleYtdlpDirs() {
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
const sweepTimer = setInterval(() => void sweepStaleYtdlpDirs(), 10 * 60 * 1000);
sweepTimer.unref?.();

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

/** Forget the pinned probe — after installing a new yt-dlp the version must be re-read. */
export function resetPythonProbe(): void {
  pythonProbe = null;
}

/** Throw the actionable message when Python cannot run yt-dlp. */
export async function requirePython(): Promise<void> {
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

export const ensurePySocks = optionalModule("socks", "PySocks");
export const ensureImpersonate = optionalModule("curl_cffi", "curl_cffi");
