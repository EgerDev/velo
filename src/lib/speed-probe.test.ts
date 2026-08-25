import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeedProbe, formatSpeed } from "./speed-probe.ts";

test("formatSpeed uses KB/s and MB/s", () => {
  assert.equal(formatSpeed(40 * 1024), "40 KB/s");
  assert.equal(formatSpeed(2.4 * 1024 * 1024), "2.4 MB/s");
});

test("the first sample reports no rate yet rather than a made-up one", () => {
  const probe = createSpeedProbe();
  const first = probe.push(8_192, 8_000_000);
  assert.equal(first.throttled, false);
  // Dividing bytes by a sub-millisecond interval yields a fantasy number, so
  // an un-measurable sample reads as 0 = "not measured yet".
  assert.equal(first.bytesPerSec, 0);
  assert.equal(first.loaded, 8_192);
});

/** A probe driven by a clock we control, so speed assertions are exact. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("a range retry does not report a healthy stream as throttled", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);
  const RATE = 200 * 1024; // healthy, well above the 80 KB/s floor

  let loaded = 0;
  for (let i = 0; i < 5; i++) {
    clock.advance(1000);
    loaded += RATE;
    probe.push(loaded, 8_000_000);
  }

  // The server drops the connection and the download restarts from zero.
  clock.advance(1000);
  const rebased = probe.push(0, 8_000_000);
  assert.equal(rebased.throttled, false);

  // The very first real sample after the retry must read the true rate, not a
  // fraction of it seeded from a synthetic zero.
  clock.advance(1000);
  const after = probe.push(RATE, 8_000_000);
  assert.equal(after.throttled, false);
  assert.ok(
    after.bytesPerSec > RATE * 0.9,
    `expected ~${RATE} B/s after a retry, got ${Math.round(after.bytesPerSec)}`,
  );
});

test("a stream stalled at zero bytes is throttled", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);
  clock.advance(20_000);
  const stalled = probe.push(0, 8_000_000);
  assert.equal(stalled.bytesPerSec, 0);
  assert.equal(stalled.throttled, true);
});

test("a backwards clock step does not disable throttle detection", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);
  clock.advance(1000);
  probe.push(1024 * 1024, 8_000_000);

  // NTP correction / VM resume: the clock jumps an hour into the past.
  clock.advance(-3_600_000);
  probe.push(1024 * 1024 + 100 * 1024, 8_000_000);

  // A real 40 KB/s nsig crawl from here still has to be caught.
  let loaded = 1024 * 1024 + 100 * 1024;
  let last = probe.push(loaded, 8_000_000);
  for (let i = 0; i < 30; i++) {
    clock.advance(1000);
    loaded += 40 * 1024;
    last = probe.push(loaded, 8_000_000);
  }
  assert.equal(last.throttled, true, "40 KB/s is exactly the crawl this module detects");
});

test("a buffered flush is not reported as link speed", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);

  // 80 MB handed over in 3 ms (a server-muxed response landing at once).
  clock.advance(3);
  const flush = probe.push(80 * 1024 * 1024, 160 * 1024 * 1024);
  assert.equal(flush.bytesPerSec, 0, "sub-window sample must not divide by 3ms");

  // Those bytes are not lost: the next honest window covers the whole span.
  clock.advance(997);
  const measured = probe.push(80 * 1024 * 1024, 160 * 1024 * 1024);
  assert.ok(
    measured.bytesPerSec > 0 && measured.bytesPerSec < 100 * 1024 * 1024,
    `expected a realistic rate, got ${Math.round(measured.bytesPerSec / 1048576)} MB/s`,
  );
});

test("a steady stream still measures its true rate", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);
  const RATE = 10 * 1024 * 1024; // 10 MB/s

  let loaded = 0;
  let last = 0;
  for (let i = 0; i < 8; i++) {
    clock.advance(500);
    loaded += RATE / 2;
    last = probe.push(loaded, 500 * 1024 * 1024).bytesPerSec;
  }
  assert.ok(
    last > RATE * 0.85 && last < RATE * 1.15,
    `expected ~10 MB/s, got ${(last / 1048576).toFixed(1)} MB/s`,
  );
});

test("chunky sub-window deliveries average out instead of spiking", () => {
  const clock = fakeClock();
  const probe = createSpeedProbe(clock.now);
  let loaded = 0;
  let last = 0;
  // 1 MB arrives every 100ms in one burst = a true 10 MB/s, delivered chunkily.
  for (let i = 0; i < 40; i++) {
    clock.advance(100);
    loaded += 1024 * 1024;
    last = probe.push(loaded, 100 * 1024 * 1024).bytesPerSec;
  }
  assert.ok(
    last > 8 * 1024 * 1024 && last < 12 * 1024 * 1024,
    `expected ~10 MB/s from chunky delivery, got ${(last / 1048576).toFixed(1)} MB/s`,
  );
});
