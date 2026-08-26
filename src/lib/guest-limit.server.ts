/**
 * Download abuse control.
 *
 * Token bucket (primary): guests can burst one 1080p mux (3 tokens) then refill
 * slowly. Sliding-window log (safety): each spend is timestamped; cost ages out
 * exactly `windowMs` later so a client cannot sit on a fixed-window edge and
 * double the rate. Identity is user id when signed in, otherwise a per-browser
 * guest id (x-velo-guest / cookie) so 100 grok.me tabs on one NAT are not one
 * bucket.
 *
 * That guest id is client-set and unsigned, so it is a fairness key, NOT a cap:
 * on its own, rotating the header once per request buys unlimited downloads.
 * Guests therefore clear a coarse per-IP backstop FIRST (`IP_PLAN`), and only
 * then their own bucket. Charging in that order also means a refused caller
 * never mints a bucket, which is what keeps the map bounded under a flood.
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
  /** Kept per row so eviction can tell a spent bucket from a fully refilled one. */
  plan: QuotaPlan;
};

/**
 * Per-browser and per-user buckets, keyed `guest:<id>` / `user:<id>`.
 *
 * Separate from `ipBuckets` on purpose: guest ids are attacker-chosen and
 * unbounded, so a flood of them must not be able to force the eviction of the
 * per-IP row that is the thing actually capping that flood.
 */
const buckets = new Map<string, Bucket>();

/** Per-IP backstop buckets, bounded by real networks rather than by header values. */
const ipBuckets = new Map<string, Bucket>();

const bucketsFor = (plan: QuotaPlan): Map<string, Bucket> =>
  plan.name === IP_PLAN.name || plan.name === META_PLAN.name ? ipBuckets : buckets;

/** What each in-flight request actually spent, so a refund cannot land elsewhere. */
const charged = new WeakMap<Request, Array<{ key: string; plan: QuotaPlan }>>();

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

/**
 * Coarse per-IP backstop for guests.
 *
 * The per-browser guest id is what keeps 100 tabs on one NAT from sharing a
 * bucket, and that fairness goal is real — but `x-velo-guest` is set by ordinary
 * client JS with no signature, so on its own it caps nothing: rotating the
 * header once per request buys unlimited downloads. This sits behind it, sized
 * well above an honest shared NAT and low enough to bound one host's cost.
 */
export const IP_PLAN: QuotaPlan = {
  name: "ip",
  capacity: 24,
  refillPerMs: 120 / (10 * 60_000),
  windowMax: 120,
  windowMs: 10 * 60_000,
};

/**
 * Coarse per-IP backstop for cheap metadata routes (captions, channel feed,
 * non-media relay). These do not spend a download token but each fans out to
 * real upstream work — up to ~14 InnerTube calls plus a BotGuard mint for a
 * caption lookup — so an unmetered flood of attacker-chosen ids can get the
 * server IP rate-banned by YouTube. Sized generously above honest browsing and
 * held in `ipBuckets`, keyed by real network, so it can't be reset by rotating
 * a client-set header. Separate plan from `IP_PLAN` so metadata traffic and
 * download traffic don't drain each other's backstop.
 */
export const META_PLAN: QuotaPlan = {
  name: "meta",
  capacity: 40,
  refillPerMs: 300 / (10 * 60_000),
  windowMax: 300,
  windowMs: 10 * 60_000,
};

const GUEST_ID_RE = /^[a-z0-9_-]{8,64}$/i;

