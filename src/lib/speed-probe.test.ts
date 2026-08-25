import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeedProbe, formatSpeed } from "./speed-probe.ts";

test("formatSpeed uses KB/s and MB/s", () => {
  assert.equal(formatSpeed(40 * 1024), "40 KB/s");
  assert.equal(formatSpeed(2.4 * 1024 * 1024), "2.4 MB/s");
});

test("probe flags nsig-crawl speeds after warmup", () => {
  const probe = createSpeedProbe();
  const first = probe.push(8_192, 8_000_000);
  assert.equal(first.throttled, false);
  assert.ok(first.bytesPerSec > 0);
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
