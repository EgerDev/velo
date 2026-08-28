import assert from "node:assert/strict";
import { test } from "node:test";
import { fileBasename, stripUnsafeFilenameChars } from "./safe-filename.ts";

test("stripUnsafeFilenameChars drops path and control characters", () => {
  assert.equal(stripUnsafeFilenameChars('a/b\\c:d*e?f"g<h>i|j'), "abcdefghij");
  assert.equal(stripUnsafeFilenameChars("ok\u0000title\u001f"), "oktitle");
  assert.equal(fileBasename("  My: Video / 1  "), "My Video 1");
  assert.equal(fileBasename("   "), "video");
  assert.equal(fileBasename("x".repeat(200)).length, 120);
});
