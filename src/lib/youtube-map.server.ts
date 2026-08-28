import type { MediaKind, SearchHit, VideoFormat } from "@/lib/youtube";
import { codecFromMime, parseClock, parseVideoId } from "@/lib/youtube";

export function containerExt(mime: string, hasVideo: boolean): string {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/webm") return "webm";
  if (type === "video/mp4") return hasVideo ? "mp4" : "m4a";
  if (type === "video/webm") return "webm";
  if (type.includes("mp4")) return hasVideo ? "mp4" : "m4a";
  if (type.includes("webm")) return "webm";
  return "mp4";
}

export function heightFromLabel(label: string | undefined, height?: number): number | null {
  if (typeof height === "number" && height > 0) return height;
  const match = label?.match(/(\d{3,4})p/);
  return match ? Number(match[1]) : null;
}

export function formatLabel(opts: {
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

export type RawFormat = {
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

export function toFormat(raw: RawFormat): VideoFormat | null {
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

export function uniqueFormats(list: VideoFormat[]): VideoFormat[] {
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

export function pickThumbnail(
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

export function uniqueHits(items: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

