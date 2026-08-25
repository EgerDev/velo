/**
 * Velo Bulk & Batch Download Engine
 * - Robust URL extraction (watch, shorts, embed, youtu.be, playlists)
 * - Anti-throttling concurrency control (staggered bursts, max concurrency limits)
 * - Rate-limit backoff & auto-retry ladder
 * - Export formats: yt-dlp script, curl batch, text list, JSON
 */

import { parseVideoId, parsePlaylistId, youtubeWatchUrl } from "./youtube.ts";

export type BulkQualityPreset = "1080p" | "720p" | "360p" | "audio" | "transcript";

export type BulkItemStatus =
  | "pending"
  | "resolving"
  | "ready"
  | "downloading"
  | "completed"
  | "failed"
  | "skipped";

export type BulkItem = {
  id: string; // YouTube Video ID (11 chars)
  url: string;
  title: string | null;
  author: string | null;
  duration: number | null;
  durationFormatted: string | null;
  thumbnail: string | null;
  status: BulkItemStatus;
  progress: number; // 0 to 100
  preset: BulkQualityPreset;
  sizeFormatted: string | null;
  filename: string | null;
  downloadUrl: string | null;
  error: string | null;
  retryCount: number;
  selectedItag: number | null;
  selectedAudioItag: number | null;
};

export type BulkExtractionResult = {
  videoIds: string[];
  playlistIds: string[];
  totalUnique: number;
};

/**
 * Parses freeform text, multi-line pastes, CSVs, or JSON and extracts unique YouTube Video and Playlist IDs.
 */
export function extractYoutubeLinks(rawText: string): BulkExtractionResult {
  if (!rawText || typeof rawText !== "string") {
    return { videoIds: [], playlistIds: [], totalUnique: 0 };
  }

  const videoIdSet = new Set<string>();
  const playlistIdSet = new Set<string>();

  // Split by line breaks, commas, spaces, tabs, or quotes
  const tokens = rawText
    .split(/[\r\n,\t\s"';<>()\x5b\x5d]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    // 1. Try playlist match
    const playlistId = parsePlaylistId(token);
    if (playlistId && !playlistIdSet.has(playlistId)) {
      playlistIdSet.add(playlistId);
    }

    // 2. Try video match
    const videoId = parseVideoId(token);
    if (videoId && !videoIdSet.has(videoId)) {
      videoIdSet.add(videoId);
    }
  }

  // Also run global regex over raw string in case tokens were merged
  const genericVideoRe =
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/gi;
  let match: RegExpExecArray | null;
  while ((match = genericVideoRe.exec(rawText)) !== null) {
    const vid = match[1];
    if (vid && vid.length === 11) {
      videoIdSet.add(vid);
    }
  }

  const genericListRe = /[?&]list=([a-zA-Z0-9_-]{10,50})/gi;
  while ((match = genericListRe.exec(rawText)) !== null) {
    const lid = match[1];
    if (lid && parsePlaylistId(lid)) {
      playlistIdSet.add(lid);
    }
  }

  return {
    videoIds: Array.from(videoIdSet),
    playlistIds: Array.from(playlistIdSet),
    totalUnique: videoIdSet.size,
  };
}

/**
 * Creates initial BulkItem objects from a list of video IDs
 */
export function createBulkItems(
  videoIds: string[],
  defaultPreset: BulkQualityPreset = "1080p",
): BulkItem[] {
  return videoIds.map((id) => ({
    id,
    url: youtubeWatchUrl(id),
    title: null,
    author: null,
    duration: null,
    durationFormatted: null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    status: "pending",
    progress: 0,
    preset: defaultPreset,
    sizeFormatted: null,
    filename: null,
    downloadUrl: null,
    error: null,
    retryCount: 0,
    selectedItag: null,
    selectedAudioItag: null,
  }));
}

/**
 * Configuration for concurrency, staggering, and rate-limit mitigation
 */
export type BulkQueueOptions = {
  maxConcurrency: number; // default 2 (safe against YouTube 429)
  staggerDelayMs: number; // default 1800ms between starting successive downloads
  maxRetries: number; // default 2
  retryBaseDelayMs: number; // default 2500ms
};

export const DEFAULT_BULK_OPTIONS: BulkQueueOptions = {
  maxConcurrency: 2,
  staggerDelayMs: 1800,
  maxRetries: 2,
  retryBaseDelayMs: 2500,
};

/**
 * Exports batch items as an executable bash shell script using optimal yt-dlp commands
 */
export function exportYtdlpBatchScript(items: BulkItem[]): string {
  const activeItems = items.filter((item) => item.status !== "skipped");
  const lines: string[] = [
    "#!/usr/bin/env bash",
    "# Velo - Generated Bulk Media Ingest Script",
    "# Anti-throttling: using direct copy-mux and rate-limit safeguards",
    "set -euo pipefail",
    "",
    `echo "Starting batch download of ${activeItems.length} videos..."`,
    "mkdir -p ./velo_downloads",
    "cd ./velo_downloads",
    "",
  ];

  for (let i = 0; i < activeItems.length; i++) {
    const item = activeItems[i];
    const formatFlag =
      item.preset === "1080p"
        ? '-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" --merge-output-format mp4'
        : item.preset === "720p"
          ? '-f "bestvideo[height<=720]+bestaudio/best[height<=720]/best" --merge-output-format mp4'
          : item.preset === "audio"
            ? '-f "bestaudio/best" -x --audio-format m4a'
            : item.preset === "transcript"
              ? "--write-subs --write-auto-subs --sub-lang en --skip-download"
              : "-f best";

    lines.push(`echo "[${i + 1}/${activeItems.length}] Processing ${item.id}..."`);
    lines.push(
      `yt-dlp ${formatFlag} --concurrent-fragments 4 --extractor-retries 3 --fragment-retries 3 "${item.url}" || echo "Failed: ${item.id}"`,
    );
    lines.push("sleep 1.5");
    lines.push("");
  }

  lines.push('echo "All batch items completed!"');
  return lines.join("\n");
}

/**
 * Exports batch items as a clean list of URLs for IDM, JDownloader, aria2, or curl
 */
export function exportUrlList(items: BulkItem[]): string {
  return items
    .filter((item) => item.status !== "skipped")
    .map((item) => item.url)
    .join("\n");
}

/**
 * Exports batch items as structured JSON
 */
export function exportBatchJson(items: BulkItem[]): string {
  const exportable = items.map((item) => ({
    id: item.id,
    url: item.url,
    title: item.title,
    author: item.author,
    duration: item.duration,
    preset: item.preset,
    status: item.status,
    filename: item.filename,
    error: item.error,
  }));
  return JSON.stringify(exportable, null, 2);
}

/**
 * Helper to calculate total queue stats
 */
export function calculateQueueStats(items: BulkItem[]) {
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const downloading = items.filter((i) => i.status === "downloading").length;
  const pending = items.filter((i) => i.status === "pending" || i.status === "resolving").length;
  const ready = items.filter((i) => i.status === "ready").length;

  const totalProgress =
    total > 0
      ? Math.round(
          items.reduce((sum, item) => {
            if (item.status === "completed") return sum + 100;
            if (item.status === "failed" || item.status === "skipped") return sum + 0;
            return sum + (item.progress || 0);
          }, 0) / total,
        )
      : 0;

  return {
    total,
    completed,
    failed,
    downloading,
    pending,
    ready,
    totalProgress,
    isAllDone: total > 0 && completed + failed === total,
  };
}
