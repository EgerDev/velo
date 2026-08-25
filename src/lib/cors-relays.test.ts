import assert from "node:assert/strict";
import { test } from "node:test";
import { allRelayUrls, isPublicHtmlTarget, isRelayTarget, publicRelayUrls, relayHost } from "./cors-relays.ts";

test("only YouTube and googlevideo HTTPS URLs may be relayed", () => {
  assert.equal(isRelayTarget("https://r1---sn-abc.googlevideo.com/videoplayback?itag=18"), true);
  assert.equal(isRelayTarget("https://www.youtube.com/watch?v=jNQXAC9IVRw"), true);
  assert.equal(isRelayTarget("https://i.ytimg.com/vi/x/default.jpg"), true);
  assert.equal(isRelayTarget("http://www.youtube.com/watch?v=jNQXAC9IVRw"), false);
  assert.equal(isRelayTarget("https://evil.example/steal"), false);
  assert.equal(isRelayTarget("https://imasdk.googleapis.com/js/sdkloader/ima3.js"), false);
});

test("public CORS hops are HTML-only; googlevideo stays on the local hop", () => {
  const media = "https://r1---sn-abc.googlevideo.com/videoplayback?itag=18";
  const page = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  assert.equal(isRelayTarget(media), true);
  assert.equal(isPublicHtmlTarget(media), false);
  assert.deepEqual(publicRelayUrls(media), []);
  assert.ok(publicRelayUrls(page).some((item) => item.includes("proxy.cors.sh")));
  const all = allRelayUrls(media, true);
  assert.ok(all.every((item) => item.startsWith("/api/relay") || !/corsfix|cors\.sh|allorigins/.test(item)));
  assert.ok(all.some((item) => item.startsWith("/api/relay?url=")));
  assert.equal(relayHost("/api/relay?url=x"), "velo-relay");
});
