import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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

// The server-side block predicate lives in bypass.server.ts, whose import
// graph uses "@/" aliases plus two server-only modules (ipv4-bind.server's
// dns/net patching, youtube.server's Innertube stack) that a unit test must
// not load. Map the aliases onto src/ and stub just those two modules, so the
// module under test — and its isBlock — is the real bypass.server.ts.
const SERVER_STUBS: Record<string, string> = {
  "@/lib/ipv4-bind.server": "export {};",
  "@/lib/youtube.server":
    "export async function decipherRawFormat() { throw new Error('stubbed in bypass.test.ts'); }",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in SERVER_STUBS) return { url: `velo-stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("velo-stub:")) {
      const source = SERVER_STUBS[url.slice("velo-stub:".length)] ?? "export {};";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test("server isBlock flags a 200 text/plain relay notice as a block", async () => {
  const { isBlock } = await import("./bypass.server.ts");
  // Regression: a public relay's rate-limit/error notice arrives as HTTP 200
  // text/plain and must fail over to the next relay, not stream back as the
  // "video" — matching the client isBlockPage() twin in bypass.ts.
  assert.equal(isBlock("text/plain", 200), true);
  assert.equal(isBlock("text/plain; charset=utf-8", 200), true);
  assert.equal(isBlock("TEXT/PLAIN", 200), true);
  // The rest of the contract, unchanged.
  assert.equal(isBlock("text/html; charset=utf-8", 200), true);
  assert.equal(isBlock("application/json", 200), true);
  assert.equal(isBlock("video/mp4", 403), true);
  assert.equal(isBlock("video/mp4", 200), false);
  assert.equal(isBlock("application/octet-stream", 206), false);
  assert.equal(isBlock(null, 200), false);
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
