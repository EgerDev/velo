import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldUseOAuthPopup } from "./oauth-popup.ts";

test("Google OAuth uses a popup in preview iframes and on grok-sandbox hosts", () => {
  assert.equal(shouldUseOAuthPopup("abc.grok-sandbox.com", false), true);
  assert.equal(shouldUseOAuthPopup("grok-sandbox.com", false), true);
  assert.equal(shouldUseOAuthPopup("velo.example", true), true);
  assert.equal(shouldUseOAuthPopup("app.velo.dev", false), false);
  assert.equal(shouldUseOAuthPopup("velo.grok.me", true), true);
  assert.equal(shouldUseOAuthPopup("velo.grok.me", false), false);
});
