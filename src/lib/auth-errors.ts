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

type AuthErrorCode = "access_denied" | "state_mismatch" | "oauth_config" | "oauth_server" | "rate_limited" | "origin" | "network";

const AUTH_ERRORS: Record<AuthErrorCode, AuthErrorInfo> = {
  access_denied: {
    code: "access_denied",
    title: "Permission declined",
    detail: "Google did not share your account with Velo.",
    action: "Try again and approve the Google prompt. Downloads still work as a guest.",
  },
  state_mismatch: {
    code: "state_mismatch",
    title: "Sign-in expired",
    detail: "The hand-off from Google took too long or came from another tab.",
    action: "Start again from this page.",
  },
  oauth_config: {
    code: "oauth_config",
    title: "Google sign-in is misconfigured",
    detail: "Google rejected this site's sign-in settings.",
    action: "Tell the site operator. Downloads still work as a guest.",
  },
  oauth_server: {
    code: "oauth_server",
    title: "Google had a problem",
    detail: "Google returned a server error.",
    action: "Wait a moment, then try again.",
  },
  rate_limited: {
    code: "rate_limited",
    title: "Too many attempts",
    detail: "Sign-in is paused for a few seconds.",
    action: "Wait ten seconds, then try again.",
  },
  origin: {
    code: "origin",
    title: "Open Velo from its own address",
    detail: "Sign-in only works on the address this site is configured for.",
    action: "Go to the site's main address and sign in there.",
  },
  network: {
    code: "network",
    title: "Could not reach Velo",
    detail: "The sign-in request did not get through.",
    action: "Check your connection, then try again.",
  },
};

/** Exact error codes from Google's OAuth errors, Better Auth's callback and its API errors (lower-cased). */
const EXACT_CODES: Record<string, AuthErrorCode> = {
  access_denied: "access_denied",
  state_mismatch: "state_mismatch",
  state_security_mismatch: "state_mismatch",
  state_not_found: "state_mismatch",
  state_invalid: "state_mismatch",
  please_restart_the_process: "state_mismatch",
  invalid_callback_request: "state_mismatch",
  redirect_uri_mismatch: "oauth_config",
  invalid_client: "oauth_config",
  unauthorized_client: "oauth_config",
  client_disabled: "oauth_config",
  unsupported_response_type: "oauth_config",
  oauth_provider_not_found: "oauth_config",
  temporarily_unavailable: "oauth_server",
  server_error: "oauth_server",
  "429": "rate_limited",
  invalid_origin: "origin",
  missing_or_null_origin: "origin",
  invalid_callback_url: "origin",
  invalid_error_callback_url: "origin",
};

/** Word-bounded phrases for thrown messages that carry no code. */
const PHRASES: Array<[RegExp, AuthErrorCode]> = [
  [/\baccess denied\b/, "access_denied"],
  [/\bprovider not found\b/, "oauth_config"],
  [/\btoo many requests\b/, "rate_limited"],
  [/\binvalid origin\b|\binvalid callbackurl\b/, "origin"],
  [/\bfailed to fetch\b|\bnetwork ?error\b/, "network"],
];

const FALLBACK: AuthErrorInfo = {
  code: "unknown",
  title: "Sign-in failed",
  detail: "Google sign-in did not finish.",
  action: "Try again. Downloads still work as a guest.",
};

/** Exact codes win over phrases; anything unmatched gets fixed copy, never the raw text. */
export function describeAuthError(raw: string): AuthErrorInfo {
  const message = raw.toLowerCase();
  for (const token of message.split(/[^a-z0-9_]+/)) {
    const code = Object.hasOwn(EXACT_CODES, token) ? EXACT_CODES[token] : undefined;
    if (code) return AUTH_ERRORS[code];
  }
  for (const [pattern, code] of PHRASES) {
    if (pattern.test(message)) return AUTH_ERRORS[code];
  }
  return FALLBACK;
}

/** The OAuth callback's `?error=` / `?error_description=` pair, or null when absent. */
export function describeOAuthSearch(error: string | undefined, description?: string): AuthErrorInfo | null {
  if (!error && !description) return null;
  return describeAuthError([error, description].filter(Boolean).join(" "));
}
