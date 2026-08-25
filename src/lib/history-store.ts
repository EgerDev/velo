import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { VideoPreset } from "@/lib/youtube";
import { setMediaCacheOwner } from "./media-cache.ts";
import { useHarStore } from "./har-store.ts";

export type HistoryItem = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number | null;
  url: string;
  lastItag: number;
  lastPreset: string;
  lastExt: string;
  downloadedAt: number;
};

export type HistoryShelf = {
  items: HistoryItem[];
  lastPresetId: string | null;
};

type HistoryState = {
  ownerId: string;
  shelves: Record<string, HistoryShelf>;
  items: HistoryItem[];
  lastPresetId: string | null;
  adoptOwner: (ownerId: string) => void;
  record: (item: Omit<HistoryItem, "downloadedAt">) => void;
  rememberPreset: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const MAX_ITEMS = 40;
const EMPTY_SHELF: HistoryShelf = { items: [], lastPresetId: null };
const OWNER_POINTER = "velo-session-owner";
const SHELF_PREFIX = "velo-history:";
const LEGACY_BLOB = "velo-history";

const memory = (() => {
  const map = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  return storage;
})();

function historyStorage(): Storage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode / SSR */
  }
  return memory;
}

export function accountOwnerId(userId: string | null | undefined): string {
  return userId ? `u:${userId}` : "guest";
}

export function shelfStorageKey(ownerId: string): string {
  return `${SHELF_PREFIX}${ownerId}`;
}

function parseShelf(raw: string | null): HistoryShelf {
  if (!raw) return { items: [], lastPresetId: null };
  try {
    const parsed = JSON.parse(raw) as Partial<HistoryShelf> | { state?: { items?: HistoryItem[]; lastPresetId?: string | null } };
    if (parsed && Array.isArray((parsed as HistoryShelf).items)) {
      const shelf = parsed as HistoryShelf;
      return { items: shelf.items, lastPresetId: shelf.lastPresetId ?? null };
    }
  } catch {
    /* ignore */
  }
  return { items: [], lastPresetId: null };
}

export function readPersistedShelf(ownerId: string): HistoryShelf {
  return parseShelf(historyStorage().getItem(shelfStorageKey(ownerId)));
}

export function writePersistedShelf(ownerId: string, shelf: HistoryShelf) {
  const store = historyStorage();
  try {
    store.setItem(shelfStorageKey(ownerId), JSON.stringify(shelf));
    store.setItem(OWNER_POINTER, ownerId);
  } catch {
    // Quota exceeded. Give up items progressively rather than in one step: a
    // single retry at 10 that also failed dropped the shelf AND the owner
    // pointer, orphaning the shelf while the UI kept showing every item.
    for (const keep of [10, 3, 0]) {
      try {
        const pruned = { ...shelf, items: shelf.items.slice(0, keep) };
        store.setItem(shelfStorageKey(ownerId), JSON.stringify(pruned));
        store.setItem(OWNER_POINTER, ownerId);
        return;
      } catch {
        /* try a smaller shelf */
      }
    }
  }
}

function splitLegacyBlob() {
  const store = historyStorage();
  const legacy = store.getItem(LEGACY_BLOB);
  if (!legacy) return;
  try {
    const parsed = JSON.parse(legacy) as {
      state?: { items?: HistoryItem[]; lastPresetId?: string | null; shelves?: Record<string, HistoryShelf>; ownerId?: string };
      items?: HistoryItem[];
      shelves?: Record<string, HistoryShelf>;
    };
    const state = parsed.state ?? parsed;
    const shelves = "shelves" in state ? state.shelves : parsed.shelves;
    if (shelves && typeof shelves === "object") {
      for (const [id, shelf] of Object.entries(shelves)) {
        if (!store.getItem(shelfStorageKey(id))) writePersistedShelf(id, shelf);
      }
    } else {
      const items = parsed.state?.items ?? parsed.items;
      const lastPresetId = parsed.state?.lastPresetId ?? null;
      if (Array.isArray(items) && !store.getItem(shelfStorageKey("guest"))) {
        writePersistedShelf("guest", { items, lastPresetId });
      }
    }
  } catch {
    /* ignore corrupt */
  }
  store.removeItem(LEGACY_BLOB);
}

splitLegacyBlob();

