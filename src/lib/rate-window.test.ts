import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimited, type RateState } from "./rate-window.ts";

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

test("sign-in link module is gone", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(new URL("./sign-in-link.ts", import.meta.url)), false);
});
