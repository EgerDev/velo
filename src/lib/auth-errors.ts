/**
 * Sign-in error copy for the login page. Sign-in is Google only, through a
 * full-page redirect; failures arrive either as a thrown message (the request
 * that starts sign-in) or as `?error=<code>` on `/login` (the OAuth callback).
 */
export type AuthErrorInfo = {
  code: string;
  title: string;
  detail: string;
  action: string;
};

const AUTH_ERRORS: Array<{ test: (message: string) => boolean; info: AuthErrorInfo }> = [
  {
    test: (m) => m.includes("access_denied") || m.includes("access denied"),
    info: {
      code: "access_denied",
      title: "Permission declined",
      detail: "Google did not share your account with Velo.",
      action: "Try again and approve the Google prompt. Downloads still work as a guest.",
    },
  },
  {
    test: (m) => m.includes("state") || m.includes("please_restart"),
    info: {
      code: "state_mismatch",
      title: "Sign-in expired",
      detail: "The hand-off from Google took too long or came from another tab.",
      action: "Start again from this page.",
    },
  },
  {
    test: (m) =>
      m.includes("redirect_uri") ||
      m.includes("invalid_client") ||
      m.includes("unauthorized_client") ||
      m.includes("provider_not_found") ||
      m.includes("provider not found"),
    info: {
      code: "oauth_config",
      title: "Google sign-in is misconfigured",
      detail: "Google rejected this site's sign-in settings.",
      action: "Tell the site operator. Downloads still work as a guest.",
    },
  },
  {
    test: (m) => m.includes("temporarily_unavailable") || m.includes("server_error"),
    info: {
      code: "oauth_server",
      title: "Google had a problem",
      detail: "Google returned a server error.",
      action: "Wait a moment, then try again.",
    },
  },
  {
    test: (m) => m.includes("too many") || m.includes("rate") || m.includes("429"),
    info: {
      code: "rate_limited",
      title: "Too many attempts",
      detail: "Sign-in is paused for a few seconds.",
      action: "Wait ten seconds, then try again.",
    },
  },
  {
    test: (m) => m.includes("invalid origin") || m.includes("invalid_origin") || m.includes("callback_url"),
    info: {
      code: "origin",
      title: "Open Velo from its own address",
      detail: "Sign-in only works on the address this site is configured for.",
      action: "Go to the site's main address and sign in there.",
    },
  },
  {
    test: (m) => m.includes("failed to fetch") || m.includes("network"),
    info: {
      code: "network",
      title: "Could not reach Velo",
      detail: "The sign-in request did not get through.",
      action: "Check your connection, then try again.",
    },
  },
];

export function describeAuthError(raw: string): AuthErrorInfo {
  const message = raw.toLowerCase();
  for (const row of AUTH_ERRORS) {
    if (row.test(message)) return row.info;
  }
  return {
    code: "unknown",
    title: "Sign-in failed",
    detail: "Google sign-in did not finish.",
    action: "Try again. Downloads still work as a guest.",
  };
}

/** The OAuth callback's `?error=` / `?error_description=` pair, or null when absent. */
export function describeOAuthSearch(error: string | undefined, description?: string): AuthErrorInfo | null {
  if (!error && !description) return null;
  return describeAuthError([error, description].filter(Boolean).join(" "));
}
