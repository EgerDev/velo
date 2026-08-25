import { Innertube, Platform } from "youtubei.js";
import "@/lib/ipv4-bind.server";
import type {
  CaptionTrack,
  ResolvedVideo,
  SearchHit,
  PlaylistResult,
  VideoFormat,
  MediaKind,
} from "@/lib/youtube";
import { nsigCache, nsigCacheLookup, nsigReport, readNParam, rememberNsig } from "@/lib/nsig";
import {
  buildPresets,
  codecFromMime,
  parseClock,
  parsePlaylistId,
  parseVideoId,
  youtubeWatchUrl,
} from "@/lib/youtube";

Platform.shim.eval = (data) => new Function(data.output)();

const STREAM_HEADERS = {
  accept: "*/*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  referer: "https://www.youtube.com/",
} as const;

/** youtubei.js InnerTube clients. ANDROID_VR omitted (GVS 403). TV_EMBEDDED / IOS / VISIONOS / music-studio are not in yt-dlp. */
const CLIENTS = [
  "WEB_EMBEDDED",
  "TV_EMBEDDED",
  "TV_SIMPLY",
  "VISIONOS",
  "IOS",
  "MWEB",
  "TV",
  "YTMUSIC",
  "YTMUSIC_ANDROID",
  "YTSTUDIO_ANDROID",
  "YTKIDS",
  "WEB_CREATOR",
  "ANDROID",
  "WEB",
] as const;

type InnertubeClient = Awaited<ReturnType<typeof Innertube.create>>;

let clientPromise: Promise<InnertubeClient> | null = null;
let clientCreatedAt = 0;
const CLIENT_TTL_MS = 4 * 60 * 60 * 1000;

