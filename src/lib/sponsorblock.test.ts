import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  SPONSOR_CATEGORIES,
  type SponsorSegment,
  hashVideoIdPrefix,
  isInSegment,
  parseSegments,
  segmentsApiUrl,
  totalSponsorSeconds,
} from "./sponsorblock.ts";

describe("segmentsApiUrl", () => {
  it("builds the skipSegments URL with JSON-encoded categories", () => {
    const url = new URL(segmentsApiUrl("a1b2", ["sponsor", "intro"]));
    assert.equal(url.origin, "https://sponsor.ajay.app");
    assert.equal(url.pathname, "/api/skipSegments/a1b2");
    assert.deepEqual(JSON.parse(url.searchParams.get("categories")!), ["sponsor", "intro"]);
    assert.deepEqual(JSON.parse(url.searchParams.get("actionTypes")!), ["skip"]);
  });

  it("defaults to all known categories", () => {
    const url = new URL(segmentsApiUrl("dead"));
    assert.deepEqual(
      JSON.parse(url.searchParams.get("categories")!),
      SPONSOR_CATEGORIES.map((c) => c.id),
    );
    // Empty array is not a real selection — fall back to all.
    const empty = new URL(segmentsApiUrl("dead", []));
    assert.equal(empty.searchParams.get("categories"), url.searchParams.get("categories"));
  });

  it("throws TypeError on bad hash prefixes", () => {
    assert.throws(() => segmentsApiUrl("ZZZZ"), TypeError);
    assert.throws(() => segmentsApiUrl(""), TypeError);
    assert.throws(() => segmentsApiUrl("abc"), TypeError); // too short
    assert.throws(() => segmentsApiUrl("a".repeat(33)), TypeError); // too long
    assert.throws(() => segmentsApiUrl("ABCD"), TypeError); // uppercase hex is still invalid
    assert.equal(typeof segmentsApiUrl("a".repeat(32)), "string"); // 32 is the max, inclusive
  });
});

describe("hashVideoIdPrefix", () => {
  it("returns a stable 4-char lowercase hex SHA-256 prefix", async () => {
    const prefix = await hashVideoIdPrefix("dQw4w9WgXcQ");
    assert.match(prefix, /^[0-9a-f]{4}$/);
    assert.equal(prefix, await hashVideoIdPrefix("dQw4w9WgXcQ"));
    // Cross-check against node's crypto rather than a hardcoded guess.
    const expected = createHash("sha256").update("dQw4w9WgXcQ").digest("hex");
    assert.equal(prefix, expected.slice(0, 4));
    assert.equal(await hashVideoIdPrefix("dQw4w9WgXcQ", 8), expected.slice(0, 8));
  });
});

// Shape mirrors a real hash-prefix response: multiple videos, extra fields,
// and the assorted garbage a mirror might serve.
const payload = [
  {
    videoID: "otherVideo1",
    segments: [{ UUID: "x", category: "sponsor", actionType: "skip", segment: [0, 10] }],
  },
  {
    videoID: "myVideo0001",
    segments: [
      { UUID: "u-outro", category: "outro", actionType: "skip", segment: [300, 315.5], votes: 12 },
      { UUID: "u-sponsor", category: "sponsor", actionType: "skip", segment: [10.5, 42], locked: 1 },
      { UUID: "u-legacy", category: "intro", segment: [0, 5] }, // legacy: no actionType
      { UUID: "u-mute", category: "sponsor", actionType: "mute", segment: [50, 60] },
      { UUID: "u-unknown", category: "exclusive_access", actionType: "skip", segment: [70, 80] },
      { UUID: "u-zero", category: "filler", actionType: "skip", segment: [90, 90] },
      { UUID: "u-inverted", category: "filler", actionType: "skip", segment: [100, 95] },
      { UUID: "u-negative", category: "filler", actionType: "skip", segment: [-5, 3] },
      { UUID: "u-nan", category: "filler", actionType: "skip", segment: ["abc", 120] },
      { UUID: "u-short", category: "filler", actionType: "skip", segment: [130] },
      "not-an-object",
      null,
    ],
  },
  { videoID: "otherVideo2", segments: "corrupt" },
  null,
  42,
];

describe("parseSegments", () => {
  it("picks the matching videoID and maps/filters/sorts segments", () => {
    const segs = parseSegments(payload, "myVideo0001");
    assert.deepEqual(segs, [
      { uuid: "u-legacy", category: "intro", start: 0, end: 5, label: "Intro / intermission" },
      { uuid: "u-sponsor", category: "sponsor", start: 10.5, end: 42, label: "Sponsor" },
      { uuid: "u-outro", category: "outro", start: 300, end: 315.5, label: "Endcards / outro" },
    ] satisfies SponsorSegment[]);
  });

  it("returns [] for missing videos and non-conforming input", () => {
    assert.deepEqual(parseSegments(payload, "notInResults"), []);
    assert.deepEqual(parseSegments(payload, "otherVideo2"), []); // corrupt segments field
    assert.deepEqual(parseSegments(null, "myVideo0001"), []);
    assert.deepEqual(parseSegments("nope", "myVideo0001"), []);
    assert.deepEqual(parseSegments({ videoID: "myVideo0001" }, "myVideo0001"), []);
  });
});

describe("totalSponsorSeconds / isInSegment", () => {
  const segs = parseSegments(payload, "myVideo0001");

  it("sums durations, rounded", () => {
    // 5 + 31.5 + 15.5 = 52
    assert.equal(totalSponsorSeconds(segs), 52);
    assert.equal(totalSponsorSeconds([]), 0);
  });

  it("finds the containing segment with [start, end) boundaries", () => {
    assert.equal(isInSegment(0, segs)?.uuid, "u-legacy"); // start inclusive
    assert.equal(isInSegment(4.999, segs)?.uuid, "u-legacy");
    assert.equal(isInSegment(5, segs), null); // end exclusive
    assert.equal(isInSegment(20, segs)?.uuid, "u-sponsor");
    assert.equal(isInSegment(200, segs), null);
    assert.equal(isInSegment(315.5, segs), null);
    assert.equal(isInSegment(10, []), null);
  });
});
