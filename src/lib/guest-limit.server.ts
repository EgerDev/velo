/**
 * Download abuse control.
 *
 * Token bucket (primary): guests can burst one 1080p mux (3 tokens) then refill
 * slowly. Sliding-window log (safety): each spend is timestamped; cost ages out
 * exactly `windowMs` later so a client cannot sit on a fixed-window edge and
 * double the rate. Identity is user id when signed in, otherwise a per-browser
 * guest id (x-velo-guest / cookie) so 100 grok.me tabs on one NAT are not one
 * bucket. IP is last-resort only.
 *
 * On grok.me the session rides a bearer token (partitioned cookies). Quota and
 * cookie gates must read Authorization from the download request itself.
 */
import { readSessionTokenFromHeaders } from "./session-token.ts";

type Spend = { at: number; cost: number };

type Bucket = {
  tokens: number;
  updatedAt: number;
  spends: Spend[];
};

const buckets = new Map<string, Bucket>();

export type QuotaPlan = {
  name: string;
  capacity: number;
  refillPerMs: number;
  windowMax: number;
  windowMs: number;
};

/** Guest: burst of one Full HD hybrid (server + yt-dlp + audio), ~12 files / 10 min. */
export const GUEST_PLAN: QuotaPlan = {
  name: "guest",
  capacity: 6,
  refillPerMs: 12 / (10 * 60_000),
  windowMax: 12,
  windowMs: 10 * 60_000,
};

/** Signed-in: 12-token burst, ~80 files / 10 min. */
export const USER_PLAN: QuotaPlan = {
  name: "user",
  capacity: 12,
  refillPerMs: 80 / (10 * 60_000),
  windowMax: 80,
  windowMs: 10 * 60_000,
};

const GUEST_ID_RE = /^[a-z0-9_-]{8,64}$/i;

export function clientIp(request: Request): string {
  const cfRay = request.headers.get("cf-ray")?.trim();
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfRay && cfIp) return cfIp;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    return hops.at(-1) || hops[0] || "local";
  }
  return "local";
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

export function readGuestId(request: Request): string | null {
  const header = request.headers.get("x-velo-guest")?.trim();
  if (header && GUEST_ID_RE.test(header)) return header;
  for (const name of ["velo-guest-id", "velo_guest"]) {
    const cookie = cookieValue(request, name);
    if (cookie && GUEST_ID_RE.test(cookie)) return cookie;
  }
  return null;
}

export function quotaIdentity(
  request: Request,
  userId: string | null,
): { key: string; plan: QuotaPlan; signedIn: boolean; guestId: string | null } {
  if (userId) return { key: `user:${userId}`, plan: USER_PLAN, signedIn: true, guestId: null };
  const guestId = readGuestId(request);
  if (guestId) return { key: `guest:${guestId}`, plan: GUEST_PLAN, signedIn: false, guestId };
  return { key: `guest:${clientIp(request)}`, plan: GUEST_PLAN, signedIn: false, guestId: null };
}

function refill(bucket: Bucket, plan: QuotaPlan, now: number) {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(plan.capacity, bucket.tokens + elapsed * plan.refillPerMs);
  bucket.updatedAt = now;
}

export function pruneSpends(spends: Spend[], now: number, windowMs: number): Spend[] {
  const cutoff = now - windowMs;
  return spends.filter((spend) => spend.at > cutoff);
}

export function windowLoad(spends: Spend[]): number {
  return spends.reduce((sum, spend) => spend.cost + sum, 0);
}

export function slidingRetryAfterSec(
  spends: Spend[],
  cost: number,
  windowMax: number,
  windowMs: number,
  now: number,
): number {
  const live = [...pruneSpends(spends, now, windowMs)].sort((a, b) => a.at - b.at);
  let load = windowLoad(live);
  if (load + cost <= windowMax) return 1;
  let waitUntil = now + windowMs;
  for (const spend of live) {
    load -= spend.cost;
    waitUntil = spend.at + windowMs;
    if (load + cost <= windowMax) break;
  }
  return Math.max(1, Math.ceil((waitUntil - now) / 1000));
}

