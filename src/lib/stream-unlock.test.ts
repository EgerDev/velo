import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeStreamUrl,
  lockSummary,
  parseHls,
  parsePlaybackUrl,
  pickHlsVariant,
  unlockStreamUrl,
  unlockVariants,
} from "./stream-unlock.ts";

const SAMPLE =
  "https://r1---sn-abc.googlevideo.com/videoplayback?expire=1999999999&ip=1.2.3.4&id=o-A&itag=18&source=youtube&requiressl=yes&mime=video%2Fmp4&n=rawN&sig=AE0&lsig=APA&c=MWEB&alr=yes&sparams=expire,ip,id,itag";

test("detects ip, n-sig, sig, lsig, alr, client, expire", () => {
  const report = analyzeStreamUrl(SAMPLE, 1_700_000_000_000);
  assert.equal(report.itag, 18);
  assert.equal(report.client, "MWEB");
  assert.equal(report.ip, "1.2.3.4");
  assert.equal(report.sabr, false);
  assert.ok(report.locks.includes("ip"));
  assert.ok(report.locks.includes("nsig"));
  assert.ok(report.locks.includes("sig"));
  assert.ok(report.locks.includes("alr"));
  assert.match(lockSummary(report), /IP bind/);
});

test("unlock drops alr, stamps pot/cpn/ratebypass/rn, never invents cver", () => {
  const { url, applied } = unlockStreamUrl(SAMPLE, { pot: "POTTOKEN", cpn: "CPN1" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("alr"), null);
  assert.equal(parsed.searchParams.get("pot"), "POTTOKEN");
  assert.equal(parsed.searchParams.get("potc"), "1");
  assert.equal(parsed.searchParams.get("cpn"), "CPN1");
  assert.equal(parsed.searchParams.get("cver"), null);
  assert.equal(parsed.searchParams.get("ratebypass"), "yes");
  assert.equal(parsed.searchParams.get("rn"), "1");
  assert.ok(applied.includes("drop-alr"));
  assert.ok(applied.includes("gvs-pot"));
  assert.ok(!applied.includes("cver"));
});

test("does not stamp pot/ratebypass/rn on HLS manifests", () => {
  const master =
    "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1/sig/ABC/index.m3u8?id=o-A";
  const { url, applied } = unlockStreamUrl(master, { pot: "X" });
  assert.equal(url, master);
  assert.equal(applied.length, 0);
  assert.ok(!url.includes("pot="));
  assert.ok(!url.includes("ratebypass"));
});

test("does not stamp pot on SABR stubs", () => {
  const { url, applied } = unlockStreamUrl(
    "https://r1.googlevideo.com/videoplayback?sabr=1&itag=137",
    { pot: "X" },
  );
  assert.equal(new URL(url).searchParams.get("pot"), null);
  assert.equal(applied.includes("gvs-pot"), false);
  // The pot is withheld, but the SABR stub is still a progressive URL — it must
  // keep the throughput params or it downloads at the default trickle rate.
  assert.equal(new URL(url).searchParams.get("ratebypass"), "yes");
  assert.equal(new URL(url).searchParams.get("rn"), "1");
});

test("pot:null strips a visitor-bound token instead of stamping one", () => {
  const { url, applied } = unlockStreamUrl(
    "https://r1.googlevideo.com/videoplayback?itag=18&pot=OLD&potc=1",
    { pot: null },
  );
  const q = new URL(url).searchParams;
  assert.equal(q.get("pot"), null);
  assert.equal(q.get("potc"), null);
  assert.ok(applied.includes("drop-pot"));
  // Nothing to drop → no drop-pot claim.
  const clean = unlockStreamUrl("https://r1.googlevideo.com/videoplayback?itag=18", { pot: null });
  assert.equal(clean.applied.includes("drop-pot"), false);
});

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

test("parsePlaybackUrl unwraps a cipher but never a plain url= query param", () => {
  // A real signatureCipher blob: the playback URL is the nested `url`.
  assert.equal(
    parsePlaybackUrl("s=SIG&sp=sig&url=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback%3Fitag%3D18")
      ?.host,
    "r1.googlevideo.com",
  );
  // An ordinary absolute URL that merely carries `url=` must resolve to ITSELF.
  // Keying off a bare `&url=http` sent callers to the other host.
  const decoy =
    "https://r1.googlevideo.com/videoplayback?itag=18&emsg=x&url=http://evil.test/x";
  assert.equal(parsePlaybackUrl(decoy)?.host, "r1.googlevideo.com");
  assert.equal(parsePlaybackUrl("not a url"), null);
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

test("unlock variants include pot and no-pot", () => {
  const urls = unlockVariants("https://r1.googlevideo.com/videoplayback?itag=18&alr=yes", {
    pot: "ABC",
  });
  assert.ok(urls.some((item) => item.includes("pot=ABC")));
  assert.ok(urls.some((item) => !item.includes("pot=")));
});

test("replaces a visitor-bound pot with the video-id GVS token", () => {
  const { url, applied } = unlockStreamUrl(
    "https://r1.googlevideo.com/videoplayback?itag=18&pot=OLD",
    { pot: "ABC" },
  );
  assert.equal(new URL(url).searchParams.get("pot"), "ABC");
  assert.equal(applied.includes("gvs-pot"), true);
});

test("does not stamp pot/ratebypass/rn/cver on videoplayback HLS m3u8", () => {
  const master =
    "https://rr2.googlevideo.com/videoplayback?expire=1&sig=ABC&file=index.m3u8&id=o-A&cver=1.20260206.01.00";
  const { url, applied } = unlockStreamUrl(master, { pot: "X" });
  assert.equal(applied.length, 0);
  assert.equal(new URL(url).searchParams.get("pot"), null);
  assert.equal(new URL(url).searchParams.get("ratebypass"), null);
  assert.equal(new URL(url).searchParams.get("cver"), "1.20260206.01.00");
});
