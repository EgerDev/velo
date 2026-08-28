import type { MediaKind, VideoFormat, VideoPreset } from "./youtube-types.ts";


export function preferContainer<T extends { ext: string; bitrate: number }>(list: T[]): T[] {
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

export function presetHint(format: Pick<VideoFormat, "qualityLabel" | "ext" | "codec">, extra: string): string {
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

export function inBand(height: number | null, min: number, max: number): boolean {
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

export function pickMergedPreset(
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
