import { create } from "zustand";
import { parseCookieImport } from "@/lib/cookies";

type CookieState = {
  raw: string;
  count: number;
  error: string | null;
  setRaw: (raw: string) => void;
  clear: () => void;
};

const COOKIE_PERSIST_KEY = "velo-yt-cookies";

export function scrubCookiePersist() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(COOKIE_PERSIST_KEY);
  } catch {
    /* private mode */
  }
}

export const useCookieStore = create<CookieState>()((set) => ({
  raw: "",
  count: 0,
  error: null,
  setRaw: (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      set({ raw: "", count: 0, error: null });
      return;
    }
    try {
      const parsed = parseCookieImport(trimmed);
      set({ raw: parsed.netscape, count: parsed.count, error: null });
    } catch (err) {
      set({
        raw: trimmed,
        count: 0,
        error: err instanceof Error ? err.message : "Could not parse cookies.",
      });
    }
  },
  clear: () => set({ raw: "", count: 0, error: null }),
}));

export function cookiesForDownload(signedIn: boolean | null | undefined): string {
  if (signedIn !== true) return "";
  return useCookieStore.getState().raw;
}
