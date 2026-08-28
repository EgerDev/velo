import { toast } from "sonner";
import type { MutableRefObject } from "react";
import { parsePlaylistId, parseVideoId, pickMuxedFallback, pickBestPreset, type ResolvedVideo, type VideoPreset } from "@/lib/youtube";
import { resolvePlaylist, resolveVideo, searchVideos } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
import { beginBuilderSave, discardPendingSave, saveMediaBlob } from "@/lib/builder-save";
import { persistStorage } from "@/lib/media-cache";
import { classifyDownloadError, downloadHint, isUserAbort, shouldEscalateSave } from "@/lib/download-error";
import { GUEST } from "@/lib/guest-copy";
import type { ResultsView } from "@/lib/home-draft";
import type { FallbackPrompt } from "@/components/home-single";
import type { HistoryItem } from "@/lib/history-store";

export async function lookupVideo(opts: {
  raw: string | undefined;
  urlRef: MutableRefObject<string>;
  statusRef: MutableRefObject<string>;
  requestRef: MutableRefObject<number>;
  video: ResolvedVideo | null;
  results: ResultsView | null;
  updateUrl: (next: string) => void;
  applyVideo: (result: ResolvedVideo) => void;
  setStatus: (s: "idle" | "loading" | "error") => void;
  setError: (s: string | null) => void;
  setOffer: (v: null) => void;
  setResults: (v: ResultsView | null) => void;
  setVideo: (v: ResolvedVideo | null) => void;
}) {
  const trimmed = (opts.raw ?? opts.urlRef.current).trim();
  if (!trimmed) {
    if (opts.statusRef.current === "loading") return;
    opts.setError("Paste a YouTube link or search for a video.");
    opts.setStatus("error");
    return;
  }
  opts.updateUrl(trimmed);
  const requestId = ++opts.requestRef.current;
  const previousVideo = opts.video;
  const id = parseVideoId(trimmed);
  const keepResults = Boolean(
    id &&
      (opts.results?.kind === "search"
        ? opts.results.items.some((item) => item.id === id)
        : opts.results?.kind === "playlist"
          ? opts.results.playlist.items.some((item) => item.id === id)
          : false),
  );
  opts.setStatus("loading");
  opts.setError(null);
  opts.setOffer(null);
  if (!keepResults) opts.setResults(null);
  const playlistId = parsePlaylistId(trimmed);
  try {
    if (id) {
      const result = await resolveVideo({ data: { url: trimmed } });
      if (requestId !== opts.requestRef.current) return;
      opts.applyVideo(result);
      if (opts.urlRef.current === trimmed) opts.updateUrl(result.url);
      opts.setStatus("idle");
      return;
    }
    if (playlistId) {
      const playlist = await resolvePlaylist({ data: { url: trimmed } });
      if (requestId !== opts.requestRef.current) return;
      opts.setResults({ kind: "playlist", playlist });
      opts.setStatus("idle");
      return;
    }
    const items = await searchVideos({ data: { query: trimmed } });
    if (requestId !== opts.requestRef.current) return;
    if (items.length === 0) {
      opts.setError("No videos matched that search.");
      opts.setStatus("error");
      return;
    }
    opts.setResults({ kind: "search", query: trimmed, items });
    opts.setStatus("idle");
  } catch (err) {
    if (requestId !== opts.requestRef.current) return;
    opts.setStatus("error");
    opts.setError(err instanceof Error ? err.message : "Couldn’t read that. Try another link or search.");
    if (previousVideo) opts.setVideo(previousVideo);
  }
}

