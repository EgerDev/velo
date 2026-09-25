// Characterization tests: guards that already hold on the built server. Each
// request is rejected before any upstream fetch, so these run offline. They
// assert status codes only; W4a moves the bodies to `apiError` (contract C2).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";
import { NO_DB_URL, PROD_ENV } from "./env.mjs";

describe("API input guards", () => {
  let server;
  before(async () => {
    server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });
  });
  after(() => server?.stop());

  const get = (path) => fetch(`${server.baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
  const postJson = (path, body) =>
    fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

  for (const target of [
    "http://127.0.0.1:8080/",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.example/",
    "https://www.youtube.com.evil.example/",
    "https://www.youtube.com@evil.example/",
    "http://www.youtube.com/",
    "file:///etc/passwd",
    "",
  ]) {
    test(`relay refuses a non-allow-listed target: ${JSON.stringify(target)}`, async () => {
      const res = await get(`/api/relay?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 400);
    });
  }

  test("download without id/itag is 400", async () => {
    assert.equal((await get("/api/download")).status, 400);
  });

  test("captions without id/lang is 400", async () => {
    assert.equal((await get("/api/captions")).status, 400);
  });

  test("ytdlp rejects malformed JSON with 400", async () => {
    assert.equal((await postJson("/api/ytdlp", "{not json")).status, 400);
  });

  test("ytdlp rejects a bad video id with 400", async () => {
    const res = await postJson("/api/ytdlp", JSON.stringify({ id: "../../etc/passwd", itag: 18 }));
    assert.equal(res.status, 400);
  });

  // Roadmap D7/C5: the same-hop bypass and the server-side decipher/unlock
  // routes are deleted; their paths fall through to the 404 page. The inputs
  // are ones the old handlers rejected before any upstream fetch, so the
  // failing-first run stays offline too.
  test("GET /api/bypass is 404 (route deleted)", async () => {
    assert.equal((await get("/api/bypass")).status, 404);
  });

  test("POST /api/unlock is 404 (route deleted)", async () => {
    assert.equal((await postJson("/api/unlock", JSON.stringify({}))).status, 404);
  });

  test("GET /api/unlock is 404 (route deleted)", async () => {
    assert.equal((await get("/api/unlock")).status, 404);
  });

  // The deleted paths answer exactly what any unknown path does: the app's
  // HTML not-found page (AppNotFound), for GET and POST alike.
  test("the deleted routes serve the app's not-found page", async () => {
    for (const res of [
      await get("/api/bypass"),
      await get("/api/unlock"),
      await postJson("/api/unlock", JSON.stringify({})),
    ]) {
      assert.equal(res.status, 404, res.url);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8", res.url);
      assert.match(await res.text(), /This page doesn’t exist/, res.url);
    }
  });

  test("builder allows POST only", async () => {
    const res = await get("/api/builder");
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });
});
