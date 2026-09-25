import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAuthError, describeOAuthSearch } from "./auth-errors.ts";

test("maps Google OAuth failures for the login page", () => {
  assert.equal(describeAuthError("access_denied").code, "access_denied");
  assert.equal(describeAuthError("state_mismatch").code, "state_mismatch");
  assert.equal(describeAuthError("please_restart_the_process").code, "state_mismatch");
  assert.equal(describeAuthError("redirect_uri_mismatch").code, "oauth_config");
  assert.equal(describeAuthError("oauth_provider_not_found").code, "oauth_config");
  assert.equal(describeAuthError("temporarily_unavailable").code, "oauth_server");
  assert.equal(describeAuthError("Too many requests. Please try again later.").code, "rate_limited");
  assert.equal(describeAuthError("Invalid origin").code, "origin");
  assert.equal(describeAuthError("INVALID_CALLBACK_URL").code, "origin");
  assert.equal(describeAuthError("Failed to fetch").code, "network");
});

test("substrings inside other words do not pick a category", () => {
  assert.equal(describeAuthError("Could not generate a token").code, "unknown");
  assert.equal(describeAuthError("separate accounts").code, "unknown");
  assert.equal(describeAuthError("Unexpected state of the session").code, "unknown");
});

test("exact codes win, including Better Auth's rate-limit response", () => {
  assert.equal(describeAuthError("Too many requests. Please try again later.").code, "rate_limited");
  assert.equal(describeAuthError("429").code, "rate_limited");
  assert.equal(describeAuthError("access denied (429)").code, "rate_limited");
});

test("unknown failures never echo the raw message", () => {
  const info = describeAuthError("Error: connect ECONNREFUSED 10.0.0.5:5432 at pg.Client");
  assert.equal(info.code, "unknown");
  assert.doesNotMatch(`${info.title} ${info.detail} ${info.action}`, /ECONNREFUSED|10\.0\.0\.5|pg\./);
});

test("sign-in copy names only Google: no email, password, X, pop-up, broker or library", () => {
  const samples = [
    "access_denied",
    "state_mismatch",
    "redirect_uri_mismatch",
    "server_error",
    "Too many requests",
    "Invalid origin",
    "Failed to fetch",
    "something else",
  ];
  for (const raw of samples) {
    const { title, detail, action } = describeAuthError(raw);
    assert.doesNotMatch(`${title} ${detail} ${action}`, /email|password|\bX\b|pop-?up|broker|Better Auth|Grok/i, raw);
  }
});

test("maps OAuth callback search params", () => {
  assert.equal(describeOAuthSearch(undefined), null);
  assert.equal(describeOAuthSearch("access_denied")?.code, "access_denied");
  assert.equal(describeOAuthSearch("oauth", "server_error")?.code, "oauth_server");
});
