import assert from "node:assert/strict";
import { test } from "node:test";
import { ytdlpJsonToFormats } from "./ytdlp-formats.ts";

test("yt-dlp JSON maps 137 1080p and HLS 96 muxed", () => {
  const formats = ytdlpJsonToFormats([
    { format_id: "137", vcodec: "avc1.640028", acodec: "none", ext: "mp4", height: 1080, fps: 25, filesize: 80_000_000, tbr: 3000 },
    { format_id: "96", vcodec: "avc1.640028", acodec: "mp4a.40.2", ext: "mp4", height: 1080, fps: 25, protocol: "m3u8", tbr: 4600 },
    { format_id: "sb0", vcodec: "none", acodec: "none", ext: "mhtml" },
    { format_id: "18", vcodec: "avc1.42001E", acodec: "mp4a.40.2", ext: "mp4", height: 360, fps: 25, filesize: 600_000 },
  ]);
  assert.equal(formats.find((item) => item.itag === 137)?.height, 1080);
  assert.equal(formats.find((item) => item.itag === 137)?.kind, "video");
  assert.equal(formats.find((item) => item.itag === 96)?.kind, "av");
  assert.equal(formats.find((item) => item.itag === 96)?.hasAudio, true);
  assert.ok(!formats.some((item) => item.itag === 0 || item.ext === "mhtml"));
});
