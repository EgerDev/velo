// Production configuration for the HTTP suites (roadmap C1). Every value is
// fake but well-formed, so the built server boots in real production mode and
// nothing reaches Google. `NO_DB_URL` points at a closed port: suites that only
// need a booted server use it; suites that need a working database take
// VELO_TEST_DATABASE_URL (CI always sets it) and skip locally without one.
import assert from "node:assert/strict";

export const TEST_ORIGIN = "https://velo.test";

export const PROD_ENV = Object.freeze({
  BETTER_AUTH_SECRET: "test-only-not-a-secret-0123456789abcdef",
  VELO_PUBLIC_ORIGIN: TEST_ORIGIN,
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-google-client-secret",
  // Until Task 4 removes the platform broker, production boot needs its flag off.
  VITE_AUTH_ENABLED: "false",
});

/** Well-formed, never reachable: port 1 on loopback refuses every connection. */
export const NO_DB_URL = "postgres://velo-test@127.0.0.1:1/unreachable";

export const DB_URL = process.env.VELO_TEST_DATABASE_URL ?? "";

/** `skip` value for suites that need a working database. CI never skips. */
export const NEEDS_DB =
  !DB_URL && !process.env.CI ? "needs a migrated Postgres: set VELO_TEST_DATABASE_URL (CI always does)" : false;

/** Production env with the test database; fails loudly in CI when the URL is missing. */
export function dbEnv() {
  assert.ok(DB_URL, "VELO_TEST_DATABASE_URL must be set in CI");
  return { ...PROD_ENV, DATABASE_URL: DB_URL };
}
