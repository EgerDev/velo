import { isGrokHost, isSandboxHost } from "./builder-env.ts";

/**
 * A parent frame we will exchange bridge messages with: the Grok chat/app hosts
 * and localhost (covered by `isGrokEmbedderOrigin`), plus the sandbox preview
 * shells that serve the live preview. Membership is decided by the PARENT's
 * hostname — never by our own.
 */
function isTrustedEmbedderHost(parentHostname: string): boolean {
  return isGrokHost(parentHostname) || isSandboxHost(parentHostname);
}

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
      // A sandbox-hosted guest may also be framed by a sandbox shell rather
      // than grok.com itself — but the PARENT has to be one of those hosts.
      // Testing only `isSandboxPreviewGuestHost(guestHostname)` asked "am I in
      // the sandbox?", which is true for every deployed preview, and so
      // returned whatever origin framed us: any site could embed the preview,
      // read the location/routes we post, and drive navigation back through
      // the bridge.
      if (isSandboxPreviewGuestHost(guestHostname) && isTrustedEmbedderHost(url.hostname)) {
        return url.origin;
      }
      if (isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
