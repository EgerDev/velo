export const H264_VS_AV1 =
  "Same 1080p picture: AV1 is typically 30–50% smaller than H.264. H.264 spends more bits so the file opens everywhere. Full HD Save uses H.264; pick AV1 only if you want the smaller copy.";

export const HLS_EXPLAIN =
  "HLS fallback: if DASH 137 is unavailable, Save asks yt-dlp for YouTube’s itag 96 playlist (~5s MPEG-TS chunks). The master playlist’s 1080p variant is used — not 4K.";

export const ABORT_EXPLAIN =
  "AbortController: the first path that returns a real file wins. Close, a new Save, or a race winner aborts the rest so guest quota is not spent twice.";

export const FORMAT_PRIORITY = [
  { id: "137", label: "1080p H.264 + AAC", detail: "DASH 137+140 — default" },
  { id: "96", label: "HLS 1080p stitch", detail: "itag 96 if DASH is blocked" },
  { id: "22", label: "720p muxed H.264", detail: "no 1080p on this upload" },
  { id: "18", label: "360p muxed H.264", detail: "last resort" },
] as const;

export const SAVE_MECHANICS = [
  { name: "AbortController", detail: "Winner / Close kills every other fetch." },
  { name: "HLS fallback", detail: "Stitch itag 96 TS chunks when 137 is SABR or 403." },
  { name: "IMA SDK", detail: "Ad player (ima3.js). Never loaded; DoubleClick/DAI dropped." },
  { name: "IPv4 pin", detail: "yt-dlp stays on IPv4 so the player request and the file share one address family." },
] as const;
