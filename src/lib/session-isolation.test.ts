import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionTokenKey } from "./session-token.ts";

test("session token key is unique and strips a cookie signature", () => {
  assert.equal(sessionTokenKey("abc123def456"), "abc123def456");
  assert.equal(sessionTokenKey("abc123def456.signature"), "abc123def456");
  assert.equal(sessionTokenKey("  tok.sig  "), "tok");
  assert.equal(sessionTokenKey(""), "");
  assert.equal(sessionTokenKey(null), "");
  assert.notEqual(sessionTokenKey("alice-session"), sessionTokenKey("bob-session"));
});
