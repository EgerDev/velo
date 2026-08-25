import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adviseThrottle } from "./throttle-advisor.ts";

const MIB = 1024 * 1024;

describe("adviseThrottle", () => {
  it("returns unknown for null/zero/invalid measurements (never treats them as slow)", () => {
    assert.equal(adviseThrottle(null).verdict, "unknown");
    assert.equal(adviseThrottle(0).verdict, "unknown");
    assert.equal(adviseThrottle(-5).verdict, "unknown");
    assert.equal(adviseThrottle(Number.NaN).verdict, "unknown");
  });

  it("calls healthy at or above 2.5 MiB/s with no action", () => {
    const advice = adviseThrottle(3 * MIB);
    assert.equal(advice.verdict, "healthy");
    assert.equal(advice.action, null);
  });

  it("calls moderate for mid-band speeds", () => {
    assert.equal(adviseThrottle(1 * MIB).verdict, "moderate");
  });

  it("calls slow below ~600 KB/s and crawling below ~150 KB/s", () => {
    assert.equal(adviseThrottle(0.3 * MIB).verdict, "slow");
    assert.equal(adviseThrottle(40 * 1024).verdict, "crawling");
  });

  it("suppresses a false slow verdict while the transfer is still ramping", () => {
    assert.equal(adviseThrottle(0.1 * MIB, { improving: true }).verdict, "moderate");
    assert.equal(adviseThrottle(0.1 * MIB, { improving: true }).action, null);
  });

  it("tailors the retry action to the relay in use", () => {
    const local = adviseThrottle(40 * 1024, { usingLocalRelay: true });
    const publicRelay = adviseThrottle(40 * 1024, { usingLocalRelay: false });
    assert.match(local.action ?? "", /fresh route/);
    assert.match(publicRelay.action ?? "", /different relay/);
  });
});
