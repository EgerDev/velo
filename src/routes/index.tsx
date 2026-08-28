import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ViewMode } from "@/lib/view-mode";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { HomeLayout } from "@/components/home-layout";
import { HomeModes } from "@/components/home-modes";
import { HomeSingle, type FallbackPrompt } from "@/components/home-single";
import { parsePlaylistId, parseVideoId, pickBestPreset, type ResolvedVideo, type VideoPreset } from "@/lib/youtube";
import { type DownloadProgress, type OfferedFile } from "@/lib/download-client";
import { useAccountScope, useHistoryHydrated, useHistoryStore, type HistoryItem } from "@/lib/history-store";
import { MODE_TABS } from "@/components/mode-tabs";
import { anyBehind } from "@/lib/tool-versions";
import { useToolsBadge } from "@/lib/use-tools-badge";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
import { mapExtensionPreset, readDraftUrl, writeDraftUrl, type ResultsView } from "@/lib/home-draft";
import { lookupVideo, redownloadHistoryItem, runHomeDownload } from "@/lib/home-actions";

export const Route = createFileRoute("/")({ component: Home });

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
  const [viewMode, setViewMode] = useState<ViewMode>("single");
  const { toolsBehind, setToolsBehind } = useToolsBadge(signedIn);
  const modeTabs = signedIn ? MODE_TABS : MODE_TABS.filter((tab) => tab.mode !== "tools");
  const activeMode: ViewMode = viewMode === "tools" && !signedIn ? "single" : viewMode;
  const [sessionReveal, setSessionReveal] = useState(0);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const wantedPresetRef = useRef<string | null>(null);
  const autoDownloadRef = useRef(false);
  const preferredLangRef = useRef<string | null>(null);
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
      const tab = params.get("tab");
      const batchParam = params.get("batch");
      if (tab === "bulk" || tab === "transcript" || tab === "watch" || tab === "tools") {
        setViewMode(tab);
      } else if (batchParam) {
        setViewMode("bulk");
      }
      if (batchParam) {
        const ids = batchParam
          .split(",")
          .map((part) => parseVideoId(part.trim()))
          .filter((id): id is string => Boolean(id));
        if (ids.length) setBatchIds(ids);
      }
      if (params.get("cookie_sync") === "1") {
        setSessionReveal((n) => n + 1);
      }
      const presetParam = params.get("preset") || (params.get("tab") === "audio" ? "audio" : null);
      if (presetParam) wantedPresetRef.current = mapExtensionPreset(presetParam);
      if (params.get("lang")) preferredLangRef.current = params.get("lang");
      if (params.get("auto") === "1") autoDownloadRef.current = true;

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

  useEffect(() => {
    if (!autoDownloadRef.current || !video || !selected || downloading) return;
    autoDownloadRef.current = false;
    void runDownload(video, selected);
  }, [video, selected, downloading]);

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
    const wanted = wantedPresetRef.current;
    const preferred =
      (preferredItag != null
        ? result.presets.find((p) => p.itag === preferredItag) ??
          result.presets.find((p) => p.audioItag === preferredItag)
        : undefined) ??
      (wanted === "audio" ? result.presets.find((p) => p.kind === "audio") : undefined) ??
      (wanted ? result.presets.find((p) => p.id === wanted) : undefined) ??
      pickBestPreset(result.presets);
    setPresetId(preferred?.id ?? null);
    setOffer(null);
    setProgress(null);
  }

  async function lookup(raw?: string) {
    await lookupVideo({
      raw,
      urlRef,
      statusRef,
      requestRef,
      video,
      results,
      updateUrl,
      applyVideo,
      setStatus,
      setError,
      setOffer,
      setResults,
      setVideo,
    });
  }

  const [fallbackPrompt, setFallbackPrompt] = useState<FallbackPrompt | null>(null);

  async function runDownload(target: ResolvedVideo, preset: VideoPreset, usedFallback = false, pending?: Parameters<typeof runHomeDownload>[0]["pending"]) {
    await runHomeDownload({
      target,
      preset,
      usedFallback,
      pending,
      isPending,
      signedIn,
      abortRef,
      rememberPreset,
      record,
      setDownloading,
      setFallbackPrompt,
      setProgress,
    });
  }

  async function openHistory(item: HistoryItem) {
    updateUrl(item.url);
    await lookup(item.url);
  }

  async function redownloadHistory(item: HistoryItem) {
    await redownloadHistoryItem({
      item,
      abortRef,
      updateUrl,
      applyVideo,
      runDownload,
      setDownloading,
      setProgress,
    });
  }

  const reviewSession = () => {
    setSessionReveal((value) => value + 1);
    document.getElementById("session")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <HomeLayout
      downloading={downloading}
      hydrated={hydrated}
      isPending={isPending}
      signedIn={signedIn}
      activeMode={activeMode}
      modeTabs={modeTabs}
      toolsBehind={toolsBehind}
      sessionReveal={sessionReveal}
      searchInputRef={searchInputRef}
      onOpenHistory={(item) => void openHistory(item)}
      onRedownloadHistory={(item) => void redownloadHistory(item)}
      onMode={setViewMode}
      onReviewSession={reviewSession}
    >
      {activeMode !== "single" ? (
        <HomeModes
          mode={activeMode}
          url={url}
          preferredLang={preferredLangRef.current}
          batchIds={batchIds}
          signedIn={signedIn}
          onOpenVideo={(singleUrl) => {
            updateUrl(singleUrl);
            setViewMode("single");
            void lookup(singleUrl);
          }}
          onToolsStatus={(check) => setToolsBehind(anyBehind(check.rows))}
        />
      ) : (
        <HomeSingle
          url={url}
          urlRef={urlRef}
          searchInputRef={searchInputRef}
          submitKind={submitKind}
          status={status}
          error={error}
          isPending={isPending}
          video={video}
          selected={selected}
          downloading={downloading}
          progress={progress}
          offer={offer}
          results={results}
          fallbackPrompt={fallbackPrompt}
          onUrl={updateUrl}
          onLookup={(raw) => void lookup(raw)}
          onClearError={() => {
            setError(null);
            setStatus("idle");
            updateUrl("");
          }}
          onDownload={(target, preset, usedFallback) => void runDownload(target, preset, usedFallback)}
          onSelectPreset={setPresetId}
          onResetVideo={() => {
            setVideo(null);
            setOffer(null);
            setProgress(null);
          }}
          onCloseOffer={() => setOffer(null)}
          onFallback={setFallbackPrompt}
        />
      )}
    </HomeLayout>
  );
}
