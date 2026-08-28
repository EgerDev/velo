import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpConnectProxy } from "./proxy-test-fixtures/http-connect.ts";
import { createSocks5Proxy } from "./proxy-test-fixtures/socks5.ts";
import { createRangeTarget, createStatusTarget } from "./proxy-test-fixtures/target.ts";
import { PRODUCTION_VALIDATION_TARGETS, validateProxyRoute } from "./proxy-validator.server.ts";

test("Given production validator targets, When inspected, Then transport is generate_204 and metadata is youtubei with no static media target", () => {
  assert.deepEqual(PRODUCTION_VALIDATION_TARGETS, { routeProbeUrl: "https://redirector.googlevideo.com/generate_204", metadataUrl: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false" });
  assert.equal("mediaUrl" in PRODUCTION_VALIDATION_TARGETS, false);
});

test("Given an exact HTTP route, When all bounded stages pass, Then validation records ordered sanitized evidence", async () => {
  // Given
  const route = await createStatusTarget(204);
  const target = await createRangeTarget(Buffer.alloc(12 * 1024, 7));
  const mediaUrl = `${target.url}?videoId=jNQXAC9IVRw`;
  const metadata = await createRangeTarget(Buffer.from(JSON.stringify({ videoId: "jNQXAC9IVRw", mediaUrl })));
  const proxy = await createHttpConnectProxy();
  try {
    // When
    const result = await validateProxyRoute(proxy.url, {
      routeProbeUrl: route.url, metadataUrl: metadata.url,
      timeoutMs: 2_000, allowPrivateProxyForTests: true,
    });
    // Then
    assert.equal(result.classification.verdict, "healthy");
    assert.deepEqual(result.evidence.map((item) => item.stage), ["connection", "tls", "route_probe", "metadata", "media_range"]);
    assert.equal(result.evidence.at(-1)?.bytesRead, 10 * 1024);
    assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1:\d+/);
  } finally { await Promise.all([proxy.close(), route.close(), metadata.close(), target.close()]); }
});

test("Given an exact SOCKS5 route, When all bounded stages pass, Then the same staged validator succeeds", async () => {
  // Given
  const route = await createStatusTarget(204);
  const target = await createRangeTarget(Buffer.alloc(12 * 1024, 9));
  const mediaUrl = `${target.url}?videoId=jNQXAC9IVRw`;
  const metadata = await createRangeTarget(Buffer.from(JSON.stringify({ videoId: "jNQXAC9IVRw", mediaUrl })));
  const proxy = await createSocks5Proxy();
  try {
    // When
    const result = await validateProxyRoute(proxy.url, { routeProbeUrl: route.url, metadataUrl: metadata.url, timeoutMs: 2_000, allowPrivateProxyForTests: true });
    // Then
    assert.equal(result.classification.verdict, "healthy");
    assert.equal(result.evidence.at(-1)?.bytesRead, 10 * 1024);
  } finally { await Promise.all([proxy.close(), route.close(), metadata.close(), target.close()]); }
});

test("Given metadata for a different video, When the isolated metadata stage runs, Then the route cannot pass", async () => {
  const route = await createStatusTarget(204);
  const media = await createRangeTarget(Buffer.alloc(12 * 1024));
  const metadata = await createRangeTarget(Buffer.from(JSON.stringify({ videoId: "aaaaaaaaaaa", mediaUrl: `${media.url}?videoId=jNQXAC9IVRw` })));
  const proxy = await createHttpConnectProxy();
  try {
    const result = await validateProxyRoute(proxy.url, { routeProbeUrl: route.url, metadataUrl: metadata.url, allowPrivateProxyForTests: true });
    assert.equal(result.classification.verdict === "healthy", false);
    assert.equal(media.requests().length, 0);
  } finally { await Promise.all([proxy.close(), route.close(), metadata.close(), media.close()]); }
});

test("Given a hanging exact route, When the deadline expires, Then timeout is explicit and later stages are skipped", async () => {
  // Given
  const target = await createRangeTarget(Buffer.alloc(1), "hang");
  const proxy = await createHttpConnectProxy();
  try {
    // When
    const result = await validateProxyRoute(proxy.url, { routeProbeUrl: target.url, metadataUrl: target.url, timeoutMs: 40, allowPrivateProxyForTests: true });
    // Then
    assert.equal(result.errorCode, "timeout");
    assert.equal(result.classification.verdict, "unreachable");
    assert.equal(result.evidence.slice(1).every((item) => item.outcome === "skipped"), true);
  } finally { await Promise.all([proxy.close(), target.close()]); }
});

test("Given malformed input, When validation starts, Then it fails safely without echoing credentials", async () => {
  // Given / When
  const result = await validateProxyRoute("http://sentinel:secret@bad", { timeoutMs: 50 });
  // Then
  assert.equal(result.classification.verdict, "misconfigured");
  assert.doesNotMatch(JSON.stringify(result), /sentinel|secret/);
});
