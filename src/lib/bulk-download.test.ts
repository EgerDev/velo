import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateQueueStats,
  createBulkItems,
  exportBatchJson,
  exportUrlList,
  exportYtdlpBatchScript,
  extractYoutubeLinks,
  importBatchJson,
  type BulkItem,
} from "./bulk-download.ts";

describe("extractYoutubeLinks", () => {
  it("extracts multiple video links from multi-line text and mixed URLs", () => {
    const raw = `
Check out these videos:
1. https://www.youtube.com/watch?v=jNQXAC9IVRw (classic)
2. https://youtu.be/aqz-KE-bpKQ
3. https://www.youtube.com/shorts/5Eqb_-j3FDA
4. https://www.youtube.com/watch?v=jNQXAC9IVRw (duplicate)
5. plain id: _bzeabETAAA in text
`;
    const result = extractYoutubeLinks(raw);
    assert.equal(result.totalUnique, 4);
    assert.ok(result.videoIds.includes("jNQXAC9IVRw"));
    assert.ok(result.videoIds.includes("aqz-KE-bpKQ"));
    assert.ok(result.videoIds.includes("5Eqb_-j3FDA"));
    assert.ok(result.videoIds.includes("_bzeabETAAA"));
  });

  it("extracts playlist URLs", () => {
    const raw = `https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9up55ofpq42`;
    const result = extractYoutubeLinks(raw);
    assert.equal(result.playlistIds.length, 1);
    assert.equal(result.playlistIds[0], "PLrAXtmErZgOdP_8GztsuKi9up55ofpq42");
  });

  it("handles empty or garbage input gracefully", () => {
    assert.equal(extractYoutubeLinks("").totalUnique, 0);
    assert.equal(extractYoutubeLinks("random text without youtube").totalUnique, 0);
  });
});

describe("createBulkItems", () => {
  it("initializes items with default preset and thumbnail URLs", () => {
    const ids = ["jNQXAC9IVRw", "aqz-KE-bpKQ"];
    const items = createBulkItems(ids, "1080p");
    assert.equal(items.length, 2);
    assert.equal(items[0].id, "jNQXAC9IVRw");
    assert.equal(items[0].preset, "1080p");
    assert.equal(items[0].status, "pending");
    assert.equal(items[0].thumbnail, "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg");
  });
});

describe("queue exporters", () => {
  const sampleItems: BulkItem[] = [
    {
      id: "jNQXAC9IVRw",
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      title: "Me at the zoo",
      author: "jawed",
      duration: 19,
      durationFormatted: "0:19",
      thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
      status: "ready",
      progress: 0,
      preset: "1080p",
      sizeFormatted: "4.2 MB",
      filename: "Me at the zoo.mp4",
      downloadUrl: null,
      error: null,
      retryCount: 0,
      selectedItag: 137,
      selectedAudioItag: 140,
    },
    {
      id: "aqz-KE-bpKQ",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      title: "Big Buck Bunny",
      author: "Blender",
      duration: 600,
      durationFormatted: "10:00",
      thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      status: "completed",
      progress: 100,
      preset: "audio",
      sizeFormatted: "12.5 MB",
      filename: "Big Buck Bunny.m4a",
      downloadUrl: null,
      error: null,
      retryCount: 0,
      selectedItag: 140,
      selectedAudioItag: null,
    },
  ];

  it("exports batch yt-dlp script with staggering and safe format flags", () => {
    const script = exportYtdlpBatchScript(sampleItems);
    assert.match(script, /^#!\/usr\/bin\/env bash/);
    assert.match(script, /yt-dlp -f "bestvideo\[height<=1080\]\+bestaudio/);
    assert.match(script, /sleep 1\.5/);
    assert.match(script, /jNQXAC9IVRw/);
    assert.match(script, /aqz-KE-bpKQ/);
  });

  it("exports clean URL list", () => {
    const list = exportUrlList(sampleItems);
    assert.equal(
      list,
      "https://www.youtube.com/watch?v=jNQXAC9IVRw\nhttps://www.youtube.com/watch?v=aqz-KE-bpKQ",
    );
  });

  it("exports structured JSON", () => {
    const json = exportBatchJson(sampleItems);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, "jNQXAC9IVRw");
    assert.equal(parsed[0].title, "Me at the zoo");
  });
});

describe("calculateQueueStats", () => {
  it("accurately tallies completed, pending, failed, and average progress", () => {
    const items: BulkItem[] = [
      {
        id: "1",
        url: "",
        title: null,
        author: null,
        duration: null,
        durationFormatted: null,
        thumbnail: null,
        status: "completed",
        progress: 100,
        preset: "1080p",
        sizeFormatted: null,
        filename: null,
        downloadUrl: null,
        error: null,
        retryCount: 0,
        selectedItag: null,
        selectedAudioItag: null,
      },
      {
        id: "2",
        url: "",
        title: null,
        author: null,
        duration: null,
        durationFormatted: null,
        thumbnail: null,
        status: "downloading",
        progress: 50,
        preset: "1080p",
        sizeFormatted: null,
        filename: null,
        downloadUrl: null,
        error: null,
        retryCount: 0,
        selectedItag: null,
        selectedAudioItag: null,
      },
      {
        id: "3",
        url: "",
        title: null,
        author: null,
        duration: null,
        durationFormatted: null,
        thumbnail: null,
        status: "pending",
        progress: 0,
        preset: "1080p",
        sizeFormatted: null,
        filename: null,
        downloadUrl: null,
        error: null,
        retryCount: 0,
        selectedItag: null,
        selectedAudioItag: null,
      },
    ];

    const stats = calculateQueueStats(items);
    assert.equal(stats.total, 3);
    assert.equal(stats.completed, 1);
    assert.equal(stats.downloading, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.totalProgress, 50); // (100 + 50 + 0) / 3 = 50
    assert.equal(stats.isAllDone, false);
  });
});

describe("importBatchJson", () => {
  it("round-trips an exported manifest, preserving preset and title", () => {
    const items = createBulkItems(["jNQXAC9IVRw"], "1080p");
    items[0].title = "Me at the zoo";
    items[0].preset = "audio";
    const json = exportBatchJson(items);
    const result = importBatchJson(json);
    assert.equal(result.error, null);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, "jNQXAC9IVRw");
    assert.equal(result.items[0].preset, "audio");
    assert.equal(result.items[0].title, "Me at the zoo");
  });

  it("accepts a bare JSON array of url objects and dedupes", () => {
    const json = JSON.stringify([
      { url: "https://youtu.be/aqz-KE-bpKQ", preset: "720p" },
      { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" },
      { id: "jNQXAC9IVRw" },
    ]);
    const result = importBatchJson(json);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].preset, "720p");
  });

  it("falls back to link extraction for non-JSON pastes", () => {
    const result = importBatchJson("watch these: https://youtu.be/aqz-KE-bpKQ and https://youtu.be/jNQXAC9IVRw");
    assert.equal(result.error, null);
    assert.equal(result.items.length, 2);
  });

  it("reports errors for empty and video-less input", () => {
    assert.equal(importBatchJson("").items.length, 0);
    assert.ok(importBatchJson("").error);
    assert.ok(importBatchJson("[]").error);
    assert.ok(importBatchJson("just some words").error);
  });

  it("coerces an unknown preset to the default", () => {
    const json = JSON.stringify([{ id: "jNQXAC9IVRw", preset: "8k-holographic" }]);
    const result = importBatchJson(json, "720p");
    assert.equal(result.items[0].preset, "720p");
  });
});
