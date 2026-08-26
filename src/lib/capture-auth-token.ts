/** Same key `src/lib/auth/client.ts` uses for the live-preview bearer. */
const BEARER_KEY = "grok-auth.bearer-token";

function storeBearer(token: string) {
  try {
    window.sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* storage blocked */
  }
}

export function applySessionBearer(token: string) {
  if (typeof window === "undefined") return;
  storeBearer(token);
}

/** Better Auth's bearer plugin returns the session on `set-auth-token`. */
export function captureAuthToken(response: Response | undefined) {
  if (!response || typeof window === "undefined") return;
  const token =
    response.headers.get("set-auth-token") || response.headers.get("Set-Auth-Token");
  if (token) storeBearer(token);
}

export const emailAuthFetchOptions = {
  onSuccess(ctx: { response: Response; data?: { token?: string } }) {
    if (ctx.data?.token) storeBearer(ctx.data.token);
    captureAuthToken(ctx.response);
  },
};

export type AuthErrorInfo = {
  code: string;
  title: string;
  detail: string;
  action: string;
};

const AUTH_ERRORS: Array<{ test: (message: string) => boolean; info: AuthErrorInfo }> = [
  {
    test: (m) => m.includes("popup") || m.includes("pop-up") || m.includes("pop up"),
    info: {
      code: "popup_blocked",
      title: "Pop-up blocked",
      detail: "Google and X sign-in open a small window. This browser stopped it.",
      action: "Allow pop-ups for this site, then try Google or X again.",
    },
  },
  {
    test: (m) => m.includes("cancelled") || m.includes("canceled"),
    info: {
      code: "cancelled",
      title: "Sign-in cancelled",
      detail: "The Google or X window closed before Velo got a session.",
      action: "Try again, or use email.",
    },
  },
  {
    test: (m) => m.includes("access_denied") || m.includes("access denied"),
    info: {
      code: "access_denied",
      title: "Permission declined",
      detail: "Google or X did not grant Velo an account.",
      action: "Approve the prompt, or use email instead.",
    },
  },
  {
    test: (m) => m.includes("state") && m.includes("mismatch"),
    info: {
      code: "state_mismatch",
      title: "Sign-in expired",
      detail: "The OAuth hand-off sat too long, so Velo dropped it.",
      action: "Start Google or X again from this page.",
    },
  },
  {
    test: (m) => m.includes("redirect_uri") || m.includes("invalid_client") || m.includes("unauthorized_client"),
    info: {
      code: "oauth_config",
      title: "OAuth could not start",
      detail: "The identity provider rejected this app’s callback.",
      action: "Reload Velo on this origin, then try email.",
    },
  },
  {
    test: (m) => m.includes("temporarily_unavailable") || m.includes("server_error"),
    info: {
      code: "oauth_server",
      title: "Google or X had an outage",
      detail: "The provider returned a server error.",
      action: "Wait a moment, or sign in with email.",
    },
  },
  {
    test: (m) => m.includes("oauth") || m.includes("idp"),
    info: {
      code: "oauth",
      title: "Google or X did not finish",
      detail: "The broker never returned a session token.",
      action: "Try the other provider, or use email.",
    },
  },
  {
    test: (m) => m.includes("already exists") || m.includes("user_already_exists"),
    info: {
      code: "exists",
      title: "Account already exists",
      detail: "That email is registered on Velo.",
      action: "Sign in instead of creating a new account.",
    },
  },
  {
    test: (m) =>
      m.includes("invalid email or password") ||
      m.includes("invalid password") ||
      m.includes("invalid credentials") ||
      m.includes("invalid_password"),
    info: {
      code: "credentials",
      title: "Email or password is wrong",
      detail: "Velo could not match that login.",
      action: "Check caps lock, or use a sign-in link.",
    },
  },
  {
    test: (m) => m.includes("invalid email") || m.includes("invalid_email"),
    info: {
      code: "email",
      title: "Email looks invalid",
      detail: "The address did not parse.",
      action: "Use a full address like you@email.com.",
    },
  },
  {
    test: (m) => m.includes("password") && (m.includes("too short") || m.includes("min")),
    info: {
      code: "password",
      title: "Password too short",
      detail: "New accounts need at least 8 characters.",
      action: "Pick a longer password.",
    },
  },
  {
    test: (m) => m.includes("invalid origin"),
    info: {
      code: "origin",
      title: "This page is not a trusted origin",
      detail: "Better Auth rejected the sign-in POST.",
      action: "Open Velo from its own URL and retry.",
    },
  },
  {
    test: (m) => m.includes("unauthorized") || m.includes("failed to create session"),
    info: {
      code: "session",
      title: "Session did not start",
      detail: "The account lookup worked but no cookie/token was minted.",
      action: "Try Google, X, or email again.",
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
    detail: raw || "Something went wrong.",
    action: "Try another method. Downloads still work as a guest.",
  };
}

export function friendlyAuthError(raw: string): string {
  const info = describeAuthError(raw);
  return `${info.title}. ${info.action}`;
}

export function describeOAuthSearch(error: string | undefined, description?: string): AuthErrorInfo | null {
  if (!error && !description) return null;
  const combined = [error, description].filter(Boolean).join(" ");
  return describeAuthError(combined);
}

export function messageForOAuthSearch(error: string | undefined): string | null {
  const info = describeOAuthSearch(error);
  return info ? `${info.title}. ${info.action}` : null;
}
