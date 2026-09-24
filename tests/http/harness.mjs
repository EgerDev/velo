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
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {Promise<{ baseUrl: string; stop(): Promise<void>; logs(): string }>}
 */
export async function startServer({ env = {} } = {}) {
  if (!existsSync(ENTRY)) {
    throw new Error(`${ENTRY} is missing. Run \`npm run build\` before \`npm run test:http\`.`);
  }
  const childEnv = {
    ...process.env,
    // An ambient DATABASE_URL must never leak into a test; tests pass their own.
    DATABASE_URL: "",
    ...env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
  };
  // NITRO_PORT wins over PORT even when empty (`??`), so it must be absent.
  delete childEnv.NITRO_PORT;
  delete childEnv.NITRO_HOST;

  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    // Own process group on POSIX, so stop() can signal the whole tree.
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });

  let output = "";
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve(undefined);
    });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const kill = (signal) => {
    try {
      if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
  };

  async function stop() {
    if (exited) return;
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 5_000);
    await exit;
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
        await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
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
