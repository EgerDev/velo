import { DownloadError } from "./download-error.ts";

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  retryOn?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, waitMs: number) => void;
  wait?: (ms: number) => Promise<void>;
};

const FATAL_CODES = new Set(["rate", "busy", "queue", "blocked", "bot", "cookies"]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof DownloadError && FATAL_CODES.has(err.code)) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("403") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("sign in") ||
    msg.includes("cookie") ||
    msg.includes("access denied") ||
    msg.includes("locked cdn") ||
    msg.includes("bot wall") ||
    msg.includes("download cap") ||
    msg.includes("guest cap") ||
    msg.includes("burst cap") ||
    msg.includes("too many downloads") ||
    msg.includes("lots of people are saving") ||
    msg.includes("queued") ||
    msg.includes("sandbox busy") ||
    /\baborted\b/.test(msg)
  ) {
    return false;
  }
  return (
    msg.includes("throttl") ||
    msg.includes("nsig") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("502") ||
    msg.includes("522") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("empty stream")
  );
}

function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return exp + Math.floor(Math.random() * Math.min(120, baseMs));
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4000;
  const retryOn = opts.retryOn ?? isRetryable;
  const wait = opts.wait ?? defaultWait;
  let last: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt >= attempts || !retryOn(err)) throw err;
      const delay = backoffMs(attempt, baseMs, maxMs);
      opts.onRetry?.(attempt, err, delay);
      await wait(delay);
    }
  }

  throw last;
}
