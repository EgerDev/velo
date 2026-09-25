import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nalType,
  parseAvcC,
  parseTrunDataOffset,
  splitAnnexB,
  splitAvccSample,
} from "./nal-h264.ts";
import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
import { dashSegmentPlan } from "./iso-bmff.ts";
import { dashCmafFixture, hlsTsFixture } from "./media-test-fixtures/index.ts";

test("HLS TS Annex-B: AUD SPS PPS SEI IDR, High@4.0", () => {
  const data = hlsTsFixture();
  const scan = scanMpegTs(data);
  const videoPid = scan.streams.find((s) => s.codec === "h264")?.pid;
  assert.equal(videoPid, 256);
  const pes = extractPesPayloads(data, videoPid!);
  const nals = splitAnnexB(pes).filter((nal) => nal.length > 0);
  assert.ok(nals.length > 5);
  assert.deepEqual(
    nals.slice(0, 5).map((nal) => nal.name),
    ["AUD", "SPS", "PPS", "SEI", "IDR"],
  );
  // Every frame of the fixture starts with an access-unit delimiter (x264 aud=1).
  assert.equal(nals.filter((nal) => nal.name === "AUD").length, 12);
  const sps = nals.find((nal) => nal.type === 7);
  assert.ok(sps);
  assert.equal(pes[sps!.offset + 1], 100);
  assert.equal(pes[sps!.offset + 3], 40);
});

test("DASH CMAF: avcC High@4.0, first sample SEI+IDR via trun", () => {
  const data = dashCmafFixture();
  const avcC = parseAvcC(data);
  assert.ok(avcC);
  assert.equal(avcC!.profile, 100);
  assert.equal(avcC!.level, 40);
  assert.equal(avcC!.lengthSize, 4);
  assert.equal(nalType(avcC!.sps[0]![0]!), 7);
  assert.equal(nalType(avcC!.pps[0]![0]!), 8);
  const moof = dashSegmentPlan(data).boxes.find((box) => box.type === "moof");
  assert.ok(moof);
  const trun = parseTrunDataOffset(data, moof!.offset);
  assert.ok(trun);
  // default-base-is-moof: the first sample sits right after the moof box and
  // the 8-byte mdat header.
  assert.equal(trun!.dataOffset, moof!.size + 8);
  assert.ok(trun!.sample0Size);
  const start = moof!.offset + trun!.dataOffset;
  const sample = data.subarray(start, start + trun!.sample0Size!);
  const nals = splitAvccSample(sample, avcC!.lengthSize);
  assert.deepEqual(
    nals.map((nal) => nal.name),
    ["SEI", "IDR"],
  );
  // The length-prefixed NALs tile the whole sample, with nothing left over.
  assert.equal(
    nals.reduce((sum, nal) => sum + avcC!.lengthSize + nal.length, 0),
    trun!.sample0Size,
  );
});
