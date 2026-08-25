import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GUEST_PLAN,
  IP_PLAN,
  USER_PLAN,
  clientIp,
  pruneSpends,
  quotaIdentity,
  readGuestId,
  refundTokens,
  takeTokens,
  windowLoad,
} from "./guest-limit.server.ts";

test("token bucket allows a guest 1080p burst then blocks", () => {
  const now = 5_000_000;
  const first = takeTokens("guest:burst-b", GUEST_PLAN, 6, now);
  assert.equal(first.ok, true);
  assert.equal(first.reason, "ok");
  const blocked = takeTokens("guest:burst-b", GUEST_PLAN, 1, now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "burst");
  const later = takeTokens("guest:burst-b", GUEST_PLAN, 1, now + 60_000);
  assert.equal(later.ok, true);
});

test("sliding window ages cost out instead of cliff-resetting", () => {
  const t0 = 20_000_000;
  let t = t0;
  for (let i = 0; i < 12; i++) {
    assert.equal(takeTokens("guest:slide-b", GUEST_PLAN, 1, t).ok, true, `fill ${i}`);
    t += 50_000;
  }
  const stillFull = takeTokens("guest:slide-b", GUEST_PLAN, 1, t0 + 599_000);
  assert.equal(stillFull.ok, false);
  assert.equal(stillFull.reason, "window");
  const afterFirstExpires = takeTokens("guest:slide-b", GUEST_PLAN, 7, t0 + 600_001);
  assert.equal(afterFirstExpires.ok, false);
  assert.equal(afterFirstExpires.reason, "window");
});

test("pruneSpends drops events at the window edge", () => {
  const now = 100_000;
  const live = pruneSpends(
    [
      { at: now - 600_000, cost: 1 },
      { at: now - 599_999, cost: 2 },
    ],
    now,
    600_000,
  );
  assert.equal(windowLoad(live), 2);
});

test("signed-in plan has a larger window than guests", () => {
  assert.ok(USER_PLAN.windowMax > GUEST_PLAN.windowMax);
  assert.ok(USER_PLAN.capacity > GUEST_PLAN.capacity);
});

test("reads client IP from platform headers, not the leftmost spoofable hop", () => {
  const spoofed = new Request("https://velo.test/api/download", {
    headers: {
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "cf-connecting-ip": "198.51.100.4",
    },
  });
  assert.equal(clientIp(spoofed), "10.0.0.1");
  const fromCf = new Request("https://velo.test/api/download", {
    headers: {
      "cf-ray": "abc-SJC",
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    },
  });
  assert.equal(clientIp(fromCf), "198.51.100.4");
  const forwarded = new Request("https://velo.test/api/download", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(clientIp(forwarded), "10.0.0.1");
  const real = new Request("https://velo.test/api/download", {
    headers: { "x-real-ip": "192.0.2.8", "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(clientIp(real), "192.0.2.8");
});

test("guest identity prefers x-velo-guest over shared NAT IP", () => {
  const a = new Request("https://velo.test/api/builder", {
    headers: { "x-velo-guest": "browser-aaa-123", "x-real-ip": "10.0.0.1" },
  });
  const b = new Request("https://velo.test/api/builder", {
    headers: { "x-velo-guest": "browser-bbb-456", "x-real-ip": "10.0.0.1" },
  });
  const identA = quotaIdentity(a, null);
  const identB = quotaIdentity(b, null);
  assert.equal(identA.key, "guest:browser-aaa-123");
  assert.equal(identB.key, "guest:browser-bbb-456");
  assert.notEqual(identA.key, identB.key);
  assert.equal(readGuestId(a), "browser-aaa-123");
});

test("rejects tiny or junk guest ids so the header cannot be a one-byte bucket", () => {
  const bad = new Request("https://velo.test/api/builder", {
    headers: { "x-velo-guest": "x", "x-real-ip": "10.0.0.1" },
  });
  const ident = quotaIdentity(bad, null);
  assert.equal(ident.key, "guest:10.0.0.1");
});

test("refundTokens restores a failed hop", () => {
  const now = 80_000_000;
  const key = "guest:refund-b";
  assert.equal(takeTokens(key, GUEST_PLAN, 1, now).ok, true);
  refundTokens(key, GUEST_PLAN, 1, now);
  const again = takeTokens(key, GUEST_PLAN, GUEST_PLAN.capacity, now);
  assert.equal(again.ok, true);
});

test("signed-in quota keys are unique per person and ignore the shared guest id", () => {
  const req = new Request("https://velo.test/api/builder", {
    headers: { "x-velo-guest": "browser-aaa-123", "x-real-ip": "10.0.0.1" },
  });
  const alice = quotaIdentity(req, "user-alice");
  const bob = quotaIdentity(req, "user-bob");
  const guest = quotaIdentity(req, null);
  assert.equal(alice.key, "user:user-alice");
  assert.equal(bob.key, "user:user-bob");
  assert.equal(guest.key, "guest:browser-aaa-123");
  assert.notEqual(alice.key, bob.key);
  assert.notEqual(alice.key, guest.key);
  assert.equal(alice.signedIn, true);
  assert.equal(guest.signedIn, false);
});

test("rotating the guest header cannot outrun the per-IP backstop", () => {
  // `x-velo-guest` is set by ordinary client JS, so a fresh id per request
  // costs an attacker nothing. The IP bucket is what actually caps them.
  const now = 7_000_000;
  const ip = "ip:203.0.113.77";
  let allowed = 0;
  for (let i = 0; i < 5_000; i++) {
    const guest = takeTokens(`guest:rot${String(i).padStart(8, "0")}`, GUEST_PLAN, 1, now);
    if (!guest.ok) continue;
    if (takeTokens(ip, IP_PLAN, 1, now).ok) allowed++;
  }
  assert.equal(allowed, IP_PLAN.capacity);
});

test("an honest guest still gets the documented burst behind the backstop", () => {
  const now = 7_100_000;
  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    const guest = takeTokens("guest:honest-browser-1", GUEST_PLAN, 1, now);
    if (guest.ok && takeTokens("ip:198.51.100.9", IP_PLAN, 1, now).ok) allowed++;
  }
  assert.equal(allowed, GUEST_PLAN.capacity);
});

test("a flood of one-shot keys does not evict the bucket doing the limiting", () => {
  // Eviction ordered by insertion would drop the long-lived IP bucket — created
  // early, only ever mutated — and hand the flood a fresh full bucket.
  const now = 7_200_000;
  const ip = "ip:198.51.100.200";
  takeTokens(ip, IP_PLAN, IP_PLAN.capacity, now);
  for (let i = 0; i < 6_000; i++) takeTokens(`guest:evict${i}`, GUEST_PLAN, 1, now);
  assert.equal(takeTokens(ip, IP_PLAN, 1, now).ok, false, "IP bucket must survive the flood");
});

test("a backwards clock step does not refill a drained bucket", () => {
  const now = 7_300_000;
  const key = "guest:clock-step";
  assert.equal(takeTokens(key, GUEST_PLAN, GUEST_PLAN.capacity, now).ok, true);
  assert.equal(takeTokens(key, GUEST_PLAN, 1, now).ok, false);
  // NTP correction / VM resume: an hour into the past, then back.
  takeTokens(key, GUEST_PLAN, 1, now - 3_600_000);
  assert.equal(
    takeTokens(key, GUEST_PLAN, 1, now + 1000).ok,
    false,
    "still drained a second later",
  );
});
