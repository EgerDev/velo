import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };
const DB_URL = process.env.VELO_TEST_DATABASE_URL ?? "";

describe("GET /api/health without a database", () => {
  let server;
  before(async () => {
    server = await startServer({ env: BASE_ENV });
  });
  after(() => server?.stop());

  test("answers 503 degraded with a fixed detail and no-store", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    const body = await res.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.checks.database.ok, false);
    assert.equal(body.checks.database.detail, "database unreachable");
  });

  test("leaks no path, stack or driver message", async () => {
    const text = await (await fetch(`${server.baseUrl}/api/health?deep=1`)).text();
    assert.doesNotMatch(text, /ENOENT|\.output|node_modules|[A-Za-z]:\\|\bat \w+ \(|postgres:\/\//i);
  });
});

describe("GET /api/health against a migrated Postgres", () => {
  // Runs everywhere VELO_TEST_DATABASE_URL is set; CI always sets it (ci.yml `verify` job).
  const skip = !DB_URL && !process.env.CI ? "set VELO_TEST_DATABASE_URL to a migrated Postgres" : false;
  let server;
  before(async () => {
    if (skip) return;
    assert.ok(DB_URL, "VELO_TEST_DATABASE_URL must be set in CI");
    server = await startServer({ env: { ...BASE_ENV, DATABASE_URL: DB_URL } });
  });
  after(() => server?.stop());

  test("deep check is 200 ok and never echoes the connection string", { skip }, async () => {
    const res = await fetch(`${server.baseUrl}/api/health?deep=1`);
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.status, "ok");
    assert.equal(body.checks.database.ok, true);
    assert.doesNotMatch(text, new RegExp(new URL(DB_URL).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
