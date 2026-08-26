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

test("a sandbox guest does not trust an arbitrary framer", () => {
  // Being sandbox-hosted is not a reason to trust whoever framed us: an
  // attacker embedding the preview URL must not receive the bridge handshake.
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://evil.example/", null, "abc.grok-sandbox.com"),
    null,
  );
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://evil.example/", "https://evil.example", "velo.grok.me"),
    null,
  );
  // A lookalike suffix is not a sandbox host either.
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://grok.me.evil.example/", null, "abc.grok-sandbox.com"),
    null,
  );
  // Sandbox shells framing a sandbox guest stay trusted.
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://shell.grok-sandbox.com/", null, "abc.grok-sandbox.com"),
    "https://shell.grok-sandbox.com",
  );
});

test("remint preview pairing still resolves without a sandbox guest host", () => {
  assert.equal(
    resolveParentEmbedderOrigin(false, "https://example.dev/", null, "app.preview.example.dev"),
    "https://example.dev",
  );
});
