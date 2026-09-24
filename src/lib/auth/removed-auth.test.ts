// Regression guards for removed sign-in paths (W0-T2, W0-T4, W2). Each one was
// an account-takeover or third-party-identity path; none may come back.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const here = (path: string) => new URL(path, import.meta.url);
const source = (path: string) => readFileSync(here(path), "utf8");

test("the committed preview OAuth client stays deleted (W0-T2)", () => {
  assert.equal(existsSync(here("./preview.ts")), false);
  assert.doesNotMatch(source("./server.ts"), /PREVIEW_CLIENT_SECRET|PREVIEW_CLIENT_ID/);
});

test("the copy-paste sign-in link stays deleted (W0-T4)", () => {
  assert.equal(existsSync(here("../sign-in-link.ts")), false);
  assert.equal(existsSync(here("../sign-in-link-policy.ts")), false);
});

test("the platform broker, gate identity, popup and email/password modules stay deleted (W2)", () => {
  for (const file of [
    "./providers.ts",
    "./oauth-popup.ts",
    "./email-password.ts",
    "./gate-identity.server.ts",
    "./gate-session.server.ts",
    "./popup.server.ts",
    "./auth-boot-policy.ts",
  ]) {
    assert.equal(existsSync(here(file)), false, file);
  }
});

test("the auth server registers no broker, bearer or password plugin", () => {
  const server = `${source("./server.ts")}\n${source("./auth-config.server.ts")}`;
  assert.doesNotMatch(server, /genericOAuth|bearer\(|emailAndPassword|gateIdentity|oneTimeToken|magicLink/);
});

test("no shared dev-user fallback exists in any environment", () => {
  for (const file of ["./verify.server.ts", "./middleware.ts", "./use-current-user.ts", "./client.ts"]) {
    assert.doesNotMatch(source(file), /dev-user|DEV_USER/, file);
  }
});

test("the client keeps no session token in script-readable storage", () => {
  const client = source("./client.ts");
  assert.doesNotMatch(client, /sessionStorage|localStorage|Bearer|set-auth-token|genericOAuthClient/);
  assert.equal(existsSync(here("../session-isolation.ts")), false);
});
