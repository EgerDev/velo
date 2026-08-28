import type {
  CaptionTrack,
  ResolvedVideo,
  SearchHit,
  PlaylistResult,
  VideoFormat,
} from "@/lib/youtube";
import {
  buildPresets,
  parsePlaylistId,
  parseVideoId,
  youtubeWatchUrl,
} from "@/lib/youtube";
import { getClient, getPlayableInfo, type PlayableInfo } from "@/lib/youtube-client.server";
import { collectCaptions, collectTranslationLanguages } from "@/lib/youtube-captions.server";
import { toFormat, uniqueFormats, toSearchHit, uniqueHits, pickThumbnail, type RawFormat } from "@/lib/youtube-map.server";

export { toSearchHit } from "@/lib/youtube-map.server";
export { streamYoutubeCaptions, getTranscriptText } from "@/lib/youtube-captions.server";
export {
  decipherRawFormat,
  unlockPlaybackUrl,
  getPlaybackUrl,
  streamYoutubeDownload,
} from "@/lib/youtube-stream.server";
export type { PlaybackFile } from "@/lib/youtube-stream.server";

export async function resolveYoutubeVideo(input: string): Promise<ResolvedVideo> {
  const id = parseVideoId(input);
  if (!id) {
    throw new Error("Paste a valid YouTube link or 11-character video ID.");
  }

  const yt = await getClient();
  let info: PlayableInfo;
  try {
    info = await getPlayableInfo(yt, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach YouTube.";
    throw new Error(message.replace(/^InnertubeError:\s*/i, ""));
  }
  const basic = info.basic_info;
  const status = info.playability_status?.status;

  if (basic.is_live) {
    throw new Error("Live streams can’t be saved until they end.");
  }
  if (basic.is_upcoming) {
    throw new Error("This premiere hasn’t started yet.");
  }
  if (status && status !== "OK") {
    const reason = info.playability_status?.reason?.trim();
    throw new Error(reason || "YouTube won’t play this video.");
  }

  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const formats = uniqueFormats(
    raw.map((f) => toFormat(f as unknown as RawFormat)).filter((f): f is VideoFormat => f !== null),
  );
  const has1080 = formats.some((item) => (item.height ?? 0) >= 1080);
  if (!has1080) {
    try {
      const { listYtdlpFormats } = await import("@/lib/ytdlp.server");
      const extra = await listYtdlpFormats(id);
      if (extra.length) formats.push(...extra);
    } catch {
      /* keep Innertube list */
    }
  }
  const merged = uniqueFormats(formats);
  const presets = buildPresets(merged);

  if (!presets.length) {
    throw new Error("No downloadable formats were returned for this video.");
  }

  const title = basic.title?.trim() || "YouTube video";
  const author = basic.author?.trim() || basic.channel?.name?.trim() || "Unknown channel";
  const publishedAt =
    basic.start_timestamp instanceof Date && !Number.isNaN(basic.start_timestamp.getTime())
      ? basic.start_timestamp.toISOString()
      : null;

  const isShort = Boolean(
    (typeof basic.duration === "number" && basic.duration > 0 && basic.duration <= 180 && merged.some((f) => f.width && f.height && f.width < f.height)) ||
    (typeof (basic as Record<string, unknown>).is_short === "boolean" && (basic as Record<string, unknown>).is_short) ||
    (typeof (basic as Record<string, unknown>).is_shorts === "boolean" && (basic as Record<string, unknown>).is_shorts) ||
    (typeof basic.duration === "number" && basic.duration > 0 && basic.duration <= 70 && !merged.some((f) => (f.height ?? 0) > 1080 && (f.width ?? 0) > (f.height ?? 0)))
  );

  return {
    id: basic.id || id,
    title,
    author,
    authorUrl: basic.channel?.url ?? null,
    duration: typeof basic.duration === "number" ? basic.duration : null,
    viewCount: typeof basic.view_count === "number" ? basic.view_count : null,
    likeCount: typeof basic.like_count === "number" ? basic.like_count : null,
    publishedAt,
    thumbnail: pickThumbnail(basic.thumbnail, id),
    url: youtubeWatchUrl(id),
    isLive: Boolean(basic.is_live),
    isUpcoming: Boolean(basic.is_upcoming),
    isShort,
    description: basic.short_description?.trim() || null,
    formats: merged,
    presets,
    captions: collectCaptions(info),
    translationLanguages: collectTranslationLanguages(info),
  };
}

export async function resolveBulkMetadata(
  ids: string[],
): Promise<Array<{ id: string; ok: boolean; video?: ResolvedVideo; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; video?: ResolvedVideo; error?: string }> = [];
  const chunkSize = 3;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (id) => {
      try {
        const video = await resolveYoutubeVideo(id);
        return { id, ok: true, video };
      } catch (err) {
        return {
          id,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to load video metadata.",
        };
      }
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    if (i + chunkSize < ids.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return results;
}

export async function searchYoutubeVideos(query: string): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Type something to search.");
  try {
    const yt = await getClient();
    const results = await yt.search(trimmed, { type: "video" });
    const hits = uniqueHits(
      [...(results?.videos || [])]
        .map((item) => toSearchHit(item))
        .filter((item): item is SearchHit => item !== null),
    );
    return hits.slice(0, 24);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/^InnertubeError:\s*/i, "");
    throw new Error(msg || "Could not search YouTube videos.");
  }
}

export async function resolveYoutubePlaylist(input: string): Promise<PlaylistResult> {
  const id = parsePlaylistId(input);
  if (!id) throw new Error("That doesn’t look like a playlist link.");
  try {
    const yt = await getClient();
    const playlist = await yt.getPlaylist(id);
    const items = uniqueHits(
      [...(playlist?.items || [])]
        .map((item) => toSearchHit(item))
        .filter((item): item is SearchHit => item !== null),
    );
    if (!items.length) {
      throw new Error("This playlist is empty or isn’t available.");
    }
    const info = playlist.info;
    return {
      id,
      title: info?.title?.trim() || "Playlist",
      author: info?.author?.name?.trim() || "YouTube",
      thumbnail: info?.thumbnails?.[0]?.url ?? items[0]?.thumbnail ?? null,
      total: info?.total_items || null,
      items: items.slice(0, 50),
    };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/^InnertubeError:\s*/i, "");
    throw new Error(msg || "Could not load playlist information.");
  }
}
