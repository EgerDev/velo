// /login offers Google sign-in and nothing else (roadmap D4, SEC-08).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";
import { NO_DB_URL, PROD_ENV } from "./env.mjs";

describe("the sign-in page", () => {
  let server;
  before(async () => {
    server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });
  });
  after(() => server?.stop());

  test("offers Google only: no email or password form", async () => {
    const res = await fetch(`${server.baseUrl}/login`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Continue with Google/);
    assert.doesNotMatch(html, /type="password"|type="email"|Create an account|Sign in with email/);
  });
});
