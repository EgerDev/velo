// Characterization tests: guards that already hold on the built server. Each
// request is rejected before any upstream fetch, so these run offline. They
// assert status codes only; W4a moves the bodies to `apiError` (contract C2).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };

describe("API input guards", () => {
  let server;
  before(async () => {
    server = await startServer({ env: BASE_ENV });
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

  test("bypass without id/itag is 400", async () => {
    assert.equal((await get("/api/bypass")).status, 400);
  });

  test("ytdlp rejects malformed JSON with 400", async () => {
    assert.equal((await postJson("/api/ytdlp", "{not json")).status, 400);
  });

  test("ytdlp rejects a bad video id with 400", async () => {
    const res = await postJson("/api/ytdlp", JSON.stringify({ id: "../../etc/passwd", itag: 18 }));
    assert.equal(res.status, 400);
  });

  test("unlock rejects a body without a stream URL with 400", async () => {
    assert.equal((await postJson("/api/unlock", JSON.stringify({}))).status, 400);
  });

  test("builder allows POST only", async () => {
    const res = await get("/api/builder");
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });
});
