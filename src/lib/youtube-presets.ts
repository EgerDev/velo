import type { QualitySummary, VideoFormat, VideoPreset } from "./youtube-types.ts";
import { inBand, pickBestPreset, pickMergedPreset, preferContainer, presetHint, sumSizes } from "./youtube-format.ts";

function pickWorking1080(formats: VideoFormat[]): VideoPreset | null {
  // itag 137 is the classic 1080p30 H.264 stream, but 60fps uploads carry
  // 1080p H.264 as itag 299 — accept any H.264 video-only track in the band.
  const dash =
    formats.find((f) => f.itag === 137) ??
    formats.find(
      (f) => f.kind === "video" && f.codec === "H.264" && inBand(f.height, 1080, 1439),
    );
  const aac =
    formats.find((f) => f.itag === 140 && f.kind === "audio") ??
    formats.find((f) => f.kind === "audio" && (f.codec === "AAC" || f.ext === "m4a"));
  const opus =
    formats.find((f) => f.itag === 251 && f.kind === "audio") ??
    formats.find((f) => f.kind === "audio" && f.codec === "Opus");
  if (dash && aac) {
    return {
      id: "fullhd",
      itag: dash.itag,
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
      itag: dash.itag,
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

  let fullhd = pickWorking1080(formats);
  // No 1080p H.264 (common for HDR uploads, which only carry VP9/AV1 above
  // 720p): still offer 1080p from the codec most players handle.
  if (!fullhd) {
    fullhd =
      pickMergedPreset(formats, "fullhd", () => "1080p", 1080, 1439, "VP9") ??
      pickMergedPreset(formats, "fullhd", () => "1080p", 1080, 1439, "AV1") ??
      pickMergedPreset(formats, "fullhd", () => "1080p", 1080, 1439);
  }
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
