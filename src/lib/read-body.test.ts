import assert from "node:assert/strict";
import { test } from "node:test";
import { readBodyToBlob } from "./read-body.ts";

test("a body larger than one spill comes back byte-exact, typed, with progress", async () => {
  const CHUNK = 4 * 1024 * 1024;
  const COUNT = 10; // 40 MB: crosses the 32 MB spill once
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === COUNT) return controller.close();
      controller.enqueue(new Uint8Array(CHUNK).fill(sent % 251));
      sent += 1;
    },
  });
  const size = CHUNK * COUNT;
  const response = new Response(body, {
    headers: { "content-type": "video/mp4", "content-length": String(size) },
  });
  let lastProgress = 0;
  const { blob, loaded, total } = await readBodyToBlob(response, (bytes) => (lastProgress = bytes));
  assert.equal(blob.size, size);
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([loaded, total, lastProgress], [size, size, size]);
  // Bytes either side of the 32 MB spill boundary keep their order.
  const at = async (offset: number) => new Uint8Array(await blob.slice(offset, offset + 1).arrayBuffer())[0];
  assert.equal(await at(8 * CHUNK - 1), 7);
  assert.equal(await at(8 * CHUNK), 8);
  assert.equal(await at(size - 1), 9);
});
