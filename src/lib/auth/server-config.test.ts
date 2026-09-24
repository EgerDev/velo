import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { assertAuthConfiguredForProduction } from "./auth-boot-policy.ts";

test("no committed OAuth client secret remains in source", () => {
  assert.equal(existsSync(new URL("./preview.ts", import.meta.url)), false);
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /PREVIEW_CLIENT_SECRET|PREVIEW_CLIENT_ID/);
});

test("production with auth enabled but unconfigured refuses to boot", () => {
  assert.throws(
    () => assertAuthConfiguredForProduction({ nodeEnv: "production", authDisabled: false, authConfigured: false }),
    /\[auth\] GROK_AUTH_CLIENT_ID/,
  );
  assert.throws(
    () => assertAuthConfiguredForProduction({ nodeEnv: "production", authDisabled: false, authConfigured: false }),
    (err: Error) => {
      assert.doesNotMatch(err.message, /VITE_AUTH_ENABLED/);
      return true;
    },
  );
});

test("production boots when auth is explicitly disabled", () => {
  assert.doesNotThrow(() =>
    assertAuthConfiguredForProduction({ nodeEnv: "production", authDisabled: true, authConfigured: false }),
  );
});

test("production boots when auth is configured", () => {
  assert.doesNotThrow(() =>
    assertAuthConfiguredForProduction({ nodeEnv: "production", authDisabled: false, authConfigured: true }),
  );
});

test("non-production environments boot unconfigured", () => {
  for (const nodeEnv of ["development", "test", undefined]) {
    assert.doesNotThrow(() =>
      assertAuthConfiguredForProduction({ nodeEnv, authDisabled: false, authConfigured: false }),
    );
  }
});

test("server.ts enforces the production boot policy", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(server, /assertAuthConfiguredForProduction\(/);
});
