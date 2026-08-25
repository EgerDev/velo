import assert from "node:assert/strict";
import { test } from "node:test";
import { isBuilderPreview, isGrokHost, isSandboxHost, safeDownloadName } from "./builder-env.ts";

test("builder preview is false in Node (no window)", () => {
  assert.equal(isBuilderPreview(), false);
});

test("safeDownloadName strips path characters and stays short", () => {
  assert.equal(safeDownloadName("nice.mp4"), "nice.mp4");
  assert.equal(safeDownloadName("a/b\\c:d*.mp4"), "a_b_c_d_.mp4");
  assert.equal(safeDownloadName(""), "video");
  assert.ok(safeDownloadName("x".repeat(400)).length <= 180);
});

test("grok.me and grok.com are Grok parent hosts", () => {
  assert.equal(isGrokHost("grok.com"), true);
  assert.equal(isGrokHost("www.grok.com"), true);
  assert.equal(isGrokHost("grok.me"), true);
  assert.equal(isGrokHost("velo.grok.me"), true);
  assert.equal(isGrokHost("notgrok.me"), false);
  assert.equal(isGrokHost("evil.com"), false);
});

test("grok.me and grok-sandbox are sandbox/guest hosts", () => {
  assert.equal(isSandboxHost("abc.grok-sandbox.com"), true);
  assert.equal(isSandboxHost("grok-sandbox.com"), true);
  assert.equal(isSandboxHost("velo.grok.me"), true);
  assert.equal(isSandboxHost("grok.me"), true);
  assert.equal(isSandboxHost("grok.com"), false);
});
