import assert from "node:assert/strict";
import { test } from "node:test";
import { EnvError, devOrigin, loadServerEnv, serverEnv } from "./env.server.ts";

const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "VELO_PUBLIC_ORIGIN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://velo:pw@db.internal:5432/velo",
  BETTER_AUTH_SECRET: "s".repeat(32),
  VELO_PUBLIC_ORIGIN: "https://velo.example",
  GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret-value",
} as NodeJS.ProcessEnv;

function envError(source: NodeJS.ProcessEnv): EnvError {
  try {
    loadServerEnv(source);
  } catch (err) {
    assert.ok(err instanceof EnvError, `expected EnvError, got ${String(err)}`);
    return err;
  }
  assert.fail("loadServerEnv did not throw");
}

test("production with nothing set names all five required variables", () => {
  const err = envError({ NODE_ENV: "production" });
  assert.deepEqual(err.missing, REQUIRED);
  assert.equal(err.name, "EnvError");
  assert.equal(err.message, `Missing or invalid required environment variables: ${REQUIRED.join(", ")}`);
});

test("each required variable is reported on its own, and blank counts as missing", () => {
  for (const name of REQUIRED) {
    assert.deepEqual(envError({ ...PROD, [name]: undefined }).missing, [name]);
    assert.deepEqual(envError({ ...PROD, [name]: "   " }).missing, [name]);
  }
});

test("the error names variables and never carries a value", () => {
  const err = envError({ ...PROD, BETTER_AUTH_SECRET: "short-secret-value", GOOGLE_CLIENT_ID: "" });
  assert.deepEqual(err.missing, ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID"]);
  for (const value of ["short-secret-value", "google-secret-value", "db.internal", "pw@", "velo.example"]) {
    const text = `${err.message} ${JSON.stringify(err)} ${err.stack}`;
    assert.equal(text.includes(value), false, value);
  }
});

test("BETTER_AUTH_SECRET needs at least 32 characters in production", () => {
  assert.deepEqual(envError({ ...PROD, BETTER_AUTH_SECRET: "s".repeat(31) }).missing, ["BETTER_AUTH_SECRET"]);
  assert.equal(loadServerEnv({ ...PROD, BETTER_AUTH_SECRET: "s".repeat(32) }).BETTER_AUTH_SECRET, "s".repeat(32));
});

test("VELO_PUBLIC_ORIGIN must be a bare https origin, or http on loopback", () => {
  for (const bad of [
    "velo.example",
    "http://velo.example",
    "https://velo.example/app",
    "https://velo.example/?x=1",
    "https://user:pw@velo.example",
    "ftp://velo.example",
    "https://*.velo.example",
    "https://velo.*",
  ]) {
    assert.deepEqual(envError({ ...PROD, VELO_PUBLIC_ORIGIN: bad }).missing, ["VELO_PUBLIC_ORIGIN"], bad);
  }
  assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "https://velo.example/" }).VELO_PUBLIC_ORIGIN, "https://velo.example");
  assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "https://Velo.Example:8443" }).VELO_PUBLIC_ORIGIN, "https://velo.example:8443");
  assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "http://127.0.0.1:3000" }).VELO_PUBLIC_ORIGIN, "http://127.0.0.1:3000");
});

test("production refuses Better Auth's own origin and secret overrides", () => {
  const err = envError({ ...PROD, BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example", BETTER_AUTH_SECRETS: "1:x" });
  assert.deepEqual(err.missing, ["BETTER_AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_SECRETS"]);
  assert.doesNotMatch(err.message, /evil\.example|1:x/);
  assert.doesNotThrow(() => loadServerEnv({ BETTER_AUTH_TRUSTED_ORIGINS: "http://x.test" }));
});

test("a complete production config loads with parsed lists and defaults", () => {
  const env = loadServerEnv({ ...PROD, VELO_ADMIN_EMAILS: " A@X.io, ,b@y.io ", VELO_EXTENSION_IDS: "abc, def" });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.DATABASE_URL, PROD.DATABASE_URL);
  assert.deepEqual(env.VELO_ADMIN_EMAILS, ["a@x.io", "b@y.io"]);
  assert.deepEqual(env.VELO_EXTENSION_IDS, ["abc", "def"]);
  assert.equal(env.LOG_LEVEL, "info");
  assert.equal(env.VELO_EGRESS_PROXY, undefined);
  assert.equal(env.YTDLP_PYTHON, process.platform === "win32" ? "python" : "python3");
});

test("development never throws and gets local defaults", () => {
  for (const nodeEnv of [undefined, "development", "test", "staging"]) {
    const env = loadServerEnv({ NODE_ENV: nodeEnv });
    assert.equal(env.NODE_ENV, nodeEnv === "test" ? "test" : "development");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.GOOGLE_CLIENT_ID, undefined);
    assert.equal(env.VELO_PUBLIC_ORIGIN, "http://localhost:8080");
    assert.match(env.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
  }
});

test("the dev signing secret is stable across loads in one process", () => {
  assert.equal(loadServerEnv({}).BETTER_AUTH_SECRET, loadServerEnv({}).BETTER_AUTH_SECRET);
  assert.equal(loadServerEnv({ BETTER_AUTH_SECRET: "dev-override" }).BETTER_AUTH_SECRET, "dev-override");
});

test("the dev origin follows VELO_DEV_PORT like vite.config.ts", () => {
  assert.equal(devOrigin({ VELO_DEV_PORT: "8097" }), "http://localhost:8097");
  assert.equal(devOrigin({ VELO_DEV_PORT: "not-a-port" }), "http://localhost:8080");
  assert.equal(devOrigin({}), "http://localhost:8080");
  assert.equal(loadServerEnv({ VELO_DEV_PORT: "8097" }).VELO_PUBLIC_ORIGIN, "http://localhost:8097");
  assert.equal(
    loadServerEnv({ VELO_DEV_PORT: "8097", VELO_PUBLIC_ORIGIN: "https://tunnel.example" }).VELO_PUBLIC_ORIGIN,
    "https://tunnel.example",
  );
});

test("LOG_LEVEL accepts the four levels, case-insensitively, else info", () => {
  assert.equal(loadServerEnv({ LOG_LEVEL: "DEBUG" }).LOG_LEVEL, "debug");
  assert.equal(loadServerEnv({ LOG_LEVEL: "verbose" }).LOG_LEVEL, "info");
});

test("serverEnv() is memoized", () => {
  assert.equal(serverEnv(), serverEnv());
});
