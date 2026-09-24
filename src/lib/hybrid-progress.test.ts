import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abandonFile,
  applyPresentedHop,
  applySameHopReport,
  byteTransferPercent,
  emptyTransfer,
  foldMuxView,
  hlsSegmentReport,
  noteFileBytes,
  noteHlsSegments,
  noteStage,
  presentedTransfer,
  settleTransfer,
} from "./transfer-progress.ts";

function bytesMatch(view: { percent: number; loaded?: number; total?: number }) {
  if (view.loaded == null || view.total == null) return;
  const fraction = byteTransferPercent(view.loaded, view.total);
  const expected = fraction != null && fraction >= 100 ? 99 : fraction;
  assert.equal(view.percent, expected);
}

test("presentedTransfer interleavings", async (t) => {
  await t.test("hop 18 then file 1/100 is 1% with loaded 1 total 100", () => {
    let snap = noteStage(emptyTransfer(), "hop", 18);
    snap = noteFileBytes(snap, "file", 1, 100);
    const view = presentedTransfer(snap);
    assert.equal(view.mode, "bytes");
    assert.equal(view.percent, 1);
    assert.notEqual(view.percent, 18);
    assert.equal(view.loaded, 1);
    assert.equal(view.total, 100);
    bytesMatch(view);
  });

  await t.test("hop 18 then hls 50 then hls 100 is 50 then 99 with no bytes", () => {
    let snap = noteStage(emptyTransfer(), "hop", 18);
    snap = noteHlsSegments(snap, 50, 100);
    const mid = presentedTransfer(snap);
    assert.equal(mid.mode, "segments");
    assert.equal(mid.percent, 50);
    assert.equal(mid.loaded, undefined);
    assert.equal(mid.total, undefined);
    assert.notEqual(mid.percent, 59);
    snap = noteHlsSegments(snap, 100, 100);
    const done = presentedTransfer(snap);
    assert.equal(done.mode, "segments");
    assert.equal(done.percent, 99);
    assert.equal(done.loaded, undefined);
    assert.equal(done.total, undefined);
    assert.notEqual(done.percent, 100);
  });

  await t.test("file 10/100 then abandonFile then hls 50 is 50 with no bytes", () => {
    let snap = noteFileBytes(emptyTransfer(), "file", 10, 100);
    assert.equal(presentedTransfer(snap).percent, 10);
    snap = abandonFile(snap);
    snap = noteHlsSegments(snap, 50, 100);
    const view = presentedTransfer(snap);
    assert.equal(view.mode, "segments");
    assert.equal(view.percent, 50);
    assert.notEqual(view.percent, 10);
    assert.equal(view.loaded, undefined);
    assert.equal(view.total, undefined);
  });

  await t.test("file 40/1000 then hls 80 without abandon stays 4% and keeps the file", () => {
    let snap = noteFileBytes(emptyTransfer(), "file", 40, 1000);
    snap = noteHlsSegments(snap, 80, 100);
    const view = presentedTransfer(snap);
    assert.equal(view.mode, "bytes");
    assert.equal(view.percent, 4);
    assert.equal(view.loaded, 40);
    assert.equal(view.total, 1000);
    assert.deepEqual(snap.file.file, { loaded: 40, total: 1000 });
    assert.notEqual(view.percent, 80);
    bytesMatch(view);

    snap = noteFileBytes(snap, "file", 41, 1000);
    const next = presentedTransfer(snap);
    assert.equal(next.mode, "bytes");
    assert.equal(next.loaded, 41);
    assert.equal(next.total, 1000);
    assert.equal(next.percent, byteTransferPercent(41, 1000));
    bytesMatch(next);
  });

  await t.test("hls 80 then file 40/1000 is 4% and does not mix the segment index into loaded", () => {
    const report = hlsSegmentReport(80, 100);
    assert.equal(report.segments, true);
    assert.equal(Object.hasOwn(report, "replace"), false);
    let snap = applySameHopReport(emptyTransfer(), report);
    snap = noteFileBytes(snap, "file", 40, 1000);
    const view = presentedTransfer(snap);
    assert.equal(snap.file.file?.loaded, 40);
    assert.notEqual(snap.file.file?.loaded, 80);
    assert.equal(view.mode, "bytes");
    assert.equal(view.percent, 4);
    assert.equal(view.loaded, 40);
    assert.equal(view.total, 1000);
    bytesMatch(view);
  });

  await t.test("video 80% then audio 10% does not go backward, same for two byte legs", () => {
    let stages = noteStage(emptyTransfer(), "video", 80);
    const videoOnly = presentedTransfer(stages).percent;
    stages = noteStage(stages, "audio", 10);
    assert.ok(presentedTransfer(stages).percent >= videoOnly);

    let bytes = noteFileBytes(emptyTransfer(), "video", 80, 100);
    const leading = presentedTransfer(bytes).percent;
    assert.equal(leading, 80);
    bytes = noteFileBytes(bytes, "audio", 0, 100);
    const withEmpty = presentedTransfer(bytes);
    assert.ok(withEmpty.percent >= leading);
    bytesMatch(withEmpty);
    bytes = noteFileBytes(bytes, "audio", 10, 100);
    const withAudio = presentedTransfer(bytes);
    assert.ok(withAudio.percent >= leading);
    bytesMatch(withAudio);
  });

  await t.test("settle complete is 100; failed and aborted are not 100", () => {
    const full = noteFileBytes(emptyTransfer(), "file", 1000, 1000);
    assert.notEqual(presentedTransfer(full).percent, 100);
    const done = presentedTransfer(settleTransfer(full, "complete"));
    assert.equal(done.phase, "complete");
    assert.equal(done.mode, "complete");
    assert.equal(done.percent, 100);
    const failed = presentedTransfer(settleTransfer(full, "failed"));
    assert.equal(failed.phase, "failed");
    assert.notEqual(failed.phase, "complete");
    assert.notEqual(failed.percent, 100);
    const aborted = presentedTransfer(settleTransfer(full, "aborted"));
    assert.equal(aborted.phase, "aborted");
    assert.notEqual(aborted.phase, "complete");
    assert.notEqual(aborted.percent, 100);
  });

  await t.test("a hop presentation of 1/100 is not floored by the parent's stage 18", () => {
    let parent = noteStage(emptyTransfer(), "hop", 18);
    const hop = presentedTransfer(noteFileBytes(emptyTransfer(), "file", 1, 100));
    parent = applyPresentedHop(parent, hop);
    const view = presentedTransfer(parent);
    assert.equal(view.mode, "bytes");
    assert.equal(view.percent, 1);
    assert.equal(view.loaded, 1);
    assert.equal(view.total, 100);
    bytesMatch(view);
  });

  await t.test("preparing after abandon drops the hop file and leaves server bytes", () => {
    let parent = noteFileBytes(emptyTransfer(), "server", 40, 1000);
    parent = applyPresentedHop(parent, presentedTransfer(noteFileBytes(emptyTransfer(), "file", 10, 100)));
    const abandoned = presentedTransfer(noteStage(abandonFile(noteFileBytes(emptyTransfer(), "file", 10, 100)), "hop", 18));
    assert.equal(abandoned.mode, "preparing");
    parent = applyPresentedHop(parent, abandoned);
    const view = presentedTransfer(parent);
    assert.equal(parent.file.hop, undefined);
    assert.equal(parent.file.server?.loaded, 40);
    assert.equal(view.mode, "bytes");
    assert.equal(view.loaded, 40);
    assert.equal(view.total, 1000);
    assert.equal(view.percent, 4);
    bytesMatch(view);
  });

  await t.test("server bytes survive a same-hop abandon and the next byte tick", () => {
    let parent = noteFileBytes(emptyTransfer(), "server", 40, 1000);
    parent = applyPresentedHop(parent, presentedTransfer(noteFileBytes(emptyTransfer(), "file", 10, 100)));
    assert.equal(parent.file.server?.loaded, 40);
    assert.equal(parent.file.hop?.loaded, 10);
    let hop = noteFileBytes(noteStage(emptyTransfer(), "hop", 18), "file", 10, 100);
    hop = noteHlsSegments(abandonFile(hop), 80, 100);
    parent = applyPresentedHop(parent, presentedTransfer(hop));
    const view = presentedTransfer(parent);
    assert.equal(parent.file.hop, undefined);
    assert.equal(parent.file.server?.loaded, 40);
    assert.equal(view.mode, "bytes");
    assert.equal(view.percent, 4);
    assert.equal(view.loaded, 40);
    assert.equal(view.total, 1000);
    assert.notEqual(view.percent, 80);
    bytesMatch(view);
    parent = noteFileBytes(parent, "server", 41, 1000);
    const next = presentedTransfer(parent);
    assert.equal(next.loaded, 41);
    assert.equal(next.total, 1000);
    assert.equal(next.percent, byteTransferPercent(41, 1000));
    assert.equal(next.mode, "bytes");
    bytesMatch(next);
  });
});

