import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_YTDLP,
  acquireYtdlpSlot,
  isQueueError,
  queueError,
  ytdlpSlotSnapshot,
} from "./download-pool.server.ts";

test("queue error is classified", () => {
  assert.equal(isQueueError(queueError()), true);
  assert.equal(isQueueError(new Error("Lots of people are saving right now.")), true);
  assert.equal(isQueueError(new Error("network")), false);
});

test("yt-dlp slot caps inflight at MAX_YTDLP and queues the rest", async () => {
  const held: Array<() => void> = [];
  for (let i = 0; i < MAX_YTDLP; i++) {
    held.push(await acquireYtdlpSlot());
  }
  assert.equal(ytdlpSlotSnapshot().inflight, MAX_YTDLP);

  let granted = false;
  const waiter = acquireYtdlpSlot().then((release) => {
    granted = true;
    release();
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(granted, false);
  assert.equal(ytdlpSlotSnapshot().queued, 1);

  held.pop()?.();
  await waiter;
  assert.equal(granted, true);

  for (const release of held) release();
  assert.equal(ytdlpSlotSnapshot().inflight, 0);
  assert.equal(ytdlpSlotSnapshot().queued, 0);
});
