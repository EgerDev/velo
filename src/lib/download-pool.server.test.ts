import assert from "node:assert/strict";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  MAX_YTDLP,
  acquireYtdlpSlot,
  isQueueError,
  muxCacheGet,
  muxCachePut,
  queueError,
  wipeMuxCache,
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

/** ≥2048 bytes and an `ftyp` box at offset 4, so peekMedia accepts it. */
function fakeMedia(): Buffer {
  const buf = Buffer.alloc(4096);
  buf.writeUInt32BE(buf.length, 0);
  buf.write("ftypiso5", 4, "ascii");
  return buf;
}

test("a row already removed during muxCacheGet's awaits must not evict an unrelated entry", async (t: TestContext) => {
  const srcDir = await mkdtemp(join(tmpdir(), "velo-pool-test-"));
  t.after(async () => {
    await wipeMuxCache();
    await rm(srcDir, { recursive: true, force: true });
  });
  await wipeMuxCache();

  const write = async (name: string) => {
    const path = join(srcDir, name);
    await writeFile(path, fakeMedia());
    return path;
  };
  const hitB = await muxCachePut("vid-b", 137, await write("b.mp4"), "b.mp4");
  const hitC = await muxCachePut("vid-c", 137, await write("c.mp4"), "c.mp4");
  const hitA = await muxCachePut("vid-a", 137, await write("a.mp4"), "a.mp4");

  // Fixture sanity: all three resolve from the cache before the fault.
  assert.ok(await muxCacheGet("vid-b", 137));
  assert.ok(await muxCacheGet("vid-c", 137));
  assert.ok(await muxCacheGet("vid-a", 137));

  // Delete A's cached file so stat() inside muxCacheGet throws.
  await unlink(hitA.path);

  // Two overlapping gets for A: both find the SAME row synchronously, then
  // both suspend on stat(). The first catch legitimately drops the row; the
  // second catch then runs holding a row that is no longer in the index —
  // the old splice(indexOf(row)) became splice(-1, 1) there, deleting the
  // last healthy entry (C) from the index while orphaning its file on disk.
  const [r1, r2] = await Promise.all([muxCacheGet("vid-a", 137), muxCacheGet("vid-a", 137)]);
  assert.equal(r1, null);
  assert.equal(r2, null);

  // The unrelated entries are still in the index (length and content
  // unchanged by the stale drop: only A's row went away)...
  assert.ok(await muxCacheGet("vid-b", 137), "entry B was dropped by a stale splice");
  assert.ok(await muxCacheGet("vid-c", 137), "entry C was dropped by a stale splice");
  // ...and no unrelated file was unlinked.
  assert.ok((await stat(hitB.path)).size > 0);
  assert.ok((await stat(hitC.path)).size > 0);
  // A itself is fully gone: no index row, no file left behind.
  assert.equal(await muxCacheGet("vid-a", 137), null);
  await assert.rejects(stat(hitA.path));
});
