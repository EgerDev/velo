/**
 * Caps yt-dlp/ffmpeg so a Grok sandbox cannot OOM when many people Save at once.
 * Same video:itag is coalesced and served from a short disk cache.
 */
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { looksLikeFragment } from "./iso-bmff.ts";

export const MAX_YTDLP = 4;
export const MAX_QUEUE = 32;
export const SLOT_WAIT_MS = 45_000;
const CACHE_DIR = join(tmpdir(), "velo-mux-cache");
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ITEMS = 4;
const CACHE_MAX_BYTES = 400 * 1024 * 1024;

type SlotWaiter = {
  grant: () => void;
  fail: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let inflight = 0;
const waiters: SlotWaiter[] = [];

function flushSlots() {
  while (inflight < MAX_YTDLP && waiters.length) {
    const next = waiters.shift();
    if (!next) break;
    clearTimeout(next.timer);
    inflight += 1;
    next.grant();
  }
}

export function ytdlpSlotSnapshot(): { inflight: number; queued: number } {
  return { inflight, queued: waiters.length };
}

export function acquireYtdlpSlot(signal?: AbortSignal, waitMs = SLOT_WAIT_MS): Promise<() => void> {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inflight = Math.max(0, inflight - 1);
    flushSlots();
  };
  if (signal?.aborted) return Promise.reject(new Error("aborted"));
  if (inflight < MAX_YTDLP) {
    inflight += 1;
    return Promise.resolve(release);
  }
  if (waiters.length >= MAX_QUEUE) {
    return Promise.reject(queueError());
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(entry);
      if (idx >= 0) waiters.splice(idx, 1);
      signal?.removeEventListener("abort", onAbort);
      reject(queueError());
    }, waitMs);
    const entry: SlotWaiter = {
      grant: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(release);
      },
      fail: reject,
      timer,
    };
    const onAbort = () => {
      const idx = waiters.indexOf(entry);
      if (idx >= 0) waiters.splice(idx, 1);
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(entry);
  });
}

export function queueError(): Error {
  return Object.assign(
    new Error("Lots of people are saving right now. Wait a few seconds and try again."),
    { code: "queue" as const },
  );
}

export function isQueueError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && (err as { code?: string }).code === "queue") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /lots of people are saving|queue is full|download queue/i.test(msg);
}

export type FileHit = { path: string; filename: string; size: number };

type CacheRow = FileHit & { key: string; at: number };

const cacheIndex: CacheRow[] = [];
const coalesced = new Map<string, Promise<FileHit>>();

function cacheKey(id: string, itag: number): string {
  return `${id}.${itag}`;
}

async function peekMedia(path: string): Promise<boolean> {
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fh.read(buf, 0, 512, 0);
      if (bytesRead < 8) return false;
      return looksLikeFragment(buf.subarray(0, bytesRead)) !== null;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

async function evictIfNeeded(incoming: number) {
  const now = Date.now();
  for (let i = cacheIndex.length - 1; i >= 0; i--) {
    const row = cacheIndex[i]!;
    if (now - row.at > CACHE_TTL_MS) {
      cacheIndex.splice(i, 1);
      await unlink(row.path).catch(() => undefined);
    }
  }
  let total = cacheIndex.reduce((sum, row) => sum + row.size, 0) + incoming;
  while (cacheIndex.length >= CACHE_MAX_ITEMS || total > CACHE_MAX_BYTES) {
    const oldest = cacheIndex.sort((a, b) => a.at - b.at).shift();
    if (!oldest) break;
    total -= oldest.size;
    await unlink(oldest.path).catch(() => undefined);
  }
}

/**
 * Drop `row` from the cache index, located by its stable identity (key +
 * path) rather than `indexOf(row)`. `muxCacheGet` holds a row reference
 * across disk awaits, and a concurrent muxCachePut / evictIfNeeded can
 * remove that row (and unlink its file) in the meantime; `indexOf` then
 * returned -1 and `splice(-1, 1)` silently deleted the LAST, healthy entry
 * while leaving its file orphaned on disk. Matching on path as well as key
 * means a stale reference can never target a same-key replacement row.
 * Returns the removed row, or null when another path already dropped (and
 * unlinked) it — in which case there is nothing left to do.
 */
function dropCacheRow(row: CacheRow): CacheRow | null {
  const idx = cacheIndex.findIndex((item) => item.key === row.key && item.path === row.path);
  if (idx < 0) return null;
  return cacheIndex.splice(idx, 1)[0] ?? null;
}

export async function muxCacheGet(id: string, itag: number): Promise<FileHit | null> {
  const key = cacheKey(id, itag);
  const row = cacheIndex.find((item) => item.key === key);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_TTL_MS) {
    const dropped = dropCacheRow(row);
    if (dropped) await unlink(dropped.path).catch(() => undefined);
    return null;
  }
  try {
    const info = await stat(row.path);
    if (info.size < 2048) return null;
    row.size = info.size;
    row.at = Date.now();
    if (!(await peekMedia(row.path))) return null;
    return { path: row.path, filename: row.filename, size: info.size };
  } catch {
    const dropped = dropCacheRow(row);
    if (dropped) await unlink(dropped.path).catch(() => undefined);
    return null;
  }
}

export async function muxCachePut(
  id: string,
  itag: number,
  srcPath: string,
  filename: string,
): Promise<FileHit> {
  await mkdir(CACHE_DIR, { recursive: true });
  const info = await stat(srcPath);
  // Drop our own previous row BEFORE evicting: re-saving an already-cached
  // video is a replacement, and counting it as an insert evicted an unrelated
  // video that then had to be re-muxed from scratch.
  const key = cacheKey(id, itag);
  const prev = cacheIndex.find((item) => item.key === key);
  if (prev) {
    cacheIndex.splice(cacheIndex.indexOf(prev), 1);
    await unlink(prev.path).catch(() => undefined);
  }
  await evictIfNeeded(info.size);
  const dest = join(CACHE_DIR, `${key}-${Date.now()}${extOf(filename)}`);
  await copyFile(srcPath, dest);
  const hit: FileHit = { path: dest, filename, size: info.size };
  cacheIndex.push({ ...hit, key, at: Date.now() });
  return hit;
}

function extOf(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : ".mp4";
  return /^\.[a-z0-9]{1,5}$/i.test(ext) ? ext : ".mp4";
}

export function coalesceFile(key: string, produce: () => Promise<FileHit>): Promise<FileHit> {
  const existing = coalesced.get(key);
  if (existing) return existing;
  const pending = produce().finally(() => {
    if (coalesced.get(key) === pending) coalesced.delete(key);
  });
  coalesced.set(key, pending);
  return pending;
}

export async function looksLikeMediaFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (info.size < 2048) return false;
    return peekMedia(path);
  } catch {
    return false;
  }
}

export function mediaFileResponse(
  path: string,
  filename: string,
  client: string,
  auth: string,
  size: number,
  onClose?: () => void,
): Response {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
  const mime =
    ext === "webm" ? "video/webm" : ext === "m4a" || ext === "mp3" ? "audio/mp4" : "video/mp4";
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  stream.on("close", done);
  stream.on("error", done);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": "attachment",
      "Cache-Control": "no-store",
      "X-Velo-Client": client,
      "X-Velo-Auth": auth,
    },
  });
}

export async function wipeMuxCache(): Promise<void> {
  cacheIndex.length = 0;
  coalesced.clear();
  await rm(CACHE_DIR, { recursive: true, force: true }).catch(() => undefined);
}
