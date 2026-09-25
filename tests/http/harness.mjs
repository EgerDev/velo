// HTTP black-box test harness (roadmap contract C6).
//
// startServer() runs the BUILT server (`node .output/server/index.mjs`, from
// `npm run build`) as a child process with NODE_ENV=production on an ephemeral
// loopback port, waits until GET /api/health answers (any status), and returns
// its base URL. Nitro's node-server preset reads `NITRO_PORT ?? PORT` and
// `NITRO_HOST || HOST`; with PORT=0 the OS picks a free port and the server
// prints "Listening on: http://127.0.0.1:<port>/".
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY = fileURLToPath(new URL("../../.output/server/index.mjs", import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const LISTEN_LINE = /Listening on:\s*(http:\/\/[^\s/]+)/;
// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from server output
const ANSI = /\u001b\[[0-9;]*m/g;
const isWindows = process.platform === "win32";

/**
 * The only ambient variables the server under test inherits (matched
 * case-insensitively; Windows spells them Path, SystemRoot, windir, ...).
 * Everything else in the developer's shell (VELO_*, GROK_*, BETTER_AUTH_*,
 * NODE_OPTIONS, *_PROXY, ...) stays out, so a test depends only on its own env.
 */
export const HARNESS_ENV_ALLOWLIST = Object.freeze([
  "PATH",
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
  "CI",
  "LANG",
  "TZ",
]);
const ALLOWED = new Set(HARNESS_ENV_ALLOWLIST);

/**
 * Child env = allow-listed ambient vars (original casing) + harness defaults +
 * the test's overrides + the forced runtime vars, minus NITRO_PORT/NITRO_HOST.
 * @param {Record<string, string | undefined>} ambient
 * @param {Record<string, string>} [overrides]
 * @returns {Record<string, string | undefined>}
 */
export function buildChildEnv(ambient, overrides = {}) {
  const env = {
    ...Object.fromEntries(Object.entries(ambient).filter(([key]) => ALLOWED.has(key.toUpperCase()))),
    // An ambient DATABASE_URL must never leak into a test; tests pass their own.
    DATABASE_URL: "",
    ...overrides,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
  };
  // NITRO_PORT wins over PORT even when empty (`??`), so it must be absent.
  delete env.NITRO_PORT;
  delete env.NITRO_HOST;
  return env;
}

/** Kills a process tree: taskkill /T on Windows, the process group on POSIX. */
function killTree(pid, signal) {
  try {
    if (isWindows) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

// Last-resort cleanup: a test runner that exits (or crashes) with a server
// still up must not leave it behind. "exit" handlers must be synchronous.
const live = new Set();
process.once("exit", () => {
  for (const pid of live) killTree(pid, "SIGKILL");
});

/**
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {Promise<{ baseUrl: string; stop(): Promise<void>; logs(): string }>}
 */
export async function startServer({ env = {} } = {}) {
  if (!existsSync(ENTRY)) {
    throw new Error(`${ENTRY} is missing. Run \`npm run build\` before \`npm run test:http\`.`);
  }
  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    // Own process group on POSIX, so stop() can signal the whole tree.
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildChildEnv(process.env, env),
  });
  if (child.pid) live.add(child.pid);

  let output = "";
  let exited = false;
  // Settles on "close" (process gone and all stdio flushed) or on a spawn error.
  const closed = new Promise((resolve) => {
    const finish = () => {
      exited = true;
      live.delete(child.pid);
      resolve(undefined);
    };
    child.once("close", finish);
    child.once("error", (error) => {
      output += `\n[harness] child process error: ${error.stack ?? error}\n`;
      finish();
    });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  async function stop() {
    if (exited) return;
    killTree(child.pid, "SIGTERM");
    const timer = setTimeout(() => killTree(child.pid, "SIGKILL"), 5_000);
    await closed;
    clearTimeout(timer);
  }

  const logs = () => output.replace(ANSI, "");
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let baseUrl = "";
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited before it was ready:\n${logs()}`);
    baseUrl ||= logs().match(LISTEN_LINE)?.[1] ?? "";
    if (baseUrl) {
      try {
        // Never wait past the overall deadline, so the timeout message stays true.
        const remaining = Math.max(1, Math.min(5_000, deadline - Date.now()));
        await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(remaining) });
        return { baseUrl, stop, logs };
      } catch {
        /* not accepting yet */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop();
  throw new Error(`server not ready within ${READY_TIMEOUT_MS}ms:\n${logs()}`);
}
