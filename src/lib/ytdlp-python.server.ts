import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture } from "@/lib/ytdlp-proc.server";
import { pythonBin, classifyPythonProbe, type PythonProbe } from "@/lib/ytdlp-auth";

export const TMP_PREFIX = "velo-ytdl-";

/**
 * A datacenter origin often gets 403 from YouTube. So every ladder probes
 * direct first and, once it fails, skips the probe for a while: a blocked host
 * pays one fast failure per window.
 * ponytail: one process-wide bit; key it by client/family if those diverge.
 */
const DIRECT_RETRY_MS = 15 * 60_000;
let directBlockedUntil = 0;
export const directYtdlpOpen = (): boolean => Date.now() >= directBlockedUntil;
export function markDirectYtdlpBlocked(): void {
  directBlockedUntil = Date.now() + DIRECT_RETRY_MS;
}
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
 * Without this, a host with no Python ran the whole ladder — every client on
 * every route — spawning a process that could never start, and reported it
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
