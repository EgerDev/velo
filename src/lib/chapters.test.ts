import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chaptersToCues, parseChapters } from "./chapters.ts";

describe("parseChapters", () => {
  it("parses a plain 'timestamp title' list", () => {
    const description = [
      "New episode!",
      "",
      "0:00 Intro",
      "1:30 The early years",
      "12:45 Building the company",
      "1:02:03 Rapid fire questions",
    ].join("\n");
    const chapters = parseChapters(description, 4000);
    assert.equal(chapters.length, 4);
    assert.deepEqual(
      chapters.map((c) => c.start),
      [0, 90, 765, 3723],
    );
    assert.equal(chapters[0].title, "Intro");
    assert.equal(chapters[3].title, "Rapid fire questions");
    assert.equal(chapters[0].end, 90);
    assert.equal(chapters[3].end, 4000);
  });

  it("parses separators, brackets, and title-first lines", () => {
    const description = [
      "(0:00) - Intro",
      "[2:00] — Chapter two",
      "Outro - 4:00",
    ].join("\n");
    const chapters = parseChapters(description, 300);
    assert.equal(chapters.length, 3);
    assert.deepEqual(
      chapters.map((c) => c.title),
      ["Intro", "Chapter two", "Outro"],
    );
  });

  it("rejects descriptions without a 0:00 anchor", () => {
    assert.deepEqual(parseChapters("2:00 Middle\n4:00 End", 300), []);
  });

  it("rejects non-ascending timestamp lists (e.g. scattered references)", () => {
    const description = "0:00 Intro\n5:00 Later\n2:00 See the bit at two minutes";
    assert.deepEqual(parseChapters(description, 400), []);
  });

  it("rejects a single timestamp and empty/absent descriptions", () => {
    assert.deepEqual(parseChapters("0:00 Intro", 100), []);
    assert.deepEqual(parseChapters("", 100), []);
    assert.deepEqual(parseChapters(null, 100), []);
  });

  it("drops chapters past the video duration", () => {
    const chapters = parseChapters("0:00 A\n1:00 B\n50:00 Ghost", 120);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[1].end, 120);
  });

  it("titles range-style lines by the text after the last timestamp", () => {
    const chapters = parseChapters("0:00 - 1:00 Intro\n2:00 Rest", 300);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, "Intro");
    assert.equal(chapters[0].start, 0);
  });
});

describe("chaptersToCues", () => {
  it("maps chapters onto transcript cues for the NLE exporters", () => {
    const cues = chaptersToCues(parseChapters("0:00 Intro\n1:00 Body", 180));
    assert.equal(cues.length, 2);
    assert.deepEqual(cues[0], {
      id: 0,
      start: 0,
      end: 60,
      startFormatted: "0:00",
      endFormatted: "1:00",
      text: "Intro",
    });
    assert.equal(cues[1].end, 180);
  });
});
