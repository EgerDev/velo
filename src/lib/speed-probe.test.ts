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
