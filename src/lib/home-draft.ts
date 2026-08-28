import type { PlaylistResult, SearchHit } from "@/lib/youtube";

export const SAMPLES = [
  { label: "4K HDR demo", tag: "2160p60 · HDR", query: "https://www.youtube.com/watch?v=LXb3EKWsInQ" },
  { label: "Podcast", tag: "2h+ · captions", query: "https://www.youtube.com/watch?v=L_Guz73e6fw" },
  { label: "Hi-fi audio", tag: "M4A · Opus", query: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ" },
  { label: "Me at the zoo", tag: "144p · 2005", query: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
];

const DRAFT_URL_KEY = "velo-draft-url";

export type ResultsView =
  | { kind: "search"; query: string; items: SearchHit[] }
  | { kind: "playlist"; playlist: PlaylistResult };

export function readDraftUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(DRAFT_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDraftUrl(value: string) {
  try {
    if (value) sessionStorage.setItem(DRAFT_URL_KEY, value);
    else sessionStorage.removeItem(DRAFT_URL_KEY);
  } catch {
    /* private mode */
  }
}

export function mapExtensionPreset(raw: string): string {
  const key = raw.toLowerCase();
  if (key === "4k" || key === "2160p" || key === "uhd") return "uhd";
  if (key === "720p" || key === "hd") return "hd";
  if (key === "audio") return "audio";
  if (key === "1080p" || key === "fullhd") return "fullhd";
  return key;
}
