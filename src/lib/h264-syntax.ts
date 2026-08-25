/**
 * H.264 bitstream syntax (ITU-T H.264).
 *
 * Slice header (first bytes after the NAL header):
 *   first_mb_in_slice  ue(v)   always 0 here (one slice per picture)
 *   slice_type         ue(v)   0/5 P  ·  1/6 B  ·  2/7 I
 *   pic_parameter_set_id ue(v)
 *   frame_num          u(log2_max_frame_num)  from SPS
 *   idr_pic_id         ue(v)   only if nal_unit_type == 5
 *
 * Live 1080p hop (avc1.640028): SPS High 4.0, 1920×1080, 4:2:0 8-bit,
 * log2_max_frame_num=4 (frame_num wraps at 16). IDR is slice_type 7 (I).
 * GOP then I (non-IDR) → P → B → B → P …
 *
 * HEVC is not on this title. YouTube 1080p here is AVC / VP9 / AV1
 * (`av01.0.08M.08` = AV1 Main 8-bit). HEVC Main / Main 10 used to ship as
 * `hvc1` on some 4K HDR; parseHvcC still accepts that box.
 */

export class BitReader {
  bit = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  u(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.data[Math.floor(this.bit / 8)] ?? 0;
      value = (value << 1) | ((byte >> (7 - (this.bit % 8))) & 1);
      this.bit++;
    }
    return value;
  }
  ue(): number {
    let zeros = 0;
    while (this.bit < this.data.length * 8 && this.u(1) === 0 && zeros < 32) {
      zeros++;
    }
    return zeros === 0 ? 0 : (1 << zeros) - 1 + this.u(zeros);
  }
  se(): number {
    const val = this.ue();
    const sign = (val & 1) ? 1 : -1;
    return sign * Math.ceil(val / 2);
  }
}

export function ebspToRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i + 2 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 3) {
      out.push(0, 0);
      i += 2;
      continue;
    }
    out.push(nal[i]!);
  }
  return Uint8Array.from(out);
}

export const SLICE_NAME: Record<number, "I" | "P" | "B" | "SP" | "SI"> = {
  0: "P",
  1: "B",
  2: "I",
  3: "SP",
  4: "SI",
  5: "P",
  6: "B",
  7: "I",
  8: "SP",
  9: "SI",
};

export type SpsInfo = {
  profile: number;
  level: number;
  width: number;
  height: number;
  chroma: number;
  bitDepth: number;
  log2MaxFrameNum: number;
  frameMbsOnly: boolean;
};

export function parseSps(nal: Uint8Array): SpsInfo | null {
  const rbsp = ebspToRbsp(nal);
  if (rbsp.length < 5 || (rbsp[0]! & 0x1f) !== 7) return null;
  const b = new BitReader(rbsp);
  b.u(8);
  const profile = b.u(8);
  b.u(8);
  const level = b.u(8);
  b.ue();
  let chroma = 1;
  let bitDepth = 8;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = b.ue();
    if (chroma === 3) b.u(1);
    bitDepth = b.ue() + 8;
    b.ue();
    b.u(1);
    if (b.u(1)) return null;
  }
  const log2MaxFrameNum = b.ue() + 4;
  const poc = b.ue();
  if (poc === 0) b.ue();
  else if (poc === 1) {
    b.u(1);
    b.ue();
    b.ue();
    const n = b.ue();
    // H.264 §7.3.2.1.1: i < num_ref_frames_in_pic_order_cnt_cycle. Consuming one
    // extra code here shifts every later field — including width and height.
    for (let i = 0; i < n; i++) b.ue();
  }
  b.ue();
  b.u(1);
  let width = (b.ue() + 1) * 16;
  let height = (b.ue() + 1) * 16;
  const frameMbsOnly = b.u(1) === 1;
  if (!frameMbsOnly) {
    b.u(1);
    height *= 2;
  }
  b.u(1);
  if (b.u(1)) {
    const left = b.ue();
    const right = b.ue();
    const top = b.ue();
    const bottom = b.ue();
    const subW = chroma === 1 || chroma === 2 ? 2 : 1;
    const subH = chroma === 1 ? 2 : 1;
    const cropUnitY = subH * (frameMbsOnly ? 1 : 2);
    width -= (left + right) * subW;
    height -= (top + bottom) * cropUnitY;
  }
  return { profile, level, width, height, chroma, bitDepth, log2MaxFrameNum, frameMbsOnly };
}

export type SliceHeader = {
  firstMb: number;
  sliceType: number;
  slice: string;
  ppsId: number;
  frameNum: number;
  idrPicId: number | null;
};

export function parseSliceHeader(nal: Uint8Array, log2MaxFrameNum: number): SliceHeader | null {
  const rbsp = ebspToRbsp(nal);
  if (rbsp.length < 2) return null;
  const nalType = rbsp[0]! & 0x1f;
  const b = new BitReader(rbsp);
  b.u(8);
  const firstMb = b.ue();
  const sliceType = b.ue();
  const ppsId = b.ue();
  const frameNum = b.u(log2MaxFrameNum);
  let idrPicId: number | null = null;
  if (nalType === 5) idrPicId = b.ue();
  return {
    firstMb,
    sliceType,
    slice: SLICE_NAME[sliceType] ?? String(sliceType),
    ppsId,
    frameNum,
    idrPicId,
  };
}

/** HEVC profile_idc: 1 Main, 2 Main 10, 3 Main Still, 4 Format Range. */
export const HEVC_PROFILE: Record<number, string> = {
  1: "Main",
  2: "Main 10",
  3: "Main Still Picture",
  4: "Format Range",
};

export type HvcC = { version: number; profile: number; profileName: string; level: number; tier: "main" | "high" };

export function parseHvcC(data: Uint8Array): HvcC | null {
  const a = "h".charCodeAt(0);
  let idx = -1;
  for (let i = 0; i + 4 <= data.length; i++) {
    if (data[i] === a && data[i + 1] === 118 && data[i + 2] === 99 && data[i + 3] === 67) {
      idx = i;
      break;
    }
  }
  if (idx < 0 || idx + 17 > data.length) return null;
  const box = data.subarray(idx);
  const profileByte = box[5]!;
  const profile = profileByte & 0x1f;
  const tier = profileByte & 0x20 ? "high" : "main";
  // The record starts at box[4], and general_level_idc is record byte 12
  // (ISO/IEC 14496-15 §8.3.3.1). box[21] is record[17], the bit-depth byte.
  const level = box[16] ?? 0;
  return {
    version: box[4] ?? 0,
    profile,
    profileName: HEVC_PROFILE[profile] ?? `profile ${profile}`,
    level,
    tier,
  };
}

export function youtubeHevcNote(formats: string[]): string {
  const hevc = formats.filter((item) => /h265|hevc|hvc1/i.test(item));
  if (hevc.length) return `HEVC present: ${hevc.slice(0, 3).join(", ")}`;
  const av1 = formats.find((item) => /av01\.0\.08/i.test(item));
  return av1
    ? `No HEVC on this title. 1080p is AVC High 4.0 + AV1 Main 8-bit (${av1}).`
    : "No HEVC on this title.";
}
