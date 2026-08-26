/**
 * Who may mint a copy-paste sign-in link.
 *
 * This app has no email transport, so `requestSignInLink` hands the token back
 * to whoever called it instead of delivering it to the address's owner. That is
 * a development convenience and an account-takeover primitive at the same time:
 * ungated, anyone who can reach the endpoint mints a session for any address
 * they can name — creating the account if it doesn't exist — and redeeming it
 * deletes that account's other sessions on the way in.
 *
 * Nothing here can prove someone owns an address without sending mail to it, so
 * the flow is only open where it is both needed and contained:
 *
 *   VELO_SIGNIN_LINK=false        off everywhere, no exceptions.
 *   VELO_SIGNIN_LINK_EMAILS=a,b   only these addresses, in any environment.
 *   VELO_SIGNIN_LINK=true         any address — explicit operator opt-in.
 *   (unset)                       only when federated sign-in is unconfigured,
 *                                 i.e. local dev where the link is the only way
 *                                 in. Once OAuth works this side door adds
 *                                 nothing but risk, so it closes itself.
 *
 * Keep this module free of node/server imports: it is reached from the login
 * route, so it has to survive the client bundle.
 */

export type SignInLinkConfig = {
  /** `VELO_SIGNIN_LINK`. */
  override?: string | undefined;
  /** `VELO_SIGNIN_LINK_EMAILS`, comma separated. */
  allowlist?: string | undefined;
  /** Whether federated (OAuth) sign-in is live — another way into the app. */
  authConfigured: boolean;
};

export type SignInLinkAvailability = {
  enabled: boolean;
  /** Addresses permitted to mint; empty means unrestricted. */
  allowlist: string[];
  /** Shown when a request is refused. Empty while enabled. */
  reason: string;
};

const OFF_BY_OPERATOR = "Sign-in links are turned off for this app.";
const OFF_NO_EMAIL =
  "Sign-in links are off because this app can’t send email. Use Google, or email and password.";
const NOT_ALLOWED = "That address can’t use a sign-in link here.";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseEmailAllowlist(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(normalizeEmail)
    .filter((entry) => entry.length > 0);
}

export function signInLinkAvailability(config: SignInLinkConfig): SignInLinkAvailability {
  const allowlist = parseEmailAllowlist(config.allowlist);
  const override = config.override?.trim().toLowerCase();
  if (override === "false") return { enabled: false, allowlist, reason: OFF_BY_OPERATOR };
  if (allowlist.length > 0) return { enabled: true, allowlist, reason: "" };
  if (override === "true") return { enabled: true, allowlist, reason: "" };
  if (!config.authConfigured) return { enabled: true, allowlist, reason: "" };
  return { enabled: false, allowlist, reason: OFF_NO_EMAIL };
}

/** The message to refuse this address with, or null when it may proceed. */
export function signInLinkDenial(email: string, available: SignInLinkAvailability): string | null {
  if (!available.enabled) return available.reason || OFF_BY_OPERATOR;
  if (available.allowlist.length === 0) return null;
  // Don't echo the allowlist back — the refusal is the same for any address
  // that isn't on it, whether or not an account exists.
  return available.allowlist.includes(normalizeEmail(email)) ? null : NOT_ALLOWED;
}

export type RateState = Map<string, number[]>;

/** Keys tracked before the sweep drops the coldest ones. */
const MAX_TRACKED_KEYS = 5000;

/**
 * Record one attempt against `key` and report whether it has now exceeded
 * `limit` within `windowMs`. Minting is cheap for a caller and writes a row per
 * request, so both the address and the caller's IP are counted.
 */
export function rateLimited(
  state: RateState,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): boolean {
  const since = now - windowMs;
  const hits = (state.get(key) ?? []).filter((at) => at > since);
  hits.push(now);
  // Past the limit the exact count stops mattering — only that it was exceeded.
  // Without this cap a sustained burst against one key grows the array for the
  // whole window, and every call re-filters the whole thing.
  if (hits.length > limit + 1) hits.splice(0, hits.length - (limit + 1));
  state.set(key, hits);
  if (state.size > MAX_TRACKED_KEYS) {
    for (const [other, times] of state) {
      if (other !== key && !times.some((at) => at > since)) state.delete(other);
    }
  }
  return hits.length > limit;
}