async function getClient(): Promise<InnertubeClient> {
  if (!clientPromise || Date.now() - clientCreatedAt > CLIENT_TTL_MS) {
    clientCreatedAt = Date.now();
    clientPromise = Innertube.create({
      lang: "en",
      location: "US",
      retrieve_player: true,
      enable_session_cache: true,
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

function containerExt(mime: string, hasVideo: boolean): string {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/webm") return "webm";
  if (type === "video/mp4") return hasVideo ? "mp4" : "m4a";
  if (type === "video/webm") return "webm";
  if (type.includes("mp4")) return hasVideo ? "mp4" : "m4a";
  if (type.includes("webm")) return "webm";
  return "mp4";
}

function heightFromLabel(label: string | undefined, height?: number): number | null {
  if (typeof height === "number" && height > 0) return height;
  const match = label?.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : null;
}

function formatLabel(opts: {
  qualityLabel?: string;
  quality?: string;
  audioQuality?: string;
  height: number | null;
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}): string {
  if (opts.hasVideo && opts.qualityLabel) return opts.qualityLabel;
  if (opts.hasVideo && opts.height) {
    return opts.fps && opts.fps >= 50 ? `${opts.height}p${opts.fps}` : `${opts.height}p`;
  }
  if (!opts.hasVideo && opts.hasAudio) {
    if (opts.audioQuality?.includes("HIGH")) return "High";
    if (opts.audioQuality?.includes("MEDIUM")) return "Medium";
    if (opts.audioQuality?.includes("LOW")) return "Low";
    return "Audio";
  }
  return opts.qualityLabel || opts.quality || "Original";
}

type RawFormat = {
  itag: number;
  mime_type: string;
  quality_label?: string;
  quality?: string;
  audio_quality?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate: number;
  average_bitrate?: number;
  content_length?: number;
  has_audio: boolean;
  has_video: boolean;
  is_type_otf?: boolean;
  drm_families?: string[];
  language?: string | null;
  is_dubbed?: boolean;
  is_auto_dubbed?: boolean;
  is_original?: boolean;
  is_descriptive?: boolean;
  is_secondary?: boolean;
  audio_track?: { audio_is_default?: boolean; display_name?: string; id?: string };
};

function toFormat(raw: RawFormat): VideoFormat | null {
  if (raw.is_type_otf) return null;
  if (raw.drm_families && raw.drm_families.length > 0) return null;
  if (!raw.has_audio && !raw.has_video) return null;
  const hasAudio = raw.has_audio;
  const hasVideo = raw.has_video;
  const kind: MediaKind = hasAudio && hasVideo ? "av" : hasAudio ? "audio" : "video";
  const height = heightFromLabel(raw.quality_label, raw.height);
  return {
    itag: raw.itag,
    kind,
    qualityLabel: formatLabel({
      qualityLabel: raw.quality_label,
      quality: raw.quality,
      audioQuality: raw.audio_quality,
      height,
      fps: raw.fps ?? null,
      hasVideo,
      hasAudio,
    }),
    width: raw.width ?? null,
    height,
    fps: raw.fps ?? null,
    ext: containerExt(raw.mime_type, hasVideo),
    mime: raw.mime_type.split(";")[0]?.trim() || "application/octet-stream",
    codec: codecFromMime(raw.mime_type),
    bitrate: raw.average_bitrate || raw.bitrate || 0,
    size: raw.content_length ?? null,
    hasAudio,
    hasVideo,
    language: raw.language ?? null,
    isOriginal:
      raw.is_original === true ||
      raw.audio_track?.audio_is_default === true ||
      (raw.is_original !== false && !raw.is_dubbed && !raw.is_auto_dubbed && !raw.is_descriptive),
    isDubbed: raw.is_dubbed === true,
    isAutoDubbed: raw.is_auto_dubbed === true,
    isDescriptive: raw.is_descriptive === true,
    isSecondary: raw.is_secondary === true,
  };
}

function uniqueFormats(list: VideoFormat[]): VideoFormat[] {
  const seen = new Set<string>();
  const out: VideoFormat[] = [];
  for (const item of list) {
    const key = `${item.itag}:${item.kind}:${item.ext}:${item.language ?? ""}:${item.isAutoDubbed ? "adub" : item.isDubbed ? "dub" : "orig"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function pickThumbnail(
  thumbs: { url: string; width?: number }[] | undefined,
  videoId: string,
): string {
  if (thumbs?.length) {
    const sorted = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    if (sorted[0]?.url) return sorted[0].url;
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "object") {
    const record = value as { text?: unknown; toString?: () => string };
    if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
    if (typeof record.toString === "function") {
      const asString = record.toString();
      if (asString && asString !== "[object Object]") return asString;
    }
  }
  return null;
}

function durationOf(item: {
  duration?: unknown;
  length_text?: unknown;
}): number | null {
  const duration = item.duration;
  if (typeof duration === "number" && Number.isFinite(duration)) return duration;
  if (duration && typeof duration === "object") {
    const seconds = (duration as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && seconds > 0) return seconds;
    const asText = textOf(duration);
    const parsed = parseClock(asText);
    if (parsed != null) return parsed;
  }
  return parseClock(textOf(item.length_text));
}

type LooseVideo = {
  type?: string;
  video_id?: unknown;
  id?: unknown;
  content_id?: unknown;
  content_type?: string;
  title?: unknown;
  author?: { name?: string };
  thumbnails?: { url: string; width?: number }[];
  best_thumbnail?: { url?: string };
  duration?: unknown;
  length_text?: unknown;
  short_view_count?: unknown;
  view_count?: unknown;
  views?: unknown;
  published?: unknown;
  is_live?: boolean;
  is_upcoming?: boolean | (() => boolean);
  is_playable?: boolean;
  metadata?: {
    title?: unknown;
    metadata?: { metadata_rows?: { metadata_parts?: { text?: unknown }[] }[] };
  };
  content_image?: {
    image?: { url: string; width?: number }[];
    primary_thumbnail?: { image?: { url: string; width?: number }[] };
  };
};

function isLiveLike(item: LooseVideo): boolean {
  if (item.is_live) return true;
  if (typeof item.is_upcoming === "function") return Boolean(item.is_upcoming());
  return Boolean(item.is_upcoming);
}

function lockupThumbnail(item: LooseVideo): string | undefined {
  const image = item.content_image;
  const fromView = image?.image;
  const fromCollection = image?.primary_thumbnail?.image;
  const list = fromView ?? fromCollection;
  return list?.length ? pickThumbnail(list, "x") : undefined;
}

function lockupAuthor(item: LooseVideo): string | null {
  const rows = item.metadata?.metadata?.metadata_rows ?? [];
  for (const row of rows) {
    for (const part of row.metadata_parts ?? []) {
      const text = textOf(part.text);
      if (text) return text;
    }
  }
  return null;
}

export function toSearchHit(item: unknown): SearchHit | null {
  if (!item || typeof item !== "object") return null;
  const row = item as LooseVideo;
  const typeName = typeof row.type === "string" ? row.type : "";
  if (/comment/i.test(typeName)) return null;
  if (row.is_playable === false) return null;
  if (isLiveLike(row)) return null;

  let id: string | null = null;
  if (typeof row.video_id === "string") id = row.video_id;
  else if (typeof row.content_id === "string" && (row.content_type === "VIDEO" || row.content_type === "SHORT")) {
    id = row.content_id;
  } else if (typeof row.id === "string") id = row.id;
  if (!id || !parseVideoId(id)) return null;

  const title = textOf(row.metadata?.title) || textOf(row.title) || "YouTube video";
  if (/^view \d+ more replies$/i.test(title) || /^show more$/i.test(title)) return null;
  const author = row.author?.name?.trim() || lockupAuthor(row) || "YouTube";
  const thumbnail =
    row.best_thumbnail?.url ||
    (row.thumbnails?.length ? pickThumbnail(row.thumbnails, id) : undefined) ||
    lockupThumbnail(row) ||
    pickThumbnail(undefined, id);
  const views =
    textOf(row.short_view_count) ||
    textOf(row.view_count) ||
    textOf(row.views);

  return {
    id,
    title,
    author,
    thumbnail,
    duration: durationOf(row),
    views,
    published: textOf(row.published),
  };
}

function uniqueHits(items: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

type PlayableInfo = Awaited<ReturnType<InnertubeClient["getBasicInfo"]>>;

const PLAYABLE_TTL_MS = 10 * 60_000;
const MAX_PLAYABLE_CACHE = 200;
const playableCache = new Map<string, { value: PlayableInfo; expires: number }>();
const playableInflight = new Map<string, Promise<PlayableInfo>>();

function evictPlayableCache() {
  if (playableCache.size <= MAX_PLAYABLE_CACHE) return;
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of playableCache) {
    if (entry.expires <= now) playableCache.delete(key);
  }
  // Second pass: remove oldest if still over limit
  if (playableCache.size > MAX_PLAYABLE_CACHE) {
    const sorted = [...playableCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = sorted.slice(0, playableCache.size - MAX_PLAYABLE_CACHE);
    for (const [key] of toRemove) playableCache.delete(key);
  }
}

const WEBPO_INNERTUBE = new Set([
  "WEB_EMBEDDED",
  "TV_EMBEDDED",
  "TV_SIMPLY",
  "MWEB",
  "TV",
  "YTMUSIC",
  "YTKIDS",
  "WEB_CREATOR",
  "WEB",
]);

async function getPlayableInfo(yt: InnertubeClient, id: string): Promise<PlayableInfo> {
  const hit = playableCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  let shared = playableInflight.get(id);
  if (!shared) {
    shared = getPlayableInfoUncached(yt, id).finally(() => {
      if (playableInflight.get(id) === shared) playableInflight.delete(id);
    });
    playableInflight.set(id, shared);
  }
  return shared;
}

async function getPlayableInfoUncached(yt: InnertubeClient, id: string): Promise<PlayableInfo> {
  let lastError: Error | null = null;
  let fallback: PlayableInfo | null = null;
  let gvsPot: string | undefined;
  try {
    const { mintContentPoToken } = await import("@/lib/po-token.server");
    gvsPot = (await mintContentPoToken(id)) || undefined;
  } catch {
    /* BotGuard optional — Innertube still tries */
  }

  for (const client of CLIENTS) {
    try {
      const usePot = Boolean(gvsPot && WEBPO_INNERTUBE.has(client));
      const info = await yt.getBasicInfo(id, usePot ? { client, po_token: gvsPot } : { client });
      fallback = info;
      const status = info.playability_status?.status;
      const hasFormats = Boolean(
        info.streaming_data?.formats?.length || info.streaming_data?.adaptive_formats?.length,
      );
      if ((!status || status === "OK") && hasFormats) {
        playableCache.set(id, { value: info, expires: Date.now() + PLAYABLE_TTL_MS });
        evictPlayableCache();
        return info;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Could not reach YouTube.");
    }
  }

  if (fallback) {
    playableCache.set(id, { value: fallback, expires: Date.now() + PLAYABLE_TTL_MS });
    evictPlayableCache();
    return fallback;
  }
  throw lastError ?? new Error("Could not reach YouTube.");
}

function collectCaptions(info: PlayableInfo): CaptionTrack[] {
  const tracks = info.captions?.caption_tracks ?? [];
  const out: CaptionTrack[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const languageCode = track.language_code?.trim();
    const vssId = track.vss_id?.trim();
    if (!languageCode || !vssId) continue;
    const key = `${languageCode}:${vssId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const languageName = track.name?.text?.trim() || languageCode;
    out.push({
      languageCode,
      languageName,
      kind: track.kind === "asr" ? "asr" : "manual",
      vssId,
    });
  }
  return out;
}

export async function resolveYoutubeVideo(input: string): Promise<ResolvedVideo> {
  const id = parseVideoId(input);
  if (!id) {
    throw new Error("Paste a valid YouTube link or 11-character video ID.");
  }

  const yt = await getClient();
  let info: PlayableInfo;
  try {
    info = await getPlayableInfo(yt, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach YouTube.";
    throw new Error(message.replace(/^InnertubeError:\s*/i, ""));
  }
  const basic = info.basic_info;
  const status = info.playability_status?.status;

  if (basic.is_live) {
    throw new Error("Live streams can’t be saved until they end.");
  }
  if (basic.is_upcoming) {
    throw new Error("This premiere hasn’t started yet.");
  }
  if (status && status !== "OK") {
    const reason = info.playability_status?.reason?.trim();
    throw new Error(reason || "YouTube won’t play this video.");
  }

  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const formats = uniqueFormats(
    raw.map((f) => toFormat(f as unknown as RawFormat)).filter((f): f is VideoFormat => f !== null),
  );
  const has1080 = formats.some((item) => (item.height ?? 0) >= 1080);
  if (!has1080) {
    try {
      const { listYtdlpFormats } = await import("@/lib/ytdlp.server");
      const extra = await listYtdlpFormats(id);
      if (extra.length) formats.push(...extra);
    } catch {
      /* keep Innertube list */
    }
  }
  const merged = uniqueFormats(formats);
  const presets = buildPresets(merged);

  if (!presets.length) {
    throw new Error("No downloadable formats were returned for this video.");
  }

  const title = basic.title?.trim() || "YouTube video";
  const author = basic.author?.trim() || basic.channel?.name?.trim() || "Unknown channel";
  const publishedAt =
    basic.start_timestamp instanceof Date && !Number.isNaN(basic.start_timestamp.getTime())
      ? basic.start_timestamp.toISOString()
      : null;

  const isShort = Boolean(
    (typeof basic.duration === "number" && basic.duration > 0 && basic.duration <= 180 && merged.some((f) => f.width && f.height && f.width < f.height)) ||
    (typeof (basic as Record<string, unknown>).is_short === "boolean" && (basic as Record<string, unknown>).is_short) ||
    (typeof (basic as Record<string, unknown>).is_shorts === "boolean" && (basic as Record<string, unknown>).is_shorts) ||
    (typeof basic.duration === "number" && basic.duration > 0 && basic.duration <= 70 && !merged.some((f) => (f.height ?? 0) > 1080 && (f.width ?? 0) > (f.height ?? 0)))
  );

  return {
    id: basic.id || id,
    title,
    author,
    authorUrl: basic.channel?.url ?? null,
    duration: typeof basic.duration === "number" ? basic.duration : null,
    viewCount: typeof basic.view_count === "number" ? basic.view_count : null,
    likeCount: typeof basic.like_count === "number" ? basic.like_count : null,
    publishedAt,
    thumbnail: pickThumbnail(basic.thumbnail, id),
    url: youtubeWatchUrl(id),
    isLive: Boolean(basic.is_live),
    isUpcoming: Boolean(basic.is_upcoming),
    isShort,
    description: basic.short_description?.trim() || null,
    formats: merged,
    presets,
    captions: collectCaptions(info),
  };
}

export async function resolveBulkMetadata(
  ids: string[],
): Promise<Array<{ id: string; ok: boolean; video?: ResolvedVideo; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; video?: ResolvedVideo; error?: string }> = [];
  const chunkSize = 3;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (id) => {
      try {
        const video = await resolveYoutubeVideo(id);
        return { id, ok: true, video };
      } catch (err) {
        return {
          id,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to load video metadata.",
        };
      }
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    if (i + chunkSize < ids.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return results;
}

export async function searchYoutubeVideos(query: string): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Type something to search.");
  const yt = await getClient();
  const results = await yt.search(trimmed, { type: "video" });
  const hits = uniqueHits(
    [...results.videos]
      .map((item) => toSearchHit(item))
      .filter((item): item is SearchHit => item !== null),
  );
  return hits.slice(0, 24);
}

export async function resolveYoutubePlaylist(input: string): Promise<PlaylistResult> {
  const id = parsePlaylistId(input);
  if (!id) throw new Error("That doesn’t look like a playlist link.");
  const yt = await getClient();
  const playlist = await yt.getPlaylist(id);
  const items = uniqueHits(
    [...playlist.items]
      .map((item) => toSearchHit(item))
      .filter((item): item is SearchHit => item !== null),
  );
  if (!items.length) {
    throw new Error("This playlist is empty or isn’t available.");
  }
  const info = playlist.info;
  return {
    id,
    title: info.title?.trim() || "Playlist",
    author: info.author?.name?.trim() || "YouTube",
    thumbnail: info.thumbnails?.[0]?.url ?? items[0]?.thumbnail ?? null,
    total: info.total_items || null,
    items: items.slice(0, 50),
  };
}

export async function streamYoutubeCaptions(
  id: string,
  languageCode: string,
  vssId: string,
): Promise<Response> {
  const yt = await getClient();
  const info = await getPlayableInfo(yt, id);
  const track = info.captions?.caption_tracks?.find(
    (item) => item.language_code === languageCode && item.vss_id === vssId,
  );
  if (!track?.base_url) {
    throw new Error("That caption track isn’t available.");
  }
  const target = new URL(track.base_url);
  target.searchParams.set("fmt", "vtt");
  const upstream = await fetch(target.toString(), {
    headers: {
      accept: "text/vtt, text/plain, */*",
      referer: "https://www.youtube.com/",
    },
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error("Could not fetch captions.");
  }
  const title = sanitizeFilename(info.basic_info.title?.trim() || "captions");
  const lang = languageCode.replace(/[^\w-]/g, "") || "captions";
  const headers: Record<string, string> = {
    "Content-Type": "text/vtt; charset=utf-8",
    "Content-Disposition": contentDisposition(`${title}.${lang}`, "vtt"),
    "Cache-Control": "no-store",
  };
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  return new Response(upstream.body, { status: 200, headers });
}

export async function getTranscriptText(
  id: string,
  languageCode?: string,
  vssId?: string,
): Promise<{
  videoId: string;
  languageCode: string;
  languageName: string;
  kind: "manual" | "asr";
  vssId: string;
  vtt: string;
  cues: Array<{
    id: number;
    start: number;
    end: number;
    startFormatted: string;
    endFormatted: string;
    text: string;
  }>;
  totalWords: number;
  readingMinutes: number;
}> {
  const yt = await getClient();
  const info = await getPlayableInfo(yt, id);
  const tracks = info.captions?.caption_tracks ?? [];
  if (!tracks.length) {
    throw new Error("No captions or transcripts are available for this video.");
  }

  const track =
    (languageCode && vssId
      ? tracks.find((item) => item.language_code === languageCode && item.vss_id === vssId)
      : null) ??
    (languageCode ? tracks.find((item) => item.language_code === languageCode) : null) ??
    tracks.find((item) => item.kind !== "asr") ??
    tracks[0];

  if (!track?.base_url) {
    throw new Error("Could not find a valid caption track URL.");
  }

  const target = new URL(track.base_url);
  target.searchParams.set("fmt", "vtt");
  const upstream = await fetch(target.toString(), {
    headers: {
      accept: "text/vtt, text/plain, */*",
      referer: "https://www.youtube.com/",
    },
  });

  if (!upstream.ok) {
    throw new Error(`YouTube timedtext responded with status ${upstream.status}`);
  }

  const vttText = await upstream.text();
  const { parseWebVttIntoCues } = await import("@/lib/transcript");
  const cues = parseWebVttIntoCues(vttText);
  const totalWords = cues.reduce((acc, cue) => acc + cue.text.split(/\s+/).filter(Boolean).length, 0);
  const readingMinutes = Math.max(1, Math.round(totalWords / 200));

  return {
    videoId: id,
    languageCode: track.language_code,
    languageName: track.name?.text || track.language_code,
    kind: track.kind === "asr" ? "asr" : "manual",
    vssId: track.vss_id,
    vtt: vttText,
    cues,
    totalWords,
    readingMinutes,
  };
}

function sanitizeFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "video").slice(0, 120);
}

function contentDisposition(title: string, ext: string): string {
  const base = sanitizeFilename(title);
  const ascii = `${base.replace(/[^\x20-\x7E]/g, "_")}.${ext}`;
  const encoded = encodeURIComponent(`${base}.${ext}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

type FormatLike = {
  itag: number;
  mime_type: string;
  has_audio: boolean;
  has_video: boolean;
  content_length?: number;
  is_type_otf?: boolean;
  url?: string;
  signature_cipher?: string;
  cipher?: string;
  decipher: (player?: unknown) => Promise<string>;
};

async function findRawFormat(id: string, itag: number): Promise<{
  format: FormatLike;
  title: string;
  player: unknown;
  cpn: string;
}> {
  const yt = await getClient();
  let info: PlayableInfo;
  try {
    info = await getPlayableInfo(yt, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach YouTube.";
    throw new Error(message.replace(/^InnertubeError:\s*/i, ""));
  }
  const status = info.playability_status?.status;
  if (status && status !== "OK") {
    throw new Error(info.playability_status?.reason || "YouTube won’t play this video.");
  }
  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const format = raw.find((f) => f.itag === itag);
  if (!format || (format as { is_type_otf?: boolean }).is_type_otf) {
    throw new Error("That quality is no longer available. Fetch the video again.");
  }
  return {
    format: format as unknown as FormatLike,
    title: info.basic_info.title?.trim() || "video",
    player: yt.session.player,
    cpn: info.cpn,
  };
}

function appendParam(url: string, key: string, value: string): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
}

async function openStream(url: string, range?: { start: number; end: number }, signal?: AbortSignal): Promise<Response> {
  const target = range ? appendParam(url, "range", `${range.start}-${range.end}`) : url;
  const response = await fetch(target, {
    method: "GET",
    headers: STREAM_HEADERS,
    redirect: "follow",
    signal,
  });
  return response;
}

function bumpRn(url: string, n: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("rn", String(n));
    return parsed.toString();
  } catch {
    return appendParam(url, "rn", String(n));
  }
}

function parallelStream(url: string, size: number, connections: number): ReadableStream<Uint8Array> {
  const count = Math.min(connections, Math.max(1, Math.ceil(size / (2 * 1024 * 1024))));
  const chunk = Math.ceil(size / count);
  const ranges = Array.from({ length: count }, (_, i) => {
    const start = i * chunk;
    const end = Math.min(size - 1, start + chunk - 1);
    return { start, end };
  });
  const abort = new AbortController();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const responses: Response[] = [];
      try {
        for (let i = 0; i < ranges.length; i++) {
          if (abort.signal.aborted) throw new Error("aborted");
          const range = ranges[i];
          if (!range) continue;
          const response = await openStream(bumpRn(url, i + 1), range, abort.signal);
          responses.push(response);
          if (!response.ok || !response.body) {
            throw new Error("A parallel range request was blocked.");
          }
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        abort.abort();
        for (const response of responses) await response.body?.cancel().catch(() => undefined);
        controller.error(err);
      }
    },
    cancel() {
      abort.abort();
    },
  });
}

export type PlaybackFile = {
  url: string;
  directUrl: string;
  filename: string;
  mime: string;
  ext: string;
  size: number | null;
};

async function decorateUrls(raw: string, cpn: string, videoId: string): Promise<{ url: string; directUrl: string }> {
  const { mintContentPoToken } = await import("@/lib/po-token.server");
  const { unlockStreamUrl } = await import("@/lib/stream-unlock");
  const pot = await mintContentPoToken(videoId);
  const unlocked = unlockStreamUrl(raw, { pot, cpn, stripAlr: true });
  const direct = new URL(unlocked.url);
  const redirector = new URL(direct.toString());
  redirector.hostname = "redirector.googlevideo.com";
  return { url: redirector.toString(), directUrl: direct.toString() };
}

export async function decipherRawFormat(input: {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
}): Promise<string> {
  const yt = await getClient();
  const player = yt.session.player as {
    decipher?: (
      url?: string,
      signatureCipher?: string,
      cipher?: string,
      cache?: Map<string, string>,
    ) => Promise<string>;
  } | null;
  if (!player?.decipher) throw new Error("Player script isn’t ready. Try again.");
  const raw = input.url || input.signatureCipher || input.cipher;
  if (!raw) throw new Error("Missing stream cipher.");
  const rawN = readNParam(raw) ?? readNParam(input.url);
  try {
    const cached = nsigCacheLookup(rawN);
    const solved = await player.decipher(input.url, input.signatureCipher, input.cipher, nsigCache);
    const report = nsigReport(raw, solved, "miss" in cached ? "miss" : "hit");
    rememberNsig(report.raw, report.solved);
    if (report.raw && !report.transformed) {
      nsigCache.delete(report.raw);
      throw new Error("nsig cache miss — player.js failed to transform n.");
    }
    return solved;
  } catch (err) {
    if (rawN) nsigCache.delete(rawN);
    throw err instanceof Error ? err : new Error("nsig cache miss — player.js failed to transform n.");
  }
}

export async function unlockPlaybackUrl(input: {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  videoId?: string;
  cpn?: string;
  pot?: boolean;
}): Promise<{ url: string; applied: string[] }> {
  const deciphered = await decipherRawFormat(input);
  let pot: string | null = null;
  if (input.pot !== false && input.videoId) {
    const { mintContentPoToken } = await import("@/lib/po-token.server");
    pot = await mintContentPoToken(input.videoId);
  }
  const { unlockStreamUrl } = await import("@/lib/stream-unlock");
  return unlockStreamUrl(deciphered, { pot, cpn: input.cpn, stripAlr: true });
}

export async function getPlaybackUrl(id: string, itag: number): Promise<PlaybackFile> {
  const { format, title, cpn } = await findRawFormat(id, itag);
  const deciphered = await decipherRawFormat({
    url: format.url,
    signatureCipher: format.signature_cipher,
    cipher: format.cipher,
  });
  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const urls = await decorateUrls(deciphered, cpn, id);
  return {
    url: urls.url,
    directUrl: urls.directUrl,
    filename: `${sanitizeFilename(title)}.${ext}`,
    mime,
    ext,
    size: typeof format.content_length === "number" ? format.content_length : null,
  };
}

export async function probeYoutubeDownload(
  id: string,
  itag: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await findRawFormat(id, itag);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not reach the media file.",
    };
  }
}

export async function streamYoutubeDownload(id: string, itag: number): Promise<Response> {
  const { format, title, cpn } = await findRawFormat(id, itag);
  if (format.has_video && !format.has_audio) {
    return Response.json(
      { error: "This quality is video-only. Save uses yt-dlp to mux 137+140." },
      { status: 422 },
    );
  }
  const deciphered = await decipherRawFormat({
    url: format.url,
    signatureCipher: format.signature_cipher,
    cipher: format.cipher,
  });
  const urls = await decorateUrls(deciphered, cpn, id);

  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const size = format.content_length;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(title, ext),
    "Cache-Control": "no-store",
  };

  const probe = await openStream(urls.directUrl, { start: 0, end: 2047 });
  if (!probe.ok) {
    await probe.body?.cancel().catch(() => undefined);
    return Response.json(
      { error: "YouTube blocked this server. The app will try PO token + CORS relays." },
      { status: 403 },
    );
  }
  await probe.body?.cancel().catch(() => undefined);

  const useParallel = typeof size === "number" && size > 8 * 1024 * 1024;
  if (useParallel) {
    headers["Content-Length"] = String(size);
    const body = parallelStream(urls.directUrl, size, 4);
    return new Response(body, { status: 200, headers });
  }

  const upstream = await openStream(urls.directUrl);
  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: "YouTube blocked this server. The app will try PO token + CORS relays." },
      { status: 403 },
    );
  }

  const length = upstream.headers.get("content-length") || (size ? String(size) : null);
  if (length) headers["Content-Length"] = length;

  return new Response(upstream.body, { status: 200, headers });
}
