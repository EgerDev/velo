import assert from "node:assert/strict";
import { test } from "node:test";
import { cipherUrl, describeNsig, nsigCache, nsigCacheLookup, nsigReport, readNParam, rememberNsig } from "./nsig.ts";

test("reads n from a googlevideo URL", () => {
  const url = "https://r1---sn-a.googlevideo.com/videoplayback?n=rawToken123&itag=137";
  assert.equal(readNParam(url), "rawToken123");
});

test("extracts the inner stream URL (and its raw n) from a signatureCipher", () => {
  const inner = "https://r1---sn-a.googlevideo.com/videoplayback?n=rawToken123&itag=137";
  const cipher = `s=SIGVALUE%3D%3D&sp=sig&url=${encodeURIComponent(inner)}`;
  // The raw cipher hides its inner n behind percent-encoding...
  assert.equal(readNParam(cipher), null);
  // ...but cipherUrl recovers the real URL, and its n is readable.
  assert.equal(cipherUrl(cipher), inner);
  assert.equal(readNParam(cipherUrl(cipher)), "rawToken123");
  assert.equal(cipherUrl(undefined), null);
  assert.equal(cipherUrl("not a cipher"), null);
});

test("a signatureCipher decipher counts as transformed when n actually changes", () => {
  // Reproduces the decipherRawFormat path: raw n from the cipher's inner url,
  // solved n from the returned url. Passing the raw cipher string as `before`
  // used to make raw===solved and spuriously report "not transformed".
  const inner = "https://gv.example/videoplayback?n=rawN0000&itag=251";
  const cipher = `s=ABC&sp=sig&url=${encodeURIComponent(inner)}`;
  const solved = "https://gv.example/videoplayback?n=solvedN99&itag=251";
  const report = nsigReport(cipherUrl(cipher), solved);
  assert.equal(report.transformed, true);
  assert.equal(report.raw, "rawN0000");
  assert.equal(report.solved, "solvedN99");
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
