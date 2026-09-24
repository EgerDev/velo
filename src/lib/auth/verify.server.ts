import { getRequest } from "@tanstack/react-start/server";
import { auth, authConfigured } from "./server";

/**
 * Server-side session resolution (server-only).
 *
 * Velo runs its own Better Auth at same-origin `/api/auth/*`, so the session
 * cookie rides every request to this app — server functions, API routes and
 * SSR loaders alike. Never trust a client-supplied user id, only the result of
 * this verification.
 *
 * There is no shared or fallback user in any environment. Without Google
 * credentials (development only: production refuses to boot) nobody can sign
 * in, so every per-user feature answers 401.
 */

/** Re-export so callers can branch on it without importing `server.ts`. */
export { authConfigured };

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries
 * `status: 401`; the message is a stable contract — match
 * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null };

/**
 * The signed-in user for `headers` (default: the current request's), or `null`
 * when nobody is signed in or sign-in is unavailable.
 */
export async function getSessionUser(headers?: Headers): Promise<VerifiedUser | null> {
  if (!authConfigured) return null;
  const source = headers ?? getRequest()?.headers;
  if (!source) return null;
  const session = await auth.api.getSession({ headers: source });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

/**
 * The current user's verified id for a server function, or `UnauthorizedError`.
 * Prefer `authMiddleware` (`./middleware`), which calls this for you.
 */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}
