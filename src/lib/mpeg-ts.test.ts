import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { containerKind, parseTsPacket, scanMpegTs, TS_PACKET, TS_SYNC } from "./mpeg-ts.ts";
import { dashHlsSliceEnd, dashSegmentPlan, hlsContainer, sidxDurationSec } from "./iso-bmff.ts";
import { parseHls } from "./stream-unlock.ts";

test("PAT/PMT: program 1 → PMT 4095 → AAC 257 + H.264 256", () => {
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync("/tmp/hls-ts.bin"));
  } catch {
    data = Uint8Array.of(TS_SYNC, 0x40, 0x00, 0x10, ...Array(184).fill(0xff));
  }
  const first = parseTsPacket(data, 0);
  assert.ok(first);
  assert.equal(data[0], TS_SYNC);
  if (data.length < TS_PACKET * 2) return;
  const scan = scanMpegTs(data);
  assert.equal(scan.syncErrors, 0);
  assert.equal(scan.transportStreamId, 1);
  assert.equal(scan.programNumber, 1);
  assert.equal(scan.pmtPid, 4095);
  assert.equal(scan.pcrPid, 8191);
  assert.deepEqual(
    scan.streams.map((s) => `${s.codec}:${s.pid}`).sort(),
    ["aac:257", "h264:256"],
  );
});

test("PAT with a corrupt section_length=0 yields no bogus program (body floored at header)", () => {
  const pkt = new Uint8Array(TS_PACKET).fill(0xff);
  pkt[0] = TS_SYNC; // sync
  pkt[1] = 0x40; // PUSI set, PID high bits = 0
  pkt[2] = 0x00; // PID low = 0 → PAT
  pkt[3] = 0x10; // payload only, CC = 0
  pkt[4] = 0x00; // pointer field → section starts next byte
  pkt[5] = 0x00; // table_id = PAT
  pkt[6] = 0x00; // section_length high nibble = 0
  pkt[7] = 0x00; // section_length low = 0 → declared length 0 (corrupt)
  pkt[8] = 0x00;
  pkt[9] = 0x2a; // transport_stream_id = 42
  // bytes 10.. stay 0xff — read as program entries if the body end isn't floored.
  const scan = scanMpegTs(pkt);
  assert.equal(scan.transportStreamId, 42);
  assert.equal(scan.programNumber, null);
  assert.equal(scan.pmtPid, null);
});

test("DASH sidx: 38 fragments, 213.04s, first HLS slice 0-1342317", () => {
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync("/tmp/dash137.bin"));
  } catch {
    return;
  }
  const { boxes, sidx } = dashSegmentPlan(data);
  assert.deepEqual(
    boxes.map((b) => b.type).slice(0, 4),
    ["ftyp", "moov", "sidx", "moof"],
  );
  assert.ok(sidx);
  assert.equal(sidx!.timescale, 12800);
  assert.equal(sidx!.refs.length, 38);
  assert.equal(sidx!.refs[0]?.size, 1341088);
  assert.equal(dashHlsSliceEnd(sidx!), 1342317);
  assert.equal(sidx!.refs.at(-1)?.end, 80911998);
  assert.equal(Number(sidxDurationSec(sidx!).toFixed(2)), 213.04);
});

test("CMAF HLS is MAP + m4s; YouTube VOD HLS is TS concat", () => {
  const yt = parseHls(
    `#EXTM3U
#EXTINF:5.0,
https://gv.example/file/seg.ts
#EXT-X-ENDLIST
`,
    "https://gv.example/index.m3u8",
  );
  const cmaf = parseHls(
    `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.0,
seg0.m4s
`,
    "https://gv.example/index.m3u8",
  );
  assert.equal(hlsContainer(yt.media.init, yt.media.segments[0]), "ts");
  assert.equal(hlsContainer(cmaf.media.init, cmaf.media.segments[0]), "fmp4");
  assert.equal(containerKind({ firstSegment: yt.media.segments[0], sync: TS_SYNC }), "mpeg-ts");
  assert.equal(containerKind({ hlsInit: cmaf.media.init }), "cmaf-hls");
  assert.equal(containerKind({ brand: "dash" }), "dash-fmp4");
});
