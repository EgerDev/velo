/**
 * Better Auth settings derived from the server env (roadmap C1, C9). Pure, so
 * the security-relevant choices are unit-tested without a database.
 *
 * Google (Better Auth's built-in social provider, the project's own OAuth
 * client) is the only sign-in method: no email/password, no bearer tokens, no
 * third-party broker. Sessions ride `__Host-` cookies: Secure, HttpOnly,
 * SameSite=Lax, Path=/ and no Domain, so no sibling subdomain can set or read
 * them.
 */
import { devOrigin, type ServerEnv } from "../env.server.ts";

/** Better Auth cookie prefix: every auth cookie is `__Host-velo.<name>`. */
export const SESSION_COOKIE_PREFIX = "__Host-velo";

/**
 * Origins allowed to make credentialed auth requests: the public origin, plus
 * the local dev server (both loopback spellings) outside production only.
 */
export function trustedOrigins(env: ServerEnv, source: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV === "production") return [env.VELO_PUBLIC_ORIGIN];
  const local = devOrigin(source);
  return [...new Set([env.VELO_PUBLIC_ORIGIN, local, local.replace("//localhost:", "//127.0.0.1:")])];
}

export function authSettings(env: ServerEnv, source: NodeJS.ProcessEnv = process.env) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // Always show the account chooser, so a shared browser never signs in silently.
          prompt: "select_account" as const,
        }
      : undefined;
  return {
    /** False only in development without Google credentials: sign-in is then unavailable. */
    googleConfigured: google !== undefined,
    options: {
      baseURL: env.VELO_PUBLIC_ORIGIN,
      secret: env.BETTER_AUTH_SECRET,
      trustedOrigins: trustedOrigins(env, source),
      // OAuth failures land on Velo's sign-in page with `?error=<code>`, not on
      // Better Auth's built-in error page.
      onAPIError: { errorURL: `${env.VELO_PUBLIC_ORIGIN}/login` },
      socialProviders: google ? { google } : {},
      account: {
        encryptOAuthTokens: true,
        accountLinking: { enabled: true, trustedProviders: ["google"] },
      },
      // Short-lived signed `session_data` cookie so session reads skip the database.
      session: { cookieCache: { enabled: true, maxAge: 300 } },
      advanced: {
        // Better Auth's automatic prefix is `__Secure-`, which allows a Domain
        // attribute. `__Host-` is set through the prefix below instead.
        useSecureCookies: false,
        cookiePrefix: SESSION_COOKIE_PREFIX,
        defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/" },
      },
    },
  };
}

type SessionRow = { id: string; userId: string; ipAddress?: string | null; userAgent?: string | null };

/**
 * Session privacy and the one-login policy. A session never records the IP
 * address or user agent (Velo keeps no login log), and a new sign-in ends the
 * person's other sessions, so an old device or a copied cookie cannot stay
 * signed in.
 */
export function sessionHooks(endOtherSessions: (userId: string, keepSessionId: string) => Promise<void>) {
  return {
    session: {
      create: {
        before: async <S extends SessionRow>(session: S) => ({
          data: { ...session, ipAddress: null, userAgent: null },
        }),
        after: async (session: SessionRow) => {
          await endOtherSessions(session.userId, session.id);
        },
      },
    },
  };
}
