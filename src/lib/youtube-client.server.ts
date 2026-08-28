import { Innertube, Platform } from "youtubei.js";
import "@/lib/ipv4-bind.server";
import type { VideoFormat } from "@/lib/youtube";
import { toFormat, uniqueFormats } from "@/lib/youtube-map.server";

Platform.shim.eval = (data) => new Function(data.output)();

export const STREAM_HEADERS = {
  accept: "*/*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  referer: "https://www.youtube.com/",
} as const;

/** youtubei.js InnerTube clients. ANDROID_VR omitted (GVS 403). TV_EMBEDDED / IOS / VISIONOS / music-studio are not in yt-dlp. */
const CLIENTS = [
  "WEB_EMBEDDED",
  "TV_EMBEDDED",
  "TV_SIMPLY",
  "VISIONOS",
  "IOS",
  "MWEB",
  "TV",
  "YTMUSIC",
  "YTMUSIC_ANDROID",
  "YTSTUDIO_ANDROID",
  "YTKIDS",
  "WEB_CREATOR",
  "ANDROID",
  "WEB",
] as const;

export type InnertubeClient = Awaited<ReturnType<typeof Innertube.create>>;
export type PlayableInfo = Awaited<ReturnType<InnertubeClient["getBasicInfo"]>>;

let clientPromise: Promise<InnertubeClient> | null = null;
let clientCreatedAt = 0;
const CLIENT_TTL_MS = 4 * 60 * 60 * 1000;

export async function getClient(): Promise<InnertubeClient> {
  if (!clientPromise || Date.now() - clientCreatedAt > CLIENT_TTL_MS) {
    clientCreatedAt = Date.now();
    clientPromise = Innertube.create({
      lang: "en",
      location: "US",
      retrieve_player: true,
      enable_session_cache: true,
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

const PLAYABLE_TTL_MS = 10 * 60_000;
/** Short TTL for degraded answers (bot check, LOGIN_REQUIRED, missing formats)
 *  so a transient hiccup doesn't pin an id for the full success TTL. */
const PLAYABLE_FAILURE_TTL_MS = 30_000;
const MAX_PLAYABLE_CACHE = 200;
const playableCache = new Map<string, { value: PlayableInfo; expires: number }>();
const playableInflight = new Map<string, Promise<PlayableInfo>>();

function evictPlayableCache() {
  if (playableCache.size <= MAX_PLAYABLE_CACHE) return;
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of playableCache) {
    if (entry.expires <= now) playableCache.delete(key);
  }
  // Second pass: remove oldest if still over limit
  if (playableCache.size > MAX_PLAYABLE_CACHE) {
    const sorted = [...playableCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = sorted.slice(0, playableCache.size - MAX_PLAYABLE_CACHE);
    for (const [key] of toRemove) playableCache.delete(key);
  }
}

const WEBPO_INNERTUBE = new Set([
  "WEB_EMBEDDED",
  "TV_EMBEDDED",
  "TV_SIMPLY",
  "MWEB",
  "TV",
  "YTMUSIC",
  "YTKIDS",
  "WEB_CREATOR",
  "WEB",
]);

export async function getPlayableInfo(yt: InnertubeClient, id: string): Promise<PlayableInfo> {
  const hit = playableCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  let shared = playableInflight.get(id);
  if (!shared) {
    shared = getPlayableInfoUncached(yt, id).finally(() => {
      if (playableInflight.get(id) === shared) playableInflight.delete(id);
    });
    playableInflight.set(id, shared);
  }
  return shared;
}

async function getPlayableInfoUncached(yt: InnertubeClient, id: string): Promise<PlayableInfo> {
  let lastError: Error | null = null;
  let fallback: PlayableInfo | null = null;
  let gvsPot: string | undefined;
  try {
    const { mintContentPoToken } = await import("@/lib/po-token.server");
    gvsPot = (await mintContentPoToken(id)) || undefined;
  } catch {
    /* BotGuard optional — Innertube still tries */
  }

  for (const client of CLIENTS) {
    try {
      const usePot = Boolean(gvsPot && WEBPO_INNERTUBE.has(client));
      const info = await yt.getBasicInfo(id, usePot ? { client, po_token: gvsPot } : { client });
      fallback = info;
      const status = info.playability_status?.status;
      const hasFormats = Boolean(
        info.streaming_data?.formats?.length || info.streaming_data?.adaptive_formats?.length,
      );
      if ((!status || status === "OK") && hasFormats) {
        playableCache.set(id, { value: info, expires: Date.now() + PLAYABLE_TTL_MS });
        evictPlayableCache();
        return info;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Could not reach YouTube.");
    }
  }

  if (fallback) {
    // Every client failed the OK+formats check, so this answer is degraded.
    // Cache it briefly to absorb request bursts without re-throwing a stale
    // bot check for the full success TTL after YouTube recovers.
    playableCache.set(id, { value: fallback, expires: Date.now() + PLAYABLE_FAILURE_TTL_MS });
    evictPlayableCache();
    return fallback;
  }
  throw lastError ?? new Error("Could not reach YouTube.");
}
