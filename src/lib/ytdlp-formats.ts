import type { MediaKind, VideoFormat } from "./youtube.ts";
import { codecFromMime } from "./youtube.ts";

export type YtDlpJsonFormat = {
  format_id?: string;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  height?: number;
  fps?: number;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number;
  protocol?: string;
};

function ytdlpCodec(vcodec?: string, acodec?: string): string | null {
  const source = `${vcodec ?? ""} ${acodec ?? ""}`.toLowerCase();
  if (source.includes("avc1") || source.includes("avc3") || source.includes("h264")) return "H.264";
  if (source.includes("av01") || source.includes("av1")) return "AV1";
  if (source.includes("vp9") || source.includes("vp09")) return "VP9";
  if (source.includes("hev1") || source.includes("hvc1") || source.includes("h265")) return "H.265";
  if (source.includes("mp4a") || source.includes("aac")) return "AAC";
  if (source.includes("opus")) return "Opus";
  return codecFromMime(source);
}

export function ytdlpJsonToFormats(formats: YtDlpJsonFormat[]): VideoFormat[] {
  const out: VideoFormat[] = [];
  for (const raw of formats) {
    const itag = Number(String(raw.format_id ?? "").split("-")[0]);
    if (!Number.isInteger(itag) || itag <= 0) continue;
    if (raw.ext === "mhtml" || raw.protocol === "mhtml") continue;
    const hasVideo = Boolean(raw.vcodec && raw.vcodec !== "none");
    const hasAudio = Boolean(raw.acodec && raw.acodec !== "none");
    if (!hasVideo && !hasAudio) continue;
    const kind: MediaKind = hasAudio && hasVideo ? "av" : hasAudio ? "audio" : "video";
    const height = hasVideo && raw.height ? raw.height : null;
    const ext = raw.ext || (hasVideo ? "mp4" : "m4a");
    const codec = ytdlpCodec(raw.vcodec, raw.acodec);
    out.push({
      itag,
      kind,
      qualityLabel: height ? `${height}p` : hasAudio ? "Audio" : "Video",
      height,
      fps: raw.fps ?? null,
      ext,
      mime: ext === "webm" ? (hasVideo ? "video/webm" : "audio/webm") : hasVideo ? "video/mp4" : "audio/mp4",
      codec,
      bitrate: Math.round((raw.tbr ?? 0) * 1000),
      size: raw.filesize ?? raw.filesize_approx ?? null,
      hasAudio,
      hasVideo,
      language: null,
      isOriginal: true,
      isDubbed: false,
      isAutoDubbed: false,
      isDescriptive: false,
      isSecondary: false,
    });
  }
  return out;
}
