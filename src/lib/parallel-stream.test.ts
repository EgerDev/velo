import assert from "node:assert/strict";
import { test } from "node:test";
import { orderedParallelStream, planRanges, type ByteRange } from "./parallel-stream.ts";

function bytes(range: ByteRange): Uint8Array {
  const out = new Uint8Array(range.end - range.start + 1);
  for (let i = 0; i < out.length; i++) out[i] = (range.start + i) % 251;
  return out;
}

/** Emits `range` in `chunks` pieces, awaiting a tick between each. */
function slowStream(range: ByteRange, chunks = 4): ReadableStream<Uint8Array> {
  const payload = bytes(range);
  const size = Math.ceil(payload.length / chunks);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= payload.length) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      controller.enqueue(payload.subarray(offset, Math.min(payload.length, offset + size)));
      offset += size;
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    parts.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

test("planRanges splits without gaps or overlap and respects the minimum slice", () => {
  const ranges = planRanges(1000, 4, 100);
  assert.equal(ranges.length, 4);
  assert.equal(ranges[0]!.start, 0);
  assert.equal(ranges.at(-1)!.end, 999);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i]!.start, ranges[i - 1]!.end + 1);
  }
  // Too small to be worth splitting.
  assert.deepEqual(planRanges(500, 4, 1000), [{ start: 0, end: 499 }]);
  // Nothing to fetch.
  assert.deepEqual(planRanges(0, 4), []);
  assert.deepEqual(planRanges(Number.NaN, 4), []);
});

test("reassembles every lane in byte order", async () => {
  const size = 4096;
  const stream = orderedParallelStream({
    size,
    connections: 4,
    minSliceBytes: 512,
    openRange: async (range) => slowStream(range),
  });
  const out = await drain(stream);
  assert.equal(out.byteLength, size);
  assert.deepEqual(out, bytes({ start: 0, end: size - 1 }));
});

test("opens every lane concurrently instead of draining one at a time", async () => {
  let open = 0;
  let peak = 0;
  const stream = orderedParallelStream({
    size: 4096,
    connections: 4,
    minSliceBytes: 512,
    openRange: async (range) => {
      open += 1;
      peak = Math.max(peak, open);
      const inner = slowStream(range);
      // Count the lane as in-flight until its body is fully produced.
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          for await (const chunk of inner as unknown as AsyncIterable<Uint8Array>) {
            controller.enqueue(chunk);
          }
          open -= 1;
          controller.close();
        },
      });
    },
  });
  await drain(stream);
  // Sequential draining would never hold more than one lane open at a time.
  assert.equal(peak, 4);
});

test("a lane running ahead parks instead of buffering without limit", async () => {
  const size = 4 * 1024 * 1024;
  let produced = 0;
  const stream = orderedParallelStream({
    size,
    connections: 4,
    minSliceBytes: 64 * 1024,
    // Small budget so the far lanes hit it quickly.
    bufferBudget: 4 * 64 * 1024,
    openRange: async (range) => {
      const payload = bytes(range);
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset >= payload.length) {
            controller.close();
            return;
          }
          const end = Math.min(payload.length, offset + 16 * 1024);
          produced += end - offset;
          controller.enqueue(payload.subarray(offset, end));
          offset = end;
        },
      });
    },
  });

  const reader = stream.getReader();
  await reader.read();
  // Let every lane run until it parks against its budget.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Without backpressure the lanes would have raced to the full 4 MiB.
  assert.ok(
    produced < size / 2,
    `expected lanes to park well before the full file, produced ${produced} of ${size}`,
  );
  await reader.cancel();
});

test("a failing lane errors the stream and aborts the rest", async () => {
  const opened: number[] = [];
  const signals: AbortSignal[] = [];
  const stream = orderedParallelStream({
    size: 4096,
    connections: 4,
    minSliceBytes: 512,
    openRange: async (range, index, signal) => {
      opened.push(index);
      signals.push(signal);
      if (index === 1) throw new Error("A parallel range request was blocked.");
      return slowStream(range, 64);
    },
  });
  await assert.rejects(drain(stream), /blocked/);
  assert.equal(opened.length, 4);
  // Assert the teardown actually happened, rather than only that the stream
  // rejected — the surviving lanes must not keep fetching.
  assert.ok(signals.length > 0);
  assert.ok(
    signals.every((signal) => signal.aborted),
    "every lane's signal should be aborted after a sibling fails",
  );
});

