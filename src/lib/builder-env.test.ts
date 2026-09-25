import assert from "node:assert/strict";
import { test } from "node:test";
import { safeDownloadName } from "./builder-env.ts";

test("safeDownloadName strips path characters and stays short", () => {
  assert.equal(safeDownloadName("nice.mp4"), "nice.mp4");
  assert.equal(safeDownloadName("a/b\\c:d*.mp4"), "a_b_c_d_.mp4");
  assert.equal(safeDownloadName(""), "video");
  assert.ok(safeDownloadName("x".repeat(400)).length <= 180);
});
