import assert from "node:assert/strict";
import { test } from "node:test";
import { isRelayTarget, localRelayUrl } from "./cors-relays.ts";

test("only YouTube and googlevideo HTTPS URLs may be relayed", () => {
  assert.equal(isRelayTarget("https://r1---sn-abc.googlevideo.com/videoplayback?itag=18"), true);
  assert.equal(isRelayTarget("https://www.youtube.com/watch?v=jNQXAC9IVRw"), true);
  assert.equal(isRelayTarget("https://i.ytimg.com/vi/x/default.jpg"), true);
  assert.equal(isRelayTarget("http://www.youtube.com/watch?v=jNQXAC9IVRw"), false);
  assert.equal(isRelayTarget("https://evil.example/steal"), false);
  assert.equal(isRelayTarget("https://imasdk.googleapis.com/js/sdkloader/ima3.js"), false);
});

test("the only relay is this app's own /api/relay", () => {
  const page = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  assert.equal(localRelayUrl(page), `/api/relay?url=${encodeURIComponent(page)}`);
});
