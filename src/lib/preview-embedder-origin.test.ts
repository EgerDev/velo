import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isGrokEmbedderOrigin,
  isSandboxPreviewGuestHost,
  resolveParentEmbedderOrigin,
} from "./preview-embedder-origin.ts";

test("embedder allowlist includes grok.com and grok.me", () => {
  assert.equal(isGrokEmbedderOrigin("https://grok.com"), true);
  assert.equal(isGrokEmbedderOrigin("https://www.grok.com"), true);
  assert.equal(isGrokEmbedderOrigin("https://grok.me"), true);
  assert.equal(isGrokEmbedderOrigin("https://chat.grok.me"), true);
  assert.equal(isGrokEmbedderOrigin("https://evil.example"), false);
});

test("guest hosts include grok.me sandbox", () => {
  assert.equal(isSandboxPreviewGuestHost("velo.grok.me"), true);
  assert.equal(isSandboxPreviewGuestHost("x.grok-sandbox.com"), true);
});

test("resolveParentEmbedderOrigin: grok.me parent of sandbox guest", () => {
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://grok.me/", "https://grok.me", "abc.grok-sandbox.com"),
    "https://grok.me",
  );
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://grok.com/", null, "velo.grok.me"),
    "https://grok.com",
  );
  assert.equal(resolveParentEmbedderOrigin(true, "https://grok.me/", null, "velo.grok.me"), null);
  assert.equal(resolveParentEmbedderOrigin(false, "https://evil.example/", null, "app.example"), null);
});
