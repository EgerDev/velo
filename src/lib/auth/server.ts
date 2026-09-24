/**
 * Velo's Better Auth instance (server-only; never import it from client code —
 * it pulls in `pg` and the auth secret). Settings live in `auth-config.server.ts`
 * and come from `serverEnv()`; production boot has already validated them
 * (`server/plugins/env.ts`).
 *
 * Postgres when `DATABASE_URL` is set (always, in production). Development
 * without it uses the embedded PGLite database through a Kysely dialect, so
 * auth rows live in the same database as app data.
 *
 * The client uses `@/lib/auth/client`; components read the user through
 * `@/lib/auth/use-current-user`; server functions get a verified id from
 * `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Pool } from "pg";
import { ensureDbReady, getPglite, getSql } from "../db";
import { serverEnv } from "../env.server";
import { log } from "../log.server";
import { authSettings, sessionHooks } from "./auth-config.server";
import { pgliteDialect } from "./pglite-dialect";

// Start (and share) PGLite bootstrap as soon as the auth module loads in dev.
void ensureDbReady();

const env = serverEnv();
const settings = authSettings(env);

/** True when Google sign-in is available. Always true in production. */
export const authConfigured = settings.googleConfigured;

const database = env.DATABASE_URL
  ? authPool(env.DATABASE_URL)
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

function authPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString });
  // Neither Better Auth nor Kysely attaches an `error` listener to a pool handed
  // to them, and an idle client dropped by the server emits one. Unhandled, that
  // is a process-level crash rather than a connection the pool simply replaces.
  pool.on("error", (err) => {
    log.error("auth.db_idle_client_error", { err });
  });
  return pool;
}

export const auth = betterAuth({
  ...settings.options,
  database,
  databaseHooks: sessionHooks(async (userId, keepSessionId) => {
    const sql = await getSql();
    await sql`delete from "session" where "userId" = ${userId} and id <> ${keepSessionId}`;
  }),
  // Bridges Better Auth's Set-Cookie into TanStack Start responses. Keep it last.
  plugins: [tanstackStartCookies()],
});
