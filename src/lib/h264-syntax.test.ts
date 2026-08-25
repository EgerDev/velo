import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAvcC, splitAnnexB, splitAvccSample } from "./nal-h264.ts";
import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
import {
  parseHvcC,
  parseSliceHeader,
  parseSps,
  youtubeHevcNote,
} from "./h264-syntax.ts";

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
  const header = parseSliceHeader(sample.subarray(idr!.offset, idr!.offset + idr!.length), sps!.log2MaxFrameNum);
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
  const slices = coded.map((nal) => parseSliceHeader(pes.subarray(nal.offset, nal.offset + nal.length), sps!.log2MaxFrameNum)?.slice);
  assert.equal(slices[0], "I");
  assert.ok(slices.includes("P"));
  assert.ok(slices.includes("B"));
});

test("HEVC Main/Main 10 parser; this title uses AV1 instead", () => {
  const hvcC = new Uint8Array(24);
  hvcC.set([104, 118, 99, 67, 1, 2]);
  hvcC[21] = 120;
  const parsed = parseHvcC(hvcC);
  assert.equal(parsed?.profileName, "Main 10");
  assert.equal(parsed?.level, 120);
  assert.match(
    youtubeHevcNote(["avc1.640028", "vp9", "av01.0.08M.08"]),
    /No HEVC.*AV1 Main 8-bit/,
  );
});
