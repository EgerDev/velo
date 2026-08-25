/**
 * The three layers Save uses after YouTube 403s this host.
 *
 * 1. ffmpeg mux
 *    yt-dlp downloads video-only + audio-only, then runs the equivalent of:
 *      ffmpeg -i video.mp4 -i audio.m4a -c copy -map 0:v:0 -map 1:a:0 -movflags +faststart out.mp4
 *    `-c copy` remuxes — no transcode. `--merge-output-format mp4` is the container.
 *
 * 2. yt-dlp -f selector  (`/` = try next, `+` = mux these two)
 *    137+140  1080p H.264 + AAC — the hop that works
 *    137+251  1080p H.264 + Opus in mkv if AAC is missing
 *    96       HLS 1080 MPEG-TS stitch if DASH is blocked
 *    Muxed 22 / 18 is the client muxedFallback after this selector fails.
 *
 * 3. Fallback order (stop at first real file)
 *    logged-in innertube on this host → SOCKS web_embedded (137+140/137+251)
 *    → SOCKS web_safari (HLS 96) → SOCKS tv_simply / android (18)
 */
import { ytdlpFormatSelector } from "./ytdlp-auth.ts";

export const FFMPEG_MUX_ARGS = [
  "-c",
  "copy",
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-movflags",
  "+faststart",
] as const;

export function formatFallbackChain(itag: number): string[] {
  return ytdlpFormatSelector(itag).split("/");
}

export const BUILDER_FALLBACK_STEPS = [
  "innertube on this host (often 403 — IPv6/IPv4 bind)",
  "SOCKS web_embedded + ffmpeg mux (137+140 / 137+251)",
  "SOCKS web_safari HLS (96)",
  "SOCKS android muxed 360 (18)",
] as const;
