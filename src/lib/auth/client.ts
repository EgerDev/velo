import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";
import { GROK_PROVIDERS } from "./providers";
import { shouldUseOAuthPopup } from "./oauth-popup";

export { GROK_PROVIDERS };

/** Same predicate `server.ts` uses — `"false"` is the only off switch. */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** Same key `src/lib/capture-auth-token.ts` uses for the live-preview bearer. */
const BEARER_KEY = "grok-auth.bearer-token";

export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

function storeBearer(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* storage blocked */
  }
}

export function withAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getBearerToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => getBearerToken() ?? "",
    },
    onSuccess(ctx) {
      const header =
        ctx.response.headers.get("set-auth-token") || ctx.response.headers.get("Set-Auth-Token");
      if (header) storeBearer(header);
    },
  },
});

export async function signIn(
  providerId: string,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
) {
  if (typeof window === "undefined") throw new Error("Sign-in needs a browser.");
  const framed = window.parent !== window;
  if (shouldUseOAuthPopup(window.location.hostname, framed)) {
    await openSignInPopup(providerId);
    return;
  }
  const { error } = await authClient.signIn.oauth2({
    providerId,
    callbackURL: opts.callbackURL ?? "/",
    errorCallbackURL: opts.errorCallbackURL ?? "/login?error=oauth",
  });
  if (error) throw new Error(error.message || "Sign-in failed.");
}

export async function signOut() {
  try {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message || "Sign-out failed.");
  } finally {
    storeBearer(null);
  }
  if (typeof window !== "undefined") window.location.assign("/");
}

type PopupMessage = {
  source: "grok-auth-popup";
  token: string | null;
  error?: string;
};

function isPopupMessage(data: unknown): data is PopupMessage {
  if (!data || typeof data !== "object") return false;
  return (data as { source?: unknown }).source === "grok-auth-popup";
}

async function openSignInPopup(providerId: string): Promise<void> {
  const url = `/auth/popup?providerId=${encodeURIComponent(providerId)}`;
  const popup = window.open(url, "grok-auth-popup", "width=480,height=720");
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups for this site, then try again.");

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Sign-in timed out. Close the window and try again."));
    }, 120_000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isPopupMessage(event.data)) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      if (event.data.token) storeBearer(event.data.token);
      resolve();
    };

    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("Sign-in cancelled."));
    }, 400);

    function cleanup() {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
  });
}
