import type { CaptionTrack, TranslationLanguage } from "@/lib/youtube";
import { YOUTUBE_TRANSLATE_LANGUAGES } from "@/lib/youtube";
import { fileBasename } from "@/lib/safe-filename";

function contentDisposition(title: string, ext: string): string {
  const base = fileBasename(title);
  const ascii = `${base.replace(/[^\x20-\x7E]/g, "_")}.${ext}`;
  const encoded = encodeURIComponent(`${base}.${ext}`).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
import { getClient, getPlayableInfo, type PlayableInfo } from "@/lib/youtube-client.server";

// VTT cache — avoids re-fetching the same caption track from YouTube's
// timedtext endpoint, which is the primary cause of 429 rate-limiting.
// Key: "videoId:vssId" or "videoId:vssId:tlang" for translations.
// ---------------------------------------------------------------------------
const VTT_TTL_MS = 15 * 60_000;
const MAX_VTT_CACHE = 100;
const vttCache = new Map<string, { vtt: string; expires: number }>();

function vttCacheKey(videoId: string, vssId: string, tlang?: string): string {
  return tlang ? `${videoId}:${vssId}:${tlang}` : `${videoId}:${vssId}`;
}

function evictVttCache() {
  if (vttCache.size <= MAX_VTT_CACHE) return;
  const now = Date.now();
  for (const [key, entry] of vttCache) {
    if (entry.expires <= now) vttCache.delete(key);
  }
  if (vttCache.size > MAX_VTT_CACHE) {
    const sorted = [...vttCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = sorted.slice(0, vttCache.size - MAX_VTT_CACHE);
    for (const [key] of toRemove) vttCache.delete(key);
  }
}

export function collectCaptions(info: PlayableInfo): CaptionTrack[] {
  const tracks = info.captions?.caption_tracks ?? [];
  const out: CaptionTrack[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const languageCode = track.language_code?.trim();
    const vssId = track.vss_id?.trim();
    if (!languageCode || !vssId) continue;
    const key = `${languageCode}:${vssId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const languageName = track.name?.text?.trim() || languageCode;
    out.push({
      languageCode,
      languageName,
      kind: track.kind === "asr" ? "asr" : "manual",
      vssId,
      translatable: track.is_translatable === true,
    });
  }
  return out;
}

export function collectTranslationLanguages(info: PlayableInfo): TranslationLanguage[] {
  const out: TranslationLanguage[] = [];
  const seen = new Set<string>();
  for (const lang of info.captions?.translation_languages ?? []) {
    const code = lang.language_code?.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name: lang.language_name?.text?.trim() || code });
  }
  if (!out.length) return [...YOUTUBE_TRANSLATE_LANGUAGES];
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function streamYoutubeCaptions(
  id: string,
  languageCode: string,
  vssId: string,
): Promise<Response> {
  const yt = await getClient();
  const info = await getPlayableInfo(yt, id);
  const track = info.captions?.caption_tracks?.find(
    (item) => item.language_code === languageCode && item.vss_id === vssId,
  );
  if (!track?.base_url) {
    throw new Error("That caption track isn't available.");
  }
  const title = fileBasename(info.basic_info.title?.trim() || "captions");
  const lang = languageCode.replace(/[^\w-]/g, "") || "captions";
  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/vtt; charset=utf-8",
    "Content-Disposition": contentDisposition(`${title}.${lang}`, "vtt"),
    "Cache-Control": "no-store",
  };

  // --- VTT cache: serve immediately if we already have this track -----------
  const cacheKey = vttCacheKey(id, vssId);
  const cached = vttCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return new Response(cached.vtt, { status: 200, headers: responseHeaders });
  }

  const target = new URL(track.base_url);
  target.searchParams.set("fmt", "vtt");
  const upstream = await fetch(target.toString(), {
    headers: {
      accept: "text/vtt, text/plain, */*",
      referer: "https://www.youtube.com/",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (upstream.ok && upstream.body) {
    // Read the full body so we can cache it, then return it as a Response.
    const vttText = await upstream.text();
    evictVttCache();
    vttCache.set(cacheKey, { vtt: vttText, expires: Date.now() + VTT_TTL_MS });
    return new Response(vttText, { status: 200, headers: responseHeaders });
  }

  // 429/502: try yt-dlp over SOCKS (different IP bypasses rate-limiting)
  if (upstream.status === 429 || upstream.status === 502) {
    try {
      const { fetchSubtitlesViaYtdlp } = await import("@/lib/ytdlp.server");
      const vttText = await fetchSubtitlesViaYtdlp({ id, lang: languageCode });
      if (vttText) {
        evictVttCache();
        vttCache.set(cacheKey, { vtt: vttText, expires: Date.now() + VTT_TTL_MS });
        return new Response(vttText, { status: 200, headers: responseHeaders });
      }
    } catch {
      /* yt-dlp best-effort */
    }
    throw new Error("YouTube is rate-limiting caption fetches from this server right now. Try again in a minute.");
  }

  throw new Error("Could not fetch captions.");
}

export async function getTranscriptText(
  id: string,
  languageCode?: string,
  vssId?: string,
  tlang?: string,
): Promise<{
  videoId: string;
  languageCode: string;
  languageName: string;
  kind: "manual" | "asr";
  vssId: string;
  /** Set when the cues were machine-translated by YouTube (`tlang=`). */
  translatedTo: TranslationLanguage | null;
  vtt: string;
  cues: Array<{
    id: number;
    start: number;
    end: number;
    startFormatted: string;
    endFormatted: string;
    text: string;
  }>;
  totalWords: number;
  readingMinutes: number;
}> {
  const yt = await getClient();
  const info = await getPlayableInfo(yt, id);
  const tracks = info.captions?.caption_tracks ?? [];
  if (!tracks.length) {
    throw new Error("No captions or transcripts are available for this video.");
  }

  // vss_id alone identifies a track; a caller that only knows it must not be
  // handed the first manual track instead (the studio picked English and got
  // Arabic).
  const track =
    (languageCode && vssId
      ? tracks.find((item) => item.language_code === languageCode && item.vss_id === vssId)
      : null) ??
    (vssId ? tracks.find((item) => item.vss_id === vssId) : null) ??
    (languageCode ? tracks.find((item) => item.language_code === languageCode) : null) ??
    tracks.find((item) => item.kind !== "asr") ??
    tracks[0];

  if (!track?.base_url) {
    throw new Error("Could not find a valid caption track URL.");
  }

  const target = new URL(track.base_url);
  target.searchParams.set("fmt", "vtt");
  // YouTube's own machine translation — the same free "Auto-translate" the
  // player offers. Only translatable tracks accept it; ignore it otherwise
  // rather than fail the whole transcript.
  const translatedTo =
    tlang && track.is_translatable
      ? (collectTranslationLanguages(info).find((lang) => lang.code === tlang) ?? { code: tlang, name: tlang })
      : null;
  if (translatedTo) target.searchParams.set("tlang", translatedTo.code);

  // --- VTT cache: return immediately if we already have this track ----------
  const cacheKey = vttCacheKey(id, track.vss_id, translatedTo?.code);
  const cached = vttCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    const { parseWebVttIntoCues } = await import("@/lib/transcript");
    const cues = parseWebVttIntoCues(cached.vtt);
    const totalWords = cues.reduce((acc, cue) => acc + cue.text.split(/\s+/).filter(Boolean).length, 0);
    return {
      videoId: id,
      languageCode: track.language_code,
      languageName: track.name?.text || track.language_code,
      kind: track.kind === "asr" ? "asr" : "manual",
      vssId: track.vss_id,
      translatedTo,
      vtt: cached.vtt,
      cues,
      totalWords,
      readingMinutes: Math.max(1, Math.round(totalWords / 200)),
    };
  }

  // --- Direct fetch with yt-dlp fallback on 429 ----------------------------
  let vttText: string | null = null;

  const upstream = await fetch(target.toString(), {
    headers: {
      accept: "text/vtt, text/plain, */*",
      referer: "https://www.youtube.com/",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (upstream.ok) {
    vttText = await upstream.text();
  } else if (upstream.status === 429 || upstream.status === 502) {
    // timedtext is throttling this server's IP — route through yt-dlp over
    // SOCKS so the request comes from a different IP entirely.
    try {
      const { fetchSubtitlesViaYtdlp } = await import("@/lib/ytdlp.server");
      vttText = await fetchSubtitlesViaYtdlp({
        id,
        lang: track.language_code,
        tlang: translatedTo?.code,
      });
    } catch {
      /* yt-dlp best-effort; fall through to the error below */
    }
    if (!vttText) {
      throw new Error("YouTube is rate-limiting caption fetches from this server right now. Try again in a minute.");
    }
  } else {
    throw new Error(`YouTube timedtext responded with status ${upstream.status}`);
  }

  // --- Cache and return -----------------------------------------------------
  evictVttCache();
  vttCache.set(cacheKey, { vtt: vttText, expires: Date.now() + VTT_TTL_MS });

  const { parseWebVttIntoCues } = await import("@/lib/transcript");
  const cues = parseWebVttIntoCues(vttText);
  const totalWords = cues.reduce((acc, cue) => acc + cue.text.split(/\s+/).filter(Boolean).length, 0);
  const readingMinutes = Math.max(1, Math.round(totalWords / 200));

  return {
    videoId: id,
    languageCode: track.language_code,
    languageName: track.name?.text || track.language_code,
    kind: track.kind === "asr" ? "asr" : "manual",
    vssId: track.vss_id,
    translatedTo,
    vtt: vttText,
    cues,
    totalWords,
    readingMinutes,
  };
}
