import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEmailAllowlist,
  rateLimited,
  signInLinkAvailability,
  signInLinkDenial,
  type RateState,
} from "./sign-in-link-policy.ts";

test("a deployed app with working OAuth does not offer sign-in links", () => {
  // The token comes back to the caller instead of the address's owner, so with
  // another way in the flow is pure account-takeover surface.
  const available = signInLinkAvailability({ authConfigured: true });
  assert.equal(available.enabled, false);
  assert.match(signInLinkDenial("victim@example.com", available) ?? "", /can’t send email/);
});

test("local dev with no federated sign-in keeps the only door open", () => {
  const available = signInLinkAvailability({ authConfigured: false });
  assert.equal(available.enabled, true);
  assert.equal(signInLinkDenial("dev@example.com", available), null);
});

test("an allowlist restricts minting to named addresses in any environment", () => {
  const available = signInLinkAvailability({
    authConfigured: true,
    allowlist: "Owner@Example.com, second@example.com",
  });
  assert.equal(available.enabled, true);
  assert.equal(signInLinkDenial("owner@example.com", available), null);
  assert.equal(signInLinkDenial("  OWNER@example.com  ", available), null);
  assert.equal(signInLinkDenial("second@example.com", available), null);
  // The refusal never reveals who is on the list.
  const denial = signInLinkDenial("victim@example.com", available);
  assert.match(denial ?? "", /can’t use a sign-in link/);
  assert.doesNotMatch(denial ?? "", /owner@example\.com/);
});

test("the off switch beats every other setting", () => {
  const available = signInLinkAvailability({
    authConfigured: false,
    override: "false",
    allowlist: "owner@example.com",
  });
  assert.equal(available.enabled, false);
  assert.ok(signInLinkDenial("owner@example.com", available));
});

test("an explicit opt-in re-opens it on a configured deployment", () => {
  const available = signInLinkAvailability({ authConfigured: true, override: "true" });
  assert.equal(available.enabled, true);
  assert.equal(signInLinkDenial("anyone@example.com", available), null);
});

test("parseEmailAllowlist tolerates spacing, case, and empty entries", () => {
  assert.deepEqual(parseEmailAllowlist(" A@b.com ,, c@D.com,"), ["a@b.com", "c@d.com"]);
  assert.deepEqual(parseEmailAllowlist(""), []);
  assert.deepEqual(parseEmailAllowlist(undefined), []);
});

test("rate limiting trips after the limit and recovers past the window", () => {
  const state: RateState = new Map();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimited(state, "email:a@b.com", now + i, 5, 60_000), false);
  }
  // Sixth attempt inside the window is over the limit.
  assert.equal(rateLimited(state, "email:a@b.com", now + 5, 5, 60_000), true);
  // A different key is tracked separately.
  assert.equal(rateLimited(state, "email:c@d.com", now + 5, 5, 60_000), false);
  // Once the window rolls past, the address is allowed again.
  assert.equal(rateLimited(state, "email:a@b.com", now + 120_000, 5, 60_000), false);
});
