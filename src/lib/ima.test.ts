import assert from "node:assert/strict";
import { test } from "node:test";
import { isImaHost, isImaUrl } from "./ima.ts";
import { isRelayTarget } from "./cors-relays.ts";

test("IMA SDK and DoubleClick hosts are ads, not content", () => {
  assert.equal(isImaHost("imasdk.googleapis.com"), true);
  assert.equal(isImaUrl("https://imasdk.googleapis.com/js/sdkloader/ima3.js"), true);
  assert.equal(isImaUrl("https://googleads.g.doubleclick.net/pagead/ads"), true);
  assert.equal(isImaUrl("https://pubads.g.doubleclick.net/gampad/ads"), true);
  assert.equal(isImaUrl("https://dai.google.com/linear/hls/event/x/master.m3u8"), true);
  assert.equal(isImaUrl("https://www.youtube.com/ptracking?html5=1"), false);
  assert.equal(isImaUrl("s=xxx/pagead/yyy&url=https://r1.googlevideo.com/videoplayback"), false);
  assert.equal(isImaUrl("https://r1---sn-abc.googlevideo.com/videoplayback?itag=137"), false);
  assert.equal(isImaUrl("https://r1---sn-abc.googlevideo.com/videoplayback?itag=139&oad=1&ctier=L"), true);
  assert.equal(
    isImaUrl("https://r1.googlevideo.com/videoplayback/url/https%3A%2F%2Fgoogleads.g.doubleclick.net%2Fpagead%2Fads"),
    true,
  );
  assert.equal(
    isImaUrl("https://r1---sn-abc.googlevideo.com/videoplayback?url=https://googleads.g.doubleclick.net/pagead/ads"),
    true,
  );
  assert.equal(
    isImaUrl("https://r1---sn-abc.googlevideo.com/videoplayback?url=https%3A%2F%2Fdai.google.com%2Flinear%2Fhls"),
    true,
  );
});

test("relays refuse IMA even if the URL looks like HTTPS Google", () => {
  assert.equal(isRelayTarget("https://imasdk.googleapis.com/js/sdkloader/ima3.js"), false);
  assert.equal(isRelayTarget("https://dai.google.com/linear/hls/event/x/master.m3u8"), false);
  assert.equal(isRelayTarget("https://r1---sn-abc.googlevideo.com/videoplayback?itag=18"), true);
});
