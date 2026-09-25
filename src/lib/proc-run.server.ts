import { spawn, type ChildProcess } from "node:child_process";

/**
 * The only ambient variables a child inherits (matched case-insensitively;
 * Windows spells them Path, SystemRoot, ...). yt-dlp runs YouTube's challenge
 * solver in a `node --permission` child that reads its environment, so server
 * secrets (DATABASE_URL, BETTER_AUTH_SECRET, proxy keys, ...) must never reach
 * it (roadmap D7, audit M-04). Everything a child needs to find python, node,
 * ffmpeg, a temp dir and CA certificates is here; nothing else is.
 */
export const CHILD_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CACHE_HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const CHILD_ENV_ALLOWED = new Set(CHILD_ENV_ALLOWLIST);

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => value !== undefined && CHILD_ENV_ALLOWED.has(key.toUpperCase()),
    ),
  );
}

/**
 * Child-process lifecycle for yt-dlp and friends, dependency-free so its kill
 * and idle-limit behaviour can be tested directly. Spawned `detached` so the
 * whole group (yt-dlp and the ffmpeg it forks) dies together.
 */
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

/**
 * `idleMs` is a stall limit, not a total one: any output (yt-dlp prints a
 * `--newline` progress line per update) restarts it. As a wall clock it killed
 * large saves mid-transfer — a 689 MB 4K file took up to 178s of a 180s limit.
 * A process that prints nothing (a probe, `pip --quiet`) still dies at idleMs.
 */
export function run(
  command: string,
  args: string[],
  idleMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: childEnv(),
    });
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
    const stall = () => {
      timedOut = true;
      killed = true;
      killTree(child);
    };
    let timer = setTimeout(stall, idleMs);
    const alive = () => {
      // Never re-arm after exit: a late kill could hit a reused process group.
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(stall, idleMs);
    };
    // Drained (never buffered): progress lines only prove the process is alive.
    child.stdout?.on("data", alive);
    child.stderr?.on("data", (chunk) => {
      alive();
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
