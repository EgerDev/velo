import { matchAudioTrack, mergedExt, sumSizes, type VideoFormat, type VideoPreset } from "@/lib/youtube";

export function formatAsPreset(format: VideoFormat, formats: VideoFormat[]): VideoPreset {
  if (format.kind === "video") {
    const audio = matchAudioTrack(format, formats);
    if (audio) {
      const ext = mergedExt(format);
      const isHls = format.itag === 96 || format.mime?.includes("m3u8");
      return {
        id: `fmt-${format.itag}`,
        itag: format.itag,
        audioItag: audio.itag,
        kind: "video",
        title: format.qualityLabel,
        hint: format.codec ?? format.mime,
        ext,
        codec: format.codec,
        size: sumSizes(format, audio),
        height: format.height,
        hasAudio: true,
        availability: isHls ? "hls" : "muxed",
        streamType: isHls ? "hls-stitch" : "dash-mux",
        recommended: false,
      };
    }
  }
  const isHls = format.itag === 96 || format.mime?.includes("m3u8") || format.ext === "m3u8";
  return {
    id: `fmt-${format.itag}`,
    itag: format.itag,
    kind: format.kind,
    title: format.qualityLabel,
    hint: format.codec ?? format.mime,
    ext: format.ext,
    codec: format.codec,
    size: format.size,
    height: format.height,
    hasAudio: format.kind !== "video",
    availability: isHls ? "hls" : format.kind === "video" ? "restricted" : "ready",
    streamType: isHls ? "hls-stitch" : "direct",
    recommended: false,
  };
}
