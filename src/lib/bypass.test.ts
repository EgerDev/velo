import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPlayerResponse,
  pickBypassFormat,
  sameHopPages,
  stampPot,
  appendParam,
  isVideoplaybackUrl,
} from "./bypass-parse.ts";

const FIXTURE = `
<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"streamingData":{"formats":[{"itag":18,"url":"https://r1---sn-abc.googlevideo.com/videoplayback?itag=18","mimeType":"video/mp4","contentLength":"12345","qualityLabel":"360p"}],"adaptiveFormats":[{"itag":137,"signatureCipher":"s=SIG&url=https://r1---sn-abc.googlevideo.com/videoplayback","mimeType":"video/mp4","contentLength":"999","qualityLabel":"1080p"}]}};
</script></html>
`;

test("skips the null stub and reads the real player JSON", () => {
  const html = `
    <script>var ytInitialPlayerResponse = null;</script>
    <script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"streamingData":{"formats":[{"itag":18,"url":"https://r1.googlevideo.com/videoplayback?itag=18"}]}};</script>
  `;
  const player = extractPlayerResponse(html);
  assert.equal(player?.status, "OK");
  assert.equal(player?.formats[0]?.itag, 18);
});

test("extracts muxed and adaptive itags from a watch page", () => {
  const player = extractPlayerResponse(FIXTURE);
  assert.equal(player?.status, "OK");
  assert.equal(player?.formats.length, 2);
  assert.equal(pickBypassFormat(player?.formats ?? [], 18)?.url?.includes("itag=18"), true);
  assert.equal(pickBypassFormat(player?.formats ?? [], 137)?.signatureCipher?.includes("SIG"), true);
  assert.equal(pickBypassFormat(player?.formats ?? [], 22), null);
});

test("same-hop pages stay on youtube hosts", () => {
  const pages = sameHopPages("jNQXAC9IVRw");
  assert.equal(pages.length, 4);
  assert.ok(pages.every((page) => /youtube/.test(page)));
});

test("stamps pot without dropping the host", () => {
  const stamped = stampPot("https://r1.googlevideo.com/videoplayback?itag=18", "TOKEN");
  assert.match(stamped, /pot=TOKEN/);
  assert.match(stamped, /potc=1/);
  assert.equal(appendParam("https://x.test/a", "range", "0-1"), "https://x.test/a?range=0-1");
  assert.equal(appendParam("https://x.test/a?b=1", "range", "0-1"), "https://x.test/a?b=1&range=0-1");
});

test("only googlevideo /videoplayback is treated as media", () => {
  assert.equal(isVideoplaybackUrl("https://r1---sn-abc.googlevideo.com/videoplayback?itag=18"), true);
  assert.equal(isVideoplaybackUrl("https://rr2.googlevideo.com/videoplayback/itag/96/file/seg.ts"), true);
  assert.equal(isVideoplaybackUrl("https://manifest.googlevideo.com/api/manifest/hls_playlist/index.m3u8"), false);
  assert.equal(isVideoplaybackUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw"), false);
  assert.equal(isVideoplaybackUrl("https://www.youtube.com/youtubei/v1/player"), false);
  assert.equal(
    isVideoplaybackUrl("https://www.youtube.com/redirect?q=https://r1.googlevideo.com/videoplayback?itag=18"),
    false,
  );
});
