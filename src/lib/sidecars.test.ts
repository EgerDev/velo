import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chaptersVttSidecar, descriptionSidecar } from "./sidecars.ts";
import { parseChapters } from "./chapters.ts";

describe("descriptionSidecar", () => {
  it("writes a titled .description.txt", () => {
    const sc = descriptionSidecar("My Video: Part 1", "Line one\nLine two");
    assert.ok(sc);
    assert.equal(sc.filename, "My_Video_Part_1.description.txt");
    assert.equal(sc.content, "My Video: Part 1\n\nLine one\nLine two\n");
    assert.equal(sc.mimeType, "text/plain;charset=utf-8");
  });

  it("returns null for empty or whitespace descriptions", () => {
    assert.equal(descriptionSidecar("t", ""), null);
    assert.equal(descriptionSidecar("t", "   \n  "), null);
    assert.equal(descriptionSidecar("t", null), null);
  });
});

describe("chaptersVttSidecar", () => {
  it("emits a WebVTT cue per chapter with HH:MM:SS.mmm stamps", () => {
    const chapters = parseChapters("0:00 Intro\n1:30 Body\n3:00 End", 240);
    const sc = chaptersVttSidecar("Talk", chapters);
    assert.ok(sc);
    assert.equal(sc.filename, "Talk.chapters.vtt");
    assert.equal(sc.mimeType, "text/vtt;charset=utf-8");
    assert.match(sc.content, /^WEBVTT\n/);
    assert.match(sc.content, /00:00:00\.000 --> 00:01:30\.000\nIntro/);
    assert.match(sc.content, /00:03:00\.000 --> 00:04:00\.000\nEnd/);
  });

  it("escapes WebVTT markup characters in chapter titles", () => {
    const chapters = parseChapters("0:00 <Intro> Q&A\n1:00 A --> B", 120);
    const sc = chaptersVttSidecar("Talk", chapters);
    assert.ok(sc);
    assert.match(sc.content, /\n&lt;Intro> Q&amp;A\n/);
    // Only the timing lines may carry "-->".
    assert.match(sc.content, /\nA → B\n/);
    assert.equal(sc.content.match(/-->/g)?.length, 2);
  });

  it("rolls a rounded-up millisecond into the next second instead of a 4-digit field", () => {
    // 12.9996 rounds to 13.000; rounding the fraction on its own gave
    // "00:00:12.1000", which is not a WebVTT timestamp.
    const sc = chaptersVttSidecar("Talk", [
      { index: 0, start: 5, end: 12.9996, startFormatted: "0:05", title: "Body" },
      { index: 1, start: 12.9996, end: 59.9999, startFormatted: "0:12", title: "End" },
    ]);
    assert.ok(sc);
    assert.match(sc.content, /00:00:05\.000 --> 00:00:13\.000\nBody/);
    assert.match(sc.content, /00:00:13\.000 --> 00:01:00\.000\nEnd/);
    assert.doesNotMatch(sc.content, /\.\d{4}/);
  });

  it("returns null when there are no chapters", () => {
    assert.equal(chaptersVttSidecar("Talk", []), null);
  });
});
