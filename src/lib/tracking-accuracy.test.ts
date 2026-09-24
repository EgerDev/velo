import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChapters } from "./chapters.ts";
import { calculateQueueStats, type BulkItem } from "./bulk-download.ts";
import {
  HISTORY_OWNER_KEY,
  commitHistoryShelf,
  historyRowForSave,
  readPersistedShelf,
  reconcilePersistedShelf,
  shelfStorageKey,
  useHistoryStore,
  writePersistedShelf,
} from "./history-store.ts";
import {
  EpochMillisecondsSchema,
  type SafeProxyView,
} from "./proxy-operations.ts";
import {
  displayRouteStatus,
  evidenceFreshness,
  proxyPoolSummary,
  validationRunControls,
} from "./proxy-ui-presenters.ts";
import { describeSessionStatus, SESSION_EXPIRING_MS } from "./session-status.ts";
import { compareVersions, toolStatus, toolStatusLabel } from "./tool-versions.ts";
import { validateTimeRange } from "./time-trimmer.ts";
import {
  formatCueTime,
  formatSrtTime,
  formatVttTime,
  parseTimeToSeconds,
  parseWebVttIntoCues,
} from "./transcript.ts";
import {
  byteTransferPercent,
  emptyTransfer,
  foldTransferProgress,
  noteFileBytes,
  noteStage,
  presentedTransfer,
  settleTransfer,
} from "./transfer-progress.ts";
import {
  codecFromMime,
  formatBytes,
  formatCompactCount,
  formatDuration,
  formatPublished,
  formatViews,
} from "./youtube-parse.ts";

const NOW = 1_700_000_000_000;
const secs = (ms: number) => Math.floor(ms / 1000);

function jar(rows: Array<{ name: string; expires: number }>): string {
  return [
    "# Netscape HTTP Cookie File",
    ...rows.map((row) => `.youtube.com\tTRUE\t/\tTRUE\t${row.expires}\t${row.name}\tvalue`),
  ].join("\n");
}

function bulkItem(patch: Partial<BulkItem> & Pick<BulkItem, "id" | "status">): BulkItem {
  return {
    url: "",
    title: null,
    author: null,
    duration: null,
    durationFormatted: null,
    thumbnail: null,
    progress: 0,
    preset: "1080p",
    sizeFormatted: null,
    filename: null,
    downloadUrl: null,
    error: null,
    retryCount: 0,
    selectedItag: null,
    selectedAudioItag: null,
    ...patch,
  };
}

function route(id: string, overrides: Partial<SafeProxyView> = {}): SafeProxyView {
  return {
    id: id as SafeProxyView["id"],
    routeRef: `ref-${id}`,
    maskedLabel: `HTTP ${id}`,
    protocol: "http",
    priority: 1 as SafeProxyView["priority"],
    enabled: true,
    eligible: true,
    verdict: "unknown",
    stale: false,
    lastCheckedAt: null,
    evidence: [],
    ...overrides,
  };
}

const save = {
  id: "vid-accuracy",
  title: "Accurate cut",
  author: "Ada",
  thumbnail: "https://i.ytimg.com/vi/vid-accuracy/hqdefault.jpg",
  duration: 125,
  url: "https://www.youtube.com/watch?v=vid-accuracy",
  itag: 137,
  preset: "Full HD",
  ext: "mp4",
};

test("formatters: null, zero, sub-minute, over an hour, and byte and view boundaries", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(3661), "1:01:01");

  assert.equal(formatBytes(null), "Size varies");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.00 KB");
  assert.equal(formatBytes(1024 * 1024), "1.00 MB");

  assert.equal(formatViews(null), "");
  assert.equal(formatViews(0), "0 views");
  assert.equal(formatViews(999), "999 views");
  assert.equal(formatViews(1_000), "1.0K views");
  assert.equal(formatViews(1_500), "1.5K views");
  assert.equal(formatViews(1_000_000), "1.0M views");
  assert.equal(formatViews(1_000_000_000), "1.0B views");
  assert.equal(formatCompactCount(0, "likes"), "0 likes");
  assert.equal(formatCompactCount(2_500_000_000, "likes"), "2.5B likes");

  assert.equal(formatPublished(null), "");
  assert.equal(formatPublished("not-a-date"), "");
  const published = formatPublished("2020-06-15T12:00:00.000Z");
  assert.match(published, /2020/);
  assert.equal(published, formatPublished("2020-06-15T12:00:00.000Z"));

  assert.equal(codecFromMime('video/mp4; codecs="avc1.64001F"'), "H.264");
  assert.equal(codecFromMime('video/webm; codecs="vp9"'), "VP9");
});

