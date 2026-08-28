import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileCode,
  FileText,
  ListPlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sliders,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  calculateQueueStats,
  createBulkItems,
  DEFAULT_BULK_OPTIONS,
  exportBatchJson,
  exportUrlList,
  exportYtdlpBatchScript,
  extractYoutubeLinks,
  importBatchJson,
  type BulkItem,
  type BulkQualityPreset,
  type BulkQueueOptions,
} from "@/lib/bulk-download";
import { resolveBulkVideos, resolvePlaylist, resolveVideo } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
import { isUserAbort } from "@/lib/download-error";
import { beginBuilderSave, discardPendingSave, type PendingSave } from "@/lib/builder-save";
import { pickBestPreset, type VideoPreset } from "@/lib/youtube";
import { BulkQueueItem } from "@/components/bulk-queue-item";
import { BulkView } from "@/components/bulk-view";
import { processBulkItem } from "@/lib/bulk-process";
import { startBulkQueue } from "@/lib/bulk-queue-run";
import { loadBulkLinks, resolveBulkMetadata } from "@/lib/bulk-load";

type BulkDownloaderProps = {
  onSelectSingleVideo?: (url: string) => void;
  initialIds?: string[];
  /** Lets downloads send the vault cookies — guests always fetch anonymously. */
  signedIn?: boolean;
};

const SAMPLE_BATCH = [
  "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  "https://www.youtube.com/shorts/5Eqb_-j3FDA",
];

export function BulkDownloader({ onSelectSingleVideo, initialIds, signedIn }: BulkDownloaderProps) {
  const [inputText, setInputText] = useState("");
  const [items, setItems] = useState<BulkItem[]>([]);
  // The queue's source of truth. Workers read it synchronously and every write
  // goes through `mutate`, which mirrors it into state. Reading state back out
  // of a setItems updater doesn't work: React defers the updater whenever an
  // update is already queued on this component (a progress tick, or the
  // setIsProcessing right before worker 0 starts), so the pick came back null.
  const itemsRef = useRef<BulkItem[]>([]);
  const mutate = useCallback((fn: (prev: BulkItem[]) => BulkItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);
  // Bumped per startQueue so a paused run's workers can't outlive it.
  const runRef = useRef(0);
  const [globalPreset, setGlobalPreset] = useState<BulkQualityPreset>("1080p");
  const [expandPlaylists, setExpandPlaylists] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [queueOptions, setQueueOptions] = useState<BulkQueueOptions>(DEFAULT_BULK_OPTIONS);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;

  const extracted = useMemo(() => extractYoutubeLinks(inputText), [inputText]);
  const stats = useMemo(() => calculateQueueStats(items), [items]);

  const resolveMetadataForItems = async (itemsToResolve: BulkItem[]) => {
    await resolveBulkMetadata(itemsToResolve, mutate);
  };

  const handleLoadLinks = async () => {
    await loadBulkLinks({
      inputText,
      items,
      globalPreset,
      expandPlaylists,
      extracted,
      mutate,
      setInputText,
    });
  };

  const seededRef = useRef(false);
  const resolveMetadataRef = useRef(resolveMetadataForItems);
  resolveMetadataRef.current = resolveMetadataForItems;
  useEffect(() => {
    if (seededRef.current || !initialIds?.length) return;
    seededRef.current = true;
    const seeded = createBulkItems(initialIds, globalPreset);
    mutate(() => seeded);
    void resolveMetadataRef.current(seeded);
  }, [initialIds, globalPreset, mutate]);

  // Home unmounts this tab on a mode switch; the workers close over refs that
  // outlive the component, so end the run or they keep saving files with no UI.
  useEffect(
    () => () => {
      runRef.current++;
      isProcessingRef.current = false;
      abortControllerRef.current?.abort();
    },
    [],
  );

  const startQueue = async () => {
    await startBulkQueue({
      isProcessing,
      setIsProcessing,
      setIsPaused,
      isProcessingRef,
      isPausedRef,
      abortControllerRef,
      runRef,
      itemsRef,
      queueOptions,
      mutate,
      processItem: processSingleItem,
    });
  };

  const processSingleItem = async (item: BulkItem) => {
    await processBulkItem({
      item,
      signedIn,
      signal: abortControllerRef.current?.signal,
      mutate,
    });
  };

  const pauseQueue = () => {
    setIsPaused(true);
    setIsProcessing(false);
    // Land the stop in the running workers now rather than a render later.
    isPausedRef.current = true;
    isProcessingRef.current = false;
    abortControllerRef.current?.abort();
    toast.info("Batch download queue paused.");
  };

  const clearQueue = () => {
    if (isProcessing) {
      abortControllerRef.current?.abort();
    }
    mutate(() => []);
    setIsProcessing(false);
    setIsPaused(false);
    isProcessingRef.current = false;
    isPausedRef.current = false;
    toast.info("Queue cleared.");
  };

  const retryFailed = () => {
    mutate((prev) =>
      prev.map((i) => (i.status === "failed" ? { ...i, status: "ready", error: null } : i)),
    );
    void startQueue();
  };

  const removeItem = (id: string) => {
    mutate((prev) => prev.filter((i) => i.id !== id));
  };

  const pasteSampleBatch = () => {
    setInputText(SAMPLE_BATCH.join("\n"));
  };

  // A denied clipboard write (framed preview, Firefox/Safari without a fresh
  // gesture) rejects; without the catch it was an unhandled rejection and the
  // export menu stayed open with no feedback.
  const copyExport = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error("Couldn’t copy to clipboard.");
    } finally {
      setShowExportMenu(false);
    }
  };

  const copyScript = async () => {
    if (!items.length) return;
    await copyExport(exportYtdlpBatchScript(items), "yt-dlp batch shell script copied to clipboard!");
  };

  const copyUrlList = async () => {
    if (!items.length) return;
    await copyExport(exportUrlList(items), "Clean URL list copied to clipboard!");
  };

  const copyJson = async () => {
    if (!items.length) return;
    await copyExport(exportBatchJson(items), "Queue metadata JSON copied to clipboard!");
  };

  return (
    <BulkView
      inputText={inputText}
      setInputText={setInputText}
      showOptions={showOptions}
      setShowOptions={setShowOptions}
      globalPreset={globalPreset}
      setGlobalPreset={setGlobalPreset}
      mutate={mutate}
      queueOptions={queueOptions}
      setQueueOptions={setQueueOptions}
      expandPlaylists={expandPlaylists}
      setExpandPlaylists={setExpandPlaylists}
      extracted={extracted}
      handleLoadLinks={() => void handleLoadLinks()}
      pasteSampleBatch={pasteSampleBatch}
      items={items}
      stats={stats}
      isProcessing={isProcessing}
      startQueue={() => void startQueue()}
      pauseQueue={pauseQueue}
      retryFailed={retryFailed}
      clearQueue={clearQueue}
      showExportMenu={showExportMenu}
      setShowExportMenu={setShowExportMenu}
      copyScript={() => void copyScript()}
      copyUrlList={() => void copyUrlList()}
      copyJson={() => void copyJson()}
      onSelectSingleVideo={onSelectSingleVideo}
      removeItem={removeItem}
    />
  );
}
