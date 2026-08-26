/**
 * Reverse-engineered googlevideo /videoplayback locks (2026).
 *
 * YouTube does not publish these. They are reconstructed from player.js,
 * InnerTube player JSON, and youtubei.js’s decipher pipeline:
 *
 * 1. ip        Bound to the TCP IP that requested the player JSON.
 * 2. sig / s   HMAC over `sparams`. `s` in signatureCipher is scrambled;
 *              player.js Swap/Splice/Reverse restores `sig` (or `sp`).
 * 3. n         Throttle token. Untouched `n` caps the stream ~40 KB/s.
 *              player.js nsig() transforms it. Cached per response.
 * 4. lsig      HMAC over `lsparams` (CDN locational: mn, mm, mh, ms…).
 * 5. pot       Proof-of-origin (BotGuard WebPO). Required unless sabr=1.
 * 6. expire    Unix seconds, typically ~6h.
 * 7. sabr      Server ABR. Progressive URL is a stub; bytes are protobuf.
 * 8. alr       Keepalive redirector. Browsers follow it off-proxy and 403.
 * 9. c / cver  InnerTube client that minted the URL. Mismatch → 403.
 * 10. cpn      Client playback nonce. Ties ranges to one session.
 */
export type StreamLock =
  | "ip"
  | "sig"
  | "nsig"
  | "lsig"
  | "pot"
  | "expire"
  | "sabr"
  | "alr"
  | "client";

export type StreamReport = {
  host: string;
  itag: number | null;
  client: string | null;
  ip: string | null;
  expiresAt: number | null;
  expired: boolean;
  sabr: boolean;
  locks: StreamLock[];
};

const CLIENT_VER: Record<string, string> = {
  WEB: "2.20260708.00.00",
  MWEB: "2.20260708.05.00",
  ANDROID: "21.26.364",
  ANDROID_VR: "1.65.10",
  WEB_REMIX: "1.20260707.12.00",
  WEB_KIDS: "2.20260708.00.00",
  TVHTML5: "7.20260707.07.00",
  TVHTML5_SIMPLY: "1.0",
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: "2.0",
  WEB_EMBEDDED_PLAYER: "1.20260206.01.00",
  WEB_EMBEDDED: "1.20260206.01.00",
  WEB_CREATOR: "1.20260708.06.00",
  IOS: "21.26.4",
};

export function parsePlaybackUrl(raw: string): URL | null {
  try {
    const absolute = /^https?:\/\//i.test(raw);
    const args = new URLSearchParams(absolute ? new URL(raw).search : raw);
    const nested = args.get("url");
    // A signatureCipher blob is `s=…&sp=…&url=…`, where the real playback URL is
    // the nested `url`. Require an actual signature param alongside it: keying
    // off a bare `&url=http` also matched a legitimate absolute URL that merely
    // carries a `url=` query param, silently resolving to that other host.
    const isCipher =
      raw.includes("signatureCipher") || args.has("s") || args.has("sp") || args.has("sig");
    if (nested && isCipher) return new URL(nested);
    return new URL(raw);
  } catch {
    return null;
  }
}

export function analyzeStreamUrl(raw: string, now = Date.now()): StreamReport {
  const url = parsePlaybackUrl(raw);
  if (!url) {
    return {
      host: "",
      itag: null,
      client: null,
      ip: null,
      expiresAt: null,
      expired: false,
      sabr: false,
      locks: [],
    };
  }
  const q = url.searchParams;
  const expire = Number(q.get("expire") || 0) || null;
  const locks: StreamLock[] = [];
  if (q.get("ip")) locks.push("ip");
  if (q.get("sig") || q.get("signature") || q.get("s")) locks.push("sig");
  if (q.get("n")) locks.push("nsig");
  if (q.get("lsig")) locks.push("lsig");
  if (q.get("pot")) locks.push("pot");
  if (expire) locks.push("expire");
  if (q.get("sabr") === "1") locks.push("sabr");
  if (q.get("alr")) locks.push("alr");
  if (q.get("c")) locks.push("client");
  return {
    host: url.hostname,
    itag: Number(q.get("itag") || 0) || null,
    client: q.get("c"),
    ip: q.get("ip"),
    expiresAt: expire,
    expired: Boolean(expire && expire * 1000 < now),
    sabr: q.get("sabr") === "1",
    locks,
  };
}

export type UnlockOpts = {
  pot?: string | null;
  cpn?: string | null;
  stripAlr?: boolean;
  ratebypass?: boolean;
};

export function isGvManifest(url: URL): boolean {
  const hay = `${url.pathname}?${url.search}`;
  return (
    /\/api\/manifest\/(hls[^/]*|dash)(\/|$)/i.test(url.pathname) ||
    /\.m3u8(?:[/?&]|$)/i.test(hay) ||
    /\.mpd(?:[/?&]|$)/i.test(hay) ||
    /(?:^|[?&/])file=index\.m3u8(?:&|$)/i.test(hay)
  );
}

