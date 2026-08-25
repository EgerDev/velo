import { create } from "zustand";
import type { HarHeaderReport, HarPlayback, HarWaterfallRow, ParsedHar } from "@/lib/har";

type HarState = {
  videoIds: string[];
  playbacks: HarPlayback[];
  poTokens: string[];
  waterfall: HarWaterfallRow[];
  headers: HarHeaderReport | null;
  spanMs: number;
  warnings: string[];
  importedAt: number;
  setFromParse: (har: ParsedHar) => void;
  playbackFor: (videoId: string, itag: number) => HarPlayback | null;
  clear: () => void;
};

export const useHarStore = create<HarState>()((set, get) => ({
  videoIds: [],
  playbacks: [],
  poTokens: [],
  waterfall: [],
  headers: null,
  spanMs: 1,
  warnings: [],
  importedAt: 0,
  setFromParse: (har) =>
    set({
      videoIds: har.videoIds,
      playbacks: har.playbacks,
      poTokens: har.poTokens,
      waterfall: har.waterfall,
      headers: har.headers,
      spanMs: har.spanMs,
      warnings: har.warnings,
      importedAt: Date.now(),
    }),
  playbackFor: (videoId, itag) =>
    get().playbacks.find((item) => item.itag === itag && (!item.videoId || item.videoId === videoId)) ?? null,
  clear: () =>
    set({
      videoIds: [],
      playbacks: [],
      poTokens: [],
      waterfall: [],
      headers: null,
      spanMs: 1,
      warnings: [],
      importedAt: 0,
    }),
}));
