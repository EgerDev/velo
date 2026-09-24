// Sign-in is Google through Velo's own Better Auth instance, and nothing else
// (roadmap D4). Needs a migrated Postgres: Better Auth stores OAuth state and
// sessions there.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { startServer } from "./harness.mjs";
import { DB_URL, NEEDS_DB, PROD_ENV, TEST_ORIGIN, dbEnv } from "./env.mjs";

describe("auth: Google only, __Host- cookies, no bearer, no password", { skip: NEEDS_DB }, () => {
  let server;
  let db;
  const userId = `test-${randomUUID()}`;
  const token = randomUUID().replace(/-/g, "");

  before(async () => {
    server = await startServer({ env: dbEnv() });
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test User', $2, true, now(), now())`,
      [userId, `${userId}@example.test`],
    );
    await db.query(
      `insert into "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
       values ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [randomUUID(), token, userId],
    );
  });

  after(async () => {
    await db?.query(`delete from "user" where id = $1`, [userId]);
    await db?.end();
    await server?.stop();
  });

  // Better Auth rate-limits /sign-in/* to 3 per 10 s per client IP, which it
  // reads from X-Forwarded-For by default. One documentation-range address per
  // request keeps these tests out of each other's bucket.
  let requests = 0;
  const post = (path, body, headers = {}) =>
    fetch(`${server.baseUrl}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        "x-forwarded-for": `198.51.100.${++requests}`,
        ...headers,
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });

  test("Google sign-in starts at accounts.google.com with the project's client and callback", async () => {
    const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const url = new URL(JSON.parse(text).url);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("client_id"), PROD_ENV.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), `${TEST_ORIGIN}/api/auth/callback/google`);
    assert.equal(url.searchParams.get("prompt"), "select_account");
  });

  test("the OAuth state cookie is __Host-velo.state: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", async () => {
    const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-velo.state="));
    assert.ok(cookie, `no __Host-velo.state cookie in ${JSON.stringify(res.headers.getSetCookie())}`);
    assert.match(cookie, /;\s*Secure/i);
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*SameSite=Lax/i);
    assert.match(cookie, /;\s*Path=\/(;|$)/i);
    assert.doesNotMatch(cookie, /;\s*Domain=/i);
  });

  // Production trusts VELO_PUBLIC_ORIGIN only: never a loopback dev origin (CLEAN-12).
  for (const untrusted of ["https://evil.example", "http://localhost:8080", "http://127.0.0.1:8080"]) {
    test(`a cookie-bearing auth POST from ${untrusted} is refused`, async () => {
      const res = await post(
        "/sign-in/social",
        { provider: "google", callbackURL: "/" },
        { origin: untrusted, cookie: "__Host-velo.session_data=x" },
      );
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "INVALID_ORIGIN");
    });

    test(`a callbackURL on ${untrusted} is refused`, async () => {
      const res = await post("/sign-in/social", { provider: "google", callbackURL: `${untrusted}/` });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "INVALID_CALLBACK_URL");
    });
  }

  test("email/password sign-up and sign-in are disabled", async () => {
    const creds = { email: "someone@example.test", password: "correct horse battery staple", name: "x" };
    const signUp = await post("/sign-up/email", creds);
    assert.equal(signUp.status, 400);
    assert.equal((await signUp.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
    assert.equal(signUp.headers.getSetCookie().length, 0);
    const signIn = await post("/sign-in/email", creds);
    assert.equal(signIn.status, 400);
    assert.equal((await signIn.json()).code, "EMAIL_PASSWORD_DISABLED");
  });

  test("the removed broker providers are unknown", async () => {
    for (const provider of ["grok-google", "grok-x", "twitter"]) {
      const res = await post("/sign-in/social", { provider, callbackURL: "/" });
      assert.equal(res.status, 404, provider);
      assert.deepEqual(await res.json(), { message: "Provider not found", code: "PROVIDER_NOT_FOUND" }, provider);
      assert.equal(res.headers.getSetCookie().length, 0, provider);
    }
    // genericOAuth is not registered, so its endpoint does not exist at all.
    const generic = await post("/sign-in/oauth2", { providerId: "grok-google", callbackURL: "/" });
    assert.equal(generic.status, 404);
    assert.equal(await generic.text(), "");
    assert.equal(generic.headers.getSetCookie().length, 0);
  });

  test("an OAuth callback failure lands on Velo's sign-in page with an error code", async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/callback/google?state=forged&code=x`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `${TEST_ORIGIN}/login?error=state_mismatch`);
  });

  test("a signed session cookie resolves the user", async () => {
    const signature = createHmac("sha256", PROD_ENV.BETTER_AUTH_SECRET).update(token).digest("base64");
    const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
      headers: { cookie: `__Host-velo.session_token=${encodeURIComponent(`${token}.${signature}`)}` },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json())?.user?.id, userId);
  });

  test("the same token as a bearer header is ignored (bearer plugin removed)", async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.json(), null);
  });

  test("an unsigned session cookie is ignored", async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
      headers: { cookie: `__Host-velo.session_token=${token}` },
    });
    assert.equal(await res.json(), null);
  });
});