export function takeTokens(
  key: string,
  plan: QuotaPlan,
  cost: number,
  now = Date.now(),
): { ok: boolean; remaining: number; retryAfterSec: number; limit: number; reason: "ok" | "burst" | "window" } {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: plan.capacity, updatedAt: now, spends: [] };
    buckets.set(key, bucket);
    if (buckets.size > 4000) {
      for (const [id, row] of buckets) {
        if (now - row.updatedAt > plan.windowMs * 2) buckets.delete(id);
      }
    }
  }
  refill(bucket, plan, now);
  bucket.spends = pruneSpends(bucket.spends, now, plan.windowMs);
  const load = windowLoad(bucket.spends);
  const deficit = Math.max(0, cost - bucket.tokens);
  const retryBurst = Math.max(1, Math.ceil(deficit / Math.max(plan.refillPerMs, 1e-9) / 1000));
  if (load + cost > plan.windowMax) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: slidingRetryAfterSec(bucket.spends, cost, plan.windowMax, plan.windowMs, now),
      limit: plan.windowMax,
      reason: "window",
    };
  }
  if (bucket.tokens < cost) {
    return {
      ok: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterSec: retryBurst,
      limit: plan.windowMax,
      reason: "burst",
    };
  }
  bucket.tokens -= cost;
  bucket.spends.push({ at: now, cost });
  return {
    ok: true,
    remaining: Math.max(0, plan.windowMax - (load + cost)),
    retryAfterSec: retryBurst,
    limit: plan.windowMax,
    reason: "ok",
  };
}

export function quotaHeaders(result: {
  remaining: number;
  retryAfterSec: number;
  limit: number;
}): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "RateLimit-Reset": String(result.retryAfterSec),
    "Retry-After": String(result.retryAfterSec),
  };
}

/** Resolve the signed-in person from this download request’s bearer (grok.me iframe). */
export async function userIdFromDownloadRequest(request: Request): Promise<string | null> {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  try {
    const token = readSessionTokenFromHeaders(request.headers);
    return (await getSessionUser(token || undefined))?.id ?? null;
  } catch {
    return null;
  }
}

export async function cookiesNeedSession(request: Request, cookies?: string): Promise<Response | null> {
  if (!cookies?.trim()) return null;
  const userId = await userIdFromDownloadRequest(request);
  if (userId) return null;
  return Response.json(
    { error: "Sign in to use a YouTube session. Guest downloads stay unlocked." },
    { status: 401 },
  );
}

export async function downloadQuotaResponse(request: Request, cost = 1): Promise<Response | null> {
  const userId = await userIdFromDownloadRequest(request);
  const ident = quotaIdentity(request, userId);
  const quota = takeTokens(ident.key, ident.plan, cost);
  if (quota.ok) return null;
  const message = ident.signedIn
    ? "Too many downloads on this account. Wait a few minutes, then try again."
    : quota.reason === "burst"
      ? "Guest burst cap hit (one Full HD save uses a few slots). Wait a minute, or sign in for a higher cap."
      : "Guest download cap reached (about 12 files every 10 minutes). Sign in for a higher cap, or wait.";
  return Response.json({ error: message, code: "rate" }, { status: 429, headers: quotaHeaders(quota) });
}

export function refundTokens(key: string, plan: QuotaPlan, cost: number, now = Date.now()): void {
  const bucket = buckets.get(key);
  if (!bucket) return;
  refill(bucket, plan, now);
  bucket.tokens = Math.min(plan.capacity, bucket.tokens + cost);
  for (let i = bucket.spends.length - 1; i >= 0; i--) {
    if (bucket.spends[i]?.cost === cost) {
      bucket.spends.splice(i, 1);
      break;
    }
  }
}

export async function downloadQuotaRefund(request: Request, cost = 1): Promise<void> {
  const userId = await userIdFromDownloadRequest(request);
  const ident = quotaIdentity(request, userId);
  refundTokens(ident.key, ident.plan, cost);
}