export async function runHomeDownload(opts: {
  target: ResolvedVideo;
  preset: VideoPreset;
  usedFallback?: boolean;
  pending?: ReturnType<typeof beginBuilderSave>;
  isPending: boolean;
  signedIn: boolean;
  abortRef: MutableRefObject<AbortController | null>;
  rememberPreset: (id: string) => void;
  record: (item: Omit<HistoryItem, "downloadedAt">) => void;
  setDownloading: (v: boolean) => void;
  setFallbackPrompt: (v: FallbackPrompt | null) => void;
  setProgress: (v: DownloadProgress | ((prev: DownloadProgress | null) => DownloadProgress)) => void;
}) {
  if (opts.isPending) {
    toast.error("Still checking your session.");
    void discardPendingSave(opts.pending);
    return;
  }
  opts.abortRef.current?.abort();
  const abort = new AbortController();
  opts.abortRef.current = abort;
  const pendingSave = opts.pending ?? beginBuilderSave(`${opts.target.title}.${opts.preset.ext}`);
  let wrote = false;
  void persistStorage();
  opts.setDownloading(true);
  opts.setFallbackPrompt(null);
  opts.setProgress({ label: "Starting download", percent: 4 });
  try {
    if (!opts.preset.id.startsWith("fmt-")) opts.rememberPreset(opts.preset.id);
    const saved = await downloadPresetFile({
      videoId: opts.target.id,
      title: opts.target.title,
      preset: opts.preset,
      signedIn: opts.signedIn,
      pendingSave,
      signal: abort.signal,
      onProgress: opts.setProgress,
    });
    wrote = true;
    opts.record({
      id: opts.target.id,
      title: opts.target.title,
      author: opts.target.author,
      thumbnail: opts.target.thumbnail,
      duration: opts.target.duration,
      url: opts.target.url,
      lastItag: saved.itag,
      lastPreset: saved.title,
      lastExt: saved.ext,
    });
    toast.success(`Saving ${saved.title}`);
  } catch (err) {
    if (isUserAbort(err, abort.signal)) return;
    if (!opts.usedFallback && opts.preset.audioItag && shouldEscalateSave(err)) {
      const fallback = pickMuxedFallback(opts.target.presets, opts.preset);
      if (fallback && fallback.itag !== opts.preset.itag) {
        opts.setDownloading(false);
        opts.setFallbackPrompt({
          target: opts.target,
          requestedPreset: opts.preset,
          fallbackPreset: fallback,
          errorText: err instanceof Error ? err.message : "YouTube restricted this stream.",
        });
        toast.warning(`YouTube restricted ${opts.preset.title}. Fallback option available below.`);
        return;
      }
    }
    const classified = classifyDownloadError(err);
    opts.setProgress((prev) => ({
      label: classified.code === "queue" ? GUEST.busy : classified.message,
      percent: 100,
      failed: true,
      errorCode: classified.code,
      hint: downloadHint(classified.code, !opts.signedIn, classified.retryAfterSec),
      steps: prev?.steps,
    }));
    toast.error(classified.message);
  } finally {
    if (!wrote) void discardPendingSave(pendingSave);
    if (opts.abortRef.current === abort) opts.setDownloading(false);
  }
}

export async function redownloadHistoryItem(opts: {
  item: HistoryItem;
  abortRef: MutableRefObject<AbortController | null>;
  updateUrl: (url: string) => void;
  applyVideo: (result: ResolvedVideo, itag?: number) => void;
  runDownload: (target: ResolvedVideo, preset: VideoPreset, usedFallback: boolean, pending: ReturnType<typeof beginBuilderSave>) => Promise<void>;
  setDownloading: (v: boolean) => void;
  setProgress: (v: DownloadProgress) => void;
}) {
  opts.abortRef.current?.abort();
  const abort = new AbortController();
  opts.abortRef.current = abort;
  const pendingSave = beginBuilderSave(`${opts.item.title}.${opts.item.lastExt || "mp4"}`);
  void persistStorage();
  const { getCachedMedia, planRecentSave } = await import("@/lib/media-cache");
  const cached = await getCachedMedia(opts.item.id, opts.item.lastItag);
  const plan = planRecentSave(Boolean(cached));
  if (plan.action === "local" && cached) {
    opts.setDownloading(true);
    opts.setProgress({ label: plan.label, percent: 90 });
    try {
      await saveMediaBlob(cached.blob, cached.filename, pendingSave, { videoId: opts.item.id, itag: cached.itag }, abort.signal);
      opts.setProgress({ label: "Saved from this browser", percent: 100 });
      toast.success("Saved from Recent — skipped YouTube");
    } catch (err) {
      void discardPendingSave(pendingSave);
      toast.error(err instanceof Error ? err.message : "Couldn’t save the copy.");
    } finally {
      opts.setDownloading(false);
    }
    return;
  }
  opts.updateUrl(opts.item.url);
  opts.setDownloading(true);
  opts.setProgress({ label: plan.label, percent: 8 });
  toast.message("No local copy — fetching from YouTube again");
  try {
    const result = await resolveVideo({ data: { url: opts.item.url } });
    opts.applyVideo(result, opts.item.lastItag);
    const preset =
      result.presets.find((p) => p.itag === opts.item.lastItag) ?? pickBestPreset(result.presets) ?? result.presets[0];
    if (preset) await opts.runDownload(result, preset, false, pendingSave);
    else {
      void discardPendingSave(pendingSave);
      opts.setDownloading(false);
    }
  } catch (err) {
    void discardPendingSave(pendingSave);
    opts.setDownloading(false);
    toast.error(err instanceof Error ? err.message : "Couldn’t fetch that video again.");
  }
}
