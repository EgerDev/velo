import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheBudget, cacheKey, isUsableCachedBlob, pickEvictions, planRecentSave, setMediaCacheOwner } from "./media-cache.ts";

test("cache key is unique per account", () => {
  setMediaCacheOwner("guest");
  assert.equal(cacheKey("dQw4w9WgXcQ", 137), "guest:dQw4w9WgXcQ:137");
  setMediaCacheOwner("u:alice");
  assert.equal(cacheKey("dQw4w9WgXcQ", 137), "u:alice:dQw4w9WgXcQ:137");
  assert.notEqual(cacheKey("dQw4w9WgXcQ", 137, "u:alice"), cacheKey("dQw4w9WgXcQ", 137, "u:bob"));
  setMediaCacheOwner("guest");
});

test("cache budget never exceeds 40% of quota or 180MB", () => {
  const gb = 1024 ** 3;
  assert.ok(cacheBudget(gb, 0, true) <= 180 * 1024 * 1024);
  assert.equal(cacheBudget(10 * 1024 * 1024, 8 * 1024 * 1024, false), Math.min(10 * 1024 * 1024 * 0.2, (2 * 1024 * 1024) * 0.7));
  assert.equal(cacheBudget(0, 0, false), 180 * 1024 * 1024);
});

test("evict oldest until under item and byte caps", () => {
  const drop = pickEvictions(
    [
      { key: "a", savedAt: 1, size: 50 },
      { key: "b", savedAt: 2, size: 50 },
      { key: "c", savedAt: 3, size: 50 },
    ],
    40,
    3,
    150,
  );
  assert.deepEqual(drop, ["a"]);
});

test("a blob bigger than the cache does not evict existing items", () => {
  const drop = pickEvictions(
    [
      { key: "a", savedAt: 1, size: 50 },
      { key: "b", savedAt: 2, size: 50 },
      { key: "c", savedAt: 3, size: 50 },
      { key: "d", savedAt: 4, size: 50 },
    ],
    200,
    4,
    150,
  );
  assert.deepEqual(drop, []);
});

test("Recent save: cache hit skips YouTube, miss fetches", () => {
  assert.equal(planRecentSave(true).action, "local");
  assert.equal(planRecentSave(false).action, "fetch");
  assert.match(planRecentSave(false).label, /fetching from YouTube/);
});

test("corrupt or tiny blobs are cache misses", () => {
  assert.equal(isUsableCachedBlob(null), false);
  assert.equal(isUsableCachedBlob(new Blob(["x"], { type: "video/mp4" })), false);
  assert.equal(isUsableCachedBlob(new Blob(["<html></html>"], { type: "text/html" })), false);
  assert.equal(isUsableCachedBlob(new Blob([new Uint8Array(4096)], { type: "video/mp4" })), true);
});
