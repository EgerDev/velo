import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHls, pickHlsVariant } from "./hls.ts";

test("pickHlsVariant returns null when no variant carries video", () => {
  assert.equal(pickHlsVariant([], 1080), null);
  const audioOnly = parseHls(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"
audio.m3u8
`,
    "https://gv.example/master.m3u8",
  );
  assert.equal(pickHlsVariant(audioOnly.master, 1080), null);
});

test("parses HLS master and media playlists", () => {
  const master = parseHls(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
mid.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=3840x2160
high.m3u8
`,
    "https://gv.example/master.m3u8",
  );
  assert.equal(pickHlsVariant(master.master, 1080), "https://gv.example/mid.m3u8");
  assert.equal(pickHlsVariant(master.master, 2160), "https://gv.example/high.m3u8");
  const media = parseHls(
    `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.0,
seg0.m4s
#EXTINF:2.0,
seg1.m4s
`,
    "https://gv.example/high.m3u8",
  );
  assert.equal(media.media.init, "https://gv.example/init.mp4");
  assert.equal(media.media.segments.length, 2);
});
