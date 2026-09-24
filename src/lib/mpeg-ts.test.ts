import assert from "node:assert/strict";
import { test } from "node:test";
import { containerKind, parseTsPacket, scanMpegTs, TS_PACKET, TS_SYNC } from "./mpeg-ts.ts";
import { dashHlsSliceEnd, dashSegmentPlan, hlsContainer, sidxDurationSec } from "./iso-bmff.ts";
import { parseHls } from "./stream-unlock.ts";
import { dashCmafFixture, hlsTsFixture } from "./media-test-fixtures/index.ts";

test("PAT/PMT: program 1 → PMT 4095 → AAC 257 + H.264 256", () => {
  const data = hlsTsFixture();
  assert.equal(data.length % TS_PACKET, 0);
  const first = parseTsPacket(data, 0);
  assert.ok(first);
  assert.equal(data[0], TS_SYNC);
  const scan = scanMpegTs(data);
  assert.equal(scan.packets, data.length / TS_PACKET);
  assert.equal(scan.syncErrors, 0);
  assert.equal(scan.transportStreamId, 1);
  assert.equal(scan.programNumber, 1);
  assert.equal(scan.pmtPid, 4095);
  // ffmpeg carries the PCR on the video PID (YouTube's own segments use 8191).
  assert.equal(scan.pcrPid, 256);
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

test("DASH sidx: 4 fragments, 0.8s, refs tile every moof+mdat pair", () => {
  const data = dashCmafFixture();
  const { boxes, sidx } = dashSegmentPlan(data);
  assert.deepEqual(
    boxes.map((b) => b.type).slice(0, 4),
    ["ftyp", "moov", "sidx", "moof"],
  );
  assert.ok(sidx);
  assert.equal(sidx!.timescale, 12800);
  assert.equal(sidx!.refs.length, 4);
  // Each reference spans exactly one moof+mdat pair, back to back.
  const moofs = boxes.filter((b) => b.type === "moof");
  assert.equal(moofs.length, 4);
  sidx!.refs.forEach((ref, i) => {
    const mdat = boxes[boxes.indexOf(moofs[i]!) + 1]!;
    assert.equal(mdat.type, "mdat");
    assert.equal(ref.start, moofs[i]!.offset);
    assert.equal(ref.size, moofs[i]!.size + mdat.size);
    assert.equal(ref.end, ref.start + ref.size - 1);
  });
  assert.equal(dashHlsSliceEnd(sidx!), sidx!.refs[0]!.end);
  assert.equal(dashHlsSliceEnd(sidx!, 4), null);
  assert.equal(Number(sidxDurationSec(sidx!).toFixed(2)), 0.8);
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
