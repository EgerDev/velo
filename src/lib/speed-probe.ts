export type SpeedSample = {
  bytesPerSec: number;
  loaded: number;
  total: number;
  throttled: boolean;
};

const THROTTLE_FLOOR = 80 * 1024;
const WARMUP_MS = 1500;
/**
 * Shortest interval that can produce an honest rate. A proxied or server-muxed
 * response hands the reader tens of megabytes in a few milliseconds, and
 * `bytes / 3ms` reads as hundreds of MB/s — a number that describes the buffer
 * flush, not the link. Below this window the bytes are carried forward into the
 * next sample instead of being divided by a meaningless interval.
 */
const MIN_SAMPLE_MS = 250;

/**
 * Monotonic where available. `Date.now()` steps backwards on NTP correction,
 * DST, and VM resume, which makes `elapsed` negative for the rest of the
 * download — and a negative elapsed can never clear WARMUP_MS, so throttle
 * detection silently switches off for good.
 */
const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function createSpeedProbe(clock: () => number = nowMs): {
  push: (loaded: number, total?: number) => SpeedSample;
} {
  let started = clock();
  let startedLoaded = 0;
  let lastT = started;
  let lastLoaded = 0;
  let ema = 0;
  let initialized = false;

  /** Drop the timing and rate history, keeping `loaded` as the new baseline. */
  function rebase(now: number, loaded: number): void {
    started = now;
    startedLoaded = loaded;
    lastT = now;
    lastLoaded = loaded;
    ema = 0;
    initialized = false;
  }

  return {
    push(loaded: number, total = 0): SpeedSample {
      const now = clock();
      // Either the byte counter rewound (a range retry) or the clock did (an
      // NTP step the monotonic default should prevent, but a caller may inject
      // any clock). Both invalidate the rate history, so rebase and skip this
      // sample rather than seeding the EMA with the synthetic 0 it would
      // otherwise produce — that reads back as 28% of true speed and trips a
      // false "throttled" banner on a perfectly healthy download.
      if (loaded < lastLoaded || now < lastT) {
        rebase(now, loaded);
        return { bytesPerSec: 0, loaded, total, throttled: false };
      }
      const elapsed = now - started;
      const overall = ((loaded - startedLoaded) / Math.max(1, elapsed)) * 1000;
      const dt = now - lastT;

      // Too soon to divide: hold the bytes for the next window rather than
      // reporting a buffer flush as link speed. `lastT`/`lastLoaded` stay put so
      // the next qualifying sample spans the whole accumulated interval.
      if (dt < MIN_SAMPLE_MS) {
        // Before the first honest window there is no rate to report — 0 means
        // "not measured yet", which the UI and advisor both treat as unknown.
        const holding = initialized ? ema : elapsed >= MIN_SAMPLE_MS ? overall : 0;
        return {
          bytesPerSec: holding,
          loaded,
          total,
          throttled: elapsed >= WARMUP_MS && initialized && holding < THROTTLE_FLOOR,
        };
      }

      const inst = Math.max(0, ((loaded - lastLoaded) / dt) * 1000);
      ema = !initialized ? inst : ema * 0.72 + inst * 0.28;
      initialized = true;
      lastT = now;
      lastLoaded = loaded;
      const bytesPerSec = ema > 0 ? ema : overall;
      // No `bytesPerSec > 0` guard: a stream stalled at exactly zero is the
      // worst case, not an exempt one.
      const throttled = elapsed >= WARMUP_MS && bytesPerSec < THROTTLE_FLOOR;
      return { bytesPerSec, loaded, total, throttled };
    },
  };
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}
