import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNsig, nsigCache, nsigCacheLookup, nsigReport, readNParam, rememberNsig } from "./nsig.ts";

test("reads n from a googlevideo URL", () => {
  const url = "https://r1---sn-a.googlevideo.com/videoplayback?n=rawToken123&itag=137";
  assert.equal(readNParam(url), "rawToken123");
});

test("nsig is solved only when n changes", () => {
  const before = "https://gv.example/videoplayback?n=abcDEF12";
  const after = "https://gv.example/videoplayback?n=solvedN99";
  const ok = nsigReport(before, after);
  assert.equal(ok.transformed, true);
  assert.match(describeNsig(ok), /solved/);
  const same = nsigReport(before, before);
  assert.equal(same.transformed, false);
  assert.match(describeNsig(same), /cache miss/);
});

test("stale cache entry (raw === solved) is a miss and is dropped", () => {
  nsigCache.clear();
  rememberNsig("abc", "abc");
  assert.equal(nsigCache.has("abc"), false);
  nsigCache.set("abc", "abc");
  const miss = nsigCacheLookup("abc");
  assert.equal("miss" in miss, true);
  assert.equal(nsigCache.has("abc"), false);
});

test("cache hit returns the solved n", () => {
  nsigCache.clear();
  rememberNsig("rawN", "solvedN");
  const hit = nsigCacheLookup("rawN");
  assert.equal("hit" in hit && hit.hit, "solvedN");
});
