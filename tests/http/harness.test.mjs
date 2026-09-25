import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESS_ENV_ALLOWLIST, buildChildEnv, startServer } from "./harness.mjs";
import { NO_DB_URL, PROD_ENV } from "./env.mjs";

const BOOT_ENV = { ...PROD_ENV, DATABASE_URL: NO_DB_URL };

test("the child env allowlist is exactly the OS/runtime basics", () => {
  assert.deepEqual(
    [...HARNESS_ENV_ALLOWLIST].sort(),
    ["APPDATA", "CI", "COMSPEC", "HOME", "LANG", "LOCALAPPDATA", "PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "TZ", "USERPROFILE", "WINDIR"],
  );
});

test("buildChildEnv drops the developer's shell, keeps OS basics, lets overrides win and forces the runtime vars last", () => {
  const ambient = {
    Path: "C:/bin",
    SystemRoot: "C:/Windows",
    windir: "C:/Windows",
    HOME: "/home/dev",
    CI: "true",
    VELO_ALLOW_TOOL_INSTALL: "1",
    TRUST_CLOUDFLARE: "1",
    VELO_ADMIN_EMAILS: "dev@example.test",
    GOOGLE_CLIENT_SECRET: "ambient",
    BETTER_AUTH_SECRET: "ambient",
    NODE_OPTIONS: "--inspect",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    HTTPS_PROXY: "http://proxy.invalid",
    https_proxy: "http://proxy.invalid",
    LOG_LEVEL: "debug",
    DATABASE_URL: "postgres://dev@127.0.0.1:1/dev",
    NITRO_PORT: "1",
    NITRO_HOST: "0.0.0.0",
    NODE_ENV: "development",
    HOST: "0.0.0.0",
    PORT: "8080",
  };
  const overrides = { LOG_LEVEL: "warn", DATABASE_URL: "postgres://test", NODE_ENV: "test", PORT: "9", NITRO_PORT: "2" };
  assert.deepEqual(buildChildEnv(ambient, overrides), {
    Path: "C:/bin",
    SystemRoot: "C:/Windows",
    windir: "C:/Windows",
    HOME: "/home/dev",
    CI: "true",
    LOG_LEVEL: "warn",
    DATABASE_URL: "postgres://test",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
  });
  assert.deepEqual(buildChildEnv(ambient), {
    Path: "C:/bin",
    SystemRoot: "C:/Windows",
    windir: "C:/Windows",
    HOME: "/home/dev",
    CI: "true",
    DATABASE_URL: "",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
  });
});

// buildChildEnv's unit test above covers the full allowlist (VELO_*, TRUST_*, ...).
test("an ambient DATABASE_URL never reaches the server: production boot reports it missing", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://must-not-be-used@127.0.0.1:1/none";
  try {
    await assert.rejects(
      startServer({ env: PROD_ENV }).then((s) => s.stop()),
      /EnvError: Missing or invalid required environment variables: DATABASE_URL\r?\n/,
    );
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test("ambient NITRO_PORT/NITRO_HOST leave the server on 127.0.0.1:<ephemeral>", async () => {
  const keys = ["NITRO_PORT", "NITRO_HOST", "VELO_ALLOW_TOOL_INSTALL", "TRUST_CLOUDFLARE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NITRO_PORT = "1";
  process.env.NITRO_HOST = "0.0.0.0";
  process.env.VELO_ALLOW_TOOL_INSTALL = "1";
  process.env.TRUST_CLOUDFLARE = "1";
  try {
    const server = await startServer({ env: BOOT_ENV });
    try {
      assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(server.baseUrl).port, "1");
      const body = await (await fetch(`${server.baseUrl}/api/health`)).json();
      assert.equal(body.checks.database.source, "neon");
    } finally {
      await server.stop();
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("stop() kills the server, frees the port and is idempotent", async () => {
  const server = await startServer({ env: BOOT_ENV });
  try {
    assert.match(server.logs(), /Listening on:/);
  } finally {
    await server.stop();
  }
  await server.stop();
  await assert.rejects(fetch(`${server.baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) }));
});