function writeShelf(ownerId: string, shelf: HistoryShelf): Pick<HistoryState, "ownerId" | "shelves" | "items" | "lastPresetId"> {
  return {
    ownerId,
    shelves: { [ownerId]: shelf },
    items: shelf.items,
    lastPresetId: shelf.lastPresetId,
  };
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      ownerId: "guest",
      shelves: { guest: { ...EMPTY_SHELF } },
      items: [],
      lastPresetId: null,
      adoptOwner: (ownerId) =>
        set((state) => {
          const id = ownerId || "guest";
          const current = state.shelves[state.ownerId];
          if (current) writePersistedShelf(state.ownerId, current);
          const shelf = readPersistedShelf(id);
          if (state.ownerId === id && state.items === shelf.items && state.shelves[id]) return state;
          return writeShelf(id, shelf);
        }),
      record: (item) =>
        set((state) => {
          const current = state.shelves[state.ownerId] ?? EMPTY_SHELF;
          const next: HistoryItem = { ...item, downloadedAt: Date.now() };
          const rest = current.items.filter((existing) => existing.id !== item.id);
          const shelf = {
            items: [next, ...rest].slice(0, MAX_ITEMS),
            lastPresetId: current.lastPresetId,
          };
          writePersistedShelf(state.ownerId, shelf);
          return writeShelf(state.ownerId, shelf);
        }),
      rememberPreset: (id) =>
        set((state) => {
          const current = state.shelves[state.ownerId] ?? EMPTY_SHELF;
          const shelf = { ...current, lastPresetId: id };
          writePersistedShelf(state.ownerId, shelf);
          return writeShelf(state.ownerId, shelf);
        }),
      remove: (id) =>
        set((state) => {
          const current = state.shelves[state.ownerId] ?? EMPTY_SHELF;
          const shelf = { ...current, items: current.items.filter((item) => item.id !== id) };
          writePersistedShelf(state.ownerId, shelf);
          return writeShelf(state.ownerId, shelf);
        }),
      clear: () =>
        set((state) => {
          const shelf = { items: [], lastPresetId: null };
          writePersistedShelf(state.ownerId, shelf);
          return writeShelf(state.ownerId, shelf);
        }),
    }),
    {
      name: "velo-history",
      version: 3,
      storage: createJSONStorage(() => ({
        getItem: () => {
          splitLegacyBlob();
          return JSON.stringify({
            state: { ownerId: "guest", shelves: { guest: { ...EMPTY_SHELF } }, items: [], lastPresetId: null },
            version: 3,
          });
        },
        setItem: (_name, value) => {
          try {
            const parsed = JSON.parse(value) as { state?: Partial<HistoryState> };
            const owner = parsed.state?.ownerId;
            if (!owner || owner === "_pending") return;
            const shelf = parsed.state?.shelves?.[owner] ?? {
              items: parsed.state?.items ?? [],
              lastPresetId: parsed.state?.lastPresetId ?? null,
            };
            writePersistedShelf(owner, shelf);
          } catch {
            /* ignore */
          }
        },
        removeItem: () => {
          /* keep per-owner shelves */
        },
      })),
      partialize: (state) => ({ ownerId: state.ownerId, shelves: state.shelves }),
    },
  ),
);

export function useHistoryHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const api = useHistoryStore.persist;
    if (!api) {
      setHydrated(true);
      return;
    }
    if (api.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return api.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}

/** Bind Recent + media copies to this login. Memory holds only that person. */
export function isolateBrowserSession(ownerId: string) {
  useHistoryStore.getState().adoptOwner(ownerId);
  setMediaCacheOwner(ownerId);
}

/** Bind Recent + media copies to the signed-in person. Never mix accounts. */
export function useAccountScope(userId: string | null | undefined, isPending: boolean) {
  const adoptOwner = useHistoryStore((state) => state.adoptOwner);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    const owner = accountOwnerId(userId);
    if (prev.current && prev.current !== owner) useHarStore.getState().clear();
    prev.current = owner;
    isolateBrowserSession(owner);
    adoptOwner(owner);
  }, [userId, isPending, adoptOwner]);
}

export function presetSummary(preset: VideoPreset): string {
  return `${preset.title} · ${preset.codec ?? preset.ext.toUpperCase()}`;
}
