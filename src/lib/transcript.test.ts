import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSubtitleText,
  cuesToJson,
  cuesToPlainText,
  cuesToSrt,
  cuesToTimestampedText,
  cuesToVtt,
  formatSrtTime,
  formatTime,
  parseTimeToSeconds,
  parseWebVttIntoCues,
  AI_PROMPT_TEMPLATES,
} from "./transcript.ts";

describe("transcript time formatters", () => {
  it("formats seconds into mm:ss and hh:mm:ss", () => {
    assert.equal(formatTime(0), "00:00");
    assert.equal(formatTime(75), "01:15");
    assert.equal(formatTime(3665), "1:01:05");
  });

  it("formats seconds into SRT timestamp format", () => {
    assert.equal(formatSrtTime(0), "00:00:00,000");
    assert.equal(formatSrtTime(75.42), "00:01:15,420");
    assert.equal(formatSrtTime(3665.8), "01:01:05,800");
  });

  it("parses time strings back to seconds", () => {
    assert.equal(parseTimeToSeconds("01:15.500"), 75.5);
    assert.equal(parseTimeToSeconds("01:01:05,800"), 3665.8);
  });
});

describe("cleanSubtitleText", () => {
  it("strips HTML tags and unescapes entities", () => {
    assert.equal(cleanSubtitleText("<b>Hello</b> &amp; <i>welcome</i>!"), "Hello & welcome!");
    assert.equal(cleanSubtitleText("&quot;Quote&#39;s&quot; &lt;tag&gt;"), '"Quote\'s" <tag>');
  });
});

describe("parseWebVttIntoCues", () => {
  it("parses WebVTT content into structured cues", () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.360 --> 00:00:03.040
[Music playing]

00:00:18.640 --> 00:00:21.880
We're no strangers to love

00:00:22.640 --> 00:00:26.960
You know the rules and so do I
`;

    const cues = parseWebVttIntoCues(vtt);
    assert.equal(cues.length, 3);
    assert.equal(cues[0].startFormatted, "00:01");
    assert.equal(cues[0].text, "[Music playing]");
    assert.equal(cues[1].startFormatted, "00:18");
    assert.equal(cues[1].text, "We're no strangers to love");
    assert.equal(cues[2].text, "You know the rules and so do I");
  });
});

describe("transcript export formats", () => {
  const cues = [
    {
      id: 1,
      start: 0,
      end: 3.5,
      startFormatted: "00:00",
      endFormatted: "00:03",
      text: "Introduction to AI.",
    },
    {
      id: 2,
      start: 3.5,
      end: 7.0,
      startFormatted: "00:03",
      endFormatted: "00:07",
      text: "Building neural networks.",
    },
  ];

  it("converts cues to plain text", () => {
    assert.equal(cuesToPlainText(cues), "Introduction to AI. Building neural networks.");
  });

  it("converts cues to timestamped text", () => {
    const text = cuesToTimestampedText(cues);
    assert.match(text, /\[00:00\] Introduction to AI\./);
    assert.match(text, /\[00:03\] Building neural networks\./);
  });

  it("converts cues to valid SRT format", () => {
    const srt = cuesToSrt(cues);
    assert.match(srt, /1\n00:00:00,000 --> 00:00:03,500\nIntroduction to AI\./);
    assert.match(srt, /2\n00:00:03,500 --> 00:00:07,000\nBuilding neural networks\./);
  });

  it("converts cues to valid WebVTT format", () => {
    const vtt = cuesToVtt(cues);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00\.000 --> 00:03\.000\nIntroduction to AI\./);
  });

  it("converts cues to valid JSON", () => {
    const jsonStr = cuesToJson(cues);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].text, "Introduction to AI.");
  });
});

describe("AI prompt templates", () => {
  it("includes executive summary, study notes, Q&A, and chapters templates", () => {
    const ids = AI_PROMPT_TEMPLATES.map((t) => t.id);
    assert.ok(ids.includes("summary"));
    assert.ok(ids.includes("notes"));
    assert.ok(ids.includes("qa"));
    assert.ok(ids.includes("chapters"));
    assert.ok(ids.includes("action_items"));
    assert.ok(ids.includes("social_thread"));

    const summaryTmpl = AI_PROMPT_TEMPLATES.find((t) => t.id === "summary");
    const formatted = summaryTmpl?.prompt("Test Video", "Sample transcript body");
    assert.match(formatted ?? "", /Test Video/);
    assert.match(formatted ?? "", /Sample transcript body/);
  });
});
