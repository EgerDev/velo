/**
 * Public CORS hops for watch-page HTML only. googlevideo bytes go through
 * /api/builder (same-hop SOCKS). Relays must never fetch IMA / DoubleClick.
 */
import { isImaUrl } from "./ima.ts";

export type RelaySpec = {
  id: string;
  wrap: (url: string) => string;
};

export const PUBLIC_RELAYS: RelaySpec[] = [
  {
    id: "corsfix",
    // Do not encodeURIComponent — corsfix 400s encoded googlevideo URLs. A raw
    // '#' would still terminate our own query and silently truncate the target,
    // so escape that one byte.
    wrap: (url) => `https://proxy.corsfix.com/?${url.replace(/#/g, "%23")}`,
  },
  {
    id: "cors.sh",
    wrap: (url) => `https://proxy.cors.sh/${url}`,
  },
  {
    id: "allorigins",
    wrap: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
];

const PAGE_HOST = /(^|\.)((youtube|youtube-nocookie|ytimg|ggpht)\.com)$/i;
const MEDIA_HOST = /(^|\.)googlevideo\.com$/i;

export function isRelayTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (isImaUrl(raw)) return false;
    return PAGE_HOST.test(url.hostname) || MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * True for any googlevideo media host, regardless of path. The relay charges a
 * download token for these — keying on the literal `/videoplayback` substring
 * instead would let a guest fetch googlevideo bytes uncharged via a manifest/init
 * path or a URL that only redirects into `/videoplayback`.
 */
export function isMediaHostTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function isPublicHtmlTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || isImaUrl(raw)) return false;
    return PAGE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function publicRelayUrls(url: string): string[] {
  if (!isPublicHtmlTarget(url)) return [];
  return PUBLIC_RELAYS.map((relay) => relay.wrap(url));
}

export function localRelayUrl(url: string): string {
  return `/api/relay?url=${encodeURIComponent(url)}`;
}

export function allRelayUrls(url: string, includeLocal = false): string[] {
  const publicUrls = publicRelayUrls(url);
  return includeLocal ? [...publicUrls, localRelayUrl(url)] : publicUrls;
}

export function relayHost(raw: string): string {
  if (raw.startsWith("/api/relay")) return "velo-relay";
  try {
    return new URL(raw).hostname.replace(/^api\./, "");
  } catch {
    return "relay";
  }
}
