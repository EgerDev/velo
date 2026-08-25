import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardPaste,
  Download as DownloadIcon,
  Film,
  Gauge,
  Link2,
  ListPlus,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryList } from "@/components/history-list";
import { CookieImport } from "@/components/cookie-import";
import { AccountChip } from "@/components/account-chip";
import { Wordmark } from "@/components/wordmark";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ResultList } from "@/components/result-list";
import { VideoPanel } from "@/components/video-panel";
import { SaveStage } from "@/components/save-stage";
import { BulkDownloader } from "@/components/bulk-downloader";
import { cn } from "@/lib/utils";
import {
  matchAudioTrack,
  mergedExt,
  parsePlaylistId,
  parseVideoId,
  pickMuxedFallback,
  pickBestPreset,
  sumSizes,
  type PlaylistResult,
  type ResolvedVideo,
  type SearchHit,
  type VideoFormat,
  type VideoPreset,
} from "@/lib/youtube";
import { resolvePlaylist, resolveVideo, searchVideos } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress, type OfferedFile } from "@/lib/download-client";
import { beginBuilderSave, saveMediaBlob } from "@/lib/builder-save";
import { persistStorage } from "@/lib/media-cache";
import { classifyDownloadError, downloadHint, isUserAbort, shouldEscalateSave } from "@/lib/download-error";
import { useAccountScope, useHistoryHydrated, useHistoryStore, type HistoryItem } from "@/lib/history-store";
import { GUEST } from "@/lib/guest-copy";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";

export const Route = createFileRoute("/")({ component: Home });

