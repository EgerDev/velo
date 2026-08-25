import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTimecode,
  formatTimecode,
  validateTimeRange,
  formatYtdlpSection,
  estimateClipSize,
} from "./time-trimmer.ts";

test("parseTimecode: parses various input formats into seconds", () => {
  assert.equal(parseTimecode("00:45"), 45);
  assert.equal(parseTimecode("01:30"), 90);
  assert.equal(parseTimecode("01:15:30"), 4530);
  assert.equal(parseTimecode("120"), 120);
  assert.equal(parseTimecode("75s"), 75);
  assert.equal(parseTimecode("invalid"), null);
  assert.equal(parseTimecode(""), null);
});

test("formatTimecode: formats seconds into MM:SS and HH:MM:SS", () => {
  assert.equal(formatTimecode(45), "00:45");
  assert.equal(formatTimecode(90), "01:30");
  assert.equal(formatTimecode(3665), "01:01:05");
});

test("validateTimeRange: bounds checks start, end, and duration", () => {
  const valid = validateTimeRange(10, 50, 100);
  assert.equal(valid.valid, true);
  assert.equal(valid.duration, 40);

  const invalid = validateTimeRange(50, 20, 100);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.error?.includes("greater than start"));

  const clamped = validateTimeRange(10, 200, 100);
  assert.equal(clamped.valid, true);
  assert.equal(clamped.end, 100);
  assert.equal(clamped.duration, 90);
});

test("formatYtdlpSection: outputs correct glob section format", () => {
  assert.equal(formatYtdlpSection(15, 75), "*00:15-01:15");
  assert.equal(formatYtdlpSection(3600, 3660), "*01:00:00-01:01:00");
});

test("estimateClipSize: computes proportional file size", () => {
  const size = estimateClipSize(100_000_000, 1000, 100); // 10%
  assert.equal(size, 10_000_000);
  assert.equal(estimateClipSize(null, 1000, 100), null);
});
