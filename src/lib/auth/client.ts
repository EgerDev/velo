import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for Velo's own `/api/auth/*`. The session is an HttpOnly
 * `__Host-` cookie: nothing about it is readable or stored by page script.
 */
export const authClient = createAuthClient();

/** Start Google sign-in: a full-page redirect to Google, then back to `callbackURL`. */
export async function signInWithGoogle(
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  if (typeof window === "undefined") throw new Error("Sign-in needs a browser.");
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: opts.callbackURL ?? "/",
    errorCallbackURL: opts.errorCallbackURL ?? "/login?error=oauth",
  });
  if (error) throw new Error(error.message || "Sign-in failed.");
}

export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message || "Sign-out failed.");
  if (typeof window !== "undefined") window.location.assign("/");
}