test("a lane that ends short of its range fails instead of truncating silently", async () => {
  // A short read looks like a clean close. Emitting it as success produced a
  // truncated file under a Content-Length that promised more.
  const size = 4096;
  const stream = orderedParallelStream({
    size,
    connections: 4,
    minSliceBytes: 512,
    openRange: async (range, index) => {
      const full = range.end - range.start + 1;
      const limit = index === 2 ? Math.floor(full / 2) : full;
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= limit) {
            controller.close();
            return;
          }
          const n = Math.min(64, limit - sent);
          controller.enqueue(new Uint8Array(n));
          sent += n;
        },
      });
    },
  });
  await assert.rejects(drain(stream), /ended 512 bytes short/);
});

test("a failure on a later lane surfaces even while an earlier lane stalls", async () => {
  // The consumer parks on lane 0. Lane 1 fails immediately. Waking only the
  // lane being drained meant the doomed transfer hung forever.
  const stream = orderedParallelStream({
    size: 4096,
    connections: 4,
    minSliceBytes: 512,
    openRange: async (range, index) => {
      if (index === 0) {
        return new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
      }
      if (index === 1) throw new Error("real failure on a later lane");
      return slowStream(range);
    },
  });
  const reader = stream.getReader();
  const outcome = await Promise.race([
    reader.read().then(
      () => "resolved",
      (err: Error) => `rejected: ${err.message}`,
    ),
    new Promise((resolve) => setTimeout(() => resolve("HUNG"), 2000)),
  ]);
  assert.equal(outcome, "rejected: real failure on a later lane");
});

test("cancelling while lanes are parked at their budget does not hang", async () => {
  // Exercises the delicate path: producers asleep on `resume` when stopAll fires.
  const stream = orderedParallelStream({
    size: 1024 * 1024,
    connections: 4,
    minSliceBytes: 64 * 1024,
    bufferBudget: 4 * 64 * 1024,
    openRange: async (range) => {
      const payload = bytes(range);
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= payload.length) {
            controller.close();
            return;
          }
          const end = Math.min(payload.length, offset + 8 * 1024);
          controller.enqueue(payload.subarray(offset, end));
          offset = end;
        },
      });
    },
  });
  const reader = stream.getReader();
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const cancelled = await Promise.race([
    reader.cancel().then(() => "cancelled"),
    new Promise((resolve) => setTimeout(() => resolve("HUNG"), 2000)),
  ]);
  assert.equal(cancelled, "cancelled");
});

test("cancelling the reader aborts the lanes", async () => {
  let signalled: AbortSignal | null = null;
  const stream = orderedParallelStream({
    size: 4096,
    connections: 2,
    minSliceBytes: 512,
    openRange: async (range, _index, signal) => {
      signalled = signal;
      return slowStream(range, 64);
    },
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal((signalled as unknown as AbortSignal | null)?.aborted, true);
});

test("an empty transfer closes cleanly", async () => {
  const out = await drain(
    orderedParallelStream({
      size: 0,
      connections: 4,
      openRange: async () => {
        throw new Error("should not open a range");
      },
    }),
  );
  assert.equal(out.byteLength, 0);
});

test("a lane that delivers more than its range fails instead of splicing the head of the file in", async () => {
  // A hop that ignores `range=` answers with the whole object. The old guard
  // was one-sided, so the extra bytes went out under the already-sent size.
  const size = 1000;
  const stream = orderedParallelStream({
    size,
    connections: 4,
    minSliceBytes: 100,
    openRange: async () => slowStream({ start: 0, end: size - 1 }, 4),
  });
  await assert.rejects(drain(stream), /delivered more than its 250-byte slice/);
});
