export type RateState = Map<string, number[]>;

/** Keys tracked before the sweep drops the coldest ones. */
const MAX_TRACKED_KEYS = 5000;

/**
 * Record one attempt against `key` and report whether it has now exceeded
 * `limit` within `windowMs`.
 */
export function rateLimited(
  state: RateState,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): boolean {
  const since = now - windowMs;
  const hits = (state.get(key) ?? []).filter((at) => at > since);
  hits.push(now);
  // Past the limit the exact count stops mattering — only that it was exceeded.
  // Without this cap a sustained burst against one key grows the array for the
  // whole window, and every call re-filters the whole thing.
  if (hits.length > limit + 1) hits.splice(0, hits.length - (limit + 1));
  state.set(key, hits);
  if (state.size > MAX_TRACKED_KEYS) {
    for (const [other, times] of state) {
      if (other !== key && !times.some((at) => at > since)) state.delete(other);
    }
  }
  return hits.length > limit;
}
