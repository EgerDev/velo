import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dashSegmentPlan, hlsContainer, looksLikeFragment } from "./iso-bmff.ts";
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
