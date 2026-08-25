export type SpeedSample = {
  bytesPerSec: number;
  loaded: number;
  total: number;
  throttled: boolean;
};

const THROTTLE_FLOOR = 80 * 1024;
const WARMUP_MS = 1500;

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
      const dt = Math.max(1, now - lastT);
      const inst = Math.max(0, ((loaded - lastLoaded) / dt) * 1000);
      ema = !initialized ? inst : ema * 0.72 + inst * 0.28;
      initialized = true;
      lastT = now;
      lastLoaded = loaded;
      const elapsed = now - started;
      const overall = ((loaded - startedLoaded) / Math.max(1, elapsed)) * 1000;
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
