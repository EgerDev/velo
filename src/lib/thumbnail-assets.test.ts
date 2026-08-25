import test from "node:test";
import assert from "node:assert/strict";
import { resolveThumbnailBundle } from "./thumbnail-assets.ts";

test("resolveThumbnailBundle: generates full resolution ladder", () => {
  const bundle = resolveThumbnailBundle("jNQXAC9IVRw");
  assert.equal(bundle.videoId, "jNQXAC9IVRw");
  assert.equal(bundle.maxResUrl, "https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg");
  assert.equal(bundle.items.length, 5);

  const maxRes = bundle.items[0];
  assert.equal(maxRes?.resolution, "1920x1080");
  assert.equal(maxRes?.ext, "jpg");

  const webp = bundle.items[1];
  assert.equal(webp?.ext, "webp");
  assert.ok(webp?.url.includes("/vi_webp/"));
});
