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

  test("an unknown ?error is shown as fixed copy, never reflected", async () => {
    const res = await fetch(
      `${server.baseUrl}/login?error=zzq_marker&error_description=%3Cb%3Eyyq_marker%3C%2Fb%3E`,
    );
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Sign-in failed/);
    for (const raw of ["zzq_marker", "yyq_marker", "<b>"]) assert.equal(html.includes(raw), false, raw);
    // Copy check skips only <head>: it carries share-card meta (`twitter:card`), not copy.
    const body = html.replace(/<head>[\s\S]*<\/head>/, "");
    assert.match(body, /Sign-in failed/);
    assert.doesNotMatch(body, /pop-?up|broker|password|Twitter|Sign in with email/i);
  });
});
