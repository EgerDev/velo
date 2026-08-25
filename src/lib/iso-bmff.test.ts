import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  dashSegmentPlan,
  hlsContainer,
  looksLikeAudioFile,
  looksLikeFragment,
  looksLikeMediaFile,
} from "./iso-bmff.ts";
import { parseHls } from "./stream-unlock.ts";

test("YouTube HLS VOD is MPEG-TS fragments, not CMAF MAP", () => {
  const parsed = parseHls(
    `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:5.24,
https://rr2.googlevideo.com/videoplayback/itag/96/gosq/0/file/seg.ts
#EXTINF:5.16,
https://rr2.googlevideo.com/videoplayback/itag/96/gosq/1/file/seg.ts
#EXT-X-ENDLIST
`,
    "https://manifest.googlevideo.com/api/manifest/hls_playlist/index.m3u8",
  );
  assert.equal(parsed.media.init, undefined);
  assert.equal(parsed.media.segments.length, 2);
  assert.equal(hlsContainer(parsed.media.init, parsed.media.segments[0]), "ts");
  assert.equal(looksLikeFragment(Uint8Array.of(0x47, 0x40, 0x00, 0x30)), "ts");
});

test("CMAF HLS still uses EXT-X-MAP + m4s (dash.js twin)", () => {
  const parsed = parseHls(
    `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.0,
seg0.m4s
`,
    "https://gv.example/high.m3u8",
  );
  assert.equal(hlsContainer(parsed.media.init, parsed.media.segments[0]), "fmp4");
});

function syntheticDashHead(): Uint8Array {
  const buf = new Uint8Array(28 + 44);
  buf.set([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x64, 0x61, 0x73, 0x68], 0);
  const sidxAt = 28;
  const size = 44;
  buf[sidxAt] = 0;
  buf[sidxAt + 1] = 0;
  buf[sidxAt + 2] = 0;
  buf[sidxAt + 3] = size;
  buf.set([0x73, 0x69, 0x64, 0x78], sidxAt + 4);
  const view = new DataView(buf.buffer, sidxAt);
  view.setUint32(16, 1000); // timescale at cursor 16 relative to box = offset 16
  view.setUint16(30, 1); // reference_count
  view.setUint32(32, 5000); // referenced_size
  view.setUint32(36, 2000); // duration
  return buf;
}

test("itag 137 opens as ftypdash + sidx (dash.js SegmentBase)", () => {
  let data: Uint8Array = syntheticDashHead();
  try {
    data = new Uint8Array(readFileSync("/tmp/dash137.bin"));
  } catch {
    /* synthetic layout still exercises the parser */
  }
  assert.equal(looksLikeFragment(data), "fmp4");
  const { boxes, sidx } = dashSegmentPlan(data);
  assert.equal(boxes[0]?.type, "ftyp");
  assert.ok(boxes.some((box) => box.type === "sidx"));
  assert.ok(sidx);
  assert.ok((sidx?.refs.length ?? 0) >= 1);
  const first = sidx!.refs[0]!;
  assert.ok(first.end >= first.start);
  assert.ok(first.size > 0);
});

const audioBytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

test("looksLikeAudioFile recognizes the containers the browser encoder emits", () => {
  assert.equal(looksLikeAudioFile(audioBytes("ID3", [4, 0, 0, 0, 0, 0, 0])), "mp3");
  assert.equal(looksLikeAudioFile(audioBytes([0xff, 0xfb, 0x90, 0x00])), "mp3");
  assert.equal(looksLikeAudioFile(audioBytes("fLaC", [0, 0, 0, 34])), "flac");
  assert.equal(looksLikeAudioFile(audioBytes("OggS", [0, 2, 0, 0])), "ogg");
  assert.equal(looksLikeAudioFile(audioBytes("RIFF", [36, 0, 0, 0], "WAVE")), "wav");
});

test("looksLikeAudioFile rejects HTML block pages and truncated input", () => {
  assert.equal(looksLikeAudioFile(audioBytes("<!DOCTYPE html>")), null);
  assert.equal(looksLikeAudioFile(audioBytes("<html><body>Blocked")), null);
  assert.equal(looksLikeAudioFile(new Uint8Array([0x49, 0x44])), null);
  assert.equal(looksLikeAudioFile(new Uint8Array()), null);
});

test("audio containers stay out of the fragment check", () => {
  assert.equal(looksLikeFragment(audioBytes("ID3", [4, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(looksLikeFragment(audioBytes("fLaC", [0, 0, 0, 34])), null);
});

test("looksLikeMediaFile spans both fragment and audio containers", () => {
  assert.equal(looksLikeMediaFile(audioBytes("ID3", [4, 0, 0, 0, 0, 0, 0])), "mp3");
  assert.equal(looksLikeMediaFile(audioBytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), "webm");
  assert.equal(looksLikeMediaFile(audioBytes([0, 0, 0, 0], "ftyp", "isom")), "mp4");
  assert.equal(looksLikeMediaFile(audioBytes("<!DOCTYPE html>")), null);
});
