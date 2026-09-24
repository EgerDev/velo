import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { buildChildEnv, startServer } from "./harness.mjs";
import { DB_URL, NEEDS_DB, NO_DB_URL, PROD_ENV, dbEnv } from "./env.mjs";

const ENTRY = fileURLToPath(new URL("../../.output/server/index.mjs", import.meta.url));
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "VELO_PUBLIC_ORIGIN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const FULL_ENV = { ...PROD_ENV, DATABASE_URL: NO_DB_URL };

/** Boots the built server synchronously; a correct refusal exits long before the timeout. */
function boot(childEnv) {
  return spawnSync(process.execPath, [ENTRY], { env: childEnv, encoding: "utf8", timeout: 20_000 });
}
const prodEnv = (env) => buildChildEnv(process.env, env);

describe("production boot refuses incomplete configuration", () => {
  test("no configuration: exits non-zero before listening and names all five variables, no values", () => {
    const run = boot(prodEnv({ BETTER_AUTH_SECRET: "too-short-secret-value" }));
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
    assert.notEqual(run.status, 0);
    assert.match(output, new RegExp(`EnvError: Missing or invalid required environment variables: ${REQUIRED.join(", ")}\\r?\\n`));
    assert.doesNotMatch(output, /Listening on/);
    assert.doesNotMatch(output, /too-short-secret-value/);
  });

  for (const name of REQUIRED) {
    test(`missing only ${name}: exits non-zero and names exactly that variable`, () => {
      const run = boot(prodEnv({ ...FULL_ENV, [name]: "" }));
      assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
      assert.notEqual(run.status, 0);
      assert.match(`${run.stdout}${run.stderr}`, new RegExp(`required environment variables: ${name}\\r?\\n`));
    });
  }

  for (const nodeEnv of [undefined, "development"]) {
    test(`the built server is production even with NODE_ENV=${nodeEnv ?? "(unset)"}`, () => {
      const env = prodEnv({});
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      else delete env.NODE_ENV;
      const run = boot(env);
      assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
      assert.notEqual(run.status, 0);
      assert.match(`${run.stdout}${run.stderr}`, /EnvError: Missing or invalid required environment variables: DATABASE_URL/);
    });
  }

  test("startServer rejects with the EnvError output", async () => {
    await assert.rejects(
      startServer({ env: {} }).then((s) => s.stop()),
      /server exited before it was ready:[\s\S]*EnvError: Missing or invalid required environment variables: DATABASE_URL/,
    );
  });
});

describe("GET /api/health with the database down", () => {
  let server;
  before(async () => {
    server = await startServer({ env: FULL_ENV });
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

  test("leaks no path, stack, driver message or connection string", async () => {
    const text = await (await fetch(`${server.baseUrl}/api/health?deep=1`)).text();
    assert.doesNotMatch(text, /ENOENT|ECONNREFUSED|\.output|node_modules|[A-Za-z]:\\|\bat \w+ \(|postgres:\/\/|velo-test@/i);
  });
});

describe("GET /api/health against a migrated Postgres", () => {
  let server;
  before(async () => {
    if (NEEDS_DB) return;
    server = await startServer({ env: dbEnv() });
  });
  after(() => server?.stop());

  test("deep check is 200 ok and never echoes the connection string", { skip: NEEDS_DB }, async () => {
    const res = await fetch(`${server.baseUrl}/api/health?deep=1`);
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.status, "ok");
    assert.equal(body.checks.database.ok, true);
    assert.doesNotMatch(text, new RegExp(new URL(DB_URL).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
