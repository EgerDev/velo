import assert from "node:assert/strict";
import { test } from "node:test";
import { readSessionTokenFromHeaders, sessionTokenKey } from "./session-token.ts";

test("session token key is unique and strips a cookie signature", () => {
  assert.equal(sessionTokenKey("abc123def456"), "abc123def456");
  assert.equal(sessionTokenKey("abc123def456.signature"), "abc123def456");
  assert.equal(sessionTokenKey("  tok.sig  "), "tok");
  assert.equal(sessionTokenKey(""), "");
  assert.equal(sessionTokenKey(null), "");
  assert.notEqual(sessionTokenKey("alice-session"), sessionTokenKey("bob-session"));
});

test("reads the bearer session token from request headers", () => {
  const headers = new Headers({ authorization: "Bearer alice-token.sig" });
  assert.equal(readSessionTokenFromHeaders(headers), "alice-token");
  assert.equal(readSessionTokenFromHeaders(new Headers()), "");
});
