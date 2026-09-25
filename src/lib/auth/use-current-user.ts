import { useMemo } from "react";
import { authClient } from "./client";

/** Normalized signed-in user shape used across the app. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user — `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
  isPending: boolean;
};

/**
 * Current user + loading state, from Better Auth `useSession()` →
 * `/api/auth/get-session` (session cookie). `user` is `null` while the session
 * resolves (`isPending: true`) and when signed out (`isPending: false`).
 *
 * Protect a route by waiting out `isPending` before acting on `user` —
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   import { RedirectToSignIn } from "@/lib/auth/gates";
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;              // still resolving — don't redirect yet
 *   if (!user) return <RedirectToSignIn />;  // definitely signed out
 */
export function useCurrentUserState(): CurrentUserState {
  const { data, isPending } = authClient.useSession();
  const { id, name, email, image } = data?.user ?? {};
  // Memoized on the fields, not the session object: a fresh `user` literal
  // every render re-fires any effect that depends on it (the cookie vault load
  // looped on exactly that).
  const user = useMemo<AppUser | null>(
    () =>
      id
        ? {
            id,
            displayName: name ?? null,
            primaryEmail: email ?? null,
            profileImageUrl: image ?? null,
          }
        : null,
    [id, name, email, image],
  );
  return { user, isPending };
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
