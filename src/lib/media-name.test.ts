import assert from "node:assert/strict";
import { test } from "node:test";
import { nameForBlob } from "./media-name.ts";

test("nameForBlob swaps a known container ext to match the blob type", () => {
  const mkv = new Blob([], { type: "video/x-matroska" });
  assert.equal(nameForBlob("Talk.webm", mkv), "Talk.mkv");
  assert.equal(nameForBlob("Talk.mp4", new Blob([], { type: "audio/mp4" })), "Talk.m4a");
  assert.equal(nameForBlob("Talk.mp4", new Blob([], { type: "video/mp4" })), "Talk.mp4");
  assert.equal(nameForBlob("Talk", mkv), "Talk.mkv");
  assert.equal(nameForBlob("Talk.webm", new Blob([], { type: "application/octet-stream" })), "Talk.webm");
  assert.equal(nameForBlob("Talk.info.json", mkv), "Talk.info.json");
});
