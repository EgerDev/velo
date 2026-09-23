/**
 * Every SPILL_BYTES the buffered chunks become their own Blob and the
 * ArrayBuffers are released. A 256 MB save used to peak at +558 MB of browser
 * memory (chunks and the assembled Blob alive together) — a 4K file would take
 * gigabytes and crash a phone tab. Blob storage can page to disk, and the final
 * Blob composes its parts by reference, so page memory stays near one spill.
 */
const SPILL_BYTES = 32 * 1024 * 1024;

export async function readBodyToBlob(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<{ blob: Blob; loaded: number; total: number }> {
  const total = Number(response.headers.get("content-length")) || 0;
  const type = response.headers.get("content-type") || "application/octet-stream";
  if (!response.body) {
    const blob = await response.blob();
    return { blob, loaded: blob.size, total };
  }
  const reader = response.body.getReader();
  const parts: Blob[] = [];
  let pending: Uint8Array<ArrayBuffer>[] = [];
  let pendingBytes = 0;
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      pending.push(value);
      pendingBytes += value.byteLength;
      loaded += value.byteLength;
      onBytes?.(loaded, total);
      if (pendingBytes >= SPILL_BYTES) {
        parts.push(new Blob(pending));
        pending = [];
        pendingBytes = 0;
      }
    }
  } finally {
    // A rejected read (relay drop, abort) must not leave the body locked.
    reader.releaseLock();
  }
  if (pending.length) parts.push(new Blob(pending));
  return { blob: new Blob(parts, { type }), loaded, total };
}
