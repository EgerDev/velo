/**
 * MPEG-TS (ISO/IEC 13818-1) — YouTube HLS itag 96.
 *
 * Packet = 188 bytes, sync `0x47`. Payload is PES, not MP4 boxes.
 * PAT (PID 0) → PMT → elementary streams. Live hop sample:
 *   PID 256 = H.264 (stream_type 0x1B), PID 257 = AAC ADTS (0x0F).
 * Concatenate `seg.ts` files in m3u8 order; do not wrap in ftyp.
 *
 * CMAF (ISO/IEC 23000-19) is the other HLS flavour: `#EXT-X-MAP` init + `.m4s`
 * fragments (`moof`/`mdat`). YouTube VOD HLS is TS, not CMAF. itag 137 DASH
 * is CMAF-like fMP4 on one URL (sidx + ranges), not an m3u8.
 */

export const TS_PACKET = 188;
export const TS_SYNC = 0x47;

export type TsPacket = {
  offset: number;
  pid: number;
  pusi: boolean;
  adaptation: number;
  continuity: number;
  payloadOffset: number;
};

export type TsStream = { type: number; pid: number; codec: string };

export type TsScan = {
  packets: number;
  syncErrors: number;
  pids: number[];
  pmtPid: number | null;
  programNumber: number | null;
  transportStreamId: number | null;
  pcrPid: number | null;
  streams: TsStream[];
};

const CODEC: Record<number, string> = {
  0x0f: "aac",
  0x11: "aac-latm",
  0x1b: "h264",
  0x24: "h265",
  0x86: "scte35",
};

export function parseTsPacket(data: Uint8Array, offset = 0): TsPacket | null {
  if (data.length < offset + 4) return null;
  if (data[offset] !== TS_SYNC) return null;
  const b1 = data[offset + 1]!;
  const b2 = data[offset + 2]!;
  const b3 = data[offset + 3]!;
  const adaptation = (b3 >> 4) & 0x3;
  let payloadOffset = offset + 4;
  if (adaptation === 2 || adaptation === 3) {
    if (data.length <= payloadOffset) return null;
    payloadOffset += 1 + data[payloadOffset]!;
    if (payloadOffset > offset + TS_PACKET) return null;
  }
  return {
    offset,
    pid: ((b1 & 0x1f) << 8) | b2,
    pusi: Boolean(b1 & 0x40),
    adaptation,
    continuity: b3 & 0x0f,
    payloadOffset,
  };
}

function sectionAfterPointer(data: Uint8Array, pkt: TsPacket): Uint8Array | null {
  const packetEnd = Math.min(data.length, pkt.offset + TS_PACKET);
  if (pkt.payloadOffset >= packetEnd) return null;
  const pointer = data[pkt.payloadOffset]!;
  const start = pkt.payloadOffset + 1 + pointer;
  if (start + 3 > packetEnd) return null;
  return data.subarray(start, packetEnd);
}

export function scanMpegTs(data: Uint8Array): TsScan {
  let offset = 0;
  while (offset < data.length && data[offset] !== TS_SYNC) offset++;
  let packets = 0;
  let syncErrors = 0;
  const pidCounts = new Map<number, number>();
  const headers: TsPacket[] = [];
  while (offset + 4 <= data.length) {
    const pkt = parseTsPacket(data, offset);
    if (!pkt) {
      syncErrors++;
      offset++;
      while (offset < data.length && data[offset] !== TS_SYNC) offset++;
      continue;
    }
    packets++;
    pidCounts.set(pkt.pid, (pidCounts.get(pkt.pid) ?? 0) + 1);
    headers.push(pkt);
    offset += data.length >= offset + TS_PACKET ? TS_PACKET : data.length - offset;
    if (data.length >= offset && data.length - offset < TS_PACKET) break;
  }

  let pmtPid: number | null = null;
  let programNumber: number | null = null;
  let transportStreamId: number | null = null;
  const pat = headers.find((pkt) => pkt.pid === 0 && pkt.pusi);
  if (pat) {
    const section = sectionAfterPointer(data, pat);
    if (section && section[0] === 0x00 && section.length >= 16) {
      transportStreamId = (section[3]! << 8) | section[4]!;
      const length = ((section[1]! & 0x0f) << 8) | section[2]!;
      const body = section.subarray(8, Math.min(section.length, 3 + length - 4));
      for (let i = 0; i + 4 <= body.length; i += 4) {
        const program = (body[i]! << 8) | body[i + 1]!;
        const pid = ((body[i + 2]! & 0x1f) << 8) | body[i + 3]!;
        if (program !== 0) {
          programNumber = program;
          pmtPid = pid;
          break;
        }
      }
    }
  }

  const streams: TsStream[] = [];
  let pcrPid: number | null = null;
  if (pmtPid != null) {
    const pmt = headers.find((pkt) => pkt.pid === pmtPid && pkt.pusi);
    if (pmt) {
      const section = sectionAfterPointer(data, pmt);
      if (section && section[0] === 0x02 && section.length >= 12) {
        pcrPid = ((section[8]! & 0x1f) << 8) | section[9]!;
        const info = ((section[10]! & 0x0f) << 8) | section[11]!;
        const length = ((section[1]! & 0x0f) << 8) | section[2]!;
        const limit = Math.min(section.length, 3 + length);
        let i = 12 + info;
        while (i + 5 <= limit - 4) {
          const type = section[i]!;
          const pid = ((section[i + 1]! & 0x1f) << 8) | section[i + 2]!;
          const esLen = ((section[i + 3]! & 0x0f) << 8) | section[i + 4]!;
          streams.push({ type, pid, codec: CODEC[type] ?? `0x${type.toString(16)}` });
          i += 5 + esLen;
        }
      }
    }
  }

  return {
    packets,
    syncErrors,
    pids: [...pidCounts.keys()].sort((a, b) => a - b),
    pmtPid,
    programNumber,
    transportStreamId,
    pcrPid,
    streams,
  };
}

export type ContainerKind = "mpeg-ts" | "cmaf-hls" | "dash-fmp4" | "progressive";

export function extractPesPayloads(data: Uint8Array, pid: number): Uint8Array {
  const chunks: number[] = [];
  for (let offset = 0; offset + TS_PACKET <= data.length; offset += TS_PACKET) {
    const pkt = parseTsPacket(data, offset);
    if (!pkt || pkt.pid !== pid) continue;
    let start = pkt.payloadOffset;
    const end = offset + TS_PACKET;
    if (start >= end) continue;
    if (pkt.pusi && end - start >= 9 && data[start] === 0 && data[start + 1] === 0 && data[start + 2] === 1) {
      const header = data[start + 8] ?? 0;
      start += 9 + header;
    }
    for (let i = start; i < end; i++) chunks.push(data[i]!);
  }
  return Uint8Array.from(chunks);
}

export function containerKind(opts: {
  hlsInit?: string;
  firstSegment?: string;
  brand?: string;
  sync?: number;
}): ContainerKind {
  if (opts.hlsInit) return "cmaf-hls";
  if (opts.sync === TS_SYNC || (opts.firstSegment && /seg\.ts/i.test(opts.firstSegment))) return "mpeg-ts";
  if (opts.brand === "dash" || opts.brand === "iso6" || opts.brand === "iso5") return "dash-fmp4";
  return "progressive";
}
