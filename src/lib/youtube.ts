const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^(PL|UU|OL|RD|FL)[a-zA-Z0-9_-]{10,}$/;

const HOSTS = new Set([
  "youtube.com",
  "music.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

function normalizeHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

export function cleanYoutubeInput(input: string): string {
  return input
    .trim()
    .replace(/^[\uFEFF\u200B\u200C\u200D]+/, "")
    .replace(/^['"`<[]+/, "")
    .replace(/['"`>\]]+$/, "")
    .trim();
}

function withProtocol(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes("youtube") || raw.includes("youtu.be")) return `https://${raw}`;
  return raw;
}

function asYoutubeUrl(raw: string): URL | null {
  try {
    const url = new URL(withProtocol(raw));
    const host = normalizeHost(url.hostname);
    if (!HOSTS.has(host) && !host.endsWith(".youtube.com")) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseVideoId(input: string): string | null {
  const raw = cleanYoutubeInput(input);
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  const url = asYoutubeUrl(raw);
  if (!url) return null;
  const host = normalizeHost(url.hostname);

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;

  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  const maybeId = parts[1];
  if (
    maybeId &&
    VIDEO_ID_RE.test(maybeId) &&
    (kind === "shorts" || kind === "embed" || kind === "live" || kind === "v" || kind === "watch")
  ) {
    return maybeId;
  }

  return null;
}

export function parsePlaylistId(input: string): string | null {
  const raw = cleanYoutubeInput(input);
  if (!raw) return null;
  if (PLAYLIST_ID_RE.test(raw)) return raw;

  const url = asYoutubeUrl(raw);
  if (!url) return null;
  const list = url.searchParams.get("list");
  if (!list) return null;
  if (list === "WL" || list === "LL") return null;
  if (PLAYLIST_ID_RE.test(list) || /^[a-zA-Z0-9_-]{13,80}$/.test(list)) return list;
  return null;
}

export function looksLikeYoutubeUrl(input: string): boolean {
  const raw = cleanYoutubeInput(input);
  if (!raw) return false;
  if (VIDEO_ID_RE.test(raw) || PLAYLIST_ID_RE.test(raw)) return true;
  return asYoutubeUrl(raw) !== null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) return null;
  const parts = cleaned.split(":").map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "Size varies";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const digits = n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export function formatViews(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return "";
  if (count < 1_000) return `${count} views`;
  for (const u of [
    { v: 1_000_000_000, s: "B" },
    { v: 1_000_000, s: "M" },
    { v: 1_000, s: "K" },
  ]) {
    if (count >= u.v) {
      const n = count / u.v;
      const digits = n >= 10 ? 0 : 1;
      return `${n.toFixed(digits)}${u.s} views`;
    }
  }
  return `${count} views`;
}

export function formatCompactCount(count: number | null | undefined, noun: string): string {
  if (count == null || !Number.isFinite(count)) return "";
  if (count < 1_000) return `${count} ${noun}`;
  for (const u of [
    { v: 1_000_000_000, s: "B" },
    { v: 1_000_000, s: "M" },
    { v: 1_000, s: "K" },
  ]) {
    if (count >= u.v) {
      const n = count / u.v;
      const digits = n >= 10 ? 0 : 1;
      return `${n.toFixed(digits)}${u.s} ${noun}`;
    }
  }
  return `${count} ${noun}`;
}

export function formatPublished(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function codecFromMime(mime: string): string | null {
  const match = mime.match(/codecs="?([a-z0-9.]+)"?/i);
  if (!match?.[1]) return null;
  const base = match[1].split(".")[0]?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    avc1: "H.264",
    avc3: "H.264",
    vp9: "VP9",
    vp09: "VP9",
    av01: "AV1",
    mp4a: "AAC",
    opus: "Opus",
    hev1: "H.265",
    hvc1: "H.265",
    vorbis: "Vorbis",
  };
  return names[base] ?? base.toUpperCase();
}

export type MediaKind = "av" | "audio" | "video";

export type PresetAvailability = "ready" | "muxed" | "hls" | "restricted";
export type StreamType = "direct" | "dash-mux" | "hls-stitch";

export type VideoFormat = {
  itag: number;
  kind: MediaKind;
  qualityLabel: string;
  height: number | null;
  fps: number | null;
  ext: string;
  mime: string;
  codec: string | null;
  bitrate: number;
  size: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  language: string | null;
  isOriginal: boolean;
  isDubbed: boolean;
  isAutoDubbed: boolean;
  isDescriptive: boolean;
  isSecondary: boolean;
};

export type VideoPreset = {
  id: string;
  itag: number;
  audioItag?: number;
  kind: MediaKind;
  title: string;
  hint: string;
  ext: string;
  codec: string | null;
  size: number | null;
  height: number | null;
  hasAudio: boolean;
  availability?: PresetAvailability;
  streamType?: StreamType;
  recommended?: boolean;
  statusLabel?: string;
};

export type QualitySummary = {
  maxResolution: string;
  totalQualities: number;
  hasFullHD: boolean;
  has4K: boolean;
  recommendedTitle: string;
  recommendedCodec: string;
  verified: boolean;
};

export type CaptionTrack = {
  languageCode: string;
  languageName: string;
  kind: "asr" | "manual";
  vssId: string;
};

export type ResolvedVideo = {
  id: string;
  title: string;
  author: string;
  authorUrl: string | null;
  duration: number | null;
  viewCount: number | null;
  likeCount: number | null;
  publishedAt: string | null;
  thumbnail: string;
  url: string;
  isLive: boolean;
  isUpcoming: boolean;
  description: string | null;
  formats: VideoFormat[];
  presets: VideoPreset[];
  captions: CaptionTrack[];
};

export type SearchHit = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number | null;
  views: string | null;
  published: string | null;
};

export type PlaylistResult = {
  id: string;
  title: string;
  author: string;
  thumbnail: string | null;
  total: string | null;
  items: SearchHit[];
};

export function captionsHref(id: string, languageCode: string, vssId: string): string {
  const params = new URLSearchParams({ id, lang: languageCode, vss: vssId });
  return `/api/captions?${params.toString()}`;
}

export function kindLabel(kind: MediaKind, willMerge = false): string {
  if (kind === "av" || willMerge) return "Audio + video";
  if (kind === "audio") return "Audio";
  return "Video only — no sound";
}

export function fileBasename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "video").slice(0, 120);
}

function preferContainer<T extends { ext: string; bitrate: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const extScore = (ext: string) => (ext === "mp4" || ext === "m4a" ? 1 : 0);
    const extDelta = extScore(b.ext) - extScore(a.ext);
    if (extDelta !== 0) return extDelta;
    return b.bitrate - a.bitrate;
  });
}

export function codecRank(codec: string | null | undefined): number {
  switch (codec) {
    case "AV1":
      return 4;
    case "VP9":
      return 3;
    case "H.265":
      return 2;
    case "H.264":
      return 1;
    default:
      return 0;
  }
}

function preferBestVideo(list: VideoFormat[]): VideoFormat[] {
  return [...list].sort((a, b) => {
    const height = (b.height ?? 0) - (a.height ?? 0);
    if (height !== 0) return height;
    const preferred = Number(b.itag === 137) - Number(a.itag === 137);
    if (preferred !== 0) return preferred;
    const codec = codecRank(b.codec) - codecRank(a.codec);
    if (codec !== 0) return codec;
    const fpsA = a.fps ?? 30;
    const fpsB = b.fps ?? 30;
    const fpsPenalty = Number(fpsB >= 50) - Number(fpsA >= 50);
    if (fpsPenalty !== 0) return fpsPenalty;
    return b.bitrate - a.bitrate;
  });
}

export function sortFormats(formats: VideoFormat[]): VideoFormat[] {
  const kindOrder: Record<MediaKind, number> = { av: 0, video: 1, audio: 2 };
  return [...formats].sort((a, b) => {
    const k = kindOrder[a.kind] - kindOrder[b.kind];
    if (k !== 0) return k;
    const h = (b.height ?? 0) - (a.height ?? 0);
    if (h !== 0) return h;
    const codec = codecRank(b.codec) - codecRank(a.codec);
    if (codec !== 0) return codec;
    return b.bitrate - a.bitrate;
  });
}

function presetHint(format: Pick<VideoFormat, "qualityLabel" | "ext" | "codec">, extra: string): string {
  const codec = format.codec ? ` · ${format.codec}` : "";
  return `${format.qualityLabel}${codec} · ${format.ext.toUpperCase()} · ${extra}`;
}

export function codecPlayHint(codec: string | null | undefined, ext: string): string {
  if (codec === "AV1") {
    return "AV1 is the same 1080p picture in 30–50% fewer bits than H.264. Chrome, VLC, IINA, and Windows 10 (1909+) play it. If a player refuses the file, use Full HD — that is H.264.";
  }
  if (codec === "VP9") {
    return "VP9 is YouTube’s WebM codec: smaller than H.264, a bit larger than AV1. Chrome, Android, and VLC play it. Full HD is H.264 MP4 if you need that.";
  }
  if (codec === "H.265") {
    return "H.265 / HEVC is efficient but picky. Recent iPhones, Apple TV, and VLC play it. Full HD is H.264 if you need to share the file.";
  }
  if (codec === "H.264") {
    return "H.264 (AVC) is the 1080p file that plays on phones, TVs, and editors. It is larger than AV1 at the same resolution — AV1 is the smaller extra, not a sharper picture.";
  }
  return ext === "webm"
    ? "WebM plays in VLC and Chrome. Use Full HD if you need MP4."
    : "Open the file in VLC if your default player can’t read it.";
}

export const H264_VS_AV1 =
  "Same 1080p picture: AV1 is typically 30–50% smaller than H.264. H.264 spends more bits so the file opens everywhere. Full HD Save uses H.264; pick AV1 only if you want the smaller copy.";

export const HLS_EXPLAIN =
  "HLS fallback: if DASH 137 is SABR or 403, Save stitches YouTube’s itag 96 playlist (~5s MPEG-TS chunks) on the same hop. The master playlist’s 1080p variant is used — not 4K.";

export const ABORT_EXPLAIN =
  "AbortController: the first path that returns a real file wins. Close, a new Save, or a race winner aborts the rest so SOCKS and guest quota are not spent twice.";

export const FORMAT_PRIORITY = [
  { id: "137", label: "1080p H.264 + AAC", detail: "DASH 137+140 — default" },
  { id: "96", label: "HLS 1080p stitch", detail: "itag 96 if DASH is blocked" },
  { id: "22", label: "720p muxed H.264", detail: "no 1080p on this upload" },
  { id: "18", label: "360p muxed H.264", detail: "last resort" },
] as const;

export const SAVE_MECHANICS = [
  { name: "AbortController", detail: "Winner / Close kills every other fetch." },
  { name: "HLS fallback", detail: "Stitch itag 96 TS chunks when 137 is SABR or 403." },
  { name: "nsig", detail: "player.js transforms n= or the CDN crawls at ~40 KB/s." },
  { name: "BotGuard", detail: "player and GVS tokens bound to the video id." },
  { name: "IMA SDK", detail: "Ad player (ima3.js). Never loaded; DoubleClick/DAI dropped." },
  { name: "IPv4 pin", detail: "Direct hops stay on IPv4 so player and file share one family." },
] as const;

/** Product copy for mixed IPv6 player / IPv4 CDN 403s. */
export const IPV6_TROUBLESHOOT = [
  {
    q: "Why does Full HD 403 while 360p works?",
    a: "YouTube signs the file to the IP that asked for it. If the player left on IPv6 and the file hop used IPv4 (or the other way around), the CDN refuses. 360p often sits on a muxed hop that already matches.",
  },
  {
    q: "What does Save do about it?",
    a: "Direct hops pin IPv4. Matching hops (SOCKS) carry both the player and the file so YouTube sees one address. We never force IPv4 through a tunnel — the hop owns the family.",
  },
  {
    q: "Still blocked?",
    a: "Wait a moment and hit Save again — the next hop is a different path. Compatible 360p is the same hop without a PO token if 1080p keeps failing.",
  },
] as const;

export function matchAudioTrack(video: VideoFormat, formats: VideoFormat[]): VideoFormat | null {
  const audios = formats.filter((f) => f.kind === "audio");
  if (!audios.length) return null;

  const score = (a: VideoFormat) => {
    let n = a.bitrate / 1_000_000;
    if (a.isOriginal) n += 50;
    if (a.isAutoDubbed) n -= 80;
    if (a.isDubbed) n -= 40;
    if (a.isDescriptive) n -= 30;
    if (a.isSecondary) n -= 20;
    const wantWebm = video.ext === "webm" || video.codec === "VP9";
    if (wantWebm && (a.ext === "webm" || a.codec === "Opus")) n += 8;
    if (!wantWebm && (a.ext === "m4a" || a.codec === "AAC")) n += 8;
    return n;
  };

  return [...audios].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function mergedExt(video: VideoFormat): string {
  return video.ext === "webm" ? "webm" : "mp4";
}

export function sumSizes(...parts: { size: number | null }[]): number | null {
  const values = parts.map((p) => p.size).filter((n): n is number => n != null && n > 0);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

function inBand(height: number | null, min: number, max: number): boolean {
  const h = height ?? 0;
  return h >= min && h <= max;
}

function comparableSize(video: VideoFormat, formats: VideoFormat[]): number | null {
  if (video.kind === "av") return video.size;
  const audio = matchAudioTrack(video, formats);
  return audio ? sumSizes(video, audio) : video.size;
}

function savingsPhrase(
  chosen: VideoFormat,
  formats: VideoFormat[],
  minH: number,
  maxH: number,
): string {
  if (chosen.codec === "H.264") return "audio + video";
  const baseline = preferBestVideo(
    formats.filter(
      (f) =>
        (f.kind === "video" || f.kind === "av") &&
        inBand(f.height, minH, maxH) &&
        f.codec === "H.264",
    ),
  )[0];
  if (!baseline) return "audio + video";
  const chosenSize = comparableSize(chosen, formats);
  const baseSize = comparableSize(baseline, formats);
  if (!chosenSize || !baseSize || chosenSize >= baseSize) return "audio + video";
  const percent = Math.round((1 - chosenSize / baseSize) * 100);
  if (percent < 8) return "audio + video";
  return `${percent}% smaller than H.264`;
}

function pickMergedPreset(
  formats: VideoFormat[],
  id: string,
  titleFor: (height: number | null) => string,
  minH: number,
  maxH: number,
  wantCodec?: string,
): VideoPreset | null {
  const matchCodec = (f: VideoFormat) => !wantCodec || f.codec === wantCodec;
  const extraFor = (video: VideoFormat) =>
    wantCodec === "H.264" ? "plays everywhere" : savingsPhrase(video, formats, minH, maxH);

  const muxed = preferBestVideo(
    formats.filter((f) => f.kind === "av" && inBand(f.height, minH, maxH) && matchCodec(f)),
  )[0];
  if (muxed) {
    const isHls = muxed.itag === 96 || muxed.mime?.includes("m3u8") || muxed.ext === "m3u8";
    return {
      id,
      itag: muxed.itag,
      kind: "av",
      title: titleFor(muxed.height),
      hint: presetHint(muxed, extraFor(muxed)),
      ext: muxed.ext,
      codec: muxed.codec,
      size: muxed.size,
      height: muxed.height,
      hasAudio: true,
      availability: isHls ? "hls" : "ready",
      streamType: isHls ? "hls-stitch" : "direct",
      recommended: false,
    };
  }

  const videos = preferBestVideo(
    formats.filter((f) => f.kind === "video" && inBand(f.height, minH, maxH) && matchCodec(f)),
  );

  for (const video of videos) {
    const audio = matchAudioTrack(video, formats);
    if (!audio) continue;
    const ext = mergedExt(video);
    const isHls = video.itag === 96 || video.mime?.includes("m3u8");
    return {
      id,
      itag: video.itag,
      audioItag: audio.itag,
      kind: "av",
      title: titleFor(video.height),
      hint: presetHint({ ...video, ext }, extraFor(video)),
      ext,
      codec: video.codec,
      size: sumSizes(video, audio),
      height: video.height,
      hasAudio: true,
      availability: isHls ? "hls" : "muxed",
      streamType: isHls ? "hls-stitch" : "dash-mux",
      recommended: false,
    };
  }

  return null;
}

export type CodecSize = {
  codec: string;
  ext: string;
  itag: number;
  audioItag?: number;
  size: number | null;
  qualityLabel: string;
  height: number | null;
  vsH264: number | null;
};

const COMPARE_CODECS = ["AV1", "VP9", "H.265", "H.264"] as const;

export function codecSizes(formats: VideoFormat[], minH: number, maxH: number): CodecSize[] {
  const rows: CodecSize[] = [];
  for (const codec of COMPARE_CODECS) {
    const preset = pickMergedPreset(formats, "cmp", () => codec, minH, maxH, codec);
    if (!preset) continue;
    const video = formats.find((f) => f.itag === preset.itag);
    rows.push({
      codec,
      ext: preset.ext,
      itag: preset.itag,
      audioItag: preset.audioItag,
      size: preset.size,
      qualityLabel: video?.qualityLabel ?? `${preset.height ?? minH}p`,
      height: preset.height,
      vsH264: null,
    });
  }
  const baseline = rows.find((row) => row.codec === "H.264")?.size;
  return rows.map((row) => {
    if (row.codec === "H.264" || row.size == null || baseline == null || baseline <= 0) return row;
    const percent = Math.round((1 - row.size / baseline) * 100);
    return { ...row, vsH264: percent };
  });
}

export function pickBestPreset(presets: VideoPreset[]): VideoPreset | null {
  const fullhd = presets.find((p) => p.id === "fullhd" && p.hasAudio);
  if (fullhd) return fullhd;
  const uhd = presets.find((p) => p.id === "uhd" && p.hasAudio);
  if (uhd) return uhd;
  const playable = presets.filter((p) => p.kind !== "audio" && p.hasAudio);
  return (
    [...playable].sort((a, b) => {
      const height = (b.height ?? 0) - (a.height ?? 0);
      if (height !== 0) return height;
      const fpsBias = Number((a.hint ?? "").includes("60")) - Number((b.hint ?? "").includes("60"));
      if (fpsBias !== 0) return fpsBias;
      const h264 = Number(b.codec === "H.264") - Number(a.codec === "H.264");
      if (h264 !== 0) return h264;
      return (b.size ?? 0) - (a.size ?? 0);
    })[0] ??
    presets[0] ??
    null
  );
}
export function pickMuxedFallback(presets: VideoPreset[], failed?: VideoPreset | null): VideoPreset | null {
  const muxed = presets.filter((p) => p.kind === "av" && !p.audioItag && p.hasAudio);
  const ranked = [...muxed].sort((a, b) => {
    const codec = Number(b.codec === "H.264") - Number(a.codec === "H.264");
    if (codec !== 0) return codec;
    return (b.height ?? 0) - (a.height ?? 0);
  });
  return ranked.find((p) => p.itag !== failed?.itag) ?? null;
}

function pickWorking1080(formats: VideoFormat[]): VideoPreset | null {
  const dash = formats.find((f) => f.itag === 137);
  const aac =
    formats.find((f) => f.itag === 140 && f.kind === "audio") ??
    formats.find((f) => f.kind === "audio" && (f.codec === "AAC" || f.ext === "m4a"));
  const opus =
    formats.find((f) => f.itag === 251 && f.kind === "audio") ??
    formats.find((f) => f.kind === "audio" && f.codec === "Opus");
  if (dash && aac) {
    return {
      id: "fullhd",
      itag: 137,
      audioItag: aac.itag,
      kind: "av",
      title: "Full HD",
      hint: presetHint(dash, "plays everywhere"),
      ext: "mp4",
      codec: dash.codec ?? "H.264",
      size: sumSizes(dash, aac),
      height: dash.height ?? 1080,
      hasAudio: true,
      availability: "muxed",
      streamType: "dash-mux",
      recommended: true,
    };
  }
  if (dash && opus) {
    return {
      id: "fullhd",
      itag: 137,
      audioItag: opus.itag,
      kind: "av",
      title: "Full HD",
      hint: presetHint(dash, "H.264 + Opus"),
      ext: "mkv",
      codec: dash.codec ?? "H.264",
      size: sumSizes(dash, opus),
      height: dash.height ?? 1080,
      hasAudio: true,
      availability: "muxed",
      streamType: "dash-mux",
      recommended: true,
    };
  }
  const hls = formats.find(
    (f) => f.itag === 96 && f.hasAudio && f.hasVideo && (f.height ?? 0) >= 1080,
  );
  if (hls) {
    return {
      id: "fullhd",
      itag: 96,
      kind: "av",
      title: "Full HD",
      hint: presetHint(hls, "HLS stitch"),
      ext: "mp4",
      codec: hls.codec ?? "H.264",
      size: hls.size,
      height: hls.height ?? 1080,
      hasAudio: true,
      availability: "hls",
      streamType: "hls-stitch",
      recommended: true,
    };
  }
  const muxed720 = formats.find((f) => f.itag === 22 && f.kind === "av" && f.hasAudio);
  if (muxed720) {
    return {
      id: "fullhd",
      itag: 22,
      kind: "av",
      title: "HD",
      hint: presetHint(muxed720, "muxed 720p"),
      ext: muxed720.ext,
      codec: muxed720.codec,
      size: muxed720.size,
      height: muxed720.height ?? 720,
      hasAudio: true,
      availability: "ready",
      streamType: "direct",
      recommended: true,
    };
  }
  return null;
}

export function pickWorking1080Preset(formats: VideoFormat[]): VideoPreset | null {
  return pickWorking1080(formats);
}

export function buildPresets(formats: VideoFormat[]): VideoPreset[] {
  const muxed = preferContainer(formats.filter((f) => f.kind === "av"));
  const audio = preferContainer(formats.filter((f) => f.kind === "audio"));

  const presets: VideoPreset[] = [];
  const used = new Set<string>();

  const push = (preset: VideoPreset) => {
    const key = `${preset.itag}:${preset.audioItag ?? 0}`;
    if (used.has(key) || used.has(String(preset.itag))) return;
    used.add(key);
    used.add(String(preset.itag));
    presets.push(preset);
  };

  const quick = [...muxed].sort((a, b) => {
    const sizeA = a.size ?? Number.POSITIVE_INFINITY;
    const sizeB = b.size ?? Number.POSITIVE_INFINITY;
    if (sizeA !== sizeB) return sizeA - sizeB;
    const extScore = (ext: string) => (ext === "mp4" || ext === "m4a" ? 1 : 0);
    const extDelta = extScore(b.ext) - extScore(a.ext);
    if (extDelta !== 0) return extDelta;
    return a.bitrate - b.bitrate;
  })[0];

  const best = [...muxed].sort((a, b) => {
    const h = (b.height ?? 0) - (a.height ?? 0);
    if (h !== 0) return h;
    const extScore = (ext: string) => (ext === "mp4" || ext === "m4a" ? 1 : 0);
    const extDelta = extScore(b.ext) - extScore(a.ext);
    if (extDelta !== 0) return extDelta;
    return b.bitrate - a.bitrate;
  })[0];

  if (quick) {
    const isHls = quick.itag === 96 || quick.mime?.includes("m3u8") || quick.ext === "m3u8";
    push({
      id: "quick",
      itag: quick.itag,
      kind: "av",
      title: "Quick",
      hint: presetHint(quick, "audio + video"),
      ext: quick.ext,
      codec: quick.codec,
      size: quick.size,
      height: quick.height,
      hasAudio: true,
      availability: isHls ? "hls" : "ready",
      streamType: isHls ? "hls-stitch" : "direct",
      recommended: false,
    });
  }

  if (best && best.itag !== quick?.itag && (best.height ?? 0) < 480) {
    const title = "Best";
    const isHls = best.itag === 96 || best.mime?.includes("m3u8") || best.ext === "m3u8";
    push({
      id: "best",
      itag: best.itag,
      kind: "av",
      title,
      hint: presetHint(best, "audio + video"),
      ext: best.ext,
      codec: best.codec,
      size: best.size,
      height: best.height,
      hasAudio: true,
      availability: isHls ? "hls" : "ready",
      streamType: isHls ? "hls-stitch" : "direct",
      recommended: false,
    });
  }

  const sd = pickMergedPreset(formats, "sd", () => "480p", 480, 719, "H.264") ?? pickMergedPreset(formats, "sd", () => "480p", 480, 719);
  if (sd) push(sd);

  const hd = pickMergedPreset(formats, "hd", () => "HD", 720, 1079, "H.264") ?? pickMergedPreset(formats, "hd", () => "HD", 720, 1079);
  if (hd) push(hd);

  const fullhd = pickWorking1080(formats);
  if (fullhd) push(fullhd);

  const uhd = pickMergedPreset(
    formats,
    "uhd",
    (height) => ((height ?? 0) >= 2160 ? "4K" : "QHD"),
    1440,
    4320,
  );
  if (uhd) push(uhd);

  if (fullhd?.codec && fullhd.codec !== "AV1") {
    const av1 = pickMergedPreset(formats, "av1", () => "AV1", 1080, 1439, "AV1");
    if (av1) push(av1);
  }

  if (fullhd?.codec && fullhd.codec !== "VP9") {
    const vp9 = pickMergedPreset(formats, "vp9", () => "VP9", 1080, 1439, "VP9");
    if (vp9) push(vp9);
  }

  if (fullhd?.codec && fullhd.codec !== "H.264") {
    const compat = pickMergedPreset(
      formats,
      "compat",
      () => "Compatible",
      1080,
      1439,
      "H.264",
    );
    if (compat) push(compat);
  }

  const bestAudio = audio[0];
  if (bestAudio) {
    push({
      id: "audio",
      itag: bestAudio.itag,
      kind: "audio",
      title: "Audio",
      hint: `${bestAudio.qualityLabel}${bestAudio.codec ? ` · ${bestAudio.codec}` : ""} · ${bestAudio.ext.toUpperCase()} · no video`,
      ext: bestAudio.ext,
      codec: bestAudio.codec,
      size: bestAudio.size,
      height: null,
      hasAudio: true,
      availability: "ready",
      streamType: "direct",
      recommended: false,
    });
  }

  const optimal = pickBestPreset(presets);
  if (optimal) {
    for (const p of presets) {
      p.recommended = p === optimal || (p.id === optimal.id && p.itag === optimal.itag);
    }
  }

  return presets;
}

export function summarizeQualities(presets: VideoPreset[]): QualitySummary {
  const maxH = Math.max(0, ...presets.map((p) => p.height ?? 0));
  const fullhd = presets.find((p) => p.id === "fullhd" || (p.height ?? 0) >= 1080);
  const uhd = presets.find((p) => p.id === "uhd" || (p.height ?? 0) >= 2160);
  const best = pickBestPreset(presets);
  return {
    maxResolution:
      maxH >= 2160
        ? "4K UHD"
        : maxH >= 1440
          ? "1440p QHD"
          : maxH >= 1080
            ? "1080p Full HD"
            : maxH > 0
              ? `${maxH}p HD`
              : "Standard",
    totalQualities: presets.length,
    hasFullHD: Boolean(fullhd),
    has4K: Boolean(uhd),
    recommendedTitle: best?.title ?? "Full HD",
    recommendedCodec: best?.codec ?? "H.264",
    verified: true,
  };
}

