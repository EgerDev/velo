import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  adviseThrottle,
  getSpeedBaseline,
  recordSpeedBaseline,
  resetSpeedBaseline,
  summarizeSamples,
} from "./throttle-advisor.ts";

const MIB = 1024 * 1024;

describe("summarizeSamples", () => {
  it("returns a median, low and high across valid samples", () => {
    const s = summarizeSamples([1 * MIB, 3 * MIB, 2 * MIB]);
    assert.equal(s.median, 2 * MIB);
    assert.equal(s.lo, 1 * MIB);
    assert.equal(s.hi, 3 * MIB);
    assert.equal(s.count, 3);
  });

  it("averages the middle pair for an even count", () => {
    assert.equal(summarizeSamples([1 * MIB, 3 * MIB]).median, 2 * MIB);
  });

  it("drops nulls, zeros and non-finite values instead of counting them as slow", () => {
    const s = summarizeSamples([null, 0, Number.NaN, undefined, -5, 4 * MIB]);
    assert.equal(s.count, 1);
    assert.equal(s.median, 4 * MIB);
  });

  it("reports nothing measured for an empty or all-invalid set", () => {
    assert.deepEqual(summarizeSamples([]), { median: null, lo: null, hi: null, count: 0 });
    assert.equal(summarizeSamples([null, 0]).median, null);
  });
});

describe("adviseThrottle", () => {
  it("says unknown when nothing has been measured (never 'slow')", () => {
    assert.equal(adviseThrottle([]).verdict, "unknown");
    assert.equal(adviseThrottle(null).verdict, "unknown");
    assert.equal(adviseThrottle(0).verdict, "unknown");
  });

  it("calls a fast flow healthy on absolute speed alone", () => {
    const reading = adviseThrottle([4 * MIB, 4 * MIB, 4 * MIB]);
    assert.equal(reading.verdict, "healthy");
    assert.equal(reading.action, null);
  });

  it("keeps quiet while the transfer is still ramping", () => {
    const reading = adviseThrottle([0.2 * MIB], { percentComplete: 8 });
    assert.equal(reading.verdict, "ramping");
    assert.equal(reading.action, null);
  });

  it("calls shaping only when far below what this link has already achieved", () => {
    // 0.3 MiB/s against a proven 10 MiB/s — a 3% ratio.
    const reading = adviseThrottle([0.3 * MIB, 0.3 * MIB, 0.3 * MIB], {
      baselineBytesPerSec: 10 * MIB,
      percentComplete: 60,
    });
    assert.equal(reading.verdict, "shaped");
    assert.ok(reading.ratio != null && reading.ratio < 0.4);
    assert.match(reading.action ?? "", /fresh route|Wi-Fi/);
  });

  it("does NOT call shaping when the link itself is simply slow", () => {
    // Same 0.3 MiB/s, but this link has never done better than 0.4 MiB/s.
    const reading = adviseThrottle([0.3 * MIB, 0.3 * MIB, 0.3 * MIB], {
      baselineBytesPerSec: 0.4 * MIB,
      percentComplete: 60,
    });
    assert.notEqual(reading.verdict, "shaped");
    assert.equal(reading.verdict, "slow-link");
    assert.equal(reading.ratio, null, "an untrustworthy baseline yields no ratio");
  });

  it("treats a flow keeping pace with the baseline as healthy", () => {
    const reading = adviseThrottle([7 * MIB], { baselineBytesPerSec: 10 * MIB, percentComplete: 50 });
    assert.equal(reading.verdict, "healthy");
  });

  it("hedges the wording when samples disagree wildly", () => {
    const jittery = adviseThrottle([0.1 * MIB, 0.3 * MIB, 2 * MIB], {
      baselineBytesPerSec: 10 * MIB,
      percentComplete: 70,
    });
    assert.equal(jittery.confidence, "low");
    assert.match(jittery.summary, /rough middle/);

    const steady = adviseThrottle([0.3 * MIB, 0.31 * MIB, 0.3 * MIB], {
      baselineBytesPerSec: 10 * MIB,
      percentComplete: 70,
    });
    assert.equal(steady.confidence, "high");
    assert.ok(!/rough middle/.test(steady.summary));
  });

  it("accepts a bare number as well as a sample list", () => {
    assert.equal(adviseThrottle(5 * MIB).verdict, "healthy");
  });
});

describe("session baseline", () => {
  beforeEach(() => resetSpeedBaseline());

  it("keeps the best speed seen and ignores junk", () => {
    recordSpeedBaseline(2 * MIB);
    recordSpeedBaseline(null);
    recordSpeedBaseline(0);
    recordSpeedBaseline(9 * MIB);
    recordSpeedBaseline(1 * MIB);
    assert.equal(getSpeedBaseline(), 9 * MIB);
  });

  it("starts empty so a stale figure can't misdiagnose a new network", () => {
    assert.equal(getSpeedBaseline(), null);
  });
});