test("cue times keep SRT and VTT milliseconds, and chapter and trim ranges follow the source", () => {
  assert.equal(Math.round(parseTimeToSeconds("00:01:02,345") * 1000), 62_345);
  assert.equal(Math.round(parseTimeToSeconds("00:01:02.345") * 1000), 62_345);
  assert.equal(formatSrtTime(62.345), "00:01:02,345");
  assert.equal(formatVttTime(62.345), "00:01:02.345");
  assert.equal(formatCueTime(62.345), "01:02.345");
  assert.equal(formatCueTime(62), "01:02");

  const srt = parseWebVttIntoCues("1\n00:01:02,345 --> 00:01:05,500\nHello there\n");
  assert.equal(Math.round(srt[0]!.start * 1000), 62_345);
  assert.equal(Math.round(srt[0]!.end * 1000), 65_500);
  assert.equal(srt[0]!.startFormatted, "01:02.345");
  assert.equal(srt[0]!.endFormatted, "01:05.500");

  const vtt = parseWebVttIntoCues("WEBVTT\n\n00:00:01.250 --> 00:00:02.000\nHi\n");
  assert.equal(Math.round(vtt[0]!.start * 1000), 1_250);
  assert.equal(vtt[0]!.end, 2);
  assert.equal(vtt[0]!.startFormatted, "00:01.250");

  const chapters = parseChapters("0:00 Intro\n1:02:03 Middle\n1:05:00 End", 4000);
  assert.equal(chapters[1]!.start, 3723);
  assert.equal(chapters[0]!.end, chapters[1]!.start);
  assert.equal(chapters[1]!.end, chapters[2]!.start);
  assert.equal(chapters[2]!.end, 4000);

  const clip = validateTimeRange(65, 125, 3600);
  assert.equal(clip.valid, true);
  assert.equal(clip.start, 65);
  assert.equal(clip.end, 125);
  assert.equal(clip.duration, 60);
});

test("transfer percent is the byte fraction, does not walk backward, and hits 100 only after success", () => {
  assert.equal(byteTransferPercent(0, 100), 0);
  assert.equal(byteTransferPercent(1, 3), 33);
  assert.equal(byteTransferPercent(512, 1024), 50);
  assert.equal(byteTransferPercent(1024, 4096), 25);
  assert.equal(byteTransferPercent(50, 0), null);

  const half = presentedTransfer(
    foldTransferProgress(emptyTransfer(), { id: "file", loaded: 50, total: 100, percent: 95 }),
  );
  assert.equal(half.percent, 50);
  assert.equal(half.loaded, 50);
  assert.equal(half.total, 100);
  assert.equal(half.phase, "running");
  const tiny = presentedTransfer(
    foldTransferProgress(emptyTransfer(), { id: "file", loaded: 1, total: 100, percent: 10 }),
  );
  assert.equal(tiny.percent, 1);
  const full = noteFileBytes(emptyTransfer(), "file", 1000, 1000);
  const fullView = presentedTransfer(full);
  assert.notEqual(fullView.percent, 100);
  assert.equal(fullView.phase, "running");

  let legs = noteStage(emptyTransfer(), "video", 80);
  const videoOnly = presentedTransfer(legs).percent;
  legs = noteStage(legs, "audio", 10);
  assert.ok(
    presentedTransfer(legs).percent >= videoOnly,
    `audio tick moved ${videoOnly} back to ${presentedTransfer(legs).percent}`,
  );
  legs = noteStage(legs, "video", 90);
  assert.ok(presentedTransfer(legs).percent >= videoOnly);

  let bytes = noteFileBytes(emptyTransfer(), "video", 80, 100);
  assert.equal(presentedTransfer(bytes).percent, 80);
  bytes = noteFileBytes(bytes, "audio", 0, 100);
  assert.ok(presentedTransfer(bytes).percent >= 80);
  bytes = noteFileBytes(bytes, "audio", 10, 100);
  assert.ok(presentedTransfer(bytes).percent >= 80);

  const done = presentedTransfer(settleTransfer(full, "complete"));
  assert.equal(done.phase, "complete");
  assert.equal(done.percent, 100);
  const failed = presentedTransfer(settleTransfer(full, "failed"));
  assert.notEqual(failed.phase, "complete");
  assert.notEqual(failed.percent, 100);
  const aborted = presentedTransfer(settleTransfer(noteStage(emptyTransfer(), "save", 100), "aborted"));
  assert.equal(aborted.phase, "aborted");
  assert.notEqual(aborted.percent, 100);
});

