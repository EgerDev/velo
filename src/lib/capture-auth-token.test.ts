import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAuthError, describeOAuthSearch, friendlyAuthError, messageForOAuthSearch } from "./capture-auth-token.ts";

test("maps OAuth and credential failures for the login page", () => {
  assert.equal(describeAuthError("Pop-up blocked — allow pop-ups for sign-in").code, "popup_blocked");
  assert.equal(describeAuthError("Sign-in was cancelled or failed").code, "cancelled");
  assert.equal(describeAuthError("access_denied").code, "access_denied");
  assert.equal(describeAuthError("state mismatch").code, "state_mismatch");
  assert.equal(describeAuthError("redirect_uri mismatch").code, "oauth_config");
  assert.equal(describeAuthError("temporarily_unavailable").code, "oauth_server");
  assert.equal(describeAuthError("USER_ALREADY_EXISTS").code, "exists");
  assert.equal(describeAuthError("invalid password").code, "credentials");
  // better-auth's actual wrong-password/unknown-account message — must map to
  // "credentials", NOT fall through to the "invalid email" bucket.
  assert.equal(describeAuthError("Invalid email or password").code, "credentials");
  assert.equal(describeAuthError("Invalid origin").code, "origin");
  assert.match(friendlyAuthError("Pop-up blocked — allow pop-ups for sign-in"), /Pop-up blocked/);
});

test("maps OAuth callback search params with details", () => {
  assert.equal(messageForOAuthSearch(undefined), null);
  const denied = describeOAuthSearch("access_denied");
  assert.equal(denied?.code, "access_denied");
  assert.match(denied?.action ?? "", /email/i);
  const oauth = describeOAuthSearch("oauth", "server_error");
  assert.ok(oauth?.code === "oauth_server" || oauth?.code === "oauth");
  assert.ok((oauth?.detail.length ?? 0) > 10);
});
