import { isGrokHost, isSandboxHost } from "./builder-env.ts";

/** grok.com chat, grok.me apps, and local preview parents. */
export function isGrokEmbedderOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (isGrokHost(host)) return true;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
    return false;
  } catch {
    return false;
  }
}

export function isSandboxPreviewGuestHost(hostname: string): boolean {
  return isSandboxHost(hostname);
}

function isRemintPreviewPair(guestHost: string, parentHost: string): boolean {
  const guest = guestHost.toLowerCase();
  const parent = parentHost.toLowerCase();
  const sep = ".preview.";
  const i = guest.indexOf(sep);
  if (i <= 0) return false;
  const label = guest.slice(0, i);
  const rest = guest.slice(i + sep.length);
  if (label.includes(".") || !rest.includes(".")) return false;
  return parent === rest || parent === `grok.${rest}`;
}

export function resolveParentEmbedderOrigin(
  parentIsSelf: boolean,
  referrer: string,
  ancestorOrigin?: string | null,
  guestHostname = "",
): string | null {
  if (parentIsSelf) return null;
  for (const candidate of [ancestorOrigin ?? "", referrer].filter(Boolean)) {
    try {
      const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (isGrokEmbedderOrigin(url.origin)) return url.origin;
      if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) {
        return url.origin;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
