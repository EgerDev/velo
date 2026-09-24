import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";

test("no committed OAuth client secret remains in source", () => {
  assert.equal(existsSync(new URL("./preview.ts", import.meta.url)), false);
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /PREVIEW_CLIENT_SECRET|PREVIEW_CLIENT_ID/);
});
