import { withAuthHeaders } from "@/lib/auth/client";

const GUEST_KEY = "velo-guest-id";
const GUEST_RE = /^[a-z0-9_-]{8,64}$/i;

/** Stable per-browser id so 100 guests on one grok.me NAT are not one quota bucket. */
export function getGuestId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(GUEST_KEY);
    if (!id || !GUEST_RE.test(id)) {
      const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`;
      id = raw.replace(/-/g, "").slice(0, 22);
      window.localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/** Auth bearer + per-browser guest id for every download fetch. */
export function downloadHeaders(init?: HeadersInit): Headers {
  const headers = withAuthHeaders(init);
  const guest = getGuestId();
  if (guest && !headers.has("x-velo-guest")) headers.set("x-velo-guest", guest);
  return headers;
}
