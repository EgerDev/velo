/**
 * H.264 NAL units in the two YouTube 1080p containers.
 *
 * HLS itag 96 (MPEG-TS): Annex-B start codes inside PES. Access unit starts
 * with AUD (9), then SPS (7) PPS (8) SEI (6) IDR (5) on a keyframe.
 *
 * DASH/CMAF itag 137: AVCC. SPS/PPS live in `avcC`. Samples in `mdat` are
 * 4-byte length-prefixed NALs. First sample is SEI + IDR (no AUD, no in-band
 * SPS). `trun.data_offset` from `moof` points at that sample.
 *
 * Live hop: profile_idc 100 (High), level 40 → 1920×1080 4:2:0 8-bit.
 * IDR slice_type 7 (I), frame_num 0. Next coded pictures: P (5) and B (6).
 */
import { readBoxes } from "./iso-bmff.ts";

export const NAL_NAMES: Record<number, string> = {
  1: "slice",
  5: "IDR",
  6: "SEI",
  7: "SPS",
  8: "PPS",
  9: "AUD",
};

export type Nal = { type: number; name: string; offset: number; length: number };

export function nalType(byte: number): number {
  return byte & 0x1f;
}

export function splitAnnexB(data: Uint8Array): Nal[] {
  const entries: { prefix: number; payload: number }[] = [];
  let i = 0;
  while (i + 3 <= data.length) {
    if (i + 4 <= data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      entries.push({ prefix: i, payload: i + 4 });
      i += 4;
      continue;
    }
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      entries.push({ prefix: i, payload: i + 3 });
      i += 3;
      continue;
    }
    i++;
  }
  const nals: Nal[] = [];
  for (let n = 0; n < entries.length; n++) {
    const offset = entries[n]!.payload;
    const end = entries[n + 1]?.prefix ?? data.length;
    const type = nalType(data[offset] ?? 0);
    nals.push({ type, name: NAL_NAMES[type] ?? `nal${type}`, offset, length: Math.max(0, end - offset) });
  }
  return nals;
}

export type AvcC = {
  profile: number;
  level: number;
  lengthSize: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
};

export function parseAvcC(data: Uint8Array): AvcC | null {
  const idx = indexOfBox(data, "avcC");
  if (idx < 4) return null;
  const size = new DataView(data.buffer, data.byteOffset + idx - 4, 4).getUint32(0);
  const box = data.subarray(idx - 4, idx - 4 + size);
  if (box.length < 16) return null;
  const lengthSize = (box[12]! & 3) + 1;
  let offset = 14;
  const nSps = box[13]! & 0x1f;
  const sps: Uint8Array[] = [];
  for (let i = 0; i < nSps && offset + 2 <= box.length; i++) {
    const len = (box[offset]! << 8) | box[offset + 1]!;
    offset += 2;
    sps.push(box.subarray(offset, offset + len));
    offset += len;
  }
  if (offset >= box.length) return { profile: box[9]!, level: box[11]!, lengthSize, sps, pps: [] };
  const nPps = box[offset]!;
  offset += 1;
  const pps: Uint8Array[] = [];
  for (let i = 0; i < nPps && offset + 2 <= box.length; i++) {
    const len = (box[offset]! << 8) | box[offset + 1]!;
    offset += 2;
    pps.push(box.subarray(offset, offset + len));
    offset += len;
  }
  return { profile: box[9]!, level: box[11]!, lengthSize, sps, pps };
}

export function splitAvccSample(sample: Uint8Array, lengthSize = 4): Nal[] {
  const nals: Nal[] = [];
  let offset = 0;
  while (offset + lengthSize <= sample.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = (length << 8) | sample[offset + i]!;
    offset += lengthSize;
    if (length <= 0 || offset + length > sample.length) break;
    const type = nalType(sample[offset]!);
    nals.push({ type, name: NAL_NAMES[type] ?? `nal${type}`, offset, length });
    offset += length;
  }
  return nals;
}

function indexOfBox(data: Uint8Array, type: string): number {
  const a = type.charCodeAt(0);
  const b = type.charCodeAt(1);
  const c = type.charCodeAt(2);
  const d = type.charCodeAt(3);
  for (let i = 0; i + 4 <= data.length; i++) {
    if (data[i] === a && data[i + 1] === b && data[i + 2] === c && data[i + 3] === d) return i;
  }
  return -1;
}

export function parseTrunDataOffset(data: Uint8Array, moofOffset: number): { dataOffset: number; sample0Size: number | null } | null {
  const children = readBoxes(data.subarray(moofOffset + 8), 12);
  let trunOffset = -1;
  for (const child of children) {
    const abs = moofOffset + 8 + child.offset;
    if (child.type === "traf") {
      const traf = readBoxes(data.subarray(abs + 8), 12);
      for (const inner of traf) {
        if (inner.type === "trun") {
          trunOffset = abs + 8 + inner.offset;
          break;
        }
      }
    }
    if (child.type === "trun") trunOffset = abs;
    if (trunOffset >= 0) break;
  }
  if (trunOffset < 0) return null;
  const box = data.subarray(trunOffset);
  if (box.length < 16) return null;
  const flags = (box[9]! << 16) | (box[10]! << 8) | box[11]!;
  let pos = 16;
  let dataOffset = 0;
  if (flags & 0x1) {
    // data_offset lives at bytes 16-19; a fragment header truncated by a
    // partial range fetch can end right after sample_count. Bail like the rest
    // of the module rather than let the DataView throw a RangeError.
    if (pos + 4 > box.length) return null;
    dataOffset = new DataView(box.buffer, box.byteOffset + pos, 4).getInt32(0);
    pos += 4;
  }
  let sample0Size: number | null = null;
  // first_sample_flags sits between data_offset and the per-sample array
  // (ISO/IEC 14496-12). ffmpeg and Bento4 set it to mark sample 0 as a sync
  // sample, so skipping it reads the flags word itself as a sample size.
  if (flags & 0x4) pos += 4;
  if (flags & 0x100) pos += 4;
  if (flags & 0x200 && pos + 4 <= box.length) {
    sample0Size = new DataView(box.buffer, box.byteOffset + pos, 4).getUint32(0);
  }
  return { dataOffset, sample0Size };
}