export function clientIp(request: Request): string {
  // `cf-ray` / `cf-connecting-ip` are only trustworthy when Cloudflare actually
  // fronts the origin and strips inbound copies. On a bare Vercel deploy (this
  // app's target) they are client-settable and reach the function verbatim, so
  // trusting them ahead of the platform headers lets a guest rotate the per-IP
  // backstop key at will — a spoofed `cf-ray` plus a rotating `cf-connecting-ip`
  // mints a fresh full bucket every request and defeats the cap on every
  // download route. Gate the branch behind an explicit opt-in that is only set
  // when a Cloudflare edge is really in front; default off.
  if (process.env.TRUST_CLOUDFLARE === "1") {
    const cfRay = request.headers.get("cf-ray")?.trim();
    const cfIp = request.headers.get("cf-connecting-ip")?.trim();
    if (cfRay && cfIp) return cfIp;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
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
  // Never move the marker backwards. A backwards clock step (NTP, VM resume)
  // would otherwise leave `updatedAt` in the future, and the next refill would
  // compute a huge elapsed and hand back the whole bucket.
  if (now > bucket.updatedAt) bucket.updatedAt = now;
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

/** Seconds until one more burst token exists — what a caller at zero must wait. */
function retryAfterOneToken(plan: QuotaPlan): number {
  return Math.max(1, Math.ceil(1 / Math.max(plan.refillPerMs, 1e-9) / 1000));
}

const MAX_BUCKETS = 4000;

/**
 * A row that would be recreated identically if dropped, and so caps nothing.
 * Anything below capacity is load-bearing: evicting it hands back the tokens
 * its owner has already spent.
 */
function carriesNoDebt(row: Bucket, now: number): boolean {
  const elapsed = Math.max(0, now - row.updatedAt);
  return (
    row.tokens + elapsed * row.plan.refillPerMs >= row.plan.capacity &&
    pruneSpends(row.spends, now, row.plan.windowMs).length === 0
  );
}

/**
 * Keep the map bounded without handing an attacker a reset.
 *
 * Order matters: dropping the least-recently-used row first would evict the
 * per-IP backstop — long-lived and drained — while keeping the one-shot keys
 * of the flood that triggered the eviction. So spent rows are preserved until
 * everything refundable is gone.
 */
function evict(map: Map<string, Bucket>, now: number, keep: string): void {
  for (const [id, row] of map) {
    if (id !== keep && carriesNoDebt(row, now)) map.delete(id);
  }
  // Still over: every remaining row is genuinely in debt, so there is no
  // harmless choice left and least-recently-used is the least-bad one.
  while (map.size > MAX_BUCKETS) {
    const stalest = map.keys().next().value;
    if (stalest === undefined || stalest === keep) break;
    map.delete(stalest);
  }
}

export function takeTokens(
  key: string,
  plan: QuotaPlan,
  cost: number,
  now = Date.now(),
): {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
  reason: "ok" | "burst" | "window";
} {
  const map = bucketsFor(plan);
  let bucket = map.get(key);
  if (bucket) {
    // Re-insert so Map iteration order is least-recently-USED, not
    // least-recently-created; eviction below relies on that ordering.
    map.delete(key);
    map.set(key, bucket);
  } else {
    bucket = { tokens: plan.capacity, updatedAt: now, spends: [], plan };
    map.set(key, bucket);
    if (map.size > MAX_BUCKETS) evict(map, now, key);
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
    // Report whichever constraint actually binds. Advertising sliding-window
    // room while the burst bucket is empty tells a well-behaved client it has
    // budget and then 429s it on the very next request.
    remaining: Math.max(0, Math.min(plan.windowMax - (load + cost), Math.floor(bucket.tokens))),
    retryAfterSec: bucket.tokens < 1 ? retryAfterOneToken(plan) : 1,
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

export async function cookiesNeedSession(
  request: Request,
  cookies?: string,
): Promise<Response | null> {
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

  // Guests clear the per-IP backstop FIRST. The per-browser bucket exists so
  // 100 tabs on one NAT are not one bucket, but `x-velo-guest` is client-set
  // and unsigned, so it caps nothing on its own. Charging it first would also
  // let a rotating header mint one bucket per request before being refused.
  let ipCharge: { key: string; plan: QuotaPlan } | null = null;
  if (!ident.signedIn) {
    const ipKey = `ip:${clientIp(request)}`;
    const ip = takeTokens(ipKey, IP_PLAN, cost);
    if (!ip.ok) {
      return Response.json(
        {
          error:
            "Too many guest downloads from this network. Wait a few minutes, or sign in for a higher cap.",
          code: "rate",
        },
        { status: 429, headers: quotaHeaders(ip) },
      );
    }
    ipCharge = { key: ipKey, plan: IP_PLAN };
  }

  const quota = takeTokens(ident.key, ident.plan, cost);
  if (quota.ok) {
    charged.set(
      request,
      ipCharge
        ? [{ key: ident.key, plan: ident.plan }, ipCharge]
        : [{ key: ident.key, plan: ident.plan }],
    );
    return null;
  }
  // This browser is capped but the network was not — give the IP token back.
  if (ipCharge) refundTokens(ipCharge.key, ipCharge.plan, cost);
  const message = ident.signedIn
    ? "Too many downloads on this account. Wait a few minutes, then try again."
    : quota.reason === "burst"
      ? "Guest burst cap hit (one Full HD save uses a few slots). Wait a minute, or sign in for a higher cap."
      : "Guest download cap reached (about 12 files every 10 minutes). Sign in for a higher cap, or wait.";
  return Response.json(
    { error: message, code: "rate" },
    { status: 429, headers: quotaHeaders(quota) },
  );
}

/**
 * Per-IP backstop for cheap upstream-fanout routes that do not spend a download
 * token (captions, channel feed, non-media relay). Synchronous on purpose — no
 * session lookup — so metadata stays fast; signed-in callers clear it too since
 * the goal is bounding anonymous fan-out by real network, not billing a person.
 * Returns a 429 Response when the network is over its metadata budget, else null.
 */
export function metadataBackstopResponse(request: Request): Response | null {
  const result = takeTokens(`meta:${clientIp(request)}`, META_PLAN, 1);
  if (result.ok) return null;
  return Response.json(
    { error: "Too many requests from this network. Wait a moment, then retry.", code: "rate" },
    { status: 429, headers: quotaHeaders(result) },
  );
}

export function refundTokens(key: string, plan: QuotaPlan, cost: number, now = Date.now()): void {
  const bucket = bucketsFor(plan).get(key);
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

/**
 * Credit back exactly what this request was charged.
 *
 * Re-resolving the identity here would be wrong: `userIdFromDownloadRequest`
 * swallows every error and returns null, so one transient session lookup
 * failure would credit the guest bucket for a spend made against the user
 * bucket — losing the user's token and minting a free one somewhere else.
 */
export async function downloadQuotaRefund(request: Request, cost = 1): Promise<void> {
  const spent = charged.get(request);
  if (!spent) return;
  charged.delete(request);
  for (const { key, plan } of spent) refundTokens(key, plan, cost);
}
