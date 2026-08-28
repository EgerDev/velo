import type { TranslationLanguage } from "./youtube-translate.ts";

export type MediaKind = "av" | "audio" | "video";

export type PresetAvailability = "ready" | "muxed" | "hls" | "restricted";
export type StreamType = "direct" | "dash-mux" | "hls-stitch";

export type VideoFormat = {
  itag: number;
  kind: MediaKind;
  qualityLabel: string;
  width?: number | null;
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
  isVertical?: boolean;
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
  /** YouTube will machine-translate this track on the fly (`tlang=`) — free. */
  translatable?: boolean;
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
  isShort?: boolean;
  description: string | null;
  formats: VideoFormat[];
  presets: VideoPreset[];
  captions: CaptionTrack[];
  /** Languages YouTube can auto-translate a translatable track into. */
  translationLanguages?: TranslationLanguage[];
};

export function isShortVideo(video: {
  duration?: number | null;
  formats?: VideoFormat[];
  url?: string;
  isShort?: boolean;
}): boolean {
  if (video.isShort) return true;
  if (video.url && video.url.includes("/shorts/")) return true;
  if (typeof video.duration === "number" && video.duration > 0 && video.duration <= 180) {
    const hasVertical = video.formats?.some((f) => f.width && f.height && f.width < f.height);
    if (hasVertical) return true;
  }
  return false;
}

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