test("session level follows the jar at the clock that was passed in", () => {
  assert.equal(describeSessionStatus("", NOW).level, "none");
  assert.equal(describeSessionStatus("this is not a cookie export", NOW).level, "unreadable");

  const future = secs(NOW) + 90 * 24 * 60 * 60;
  assert.equal(
    describeSessionStatus(jar([{ name: "VISITOR_INFO1_LIVE", expires: future }]), NOW).level,
    "incomplete",
  );

  const past = secs(NOW) - 60;
  const expired = describeSessionStatus(
    jar([
      { name: "__Secure-1PSID", expires: past },
      { name: "SID", expires: future },
      { name: "SAPISID", expires: future },
    ]),
    NOW,
  );
  assert.equal(expired.level, "expired");
  assert.notEqual(expired.level, "ready");

  const exactly = secs(NOW) + SESSION_EXPIRING_MS / 1000;
  const onTheDot = describeSessionStatus(
    jar([
      { name: "SID", expires: exactly },
      { name: "SAPISID", expires: exactly },
    ]),
    NOW,
  );
  assert.equal(onTheDot.level, "ready");

  const twenty = describeSessionStatus(
    jar([
      { name: "SID", expires: secs(NOW) + 20 * 60 },
      { name: "SAPISID", expires: secs(NOW) + 20 * 60 },
    ]),
    NOW,
  );
  assert.equal(twenty.level, "expiring");
  assert.equal(twenty.label, "Session ends in 20 minutes");

  const inside = describeSessionStatus(
    jar([
      { name: "SID", expires: exactly - 1 },
      { name: "SAPISID", expires: exactly - 1 },
    ]),
    NOW,
  );
  assert.equal(inside.level, "expiring");
});