test("foldMuxView keeps each child view's bytes or segments", () => {
  const video = presentedTransfer(noteFileBytes(emptyTransfer(), "file", 500, 1000));
  const audio = presentedTransfer(noteFileBytes(emptyTransfer(), "file", 100, 100));
  let snap = foldMuxView(emptyTransfer(), "video", video);
  snap = foldMuxView(snap, "audio", audio);
  const view = presentedTransfer(snap);
  assert.equal(view.mode, "bytes");
  assert.notEqual(view.mode, "preparing");
  assert.equal(view.loaded, 600);
  assert.equal(view.total, 1100);
  assert.equal(view.percent, byteTransferPercent(600, 1100));
  assert.equal(view.percent, 55);
  assert.notEqual(view.percent, 75);
  bytesMatch(view);

  const segments = presentedTransfer(noteHlsSegments(emptyTransfer(), 80, 100));
  let live = foldMuxView(emptyTransfer(), "video", presentedTransfer(noteFileBytes(emptyTransfer(), "file", 40, 1000)));
  live = foldMuxView(live, "audio", segments);
  const held = presentedTransfer(live);
  assert.equal(live.file.video?.loaded, 40);
  assert.equal(live.file.audio, undefined);
  assert.equal(held.mode, "bytes");
  assert.equal(held.percent, 4);
  assert.equal(held.loaded, 40);
  assert.equal(held.total, 1000);
  assert.notEqual(held.percent, 80);
  bytesMatch(held);

  let playlists = foldMuxView(
    emptyTransfer(),
    "video",
    presentedTransfer(noteHlsSegments(emptyTransfer(), 50, 100)),
  );
  playlists = foldMuxView(playlists, "audio", presentedTransfer(noteHlsSegments(emptyTransfer(), 50, 100)));
  const playlistView = presentedTransfer(playlists);
  assert.equal(playlistView.mode, "segments");
  assert.equal(playlistView.percent, 50);
  assert.equal(playlistView.loaded, undefined);
  assert.equal(playlistView.total, undefined);
  assert.equal(playlists.file.video, undefined);
  assert.equal(playlists.file.audio, undefined);
});
