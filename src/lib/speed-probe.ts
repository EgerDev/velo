export type SpeedSample = {
  bytesPerSec: number;
  loaded: number;
  total: number;
  throttled: boolean;
};

const THROTTLE_FLOOR = 80 * 1024;
const WARMUP_MS = 1500;

export function createSpeedProbe(): {
  push: (loaded: number, total?: number) => SpeedSample;
} {
  const started = Date.now();
  let lastT = started;
  let lastLoaded = 0;
  let ema = 0;
  return {
    push(loaded: number, total = 0): SpeedSample {
      const now = Date.now();
      const dt = Math.max(1, now - lastT);
      const inst = ((loaded - lastLoaded) / dt) * 1000;
      ema = ema === 0 ? inst : ema * 0.72 + inst * 0.28;
      lastT = now;
      lastLoaded = loaded;
      const elapsed = now - started;
      const overall = (loaded / Math.max(1, elapsed)) * 1000;
      const bytesPerSec = ema > 0 ? ema : overall;
      const throttled = elapsed >= WARMUP_MS && bytesPerSec > 0 && bytesPerSec < THROTTLE_FLOOR;
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