test("tool status compares dotted numbers and pre-releases, and the row uses that label", () => {
  assert.equal(compareVersions("9", "10"), -1);
  assert.equal(compareVersions("10", "9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(toolStatus("9.0.0", "10.0.0").status, "behind");
  assert.equal(toolStatus("10.0.0", "9.0.0").status, "ahead");
  assert.equal(toolStatus(null, "1.0.0").status, "missing");
  assert.equal(toolStatus("1.0.0", null).status, "unknown");
  assert.equal(toolStatus("1.2.3", "1.2.3").status, "current");
  assert.equal(toolStatusLabel("behind"), "Update available");
  assert.equal(toolStatusLabel("current"), "Up to date");
  assert.equal(toolStatusLabel("missing"), "Not installed");
  assert.equal(toolStatusLabel("unknown"), "Registry unreachable");
  assert.equal(toolStatusLabel("ahead"), "Ahead");
});

test("proxy counts stay overlapping, and freshness and controls follow the clock and the run", () => {
  const summary = proxyPoolSummary([
    route("both", {
      verdict: "degraded",
      stale: true,
      enabled: false,
      lastCheckedAt: EpochMillisecondsSchema.parse(1_000),
    }),
    route("ok", { verdict: "healthy" }),
  ]);
  assert.equal(summary.degraded, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.disabled, 1);
  assert.equal(summary.healthy, 1);
  assert.ok(summary.degraded + summary.stale + summary.disabled > 1);

  assert.equal(displayRouteStatus(route("held", { eligible: false, verdict: "healthy" })).label, "Held from routing");
  assert.equal(displayRouteStatus(route("off", { enabled: false, verdict: "degraded" })).label, "Disabled");
  assert.equal(displayRouteStatus(route("bad", { verdict: "unreachable" })).label, "Unreachable");

  const hour = 3_600_000;
  const now = 5_000_000_000;
  assert.equal(
    evidenceFreshness({ lastCheckedAt: EpochMillisecondsSchema.parse(now - hour), stale: false }, now),
    "Evidence older than one hour",
  );
  assert.equal(
    evidenceFreshness({ lastCheckedAt: EpochMillisecondsSchema.parse(now - hour + 1), stale: false }, now),
    "Evidence current",
  );
  assert.equal(
    evidenceFreshness({ lastCheckedAt: EpochMillisecondsSchema.parse(now - 1_000), stale: true }, now),
    "Evidence older than one hour",
  );
  assert.equal(evidenceFreshness({ lastCheckedAt: null, stale: false }, now), "No completed check");

  assert.deepEqual(validationRunControls(null), {
    canResume: false,
    canCancel: false,
    cancelLabel: "Cancel run",
  });
  assert.deepEqual(
    validationRunControls({ status: "pending", total: 4, completed: 1, cancelRequested: false }),
    { canResume: true, canCancel: true, cancelLabel: "Cancel run" },
  );
  assert.equal(
    validationRunControls({ status: "failed", total: 4, completed: 2, cancelRequested: false }).canCancel,
    true,
  );
  assert.equal(
    validationRunControls({ status: "failed", total: 4, completed: 2, cancelRequested: false }).cancelLabel,
    "Cancel remaining checks",
  );
  assert.equal(
    validationRunControls({ status: "pending", total: 4, completed: 1, cancelRequested: true }).canResume,
    false,
  );
  assert.equal(
    validationRunControls({ status: "completed", total: 4, completed: 4, cancelRequested: false }).canCancel,
    false,
  );
});

test("bulk counts follow each item's own status, including a failed row that still says 100", () => {
  const stats = calculateQueueStats([
    bulkItem({ id: "done", status: "completed", progress: 100 }),
    bulkItem({ id: "bad", status: "failed", progress: 100 }),
    bulkItem({ id: "skip", status: "skipped", progress: 0 }),
    bulkItem({ id: "wait", status: "pending", progress: 0 }),
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.completed, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.ready, 0);
  assert.equal(stats.downloading, 0);
  assert.equal(stats.totalProgress, 25);
  assert.equal(stats.isAllDone, false);
});

test("history is written only for a finished save, stays on that owner, and survives a storage failure", () => {
  assert.equal(historyRowForSave(null), null);

  const row = historyRowForSave(save);
  assert.ok(row);
  assert.equal(row.lastItag, 137);
  assert.equal(row.lastPreset, "Full HD");
  assert.equal(row.lastExt, "mp4");

  useHistoryStore.getState().adoptOwner("u:accuracy");
  useHistoryStore.getState().clear();
  useHistoryStore.getState().record(row);
  const fresh = readPersistedShelf("u:accuracy").items[0];
  assert.equal(fresh?.id, "vid-accuracy");
  assert.equal(fresh?.title, "Accurate cut");
  assert.equal(fresh?.lastItag, 137);
  assert.equal(fresh?.lastPreset, "Full HD");
  assert.equal(fresh?.lastExt, "mp4");

  writePersistedShelf("u:accuracy", {
    items: [{ ...fresh!, id: "vid-other-tab", title: "From the other tab", lastItag: 22, lastPreset: "Audio", lastExt: "m4a" }, fresh!],
    lastPresetId: null,
  });
  reconcilePersistedShelf(shelfStorageKey("u:accuracy"));
  const replayed = useHistoryStore.getState().items[0];
  assert.equal(replayed?.title, "From the other tab");
  assert.equal(replayed?.lastItag, 22);
  assert.equal(replayed?.lastPreset, "Audio");
  assert.equal(replayed?.lastExt, "m4a");
  assert.equal(readPersistedShelf("u:accuracy").items[0]?.lastExt, replayed?.lastExt);

  useHistoryStore.getState().adoptOwner("u:someone-else");
  assert.equal(useHistoryStore.getState().items.find((item) => item.title === "Accurate cut"), undefined);
  useHistoryStore.getState().adoptOwner("u:accuracy");
  useHistoryStore.getState().clear();
  assert.equal(useHistoryStore.getState().items.length, 0);
  assert.equal(readPersistedShelf("u:accuracy").items.length, 0);

  const removed: string[] = [];
  const map = new Map<string, string>();
  let fail = false;
  const store: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new Error("quota");
      map.set(key, value);
    },
    removeItem: (key) => {
      removed.push(key);
      map.delete(key);
    },
  };
  const owner = "u:quota";
  assert.equal(
    commitHistoryShelf(store, owner, {
      items: [{ ...fresh!, downloadedAt: 1 }],
      lastPresetId: null,
    }),
    true,
  );
  const pointer = store.getItem(HISTORY_OWNER_KEY);
  const shelf = store.getItem(shelfStorageKey(owner));
  assert.equal(pointer, owner);
  fail = true;
  assert.equal(
    commitHistoryShelf(store, owner, {
      items: Array.from({ length: 40 }, (_, index) => ({ ...fresh!, id: `bulk-${index}`, downloadedAt: index })),
      lastPresetId: null,
    }),
    false,
  );
  assert.equal(store.getItem(HISTORY_OWNER_KEY), pointer);
  assert.equal(store.getItem(shelfStorageKey(owner)), shelf);
  assert.equal(JSON.parse(shelf ?? "{}").items.length, 1);
  assert.equal(removed.includes(HISTORY_OWNER_KEY), false);
});
