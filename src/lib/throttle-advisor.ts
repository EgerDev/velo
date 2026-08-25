/**
 * Client-side download-speed advisor — pure decision logic, no network.
 *
 * Velo streams media through a relay (a CORS proxy or its own /api/relay), so
 * the browser never opens a TLS connection to googlevideo.com. An ISP that
 * throttles YouTube by its TLS SNI therefore has nothing to match on Velo's
 * download traffic — which is why Velo needs no ClientHello/SNI desync trick.
 * What CAN still slow a download is a genuinely congested link, volumetric
 * shaping of all large flows, or a slow relay hop. This module turns a measured
 * throughput into a plain-language verdict and, when useful, one action.
 *
 * Speeds are bytes/second. A null measurement means "not measured yet" and must
 * never be treated as zero.
 */

const MIB = 1024 * 1024;

export type ThrottleVerdict = "healthy" | "moderate" | "slow" | "crawling" | "unknown";

export type ThrottleAdvice = {
  verdict: ThrottleVerdict;
  /** One-line summary safe to show next to the speed readout. */
  summary: string;
  /** A concrete next step, or null when nothing is worth suggesting. */
  action: string | null;
};

// Calibrated to Velo's relay path, not a direct googlevideo flow:
// ~40 KB/s is the classic unsolved-nsig crawl; a few hundred KB/s is a shaped
// or congested link; multi-MiB/s is healthy for a proxied stream.
const CRAWLING = 0.15 * MIB; // < ~150 KB/s — barely moving
const SLOW = 0.6 * MIB; //     < ~600 KB/s — clearly shaped or congested
const HEALTHY = 2.5 * MIB; //  >= ~2.5 MiB/s — no complaint

/**
 * Classify a download's throughput. `improving` lets a still-ramping transfer
 * avoid a false "slow" verdict in its first seconds.
 */
export function adviseThrottle(
  bytesPerSec: number | null | undefined,
  opts: { improving?: boolean; usingLocalRelay?: boolean } = {},
): ThrottleAdvice {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return { verdict: "unknown", summary: "Measuring speed…", action: null };
  }
  if (bytesPerSec >= HEALTHY) {
    return { verdict: "healthy", summary: "Downloading at full speed.", action: null };
  }
  if (bytesPerSec >= SLOW) {
    return {
      verdict: "moderate",
      summary: "A little slower than usual — likely link congestion.",
      action: opts.improving ? null : "Let it run; speed often climbs as the stream ramps.",
    };
  }

  // Below SLOW: distinguish a still-ramping transfer from a genuinely shaped one.
  if (opts.improving) {
    return { verdict: "moderate", summary: "Still ramping up…", action: null };
  }

  const crawling = bytesPerSec < CRAWLING;
  return {
    verdict: crawling ? "crawling" : "slow",
    summary: crawling
      ? "Barely moving — your network is likely shaping this download."
      : "Running slow — your network may be shaping large downloads.",
    // Velo already avoids googlevideo's SNI via the relay, so the useful lever
    // is trying a different hop, not a desync proxy.
    action: opts.usingLocalRelay
      ? "Retry — the next attempt takes a fresh route. On mobile data, a Wi-Fi network is usually faster."
      : "Retry to pick a different relay, or switch networks (many ISPs shape mobile data hardest).",
  };
}
