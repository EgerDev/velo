import assert from "node:assert/strict";
import { test } from "node:test";
import { loadServerEnv } from "../env.server.ts";
import { authSettings, sessionHooks, trustedOrigins } from "./auth-config.server.ts";

const PROD = loadServerEnv({
  NODE_ENV: "production",
  DATABASE_URL: "postgres://velo@db/velo",
  BETTER_AUTH_SECRET: "s".repeat(32),
  VELO_PUBLIC_ORIGIN: "https://velo.example",
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
});

test("production trusts only the public origin — never a loopback dev origin", () => {
  assert.deepEqual(trustedOrigins(PROD, { VELO_DEV_PORT: "8097" }), ["https://velo.example"]);
  assert.deepEqual(authSettings(PROD).options.trustedOrigins, ["https://velo.example"]);
});

test("development also trusts the local dev server on its configured port", () => {
  assert.deepEqual(trustedOrigins(loadServerEnv({}), {}), ["http://localhost:8080", "http://127.0.0.1:8080"]);
  const dev = loadServerEnv({ VELO_DEV_PORT: "8097" });
  assert.deepEqual(trustedOrigins(dev, { VELO_DEV_PORT: "8097" }), ["http://localhost:8097", "http://127.0.0.1:8097"]);
  const tunnel = loadServerEnv({ VELO_PUBLIC_ORIGIN: "https://tunnel.example" });
  assert.deepEqual(trustedOrigins(tunnel, {}), ["https://tunnel.example", "http://localhost:8080", "http://127.0.0.1:8080"]);
});

test("Google is the only sign-in method, on the public origin", () => {
  const { googleConfigured, options } = authSettings(PROD);
  assert.equal(googleConfigured, true);
  assert.equal(options.baseURL, "https://velo.example");
  assert.equal(options.secret, "s".repeat(32));
  assert.equal(options.onAPIError.errorURL, "https://velo.example/login");
  assert.deepEqual(Object.keys(options.socialProviders), ["google"]);
  assert.deepEqual(options.socialProviders.google, {
    clientId: "id.apps.googleusercontent.com",
    clientSecret: "google-secret",
    prompt: "select_account",
  });
  assert.equal("emailAndPassword" in options, false);
});

test("account linking trusts no provider, so linking always needs Google's verified email", () => {
  const { accountLinking } = authSettings(PROD).options.account;
  assert.equal(accountLinking.enabled, true);
  const trusted: unknown = (accountLinking as { trustedProviders?: unknown }).trustedProviders;
  assert.ok(trusted === undefined || (Array.isArray(trusted) && trusted.length === 0), `trustedProviders: ${String(trusted)}`);
});

test("without Google credentials (development) sign-in is simply unavailable", () => {
  const { googleConfigured, options } = authSettings(loadServerEnv({ GOOGLE_CLIENT_ID: "only-the-id" }));
  assert.equal(googleConfigured, false);
  assert.deepEqual(options.socialProviders, {});
});

test("session cookies are __Host-velo.*, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", () => {
  const { advanced } = authSettings(PROD).options;
  assert.equal(advanced.cookiePrefix, "__Host-velo");
  assert.equal(advanced.useSecureCookies, false);
  assert.deepEqual(advanced.defaultCookieAttributes, { secure: true, httpOnly: true, sameSite: "lax", path: "/" });
  assert.equal("crossSubDomainCookies" in advanced, false);
});

test("a new session stores no IP or user agent and ends the person's other sessions", async () => {
  const ended: Array<[string, string]> = [];
  const hooks = sessionHooks(async (userId, keep) => {
    ended.push([userId, keep]);
  });
  const row = { id: "s1", userId: "u1", token: "t", ipAddress: "203.0.113.9", userAgent: "UA/1" };
  assert.deepEqual(await hooks.session.create.before(row), {
    data: { id: "s1", userId: "u1", token: "t", ipAddress: null, userAgent: null },
  });
  await hooks.session.create.after(row);
  assert.deepEqual(ended, [["u1", "s1"]]);
});
