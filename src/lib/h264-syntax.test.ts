import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAvcC, splitAnnexB, splitAvccSample } from "./nal-h264.ts";
import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
import { parseHvcC, parseSliceHeader, parseSps, youtubeHevcNote } from "./h264-syntax.ts";

test("H.264 SPS is High 4.0 1920×1080; IDR slice is I frame_num 0", () => {
  let dash: Uint8Array;
  try {
    dash = new Uint8Array(readFileSync("/tmp/dash137.bin"));
  } catch {
    return;
  }
  const avcC = parseAvcC(dash);
  assert.ok(avcC?.sps[0]);
  const sps = parseSps(avcC!.sps[0]!);
  assert.ok(sps);
  assert.equal(sps!.profile, 100);
  assert.equal(sps!.level, 40);
  assert.equal(sps!.width, 1920);
  assert.equal(sps!.height, 1080);
  assert.equal(sps!.log2MaxFrameNum, 4);
  const sample = dash.subarray(2902, 2902 + 631);
  const idr = splitAvccSample(sample).find((nal) => nal.type === 5);
  assert.ok(idr);
  const header = parseSliceHeader(
    sample.subarray(idr!.offset, idr!.offset + idr!.length),
    sps!.log2MaxFrameNum,
  );
  assert.equal(header?.slice, "I");
  assert.equal(header?.frameNum, 0);
  assert.equal(header?.firstMb, 0);
  assert.equal(header?.idrPicId, 0);
});

test("HLS GOP: IDR I, then P and B slices", () => {
  let ts: Uint8Array;
  try {
    ts = new Uint8Array(readFileSync("/tmp/hls-ts.bin"));
  } catch {
    return;
  }
  const pid = scanMpegTs(ts).streams.find((s) => s.codec === "h264")?.pid ?? 256;
  const nals = splitAnnexB(extractPesPayloads(ts, pid));
  const spsNal = nals.find((nal) => nal.type === 7);
  const pes = extractPesPayloads(ts, pid);
  const sps = spsNal ? parseSps(pes.subarray(spsNal.offset, spsNal.offset + spsNal.length)) : null;
  assert.equal(sps?.width, 1920);
  const coded = nals.filter((nal) => nal.type === 1 || nal.type === 5).slice(0, 8);
  const slices = coded.map(
    (nal) =>
      parseSliceHeader(pes.subarray(nal.offset, nal.offset + nal.length), sps!.log2MaxFrameNum)
        ?.slice,
  );
  assert.equal(slices[0], "I");
  assert.ok(slices.includes("P"));
  assert.ok(slices.includes("B"));
});

test("HEVC Main/Main 10 parser; this title uses AV1 instead", () => {
  const hvcC = new Uint8Array(24);
  hvcC.set([104, 118, 99, 67, 1, 2]);
  // general_level_idc is record byte 12, and the record starts at box[4].
  hvcC[16] = 120;
  hvcC[21] = 0xf8; // bit-depth byte: reading the level from here would give 248
  const parsed = parseHvcC(hvcC);
  assert.equal(parsed?.profileName, "Main 10");
  assert.equal(parsed?.level, 120);
  assert.match(youtubeHevcNote(["avc1.640028", "vp9", "av01.0.08M.08"]), /No HEVC.*AV1 Main 8-bit/);
});

/** Minimal exp-Golomb bit writer, so an SPS can be built to spec in a test. */
class SpsWriter {
  bits: number[] = [];
  u(v: number, n: number) {
    for (let i = n - 1; i >= 0; i--) this.bits.push((v >> i) & 1);
  }
  ue(v: number) {
    const c = v + 1;
    const n = 32 - Math.clz32(c);
    this.u(0, n - 1);
    this.u(c, n);
  }
  se(v: number) {
    this.ue(v <= 0 ? -2 * v : 2 * v - 1);
  }
  bytes() {
    const bits = [...this.bits];
    while (bits.length % 8) bits.push(0);
    const out = new Uint8Array(bits.length / 8);
    bits.forEach((bit, i) => {
      if (bit) out[i >> 3]! |= 0x80 >> (i & 7);
    });
    return out;
  }
}

/** A baseline-profile 1920x1088 SPS with the given pic_order_cnt_type. */
function buildSps(pocType: number, cycleLength: number) {
  const w = new SpsWriter();
  w.u(0x67, 8);
  w.u(66, 8);
  w.u(0, 8);
  w.u(30, 8);
  w.ue(0);
  w.ue(0);
  w.ue(pocType);
  if (pocType === 0) w.ue(0);
  else if (pocType === 1) {
    w.u(0, 1);
    w.se(0);
    w.se(0);
    w.ue(cycleLength);
    for (let i = 0; i < cycleLength; i++) w.se(0);
  }
  w.ue(1);
  w.u(0, 1);
  w.ue(1920 / 16 - 1);
  w.ue(1088 / 16 - 1);
  w.u(1, 1);
  w.u(1, 1);
  w.u(0, 1);
  w.u(0, 1);
  return w.bytes();
}

test("pic_order_cnt_type 1 does not shift the SPS bit position", () => {
  // offset_for_ref_frame[] runs i < num_ref_frames_in_pic_order_cnt_cycle
  // (H.264 §7.3.2.1.1). One extra exp-Golomb read here corrupts width/height.
  for (const [pocType, cycle] of [
    [0, 0],
    [1, 1],
    [1, 2],
    [1, 4],
  ] as const) {
    const sps = parseSps(buildSps(pocType, cycle));
    assert.equal(sps?.width, 1920, `poc_type=${pocType} cycle=${cycle}`);
    assert.equal(sps?.height, 1088, `poc_type=${pocType} cycle=${cycle}`);
  }
});
