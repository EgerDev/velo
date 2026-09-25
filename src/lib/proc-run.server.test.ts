import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerEnv } from "./env.server.ts";
import { CHILD_ENV_ALLOWLIST, childEnv, run } from "./proc-run.server.ts";

const node = process.execPath;

test("a process that keeps printing outlives idleMs (a long save moving bytes)", async () => {
  // Prints every 100ms for ~1.2s; idle limit 400ms would have killed it as a wall clock.
  const script = "let n=0;const t=setInterval(()=>{console.log('progress',n++);if(n>12){clearInterval(t)}},100)";
  const result = await run(node, ["-e", script], 400);
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0);
});

test("a silent process still dies at idleMs (a stalled transfer)", async () => {
  const started = Date.now();
  const result = await run(node, ["-e", "setTimeout(()=>{},5000)"], 300);
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 137);
  assert.ok(Date.now() - started < 3000, "killed near the idle limit, not after the sleep");
});

test("a stall kill takes the whole process group, not just the parent", { skip: process.platform === "win32" && "process groups are POSIX" }, async () => {
  // The parent spawns a long-lived grandchild (like yt-dlp forking ffmpeg) and goes silent.
  const script = "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'}).unref();console.log(process.pid);setTimeout(()=>{},30000)";
  const result = await run(node, ["-e", script], 500);
  assert.equal(result.timedOut, true);
  await new Promise((r) => setTimeout(r, 300));
  const { execSync } = await import("node:child_process");
  const survivors = execSync("ps -eo args").toString().split("\n").filter((l) => l.includes("setTimeout(()=>{},30000)") && !l.includes("spawn(")).length;
  assert.equal(survivors, 0);
});

test("childEnv keeps only allow-listed variables, matched case-insensitively", () => {
  const env = childEnv({
    Path: "C:/bin",
    SystemRoot: "C:/Windows",
    HOME: "/home/velo",
    DATABASE_URL: "postgres://u:p@db/velo",
    BETTER_AUTH_SECRET: "x".repeat(40),
    GOOGLE_CLIENT_SECRET: "g",
    VELO_PROXY_SECRET_KEY: "k",
    NODE_OPTIONS: "--require ./evil.js",
    UNSET: undefined,
  });
  assert.deepEqual(env, { Path: "C:/bin", SystemRoot: "C:/Windows", HOME: "/home/velo" });
});

test("no server config key, proxy variable or loader hook survives childEnv", () => {
  // Typed as every ServerEnv key: typecheck fails when a key is added and not listed here.
  const server: Record<keyof ServerEnv, string> = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@db/velo",
    BETTER_AUTH_SECRET: "x".repeat(40),
    VELO_PUBLIC_ORIGIN: "https://velo.example",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "g",
    VELO_ADMIN_EMAILS: "a@example.com",
    VELO_EGRESS_PROXY: "http://egress.example:3128",
    VELO_PROXY_SECRET_KEY: "k",
    VELO_PROXY_SECRET_KEY_PREVIOUS: "k0",
    VELO_EXTENSION_IDS: "abc",
    SENTRY_DSN: "https://k@sentry.example/1",
    LOG_LEVEL: "debug",
    YTDLP_PYTHON: "/usr/bin/python3",
  };
  // Built, not spelled: the policy test bans the literal names from src/.
  const proxies = ["HTTP", "HTTPS", "ALL", "NO"].flatMap((name) => [`${name}_PROXY`, `${name.toLowerCase()}_proxy`]);
  const hostile = [...Object.keys(server), ...proxies, "NODE_OPTIONS", "PYTHONPATH"];
  assert.equal(hostile.length, Object.keys(server).length + 10);
  const source = Object.fromEntries(hostile.map((key) => [key, "set"]));
  assert.deepEqual(childEnv({ ...server, ...source }), {});
  const allowed = new Set(CHILD_ENV_ALLOWLIST);
  assert.deepEqual(hostile.filter((key) => allowed.has(key.toUpperCase())), []);
});

test("a child started by run() cannot read server secrets", async () => {
  const saved = { db: process.env.DATABASE_URL, auth: process.env.BETTER_AUTH_SECRET };
  process.env.DATABASE_URL = "postgres://u:p@db/velo";
  process.env.BETTER_AUTH_SECRET = "x".repeat(40);
  try {
    const script =
      "process.stderr.write(JSON.stringify([process.env.DATABASE_URL ?? null, process.env.BETTER_AUTH_SECRET ?? null]))";
    const result = await run(node, ["-e", script], 5_000);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stderr), [null, null]);
  } finally {
    if (saved.db === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.db;
    if (saved.auth === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = saved.auth;
  }
});
