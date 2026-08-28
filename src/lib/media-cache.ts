import { looksLikeMediaFile } from "./iso-bmff.ts";

const DB_NAME = "velo-media";
const STORE = "files";
export const MAX_CACHE_ITEMS = 4;
export const MAX_CACHE_BYTES = 180 * 1024 * 1024;

export type CachedMedia = {
  key: string;
  owner?: string;
  videoId: string;
  itag: number;
  filename: string;
  blob: Blob;
  savedAt: number;
};

export type StorageStatus = {
  persisted: boolean;
  usage: number;
  quota: number;
  remaining: number;
  percent: number;
};

export function cacheKey(videoId: string, itag: number, owner = mediaOwner): string {
  return `${owner}:${videoId}:${itag}`;
}

let mediaOwner = "guest";

export function setMediaCacheOwner(ownerId: string) {
  mediaOwner = ownerId || "guest";
}

export function mediaCacheOwner(): string {
  return mediaOwner;
}


/** How many bytes we allow for media copies. Never more than 40% of origin quota. */
export function cacheBudget(quota: number, usage: number, persisted: boolean): number {
  if (quota <= 0) return MAX_CACHE_BYTES;
  const remaining = Math.max(0, quota - usage);
  const share = persisted ? quota * 0.4 : Math.min(quota * 0.2, 80 * 1024 * 1024);
  return Math.max(0, Math.min(MAX_CACHE_BYTES, share, remaining * 0.7));
}

export function pickEvictions(
  items: { key: string; savedAt: number; size: number }[],
  incomingSize: number,
  maxItems: number,
  maxBytes: number,
): string[] {
  // A blob that cannot fit even in an empty cache must not evict anything.
  if (incomingSize > maxBytes) return [];
  const sorted = [...items].sort((a, b) => a.savedAt - b.savedAt);
  let total = sorted.reduce((sum, item) => sum + item.size, 0) + incomingSize;
  let count = sorted.length + 1;
  const drop: string[] = [];
  while (count > maxItems || total > maxBytes) {
    const oldest = sorted.find((item) => !drop.includes(item.key));
    if (!oldest) break;
    drop.push(oldest.key);
    total -= oldest.size;
    count--;
  }
  return drop;
}

export type RecentSavePlan =
  | { action: "local"; label: string }
  | { action: "fetch"; label: string };

export function planRecentSave(hasCache: boolean): RecentSavePlan {
  if (hasCache) {
    return { action: "local", label: "Local copy — skipping YouTube" };
  }
  return {
    action: "fetch",
    label: "No copy in this browser (cleared, quota, or never cached) — fetching from YouTube",
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
    } catch (err) {
      reject(err instanceof Error ? err : new Error("IndexedDB security error"));
    }
  });
}

export async function persistStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  const empty = { persisted: false, usage: 0, quota: 0, remaining: 0, percent: 0 };
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const estimate = await navigator.storage?.estimate?.();
    const usage = estimate?.usage ?? 0;
    const quota = estimate?.quota ?? 0;
    return {
      persisted,
      usage,
      quota,
      remaining: Math.max(0, quota - usage),
      percent: quota > 0 ? Math.min(100, (usage / quota) * 100) : 0,
    };
  } catch {
    return empty;
  }
}

export async function putCachedMedia(opts: {
  videoId: string;
  itag: number;
  filename: string;
  blob: Blob;
}): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (opts.blob.size > MAX_CACHE_BYTES) return;
  if (!(await blobIsMedia(opts.blob))) return;
  const db = await openDb();
  try {
    const all = await tx<CachedMedia[]>(db, "readonly", (store) => store.getAll());
    const mine = all.filter((row) => ownsRow(row));
    const status = await storageStatus();
    const ownBytes = mine.reduce((sum, row) => sum + (row.blob?.size ?? 0), 0);
    const budget = cacheBudget(status.quota, Math.max(0, status.usage - ownBytes), status.persisted);
    const maxBytes = Math.min(MAX_CACHE_BYTES, budget);
    if (opts.blob.size > maxBytes) return;
    // Exclude the row we are about to overwrite. `store.put` replaces it, so
    // counting it as an insert made a re-download silently drop a different
    // cached video.
    const replacing = cacheKey(opts.videoId, opts.itag);
    const evict = pickEvictions(
      mine
        .filter((row) => row.key !== replacing)
        .map((row) => ({ key: row.key, savedAt: row.savedAt, size: row.blob?.size ?? 0 })),
      opts.blob.size,
      MAX_CACHE_ITEMS,
      maxBytes,
    );
    const record: CachedMedia = {
      key: cacheKey(opts.videoId, opts.itag),
      owner: mediaOwner,
      videoId: opts.videoId,
      itag: opts.itag,
      filename: opts.filename,
      blob: opts.blob,
      savedAt: Date.now(),
    };
    try {
      await writeAll(db, [
        ...evict.map((key) => (store: IDBObjectStore) => store.delete(key)),
        (store) => store.put(record),
      ]);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      // One transaction aborted, so evictions rolled back with the failed put.
    }
  } finally {
    db.close();
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const code = "code" in err ? Number((err as { code?: number }).code) : 0;
  const msg = err instanceof Error ? err.message : String(err);
  return name === "QuotaExceededError" || code === 22 || /quota exceeded/i.test(msg);
}

