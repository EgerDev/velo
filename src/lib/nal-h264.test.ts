import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  nalType,
  parseAvcC,
  parseTrunDataOffset,
  splitAnnexB,
  splitAvccSample,
} from "./nal-h264.ts";
import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";

test("HLS TS Annex-B: AUD SPS PPS SEI IDR, High@4.0", () => {
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync("/tmp/hls-ts.bin"));
  } catch {
    return;
  }
  const scan = scanMpegTs(data);
  const videoPid = scan.streams.find((s) => s.codec === "h264")?.pid ?? 256;
  const pes = extractPesPayloads(data, videoPid);
  const nals = splitAnnexB(pes).filter((nal) => nal.length > 0);
  assert.ok(nals.length > 5);
  assert.deepEqual(
    nals.slice(0, 5).map((nal) => nal.name),
    ["AUD", "SPS", "PPS", "SEI", "IDR"],
  );
  const sps = nals.find((nal) => nal.type === 7);
  assert.ok(sps);
  assert.equal(pes[sps!.offset + 1], 100);
  assert.equal(pes[sps!.offset + 3], 40);
});

test("DASH CMAF: avcC High@4.0, first sample SEI+IDR via trun", () => {
  let data: Uint8Array;
  try {
    data = new Uint8Array(readFileSync("/tmp/dash137.bin"));
  } catch {
    return;
  }
  const avcC = parseAvcC(data);
  assert.ok(avcC);
  assert.equal(avcC!.profile, 100);
  assert.equal(avcC!.level, 40);
  assert.equal(avcC!.lengthSize, 4);
  assert.equal(nalType(avcC!.sps[0]![0]!), 7);
  assert.equal(nalType(avcC!.pps[0]![0]!), 8);
  const trun = parseTrunDataOffset(data, 1230);
  assert.ok(trun);
  assert.equal(1230 + trun!.dataOffset, 2902);
  assert.equal(trun!.sample0Size, 631);
  const sample = data.subarray(2902, 2902 + 631);
  const nals = splitAvccSample(sample, avcC!.lengthSize);
  assert.deepEqual(
    nals.map((nal) => nal.name),
    ["SEI", "IDR"],
  );
});
