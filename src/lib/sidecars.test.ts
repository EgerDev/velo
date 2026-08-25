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

  it("returns null when there are no chapters", () => {
    assert.equal(chaptersVttSidecar("Talk", []), null);
  });
});
