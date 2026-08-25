/**
 * YouTube throttle is the `n` query param. Untouched n ≈ 40 KB/s.
 * yt-dlp solves n via player.js (Node + ejs). If that fails, we:
 *  - re-extract when speed < 100 KB/s
 *  - download in 10 MB HTTP ranges (old >10 MB single-GET cap)
 *  - one HLS fragment at a time (many threads look like a scraper)
 *  - same-hop SOCKS so IP on the player JSON matches the file
 *
 * --retries stays at 1: a GVS 403 never succeeds on the same URL.
 * Fragment retries still cover HLS flake.
 */
export const THROTTLE_FLAGS = [
  "--retries",
  "1",
  "--fragment-retries",
  "10",
  "--extractor-retries",
  "3",
  "--retry-sleep",
  "linear=1:4:2",
  "--throttled-rate",
  "100K",
  "--http-chunk-size",
  "10M",
  "--concurrent-fragments",
  "1",
  "--socket-timeout",
  "20",
  "--sleep-requests",
  "0.2",
] as const;

export function looksThrottled(text: string): boolean {
  const msg = text.toLowerCase();
  if (/\b403\b|sign in|sabr-only|no video formats/.test(msg)) return false;
  return (
    msg.includes("throttl") ||
    msg.includes("nsig extraction failed") ||
    msg.includes("error solving n challenge") ||
    msg.includes("n result is invalid") ||
    msg.includes("n-sig") ||
    /\b40\s*kb/.test(msg) ||
    msg.includes("download speed is below")
  );
}

export const THROTTLE_QA = [
  {
    q: "Why does YouTube crawl at ~40 KB/s?",
    a: "The n-token on the CDN URL is a throttle lock. If player.js doesn’t transform it, the CDN caps the stream. We run Node + ejs on this host and re-extract when speed drops under 100 KB/s.",
  },
  {
    q: "What actually avoids it?",
    a: "Solved nsig, same-hop IP, 10 MB HTTP chunks, one HLS connection, H.264 137+140. Extra clients and AV1/VP9 just add 403s.",
  },
  {
    q: "What’s still missing?",
    a: "Cookies only for age-gated / members videos. Guest 1080p does not need a Google login. Chrome “clear site data” drops the local copy, not the hop.",
  },
] as const;
