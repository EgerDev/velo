/**
 * Download-speed diagnosis — pure decision logic, no network.
 *
 * Two things shape the verdict, both borrowed from yt-final's speed-test
 * engine rather than its DPI-desync proxy (which cannot apply here — see
 * below):
 *
 *  1. Judge a flow against a *control*, never against an absolute number. A
 *     3 Mbps rural line is not "throttled" just because it is slow; it is
 *     throttled when it moves far slower than this same link has already
 *     demonstrated it can move. `baselineBytesPerSec` is that control.
 *  2. A failed or missing measurement is null, never 0 — a probe that did not
 *     run must degrade to "can't tell", never masquerade as an extreme value.
 *
 * Why no SNI desync: Velo's browser never opens a TLS connection to
 * googlevideo.com. Media arrives through this app's own origin, so an ISP
 * throttling YouTube by TLS SNI has nothing to match on. What remains is a
 * congested link, volumetric shaping of any large flow, or a slow server hop.
 */

const MIB = 1024 * 1024;

/** Ratio thresholds against the control (mirrors yt-final's calibration). */
const CLEAN_RATIO = 0.6; // at/above this share of the baseline: keeping up
const SHAPED_RATIO = 0.4; // below this share: something is holding it back
/** A baseline this slow can't prove anything about shaping. */
const BASELINE_TRUST = 1.5 * MIB;
/** At/above this a single flow is simply healthy, whatever the baseline says. */
const CLEAN_ABSOLUTE = 2.5 * MIB;
/** Below this a flow is slow in absolute terms and worth explaining. */
const SLOW_ABSOLUTE = 0.6 * MIB;
/** Spread beyond this between the fastest and slowest sample = jittery. */
const JITTER_SPREAD = 3;

export type ThrottleVerdict =
  | "unknown" // nothing measured yet
  | "ramping" // too early in the transfer to judge
  | "healthy"
  | "slow-link" // the whole connection is slow, not just this download
  | "congested" // below par, but not dramatically
  | "shaped"; // far below what this link has proven it can do

export type SpeedSummary = {
  median: number | null;
  lo: number | null;
  hi: number | null;
  count: number;
};

export type ThrottleReading = {
  verdict: ThrottleVerdict;
  summary: string;
  /** A concrete next step, or null when nothing is worth suggesting. */
  action: string | null;
  speed: SpeedSummary;
  /** median ÷ baseline, or null without a trustworthy baseline. */
  ratio: number | null;
  /** "low" when the samples disagree enough that the number is a rough middle. */
  confidence: "high" | "low";
};

function usable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Median (not mean) — googlevideo paces in bursts and a mean chases the spikes. */
export function summarizeSamples(samples: readonly (number | null | undefined)[]): SpeedSummary {
  const valid = samples.map(usable).filter((n): n is number => n != null);
  if (!valid.length) return { median: null, lo: null, hi: null, count: 0 };
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { median, lo: sorted[0]!, hi: sorted[sorted.length - 1]!, count: sorted.length };
}

export type AdviseOptions = {
  /**
   * Best throughput this link has shown recently (the control). Null when
   * nothing has been measured yet — then only absolute speed can be judged.
   */
  baselineBytesPerSec?: number | null;
  /** Transfer completion 0-100; an early transfer is still ramping. */
  percentComplete?: number;
};

const HEDGE = " Speed is bouncing around, so read this as a rough middle.";

export function adviseThrottle(
  samples: readonly (number | null | undefined)[] | number | null | undefined,
  options: AdviseOptions = {},
): ThrottleReading {
  const list = Array.isArray(samples) ? samples : [samples as number | null | undefined];
  const speed = summarizeSamples(list);
  const baseline = usable(options.baselineBytesPerSec);
  const percent = options.percentComplete ?? 100;

  const jittery =
    speed.lo != null && speed.hi != null && speed.lo > 0 && speed.hi / speed.lo > JITTER_SPREAD;
  const confidence: "high" | "low" = speed.count >= 3 && !jittery ? "high" : "low";
  const hedge = confidence === "low" && speed.count > 1 ? HEDGE : "";

  if (speed.median == null) {
    return {
      verdict: "unknown",
      summary: "Measuring speed…",
      action: null,
      speed,
      ratio: null,
      confidence: "low",
    };
  }

  const ratio = baseline != null && baseline >= BASELINE_TRUST ? speed.median / baseline : null;

  // Healthy in absolute terms needs no further explanation.
  if (speed.median >= CLEAN_ABSOLUTE || (ratio != null && ratio >= CLEAN_RATIO)) {
    return {
      verdict: "healthy",
      summary: "Downloading at full speed.",
      action: null,
      speed,
      ratio,
      confidence,
    };
  }

  // Early in a transfer the rate is still climbing; don't diagnose yet.
  if (percent < 25 && speed.median < CLEAN_ABSOLUTE) {
    return {
      verdict: "ramping",
      summary: "Still ramping up…",
      action: null,
      speed,
      ratio,
      confidence,
    };
  }

  // Far below what this same link has already achieved — that gap is the
  // evidence for shaping, and it's the only case where blaming the network is
  // fair.
  if (ratio != null && ratio < SHAPED_RATIO) {
    return {
      verdict: "shaped",
      summary: `Running at about ${Math.round(ratio * 100)}% of this connection's usual speed — large downloads look shaped.${hedge}`,
      action:
        "Retrying takes a fresh route. If you're on mobile or 5G home internet, Wi-Fi on another network is usually faster.",
      speed,
      ratio,
      confidence,
    };
  }

  // No trustworthy baseline: do not invent a "usual" speed to fall short of.
  if (ratio == null) {
    if (speed.median < SLOW_ABSOLUTE) {
      return {
        verdict: "slow-link",
        summary: `Slow going — about ${formatMib(speed.median)}.${hedge}`,
        action: "If other downloads are also slow, it's the connection rather than this file.",
        speed,
        ratio,
        confidence,
      };
    }
    return {
      verdict: "unknown",
      summary: `About ${formatMib(speed.median)} — no usual speed to compare yet.${hedge}`,
      action: null,
      speed,
      ratio,
      confidence,
    };
  }

  return {
    verdict: "congested",
    summary: `A little slower than usual — about ${formatMib(speed.median)}.${hedge}`,
    action: null,
    speed,
    ratio,
    confidence,
  };
}

function formatMib(bytesPerSec: number): string {
  return bytesPerSec >= MIB
    ? `${(bytesPerSec / MIB).toFixed(1)} MB/s`
    : `${Math.round(bytesPerSec / 1024)} KB/s`;
}

/**
 * The control: the best sustained speed seen this session. Kept in memory only
 * — a stale baseline from another network would misdiagnose this one.
 */
let sessionBaseline: number | null = null;

export function recordSpeedBaseline(bytesPerSec: number | null | undefined): void {
  const value = usable(bytesPerSec);
  if (value == null) return;
  sessionBaseline = sessionBaseline == null ? value : Math.max(sessionBaseline, value);
}

export function getSpeedBaseline(): number | null {
  return sessionBaseline;
}

export function resetSpeedBaseline(): void {
  sessionBaseline = null;
}