const SAMPLES = [
  { label: "Me at the zoo", query: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
  { label: "Big Buck Bunny", query: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" },
  { label: "AV1 hardware acceleration", query: "AV1 hardware acceleration support" },
  { label: "HEVC vs AV1", query: "HEVC vs AV1 comparison" },
  { label: "AV1", query: "AV1" },
];

const DRAFT_URL_KEY = "velo-draft-url";

function readDraftUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(DRAFT_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDraftUrl(value: string) {
  try {
    if (value) sessionStorage.setItem(DRAFT_URL_KEY, value);
    else sessionStorage.removeItem(DRAFT_URL_KEY);
  } catch {
    // private mode
  }
}

type ResultsView =
  | { kind: "search"; query: string; items: SearchHit[] }
  | { kind: "playlist"; playlist: PlaylistResult };

function Home() {
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user);
  useAccountScope(user?.id, isPending);
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [results, setResults] = useState<ResultsView | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [offer, setOffer] = useState<OfferedFile[] | null>(null);
  const [viewMode, setViewMode] = useState<"single" | "bulk">("single");
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef(url);
  const statusRef = useRef(status);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  urlRef.current = url;
  statusRef.current = status;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const deepLink = params.get("v") || params.get("url") || params.get("q");
      if (deepLink && !urlRef.current) {
        updateUrl(deepLink);
        void lookup(deepLink);
        return;
      }
    }
    const saved = readDraftUrl();
    if (saved && !urlRef.current) setUrl(saved);
    return () => abortRef.current?.abort();
  }, []);

  function updateUrl(next: string) {
    urlRef.current = next;
    setUrl(next);
    writeDraftUrl(next);
  }

  const hydrated = useHistoryHydrated();
  const record = useHistoryStore((s) => s.record);
  const rememberPreset = useHistoryStore((s) => s.rememberPreset);

  const selected = useMemo(() => {
    if (!video) return null;
    return video.presets.find((p) => p.id === presetId) ?? pickBestPreset(video.presets) ?? video.presets[0] ?? null;
  }, [video, presetId]);

  useKeyboardShortcuts({
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onDownload: () => {
      if (video && selected && !downloading) {
        void runDownload(video, selected);
      }
    },
    onSwitchMode: (mode) => setViewMode(mode),
    onClear: () => {
      if (video || results) {
        setVideo(null);
        setResults(null);
        setError(null);
        setStatus("idle");
      } else {
        updateUrl("");
      }
    },
  });

  const submitKind = useMemo(() => {
    if (parseVideoId(url)) return "fetch" as const;
    if (parsePlaylistId(url)) return "playlist" as const;
    if (url.trim()) return "search" as const;
    return "idle" as const;
  }, [url]);

  function applyVideo(result: ResolvedVideo, preferredItag?: number) {
    setVideo(result);
    const preferred =
      (preferredItag != null
        ? result.presets.find((p) => p.itag === preferredItag) ??
          result.presets.find((p) => p.audioItag === preferredItag)
        : undefined) ??
      pickBestPreset(result.presets);
    setPresetId(preferred?.id ?? null);
    setOffer(null);
    setProgress(null);
  }

  async function lookup(raw?: string) {
    const trimmed = (raw ?? urlRef.current).trim();
    if (!trimmed) {
      if (statusRef.current === "loading") return;
      setError("Paste a YouTube link or search for a video.");
      setStatus("error");
      return;
    }

    updateUrl(trimmed);
    const requestId = ++requestRef.current;
    const previousVideo = video;
    const keepResults = Boolean(
      parseVideoId(trimmed) &&
        (results?.kind === "search"
          ? results.items.some((item) => item.id === parseVideoId(trimmed))
          : results?.kind === "playlist"
            ? results.playlist.items.some((item) => item.id === parseVideoId(trimmed))
            : false),
    );
    setStatus("loading");
    setError(null);
    setOffer(null);
    if (!keepResults) setResults(null);

    const videoId = parseVideoId(trimmed);
    const playlistId = parsePlaylistId(trimmed);

    try {
      if (videoId) {
        const result = await resolveVideo({ data: { url: trimmed } });
        if (requestId !== requestRef.current) return;
        applyVideo(result);
        if (urlRef.current === trimmed) updateUrl(result.url);
        setStatus("idle");
        return;
      }

      if (playlistId) {
        const playlist = await resolvePlaylist({ data: { url: trimmed } });
        if (requestId !== requestRef.current) return;
        setResults({ kind: "playlist", playlist });
        setStatus("idle");
        return;
      }

      const items = await searchVideos({ data: { query: trimmed } });
      if (requestId !== requestRef.current) return;
      if (items.length === 0) {
        setError("No videos matched that search.");
        setStatus("error");
        return;
      }
      setResults({ kind: "search", query: trimmed, items });
      setStatus("idle");
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const message =
        err instanceof Error ? err.message : "Couldn’t read that. Try another link or search.";
      setStatus("error");
      setError(message);
      if (previousVideo) setVideo(previousVideo);
    }
  }

  type FallbackPrompt = {
    target: ResolvedVideo;
    requestedPreset: VideoPreset;
    fallbackPreset: VideoPreset;
    errorText?: string;
  };

  const [fallbackPrompt, setFallbackPrompt] = useState<FallbackPrompt | null>(null);

  async function runDownload(target: ResolvedVideo, preset: VideoPreset, usedFallback = false, pending?: ReturnType<typeof beginBuilderSave>) {
    if (isPending) {
      toast.error("Still checking your session.");
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const pendingSave = pending ?? beginBuilderSave(`${target.title}.${preset.ext}`);
    void persistStorage();
    setDownloading(true);
    setFallbackPrompt(null);
    setProgress({ label: "Starting download", percent: 4 });
    try {
      if (!preset.id.startsWith("fmt-")) rememberPreset(preset.id);
      const saved = await downloadPresetFile({
        videoId: target.id,
        title: target.title,
        preset,
        muxedFallback: pickMuxedFallback(target.presets, preset),
        signedIn,
        pendingSave,
        signal: abort.signal,
        onProgress: setProgress,
      });
      record({
        id: target.id,
        title: target.title,
        author: target.author,
        thumbnail: target.thumbnail,
        duration: target.duration,
        url: target.url,
        lastItag: saved.itag,
        lastPreset: saved.title,
        lastExt: saved.ext,
      });
      toast.success(`Saving ${saved.title}`);
    } catch (err) {
      if (isUserAbort(err, abort.signal)) {
        return;
      }
      if (!usedFallback && preset.audioItag && shouldEscalateSave(err)) {
        const fallback = pickMuxedFallback(target.presets, preset);
        if (fallback && fallback.itag !== preset.itag) {
          setDownloading(false);
          setFallbackPrompt({
            target,
            requestedPreset: preset,
            fallbackPreset: fallback,
            errorText: err instanceof Error ? err.message : "YouTube restricted this stream.",
          });
          toast.warning(`YouTube restricted ${preset.title}. Fallback option available below.`);
          return;
        }
      }
      const classified = classifyDownloadError(err);
      setProgress((prev) => ({
        label: classified.code === "queue" ? GUEST.busy : classified.message,
        percent: 100,
        failed: true,
        errorCode: classified.code,
        hint: downloadHint(classified.code, !signedIn, classified.retryAfterSec),
        steps: prev?.steps,
      }));
      toast.error(classified.message);
    } finally {
      if (!usedFallback && !fallbackPrompt) setDownloading(false);
    }
  }

  function formatAsPreset(format: VideoFormat, formats: VideoFormat[]): VideoPreset {
    if (format.kind === "video") {
      const audio = matchAudioTrack(format, formats);
      if (audio) {
        const ext = mergedExt(format);
        const isHls = format.itag === 96 || format.mime?.includes("m3u8");
        return {
          id: `fmt-${format.itag}`,
          itag: format.itag,
          audioItag: audio.itag,
          kind: "video",
          title: format.qualityLabel,
          hint: format.codec ?? format.mime,
          ext,
          codec: format.codec,
          size: sumSizes(format, audio),
          height: format.height,
          hasAudio: true,
          availability: isHls ? "hls" : "muxed",
          streamType: isHls ? "hls-stitch" : "dash-mux",
          recommended: false,
        };
      }
    }
    const isHls = format.itag === 96 || format.mime?.includes("m3u8") || format.ext === "m3u8";
    return {
      id: `fmt-${format.itag}`,
      itag: format.itag,
      kind: format.kind,
      title: format.qualityLabel,
      hint: format.codec ?? format.mime,
      ext: format.ext,
      codec: format.codec,
      size: format.size,
      height: format.height,
      hasAudio: format.kind !== "video",
      availability: isHls ? "hls" : format.kind === "video" ? "restricted" : "ready",
      streamType: isHls ? "hls-stitch" : "direct",
      recommended: false,
    };
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty.");
        return;
      }
      updateUrl(text.trim());
      await lookup(text);
    } catch {
      toast.error("Couldn’t read the clipboard. Paste into the box instead.");
    }
  }

  async function openHistory(item: HistoryItem) {
    updateUrl(item.url);
    await lookup(item.url);
  }

  async function redownloadHistory(item: HistoryItem) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const pendingSave = beginBuilderSave(`${item.title}.${item.lastExt || "mp4"}`);
    void persistStorage();
    const { getCachedMedia, planRecentSave } = await import("@/lib/media-cache");
    const cached = await getCachedMedia(item.id, item.lastItag);
    const plan = planRecentSave(Boolean(cached));
    if (plan.action === "local" && cached) {
      setDownloading(true);
      setProgress({ label: plan.label, percent: 90 });
      try {
        await saveMediaBlob(cached.blob, cached.filename, pendingSave, {
          videoId: item.id,
          itag: cached.itag,
        }, abort.signal);
        setProgress({ label: "Saved from this browser", percent: 100 });
        toast.success("Saved from Recent — skipped YouTube");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn’t save the copy.");
      } finally {
        setDownloading(false);
      }
      return;
    }
    updateUrl(item.url);
    setDownloading(true);
    setProgress({ label: plan.label, percent: 8 });
    toast.message("No local copy — fetching from YouTube again");
    try {
      const result = await resolveVideo({ data: { url: item.url } });
      applyVideo(result, item.lastItag);
      const preset =
        result.presets.find((p) => p.itag === item.lastItag) ??
        pickBestPreset(result.presets) ??
        result.presets[0];
      if (preset) await runDownload(result, preset, false, pendingSave);
      else setDownloading(false);
    } catch (err) {
      setDownloading(false);
      toast.error(err instanceof Error ? err.message : "Couldn’t fetch that video again.");
    }
  }

  const submitLabel =
    submitKind === "search" ? "Search" : submitKind === "playlist" ? "Open playlist" : "Fetch";
  const SubmitIcon = submitKind === "search" ? Search : submitKind === "playlist" ? Link2 : Gauge;

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <a
        href="#download"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to download
      </a>
      <header className="glass-nav sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Wordmark />
        <AccountChip />
      </header>

      <main id="download" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <div className="stagger max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[var(--tracking-wide)] text-subtle">YouTube downloader</p>
          <h1 className="mt-3 font-display text-3xl leading-[var(--leading-display)] tracking-[var(--tracking-display)] text-fg sm:text-4xl">
            Keep the cut.
          </h1>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-muted">{GUEST.hero}</p>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-elevated/70 border border-border/80 rounded-2xl w-fit mt-7 shadow-xs">
          <button
            type="button"
            onClick={() => setViewMode("single")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer",
              viewMode === "single"
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-muted hover:text-fg hover:bg-white/5",
            )}
          >
            <Film className="size-3.5" />
            Single Video & Search
          </button>
          <button
            type="button"
            onClick={() => setViewMode("bulk")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer",
              viewMode === "bulk"
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-muted hover:text-fg hover:bg-white/5",
            )}
          >
            <ListPlus className="size-3.5" />
            Bulk & Playlist Downloader
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold",
                viewMode === "bulk"
                  ? "bg-black/25 text-white"
                  : "bg-accent/15 text-accent",
              )}
            >
              Batch
            </span>
          </button>
        </div>

        {viewMode === "bulk" ? (
          <div className="mt-6">
            <BulkDownloader
              onSelectSingleVideo={(singleUrl) => {
                updateUrl(singleUrl);
                setViewMode("single");
                void lookup(singleUrl);
              }}
            />
          </div>
        ) : (
          <>
            <form
              className="group relative mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl bg-surface/90 p-2 border border-white/10 shadow-lg backdrop-blur-xl focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem("url");
            const typed = field instanceof HTMLInputElement ? field.value : urlRef.current;
            void lookup(typed);
          }}
        >
          <div className="relative flex flex-1 items-center min-w-0">
            {submitKind === "fetch" || submitKind === "playlist" ? (
              <Link2 className="size-4 text-accent shrink-0 ml-3 mr-1" />
            ) : (
              <Search className="size-4 text-subtle shrink-0 ml-3 mr-1 group-focus-within:text-fg transition-colors" />
            )}
            <input
              ref={searchInputRef}
              name="url"
              value={url}
              onChange={(event) => updateUrl(event.target.value)}
              placeholder="Paste a YouTube link or search..."
              aria-label="YouTube link or search"
              className="h-11 w-full bg-transparent px-2.5 text-sm sm:text-base text-fg placeholder:text-subtle/60 focus:outline-none font-sans"
              autoComplete="off"
              spellCheck={false}
            />
            {url ? (
              <button
                type="button"
                aria-label="Clear input"
                onClick={() => updateUrl("")}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle hover:text-fg hover:bg-white/10 transition-colors mr-1.5 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              className="h-10 px-3.5 text-xs font-medium rounded-xl flex-1 sm:flex-none border-0 shadow-none hover:bg-elevated/80"
              onClick={() => void pasteFromClipboard()}
            >
              <ClipboardPaste className="size-3.5 mr-1.5" />
              Paste
            </Button>
            <Button
              type="submit"
              className="h-10 min-w-24 px-4 text-xs font-semibold rounded-xl flex-1 sm:flex-none bg-accent text-accent-fg hover:opacity-90 transition-all shadow-sm"
              disabled={status === "loading"}
            >
              {status === "loading" ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <SubmitIcon className="size-3.5 mr-1.5" />}
              {status === "loading" ? "Working…" : submitLabel}
            </Button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className="lift glass min-h-11 rounded-full px-3.5 py-2 text-xs text-muted hover:text-fg"
              onClick={() => void lookup(sample.query)}
            >
              {sample.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="panel mt-5 px-4 py-3 text-sm text-danger" role="alert" aria-live="assertive">
            {error}
          </p>
        ) : null}

        {fallbackPrompt ? (
          <div className="panel rise mt-5 border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 text-fg" role="alert">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-500/20 p-2 text-amber-400 shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base text-amber-200">
                  {fallbackPrompt.requestedPreset.title} was restricted by YouTube
                </h3>
                <p className="mt-1 text-sm text-muted">
                  YouTube blocked direct downloading for <strong className="text-fg">{fallbackPrompt.requestedPreset.title}</strong> ({fallbackPrompt.requestedPreset.height ? `${fallbackPrompt.requestedPreset.height}p` : "1080p"}) without signed-in session credentials.
                </p>
                <p className="mt-2 text-sm text-fg">
                  Would you like to continue and save in <strong className="text-amber-300">{fallbackPrompt.fallbackPreset.title}</strong> ({fallbackPrompt.fallbackPreset.height ? `${fallbackPrompt.fallbackPreset.height}p` : "360p"}) instead?
                </p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <Button
                    type="button"
                    className="h-10 bg-amber-500 text-black hover:bg-amber-400 font-medium"
                    onClick={() => {
                      const prompt = fallbackPrompt;
                      setFallbackPrompt(null);
                      void runDownload(prompt.target, prompt.fallbackPreset, true);
                    }}
                  >
                    <DownloadIcon className="size-4 mr-1.5" />
                    Save {fallbackPrompt.fallbackPreset.title} ({fallbackPrompt.fallbackPreset.height ? `${fallbackPrompt.fallbackPreset.height}p` : "360p"})
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10"
                    onClick={() => {
                      setFallbackPrompt(null);
                      const el = document.getElementById("session-cookies");
                      if (el) el.scrollIntoView({ behavior: "smooth" });
                      else toast.info("Import your YouTube session cookies below to unlock full resolution.");
                    }}
                  >
                    Import Cookies for {fallbackPrompt.requestedPreset.title}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 text-muted hover:text-fg"
                    onClick={() => setFallbackPrompt(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="panel mt-8 overflow-hidden">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            </div>
          </div>
        ) : null}

        {video && status !== "loading" ? (
          <VideoPanel
            video={video}
            selected={selected}
            downloading={downloading}
            progress={progress}
            canGoBack={Boolean(results)}
            onSelect={setPresetId}
            onDownload={() => {
              if (isPending) {
                toast.error("Still checking your session.");
                return;
              }
              if (video && selected) void runDownload(video, selected);
            }}
            onDownloadFormat={(format) => {
              if (!video) return;
              void runDownload(video, formatAsPreset(format, video.formats));
            }}
            onReset={() => {
              setVideo(null);
              setOffer(null);
              setProgress(null);
            }}
          />
        ) : null}

        {offer && video ? (
          <SaveStage files={offer} videoId={video.id} thumbnail={video.thumbnail} onClose={() => setOffer(null)} />
        ) : null}

        {results?.kind === "search" && !video ? (
          <ResultList
            title="Search"
            subtitle={results.query}
            items={results.items}
            onPick={(item) => void lookup(`https://www.youtube.com/watch?v=${item.id}`)}
          />
        ) : null}

        {results?.kind === "playlist" && !video ? (
          <ResultList
            title={results.playlist.title}
            subtitle={results.playlist.author ?? "Playlist"}
            items={results.playlist.items}
            onPick={(item) => void lookup(`https://www.youtube.com/watch?v=${item.id}`)}
          />
        ) : null}
          </>
        )}

        <CookieImport />

        {hydrated && !isPending ? (
          <section className="mt-10">
            <HistoryList
              downloading={downloading}
              onOpen={(item) => void openHistory(item)}
              onRedownload={(item) => void redownloadHistory(item)}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
