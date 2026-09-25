/**
 * HLS playlist parsing: master variants (bandwidth, height, codecs, audio
 * group) and media segments (EXT-X-MAP init + segment URIs). Pure and
 * network-free.
 */
export type HlsVariant = {
  url: string;
  bandwidth: number;
  height: number;
  codecs: string;
  audioGroup: string;
  hasAudio: boolean;
  hasVideo: boolean;
};

export type HlsMedia = {
  init?: string;
  segments: string[];
  bandwidth: number;
};

function codecFlags(codecs: string): { hasAudio: boolean; hasVideo: boolean } {
  const c = codecs.toLowerCase();
  return {
    hasVideo: /avc[13]|hvc1|hev1|vp09|av01/.test(c),
    hasAudio: /mp4a|opus|ac-3|ec-3/.test(c),
  };
}

export function parseHls(text: string, base: string): { master: HlsVariant[]; media: HlsMedia } {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const master: HlsVariant[] = [];
  const segments: string[] = [];
  let init: string | undefined;
  let pending = { bandwidth: 0, height: 0, codecs: "", audioGroup: "" };
  let expectSeg = false;
  for (const line of lines) {
    if (!line) continue;
    const media = line.match(/^#EXT-X-MEDIA:(.*)/i);
    if (media) {
      const attrs = media[1] ?? "";
      if (/TYPE=AUDIO/i.test(attrs)) {
        const uri = /URI="([^"]+)"/i.exec(attrs)?.[1];
        if (uri) {
          master.push({
            url: new URL(uri, base).href,
            bandwidth: 0,
            height: 0,
            codecs: /CODECS="([^"]+)"/i.exec(attrs)?.[1] ?? "mp4a",
            audioGroup: /GROUP-ID="([^"]+)"/i.exec(attrs)?.[1] ?? "",
            hasAudio: true,
            hasVideo: false,
          });
        }
      }
      continue;
    }
    const stream = line.match(/^#EXT-X-STREAM-INF:(.*)/i);
    if (stream) {
      const attrs = stream[1] ?? "";
      const codecs = /CODECS="([^"]+)"/i.exec(attrs)?.[1] ?? "";
      pending = {
        bandwidth: Number(/BANDWIDTH=(\d+)/i.exec(attrs)?.[1] ?? 0),
        height: Number(/RESOLUTION=\d+x(\d+)/i.exec(attrs)?.[1] ?? 0),
        codecs,
        audioGroup: /AUDIO="([^"]+)"/i.exec(attrs)?.[1] ?? "",
      };
      continue;
    }
    const map = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/i);
    if (map?.[1]) {
      init = new URL(map[1], base).href;
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      expectSeg = true;
      continue;
    }
    if (line.startsWith("#")) continue;
    const abs = new URL(line, base).href;
    if (pending.bandwidth || pending.height || pending.codecs) {
      const flags = codecFlags(pending.codecs);
      master.push({
        url: abs,
        bandwidth: pending.bandwidth,
        height: pending.height,
        codecs: pending.codecs,
        audioGroup: pending.audioGroup,
        hasAudio: flags.hasAudio,
        hasVideo: flags.hasVideo || pending.height > 0,
      });
      pending = { bandwidth: 0, height: 0, codecs: "", audioGroup: "" };
      continue;
    }
    if (expectSeg || /\.(ts|m4s|mp4)(\?|$)/i.test(line)) {
      segments.push(abs);
      expectSeg = false;
    }
  }
  master.sort((a, b) => b.bandwidth - a.bandwidth);
  return { master, media: { init, segments, bandwidth: 0 } };
}

/** Prefer muxed ~1080p. Highest bandwidth is often 4K and a wasteful HLS stitch. */
export function pickHlsVariant(master: HlsVariant[], preferHeight = 1080): string | null {
  const muxed = master.filter((v) => v.hasVideo && v.hasAudio);
  const video = master.filter((v) => v.hasVideo);
  const pool = muxed.length ? muxed : video.length ? video : [];
  if (!pool.length) return null;
  const ranked = [...pool].sort((a, b) => {
    const da = Math.abs((a.height || 0) - preferHeight);
    const db = Math.abs((b.height || 0) - preferHeight);
    if (a.height && b.height && da !== db) return da - db;
    if (a.height && !b.height) return -1;
    if (!a.height && b.height) return 1;
    return b.bandwidth - a.bandwidth;
  });
  return ranked[0]?.url ?? null;
}