function stripInventedCver(original: string, next: URL): URL {
  try {
    const orig = new URL(original);
    if (!orig.searchParams.has("cver")) next.searchParams.delete("cver");
    else next.searchParams.set("cver", orig.searchParams.get("cver")!);
  } catch {
    next.searchParams.delete("cver");
  }
  return next;
}

export function unlockStreamUrl(raw: string, opts: UnlockOpts = {}): { url: string; applied: string[] } {
  const url = parsePlaybackUrl(raw);
  if (!url) return { url: raw, applied: [] };
  if (isGvManifest(url)) {
    const cleaned = stripInventedCver(raw, url);
    return { url: cleaned.toString(), applied: [] };
  }
  const applied: string[] = [];
  const q = url.searchParams;

  if (opts.stripAlr !== false && q.has("alr")) {
    q.delete("alr");
    applied.push("drop-alr");
  }

  if (opts.pot && q.get("sabr") !== "1") {
    q.set("pot", opts.pot);
    q.set("potc", "1");
    applied.push("gvs-pot");
  } else if (opts.pot === null) {
    if (q.has("pot") || q.has("potc")) {
      q.delete("pot");
      q.delete("potc");
      applied.push("drop-pot");
    }
  }

  if (opts.cpn) {
    q.set("cpn", opts.cpn);
    applied.push("cpn");
  }

  if (opts.ratebypass !== false && q.get("ratebypass") !== "yes") {
    q.set("ratebypass", "yes");
    applied.push("ratebypass");
  }

  if (!q.get("rn")) {
    q.set("rn", "1");
    applied.push("rn");
  }

  if (q.get("gir") === "yes" && !q.get("keepalive")) {
    q.set("keepalive", "yes");
    applied.push("keepalive");
  }

  return { url: url.toString(), applied };
}

const CLIENT_NAME_IDS: Record<string, string> = {
  WEB: "1",
  MWEB: "2",
  ANDROID: "3",
  IOS: "5",
  TVHTML5: "7",
  WEB_EMBEDDED_PLAYER: "56",
  WEB_EMBEDDED: "56",
  WEB_CREATOR: "62",
  WEB_REMIX: "67",
  TVHTML5_SIMPLY: "74",
  WEB_KIDS: "76",
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: "85",
  TV_EMBEDDED: "85",
  TV_SIMPLY: "74",
  TV: "7",
  VISIONOS: "101",
};

function canonicalClient(name: string | null | undefined): string {
  const raw = (name || "WEB_EMBEDDED_PLAYER").toUpperCase().replace(/-/g, "_");
  if (raw === "WEB_EMBEDDED") return "WEB_EMBEDDED_PLAYER";
  if (raw === "TV" || raw === "TVHTML5") return "TVHTML5";
  if (raw === "TV_SIMPLY") return "TVHTML5_SIMPLY";
  if (raw === "TV_EMBEDDED") return "TVHTML5_SIMPLY_EMBEDDED_PLAYER";
  return raw;
}

export function playbackHeaders(
  videoId: string,
  client = "WEB_EMBEDDED_PLAYER",
  streamUrl?: string,
): Record<string, string> {
  const parsed = streamUrl ? parsePlaybackUrl(streamUrl) : null;
  const resolved = canonicalClient(parsed?.searchParams.get("c") || client);
  const version =
    parsed?.searchParams.get("cver") || CLIENT_VER[resolved] || CLIENT_VER.WEB_EMBEDDED_PLAYER;
  const name = CLIENT_NAME_IDS[resolved] ?? CLIENT_NAME_IDS.WEB_EMBEDDED_PLAYER ?? "56";
  return {
    accept: "*/*",
    origin: "https://www.youtube.com",
    referer: `https://www.youtube.com/watch?v=${videoId}`,
    "x-youtube-client-name": name,
    "x-youtube-client-version": version,
  };
}

export function unlockVariants(url: string, opts: UnlockOpts = {}): string[] {
  const withPot = unlockStreamUrl(url, opts).url;
  const noPot = unlockStreamUrl(url, { ...opts, pot: null }).url;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [withPot, noPot, url]) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

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

export function lockSummary(report: StreamReport): string {
  if (report.sabr) return "SABR stream — progressive URL is a stub.";
  if (report.expired) return "Stream URL expired. Fetch the video again.";
  const labels: Record<StreamLock, string> = {
    ip: "IP bind",
    sig: "s/sig",
    nsig: "n-throttle",
    lsig: "lsig",
    pot: "PO token",
    expire: "expiry",
    sabr: "SABR",
    alr: "alr redirect",
    client: report.client ?? "client",
  };
  return report.locks.map((lock) => labels[lock]).join(" · ");
}
