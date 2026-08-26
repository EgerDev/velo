import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type WatchedChannel = {
  channelId: string;
  title: string;
  /** Epoch ms of the newest video the user has already seen (their "read" line). */
  lastSeenMs: number;
  addedAt: number;
};

type WatchState = {
  channels: WatchedChannel[];
  add: (channel: Omit<WatchedChannel, "addedAt" | "lastSeenMs"> & { lastSeenMs?: number }) => void;
  remove: (channelId: string) => void;
  markSeen: (channelId: string, ms: number) => void;
};

const WATCH_STORE_KEY = "velo-watch";

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useWatchStore = create<WatchState>()(
  persist(
    (set) => ({
      channels: [],
      add: (channel) =>
        set((state) => {
          if (state.channels.some((c) => c.channelId === channel.channelId)) return state;
          return {
            channels: [
              { ...channel, lastSeenMs: channel.lastSeenMs ?? Date.now(), addedAt: Date.now() },
              ...state.channels,
            ],
          };
        }),
      remove: (channelId) =>
        set((state) => ({ channels: state.channels.filter((c) => c.channelId !== channelId) })),
      markSeen: (channelId, ms) =>
        set((state) => ({
          channels: state.channels.map((c) =>
            c.channelId === channelId ? { ...c, lastSeenMs: Math.max(c.lastSeenMs, ms) } : c,
          ),
        })),
    }),
    {
      name: WATCH_STORE_KEY,
      version: 1,
      storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : noopStorage)),
      // Without a migrate, a version bump makes zustand DISCARD the persisted
      // payload — the user's whole watch list. Carry the channels across.
      migrate: (persisted) => {
        const prior = persisted as { channels?: unknown } | null;
        const channels = Array.isArray(prior?.channels) ? (prior.channels as WatchedChannel[]) : [];
        return { channels } as WatchState;
      },
    },
  ),
);

if (typeof window !== "undefined") {
  // Every mutation persists the WHOLE channels array, so a tab holding a stale
  // copy silently drops what another tab added. `storage` fires only in the
  // other tabs, so rehydrating here keeps each tab's next write on top of the
  // latest state instead of clobbering it.
  window.addEventListener("storage", (event) => {
    if (event.key !== WATCH_STORE_KEY) return;
    void useWatchStore.persist.rehydrate();
  });
}
