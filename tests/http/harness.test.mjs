import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };

test("ambient NITRO_PORT/NITRO_HOST/DATABASE_URL never reach the server under test", async () => {
  const keys = ["NITRO_PORT", "NITRO_HOST", "DATABASE_URL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NITRO_PORT = "1";
  process.env.NITRO_HOST = "0.0.0.0";
  process.env.DATABASE_URL = "postgres://must-not-be-used@127.0.0.1:1/none";
  try {
    const server = await startServer({ env: BASE_ENV });
    try {
      assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(server.baseUrl).port, "1");
      const body = await (await fetch(`${server.baseUrl}/api/health`)).json();
      assert.equal(body.checks.database.source, "pglite");
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
  const server = await startServer({ env: BASE_ENV });
  assert.match(server.logs(), /Listening on:/);
  await server.stop();
  await server.stop();
  await assert.rejects(fetch(`${server.baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) }));
});
