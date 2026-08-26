import test from "node:test";
import assert from "node:assert/strict";
import {
  secondsToTimecode,
  exportMarkersDavinciCsv,
  exportMarkersFcpxml,
  exportMarkersPremiereEdl,
  exportMarkersAudacity,
  exportNLETimeline,
} from "./nle-export.ts";
import type { TranscriptCue } from "./transcript.ts";

const SAMPLE_CUES: TranscriptCue[] = [
  { id: 1, start: 0, end: 4.5, startFormatted: "00:00", endFormatted: "00:04", text: "Welcome to Velo media ingest." },
  { id: 2, start: 4.5, end: 12.35, startFormatted: "00:04", endFormatted: "00:12", text: 'Breaking down "BotGuard" and stream deciphering.' },
  { id: 3, start: 75.2, end: 82.0, startFormatted: "01:15", endFormatted: "01:22", text: "Exporting NLE markers for DaVinci and Final Cut." },
];

test("secondsToTimecode: formats frames, seconds, minutes, hours correctly", () => {
  assert.equal(secondsToTimecode(0, 30), "00:00:00:00");
  assert.equal(secondsToTimecode(4.5, 30), "00:00:04:15");
  assert.equal(secondsToTimecode(65.5, 30), "00:01:05:15");
  assert.equal(secondsToTimecode(3661.1, 30), "01:01:01:03");
});

test("exportMarkersDavinciCsv: generates valid CSV format with escaped quotes", () => {
  const csv = exportMarkersDavinciCsv(SAMPLE_CUES, 30);
  assert.ok(csv.startsWith("Timecode In,Timecode Out,Marker Name,Marker Notes,Color"));
  assert.ok(csv.includes("00:00:00:00,00:00:04:15,\"Cue 1\",\"Welcome to Velo media ingest.\",Blue"));
  assert.ok(csv.includes('""BotGuard""'));
});

test("exportMarkersFcpxml: NTSC rates use Apple's fps*100 format names", () => {
  const ntsc2997 = exportMarkersFcpxml(SAMPLE_CUES, "NTSC", 29.97);
  assert.ok(ntsc2997.includes('name="FFVideoFormat1080p2997"'));
  assert.ok(ntsc2997.includes('frameDuration="1001/30000s"'));
  const ntsc5994 = exportMarkersFcpxml(SAMPLE_CUES, "NTSC", 59.94);
  assert.ok(ntsc5994.includes('name="FFVideoFormat1080p5994"'));
  assert.ok(ntsc5994.includes('frameDuration="1001/60000s"'));
  const whole = exportMarkersFcpxml(SAMPLE_CUES, "PAL", 25);
  assert.ok(whole.includes('name="FFVideoFormat1080p25"'));
});

test("exportMarkersFcpxml: sequence duration covers the latest-ending cue, not the last-sorted one", () => {
  // SponsorBlock segments sort by start, so an early segment can end last.
  const overlapping: TranscriptCue[] = [
    { id: 1, start: 10, end: 1200, startFormatted: "00:10", endFormatted: "20:00", text: "Sponsor" },
    { id: 2, start: 990, end: 995, startFormatted: "16:30", endFormatted: "16:35", text: "Outro" },
  ];
  const fcpxml = exportMarkersFcpxml(overlapping, "Overlap", 30);
  assert.ok(fcpxml.includes('duration="1205s"'));
});

test("exportMarkersFcpxml: generates valid FCPXML structure with markers", () => {
  const fcpxml = exportMarkersFcpxml(SAMPLE_CUES, "Test Video & Audio", 30);
  assert.ok(fcpxml.includes("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
  assert.ok(fcpxml.includes("<fcpxml version=\"1.9\">"));
  assert.ok(fcpxml.includes('project name="Test Video &amp; Audio"'));
  assert.ok(fcpxml.includes('<marker start="0.000s"'));
  assert.ok(fcpxml.includes('Cue 1: Welcome to Velo media ingest.'));
});

test("exportMarkersPremiereEdl: generates valid CMX 3600 EDL sequence", () => {
  const edl = exportMarkersPremiereEdl(SAMPLE_CUES, "Episode 101", 30);
  assert.ok(edl.includes("TITLE: EPISODE 101"));
  assert.ok(edl.includes("001  AX       V     C        00:00:00:00 00:00:04:15"));
  assert.ok(edl.includes("* MARKER: 00:00:00:00 Cyan Welcome to Velo media ingest."));
});

test("exportMarkersAudacity: generates tab-delimited label file", () => {
  const labels = exportMarkersAudacity(SAMPLE_CUES);
  const lines = labels.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "0.000000\t4.500000\tWelcome to Velo media ingest.");
});

test("exportNLETimeline: dispatches correctly to all supported formats", () => {
  const davinci = exportNLETimeline("davinci", SAMPLE_CUES, { sequenceTitle: "My Project" });
  assert.equal(davinci.mimeType, "text/csv;charset=utf-8");
  assert.ok(davinci.filename.includes("davinci_markers.csv"));
  assert.ok(davinci.content.includes("Timecode In"));

  const fcpxml = exportNLETimeline("fcpxml", SAMPLE_CUES, { sequenceTitle: "My Project" });
  assert.equal(fcpxml.mimeType, "application/xml;charset=utf-8");
  assert.ok(fcpxml.filename.includes("markers.fcpxml"));

  const premiere = exportNLETimeline("premiere", SAMPLE_CUES, { sequenceTitle: "My Project" });
  assert.equal(premiere.mimeType, "text/plain;charset=utf-8");
  assert.ok(premiere.filename.includes("premiere_markers.edl"));

  const audacity = exportNLETimeline("audacity", SAMPLE_CUES, { sequenceTitle: "My Project" });
  assert.equal(audacity.mimeType, "text/plain;charset=utf-8");
  assert.ok(audacity.filename.includes("audacity_labels.txt"));
});
