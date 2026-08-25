/**
 * MPEG-DASH / dash.js SegmentBase, without shipping dash.js.
 *
 * YouTube itag 137 is one googlevideo URL (not an MPD). The file is fragmented
 * MP4: ftyp(dash) + moov + sidx + moof/mdat… dash.js would build a SegmentBase
 * MPD from `sidx` and fetch each referenced_size with HTTP Range — same hop
 * as the player. We parse that index ourselves; the preview iframe cannot run
 * dash.js against googlevideo (CORS + IP bind).
 *
 * HLS (web_safari itag 96) is MPEG-TS packets (`0x47`, 188 bytes) listed in an
 * m3u8. Concatenate in order. No EXT-X-MAP on YouTube VOD (that would be CMAF).
 *
 * Live 137 sidx (rickroll, 24 Aug 2026): timescale 12800, 38 refs, 213.04s,
 * first slice end 1342317 (= HLS govp/slices=0-1342317), last byte 80911998.
 */
import { TS_PACKET, TS_SYNC } from "./mpeg-ts.ts";

export type Box = { type: string; size: number; offset: number };

export function readBoxes(data: Uint8Array, limit = 24): Box[] {
  const boxes: Box[] = [];
  let offset = 0;
  while (offset + 8 <= data.length && boxes.length < limit) {
    const size = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(data[offset + 4]!, data[offset + 5]!, data[offset + 6]!, data[offset + 7]!);
    let actualSize = size;
    if (size === 1) {
      if (offset + 16 > data.length) break;
      const hi = new DataView(data.buffer, data.byteOffset + offset, 16).getUint32(8);
      const lo = new DataView(data.buffer, data.byteOffset + offset, 16).getUint32(12);
      actualSize = hi * 2 ** 32 + lo;
    } else if (size === 0) {
      actualSize = data.length - offset;
    } else if (size < 8) {
      break;
    }
    boxes.push({ type, size: actualSize, offset });
    offset += actualSize;
  }
  return boxes;
}

export type SidxRef = { size: number; duration: number; start: number; end: number };

export type SidxIndex = {
  timescale: number;
  firstOffset: number;
  refs: SidxRef[];
  initEnd: number;
};

export function parseSidx(data: Uint8Array, box: Box): SidxIndex | null {
  if (box.type !== "sidx" || box.size < 32) return null;
  // The DataView spans only the bytes we actually have, but the header reads
  // below are unbounded and the reference loop is bounded by the DECLARED size.
  // Parsing the head of a fragmented MP4 — the whole point of this module —
  // therefore threw RangeError instead of returning what it could read.
  const actualLen = Math.min(box.size, data.length - box.offset);
  if (actualLen < 32) return null;
  const view = new DataView(data.buffer, data.byteOffset + box.offset, actualLen);
  const version = view.getUint8(8);
  if (version !== 0 && actualLen < 40) return null;
  let cursor = 12;
  cursor += 4;
  const timescale = view.getUint32(cursor);
  cursor += 4;
  let firstOffset: number;
  if (version === 0) {
    cursor += 4;
    firstOffset = view.getUint32(cursor);
    cursor += 4;
  } else {
    cursor += 8;
    const hi = view.getUint32(cursor);
    const lo = view.getUint32(cursor + 4);
    firstOffset = hi * 2 ** 32 + lo;
    cursor += 8;
  }
  cursor += 2;
  const count = view.getUint16(cursor);
  cursor += 2;
  const sidxEnd = box.offset + box.size;
  let start = sidxEnd + firstOffset;
  const refs: SidxRef[] = [];
  // Bounded by what we HAVE as well as by what the box claims.
  for (let i = 0; i < count && cursor + 12 <= box.size && cursor + 8 <= actualLen; i++) {
    const word = view.getUint32(cursor);
    cursor += 4;
    const size = word & 0x7fff_ffff;
    const duration = view.getUint32(cursor);
    cursor += 8;
    refs.push({ size, duration, start, end: start + size - 1 });
    start += size;
  }
  return { timescale, firstOffset, refs, initEnd: sidxEnd };
}

export function dashSegmentPlan(data: Uint8Array): { boxes: Box[]; sidx: SidxIndex | null } {
  const boxes = readBoxes(data);
  const sidxBox = boxes.find((box) => box.type === "sidx");
  return { boxes, sidx: sidxBox ? parseSidx(data, sidxBox) : null };
}

export function sidxDurationSec(index: SidxIndex): number {
  if (!index.timescale) return 0;
  const ticks = index.refs.reduce((sum, ref) => sum + ref.duration, 0);
  return ticks / index.timescale;
}

/** HLS `govp/slices=0-END` for fragment 0 is init + first sidx ref (inclusive). */
export function dashHlsSliceEnd(index: SidxIndex, fragment = 0): number | null {
  const ref = index.refs[fragment];
  return ref ? ref.end : null;
}

export function looksLikeFragment(data: Uint8Array): "fmp4" | "ts" | "webm" | "mp4" | null {
  if (!data.length) return null;
  if (data[0] === TS_SYNC) {
    if (data.length >= TS_PACKET * 2 && data[TS_PACKET] !== TS_SYNC) return null;
    return "ts";
  }
  if (data.length >= 3 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf) return "webm";
  if (data.length < 8) return null;
  const head = String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!);
  if (head === "moof" || head === "styp") return "fmp4";
  if (head === "ftyp") {
    if (data.length < 12) return "mp4";
    const brand = String.fromCharCode(data[8]!, data[9]!, data[10]!, data[11]!);
    return brand === "dash" || brand === "iso6" || brand === "iso5" ? "fmp4" : "mp4";
  }
  return null;
}

export function hlsContainer(init: string | undefined, firstSegment: string | undefined): "fmp4" | "ts" {
  if (init) return "fmp4";
  // Test for fMP4, not for TS: both arms of the old check returned "ts", so a
  // playlist of .m4s segments with no EXT-X-MAP was reported as MPEG-TS.
  if (firstSegment && /\.(m4s|mp4|cmf[va])(\?|$)/i.test(firstSegment)) return "fmp4";
  return "ts";
}
