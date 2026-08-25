/**
 * YouTube player.js obfuscation (what actually sits on a googlevideo URL).
 *
 * 1. s / signatureCipher — array of characters, Swap / Splice / Reverse.
 *    player.js rebuilds `sig` over `sparams`. Wrong sig → 403.
 * 2. nsig (`n=`) — a small VM in the same player build. Raw n ≈ 40 KB/s
 *    crawl. Solved n is a different string of similar length. Cached per
 *    InnerTube response because every itag shares the same raw n.
 * 3. lsig — HMAC over CDN locational params (mn, mm, mh…). Don’t strip.
 * 4. pot — BotGuard proof-of-origin. Missing pot → SABR stub, not a file.
 * 5. Player id rotates (~daily). Stale nsig cache = miss = crawl again.
 *
 * yt-dlp solves (1)+(2) with Node + ejs on this host. We solve them with
 * youtubei.js Player.decipher(url, s, cipher, Map). Same player.js, same
 * hop. yt-dlp wins on 1080p mux (137+140 over SOCKS). We win on a single
 * URL unlock when Innertube isn’t 403.
 */
export const nsigCache = new Map<string, string>();
const MAX_NSIG_CACHE = 500;

/**
 * player.js rotates roughly daily, and a solved `n` from the previous build is
 * simply wrong — but it is indistinguishable from a good one, since the only
 * other staleness signal is the identity transform. Age the whole map out
 * rather than serve a wrong token until the process restarts.
 */
const NSIG_TTL_MS = 6 * 60 * 60 * 1000;
let nsigCacheStamp = Date.now();

function expireNsigCache(now = Date.now()): void {
  if (now - nsigCacheStamp < NSIG_TTL_MS) return;
  nsigCache.clear();
  nsigCacheStamp = now;
}

export type NsigReport = {
  raw: string | null;
  solved: string | null;
  transformed: boolean;
  cache: "hit" | "miss" | "bypass" | "stale";
};

export function readNParam(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const value = new URL(url).searchParams.get("n");
    return value && value.length > 0 ? value : null;
  } catch {
    // `#` would otherwise capture a fragment into the token, and a bare
    // `decodeURIComponent` throws URIError on a malformed escape — out of a
    // function both callers treat as total.
    const match = /[?&]n=([^&#]+)/.exec(url);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

export function nsigCacheLookup(raw: string | null, cache = nsigCache): { hit: string } | { miss: true; stale?: boolean } {
  if (cache === nsigCache) expireNsigCache();
  if (!raw) return { miss: true };
  const solved = cache.get(raw);
  if (!solved) return { miss: true };
  if (solved === raw) {
    cache.delete(raw);
    return { miss: true, stale: true };
  }
  return { hit: solved };
}

export function rememberNsig(raw: string | null, solved: string | null, cache = nsigCache): void {
  if (!raw || !solved || raw === solved) {
    if (raw) cache.delete(raw);
    return;
  }
  cache.set(raw, solved);
  // Evict oldest entries if cache grows too large
  if (cache === nsigCache && cache.size > MAX_NSIG_CACHE) {
    const iter = cache.keys();
    const toDelete = cache.size - MAX_NSIG_CACHE;
    for (let i = 0; i < toDelete; i++) {
      const key = iter.next().value;
      if (key !== undefined) cache.delete(key);
    }
  }
}

export function nsigReport(
  before: string | undefined | null,
  after: string | undefined | null,
  cacheState: NsigReport["cache"] = "bypass",
): NsigReport {
  const raw = readNParam(before) ?? readNParam(after);
  const solved = readNParam(after);
  const transformed = Boolean(raw && solved && raw !== solved);
  return {
    raw,
    solved,
    transformed,
    // A cache HIT that failed to transform means player.js rotated under a
    // still-cached entry — that is stale, not a miss, and `describeNsig` has a
    // distinct message for it that was otherwise unreachable.
    cache: !transformed && raw ? (cacheState === "hit" ? "stale" : "miss") : cacheState,
  };
}

export function describeNsig(report: NsigReport): string {
  if (!report.raw) return "no n-token — android/muxed often skip nsig";
  if (report.cache === "hit" && report.transformed) return "nsig cache hit — throttle lock lifted";
  if (report.transformed) return "nsig solved — throttle lock lifted";
  if (report.cache === "stale") return "nsig cache stale — player.js rotated, solving again";
  return "nsig cache miss — CDN may cap ~40 KB/s";
}

export const NSIG_EXPLAIN =
  "YouTube hides the real download behind player.js: s/sig (Swap/Splice/Reverse), nsig (n= throttle VM), lsig, and a BotGuard pot. We solve nsig with youtubei.js and cache one result per response. A miss or stale player id means ~40 KB/s until yt-dlp re-extracts on the hop.";

export const BOTGUARD_EXPLAIN =
  "BotGuard (WebPO) mints two tokens both bound to the video id (player + GVS). visitor_data is a separate extractor-arg, not a POT binding. Cold-start is the JSDOM fallback when the real VM won’t snapshot — weaker, but Save still goes through yt-dlp on the hop.";

export const INNERTUBE_DECIPHER =
  "InnerTube decipher: WEB_EMBEDDED player.js runs s/sig + nsig (cached Map) then we stamp gvs pot, drop alr. getBasicInfo also sends the video-bound pot so SABR doesn’t strip 1080p. If this host’s IP is 403, yt-dlp SOCKS takes over with the same two tokens.";

export const YTDLP_COMPARE =
  "yt-dlp on this host (Node + ejs, SOCKS web_embedded, 137+140) is the path that actually finishes 1080p. Our InnerTube decipher is faster for unlocking a URL, but this machine’s IP is 403 without the hop. Save uses yt-dlp first for 1080p; nsig here is the backup unlock + the live speed probe.";
