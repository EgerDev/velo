/**
 * Ordered output over concurrent range requests.
 *
 * YouTube throttles per connection, so pulling a file down as N slices over N
 * connections beats one connection carrying everything. The catch is that the
 * bytes still have to come out in order, which is what makes this more than a
 * `Promise.all`: a lane that runs ahead of the consumer has to hold its bytes
 * until every earlier lane has drained.
 *
 * Holding them without a limit would mean buffering most of the file, so each
 * lane parks once it is sitting on `laneBudget` bytes and resumes when the
 * consumer catches up. Memory is therefore bounded by `bufferBudget` no matter
 * how large the file is: a transfer that fits inside the budget runs fully in
 * parallel, and a larger one keeps every lane warm and pre-fetching instead of
 * idle behind the lane currently being read.
 */

export type ByteRange = { start: number; end: number };

export type OrderedParallelOptions = {
  /** Total bytes expected, used to slice the ranges. */
  size: number;
  /** Maximum concurrent connections. */
  connections: number;
  /** Open one range; reject or throw to fail the whole transfer. */
  openRange: (
    range: ByteRange,
    index: number,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
  /** Smallest slice worth its own connection. Default 2 MiB. */
  minSliceBytes?: number;
  /** Bytes that may sit in memory across all lanes. Default 32 MiB. */
  bufferBudget?: number;
};

const MIB = 1024 * 1024;

/**
 * Split `size` into at most `connections` contiguous ranges, never smaller than
 * `minSliceBytes`. Returns a single range when the file is too small to be
 * worth splitting, and an empty array when there is nothing to fetch.
 */
export function planRanges(size: number, connections: number, minSliceBytes = 2 * MIB): ByteRange[] {
  const total = Number.isFinite(size) ? Math.floor(size) : 0;
  if (total <= 0) return [];
  const wanted = Math.max(1, Math.floor(connections));
  const count = Math.min(wanted, Math.max(1, Math.ceil(total / Math.max(1, minSliceBytes))));
  const slice = Math.ceil(total / count);
  const ranges: ByteRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * slice;
    if (start > total - 1) break;
    ranges.push({ start, end: Math.min(total - 1, start + slice - 1) });
  }
  return ranges;
}

type Lane = {
  chunks: Uint8Array[];
  buffered: number;
  done: boolean;
  /** Set by the producer while it waits for the consumer to drain. */
  resume: (() => void) | null;
};

export function orderedParallelStream(options: OrderedParallelOptions): ReadableStream<Uint8Array> {
  const ranges = planRanges(options.size, options.connections, options.minSliceBytes);
  const abort = new AbortController();
  const lanes: Lane[] = ranges.map(() => ({
    chunks: [],
    buffered: 0,
    done: false,
    resume: null,
  }));
  /**
   * First failure on ANY lane, not just the one being drained. Parking the
   * consumer on a per-lane waiter meant a failure on a later lane stayed
   * invisible: if the lane in front of it stalled without erroring, the stream
   * hung forever on a transfer that was already doomed.
   */
  let failure: unknown = null;
  /** The single consumer's waiter, and the lane index it is parked on. */
  let consumerWake: (() => void) | null = null;
  let waitingFor: number | null = null;
  const budget = options.bufferBudget ?? 32 * MIB;
  const laneBudget = Math.min(
    8 * MIB,
    Math.max(64 * 1024, Math.floor(budget / Math.max(1, lanes.length))),
  );

  // Each handoff reads the slot, clears it, then calls it — so a waiter that
  // immediately re-arms cannot be woken twice by the same handoff.
  const wakeConsumer = () => {
    const waiter = consumerWake;
    consumerWake = null;
    waitingFor = null;
    waiter?.();
  };
  const resumeLane = (lane: Lane) => {
    const waiter = lane.resume;
    lane.resume = null;
    waiter?.();
  };

  async function runLane(index: number): Promise<void> {
    const lane = lanes[index]!;
    const range = ranges[index]!;
    const expected = range.end - range.start + 1;
    let received = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const body = await options.openRange(range, index, abort.signal);
      reader = body.getReader();
      for (;;) {
        // Park while this lane is full. Checking `buffered` and installing
        // `resume` is one synchronous step, so the consumer cannot drain in
        // between and lose the wake-up.
        while (lane.buffered >= laneBudget && !abort.signal.aborted) {
          await new Promise<void>((resolve) => {
            lane.resume = resolve;
          });
        }
        if (abort.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          received += value.byteLength;
          // A hop that ignores `range=` answers with the whole object. Emitting
          // it would splice the head of the file in after this slice, under a
          // Content-Length that has already gone out.
          if (received > expected) {
            throw new Error(`Range ${index} delivered more than its ${expected}-byte slice.`);
          }
          lane.chunks.push(value);
          lane.buffered += value.byteLength;
          if (waitingFor === index) wakeConsumer();
        }
      }
      // A range that ends early still looks like a clean close, so without this
      // the transfer completes "successfully" having emitted fewer bytes than
      // the Content-Length already sent to the client — a truncated file the
      // caller has no way to detect. Better a hard error it can fall back from.
      if (!abort.signal.aborted && received !== expected) {
        throw new Error(
          `Range ${index} ended ${expected - received} bytes short of its ${expected}-byte slice.`,
        );
      }
    } catch (err) {
      failure ??= err ?? new Error("A parallel range request failed.");
    } finally {
      if (reader) await reader.cancel().catch(() => undefined);
      lane.done = true;
      // Wake on failure regardless of which lane the consumer is parked on.
      if (failure !== null || waitingFor === index) wakeConsumer();
    }
  }

  const stopAll = () => {
    abort.abort();
    for (const lane of lanes) {
      lane.chunks = [];
      lane.buffered = 0;
      resumeLane(lane);
    }
    wakeConsumer();
  };

  let current = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!lanes.length) {
        controller.close();
        return;
      }
      // Open every lane now — running them together is the entire point.
      for (let i = 0; i < lanes.length; i++) void runLane(i);
    },
    async pull(controller) {
      for (;;) {
        // Any lane's failure dooms the whole transfer, since the output needs
        // every slice — fail fast rather than emit a prefix or wait on a lane
        // whose bytes will never be usable.
        if (failure !== null) {
          stopAll();
          throw failure;
        }
        if (current >= lanes.length) {
          controller.close();
          return;
        }
        const lane = lanes[current]!;
        const next = lane.chunks.shift();
        if (next) {
          lane.buffered -= next.byteLength;
          resumeLane(lane);
          controller.enqueue(next);
          return;
        }
        if (lane.done) {
          current += 1;
          continue;
        }
        await new Promise<void>((resolve) => {
          consumerWake = resolve;
          waitingFor = current;
        });
      }
    },
    cancel() {
      stopAll();
    },
  });
}
