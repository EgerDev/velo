import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTimeInputs,
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

test("formatYtdlpSection: a rounding-carry fraction doesn't drop a second", () => {
  // 65.999… must render as 01:06, not 01:05.00 (floor 65 + rounded ".00").
  assert.equal(formatYtdlpSection(65.999999, 70), "*01:06-01:10");
  // A genuine sub-second boundary still keeps its centiseconds.
  assert.equal(formatYtdlpSection(15.34, 20.5), "*00:15.34-00:20.50");
});

test("estimateClipSize: computes proportional file size", () => {
  const size = estimateClipSize(100_000_000, 1000, 100); // 10%
  assert.equal(size, 10_000_000);
  assert.equal(estimateClipSize(null, 1000, 100), null);
});

test("validateTimeInputs rejects unparseable text instead of silently using the whole video", () => {
  assert.equal(validateTimeInputs("99:99", "00:15", 15).valid, false);
  assert.match(validateTimeInputs("abc", "00:15", 15).error ?? "", /Start isn’t a time/);
  assert.match(validateTimeInputs("00:03", "xyz", 15).error ?? "", /End isn’t a time/);
});

test("validateTimeInputs treats empty boxes as the video bounds and clamps the end", () => {
  const pick = (v: { valid: boolean; start: number; end: number }) => ({ valid: v.valid, start: v.start, end: v.end });
  assert.deepEqual(pick(validateTimeInputs("", "", 15)), { valid: true, start: 0, end: 15 });
  assert.deepEqual(pick(validateTimeInputs("0:03", "9:00", 15)), { valid: true, start: 3, end: 15 });
  assert.equal(validateTimeInputs("00:10", "00:05", 15).valid, false);
});
