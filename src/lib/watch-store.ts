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
      name: "velo-watch",
      version: 1,
      storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : noopStorage)),
    },
  ),
);