export function isUsableCachedBlob(blob: Blob | undefined | null): boolean {
  if (!blob || blob.size < 2048) return false;
  const type = blob.type.toLowerCase();
  return !type.includes("text/html") && !type.includes("application/json") && !type.includes("text/plain");
}

export async function blobIsMedia(blob: Blob): Promise<boolean> {
  if (!isUsableCachedBlob(blob)) return false;
  try {
    const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    // Accepts converted audio (mp3/flac/wav/ogg) too, not just YouTube's own
    // fragment containers — an encoder output is still real media.
    return looksLikeMediaFile(head) !== null;
  } catch {
    return false;
  }
}

export async function getCachedMedia(videoId: string, itag: number): Promise<CachedMedia | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    try {
      const row = await tx<CachedMedia | undefined>(db, "readonly", (store) => store.get(cacheKey(videoId, itag)));
      if (!row?.blob || !(await blobIsMedia(row.blob))) {
        if (row?.key) await tx(db, "readwrite", (store) => store.delete(row.key)).catch(() => undefined);
        return null;
      }
      return row;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function ownsRow(row: CachedMedia, owner = mediaOwner): boolean {
  if (row.owner) return row.owner === owner;
  return row.key.startsWith(`${owner}:`);
}

export async function listCachedKeys(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  // Open inside the try: a blocked IDB (third-party iframe, private mode)
  // throws on open and should read as an empty cache, not an unhandled rejection.
  try {
    const db = await openDb();
    try {
      const all = await tx<CachedMedia[]>(db, "readonly", (store) => store.getAll());
      const usable: string[] = [];
      for (const row of all) {
        if (!row?.key || !ownsRow(row)) continue;
        if (await blobIsMedia(row.blob)) usable.push(String(row.key));
        else await tx(db, "readwrite", (store) => store.delete(row.key)).catch(() => undefined);
      }
      return usable;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function removeCachedMedia(videoId: string, itag?: number): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    if (itag != null) {
      await tx(db, "readwrite", (store) => store.delete(cacheKey(videoId, itag)));
      return;
    }
    const all = await tx<CachedMedia[]>(db, "readonly", (store) => store.getAll());
    await Promise.all(
      all
        .filter((row) => row.videoId === videoId && ownsRow(row))
        .map((row) => tx(db, "readwrite", (store) => store.delete(row.key))),
    );
  } finally {
    db.close();
  }
}

export async function clearCachedMedia(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    try {
      const all = await tx<CachedMedia[]>(db, "readonly", (store) => store.getAll());
      await Promise.all(
        all.filter((row) => ownsRow(row)).map((row) => tx(db, "readwrite", (store) => store.delete(row.key))),
      );
    } finally {
      db.close();
    }
  } catch {
    return;
  }
}

function writeAll(
  db: IDBDatabase,
  runs: Array<(store: IDBObjectStore) => IDBRequest>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const run of runs) run(store);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB request failed"));
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    let result: T | undefined;
    request.onsuccess = () => {
      result = request.result as T;
    };
    request.onerror = () => {
      /* transaction.onabort / onerror is the source of truth */
    };
    transaction.oncomplete = () => resolve(result as T);
    transaction.onabort = () =>
      reject(transaction.error ?? request.error ?? new Error("IndexedDB aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? request.error ?? new Error("IndexedDB request failed"));
  });
}
