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
  language?: string | null;
  format_note?: string;
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
    // yt-dlp carries the audio track's role in `format_note` ("original",
    // "Dubbed (auto)", "descriptive"). Hardcoding every track as original left
    // `matchAudioTrack`'s dub penalties inert, so a slightly higher-bitrate
    // auto-dub outranked the real audio.
    const note = (raw.format_note ?? "").toLowerCase();
    const isAutoDubbed = note.includes("dubbed (auto)");
    const isDubbed = isAutoDubbed || note.includes("dubbed");
    const isDescriptive = note.includes("descriptive");
    out.push({
      itag,
      kind,
      qualityLabel: height ? `${height}p` : hasAudio ? "Audio" : "Video",
      height,
      fps: raw.fps ?? null,
      ext,
      mime:
        ext === "webm"
          ? hasVideo
            ? "video/webm"
            : "audio/webm"
          : hasVideo
            ? "video/mp4"
            : "audio/mp4",
      codec,
      bitrate: Math.round((raw.tbr ?? 0) * 1000),
      size: raw.filesize ?? raw.filesize_approx ?? null,
      hasAudio,
      hasVideo,
      language: raw.language ?? null,
      isOriginal: note.includes("original") || (!isDubbed && !isDescriptive),
      isDubbed,
      isAutoDubbed,
      isDescriptive,
      isSecondary: false,
    });
  }
  return dedupeByItag(out);
}

/**
 * Collapse multi-track variants that share one itag.
 *
 * yt-dlp distinguishes audio tracks as `140-0` / `140-1`, but the itag alone is
 * what ends up in a preset — so on a multi-language video two entries claimed
 * itag 140 and the one the download actually got was arbitrary. Keep the track
 * a bare itag will really resolve to: the original, then the highest bitrate.
 */
function dedupeByItag(formats: VideoFormat[]): VideoFormat[] {
  const best = new Map<string, VideoFormat>();
  for (const format of formats) {
    const key = `${format.itag}:${format.kind}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, format);
      continue;
    }
    const rank = (f: VideoFormat) =>
      f.isAutoDubbed ? 0 : f.isDubbed ? 1 : f.isDescriptive ? 2 : 3;
    if (
      rank(format) > rank(prev) ||
      (rank(format) === rank(prev) && format.bitrate > prev.bitrate)
    ) {
      best.set(key, format);
    }
  }
  return [...best.values()];
}
