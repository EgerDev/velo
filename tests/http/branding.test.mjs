// The app-builder platform's branding injector is gone: no third-party script,
// no platform manifest, no install tutorial (PRIV-05, WEB-03, ARCH-06, SUP-02).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";
import { NO_DB_URL, PROD_ENV } from "./env.mjs";

describe("no platform branding in served pages", () => {
  let server;
  before(async () => {
    server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });
  });
  after(() => server?.stop());

  for (const path of ["/", "/login", "/?install=1&platform=ios"]) {
    test(`${path} loads no third-party script and names no platform`, async () => {
      const res = await fetch(`${server.baseUrl}${path}`);
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.doesNotMatch(html, /grok\.com|grok\.me|grok-app-builder|__grok|Created with Grok/i);
      for (const src of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        assert.ok(src[1].startsWith("/"), `third-party script ${src[1]}`);
      }
    });
  }

  test("the platform manifest path is gone", async () => {
    assert.equal((await fetch(`${server.baseUrl}/__grok/manifest.webmanifest`)).status, 404);
  });
});
