/**
 * yt-dlp transfer flags for every run: re-extract when speed stays under
 * 100 KB/s, 10 MB HTTP chunks, one HLS fragment at a time.
 *
 * --retries stays at 1: a 403 never succeeds on the same URL.
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
