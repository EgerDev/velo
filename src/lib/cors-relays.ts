/**
 * Which URLs this app's own `/api/relay` may fetch. There is no third-party
 * relay (roadmap: no public CORS relays): the browser only ever talks to this
 * origin. The relay must never fetch IMA / DoubleClick.
 */
import { isImaUrl } from "./ima.ts";

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

export function localRelayUrl(url: string): string {
  return `/api/relay?url=${encodeURIComponent(url)}`;
}
