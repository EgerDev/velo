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
