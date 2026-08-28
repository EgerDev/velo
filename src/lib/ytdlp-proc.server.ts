import { spawn, type ChildProcess } from "node:child_process";
import "@/lib/ipv4-bind.server";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

export function killTree(child: ChildProcess) {
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

export function run(
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
export const JSON_STDOUT_MAX = 24_000_000;

export function runCapture(
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
