import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
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
  type BulkItem,
  type BulkQualityPreset,
  type BulkQueueOptions,
} from "@/lib/bulk-download";
import { resolveBulkVideos, resolvePlaylist, resolveVideo } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
import { beginBuilderSave } from "@/lib/builder-save";
import { pickBestPreset, type VideoPreset } from "@/lib/youtube";

type BulkDownloaderProps = {
  onSelectSingleVideo?: (url: string) => void;
};

const SAMPLE_BATCH = [
  "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  "https://www.youtube.com/shorts/5Eqb_-j3FDA",
];

export function BulkDownloader({ onSelectSingleVideo }: BulkDownloaderProps) {
  const [inputText, setInputText] = useState("");
  const [items, setItems] = useState<BulkItem[]>([]);
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

  // Load input text into items
  const handleLoadLinks = async () => {
    if (!extracted.totalUnique && !extracted.playlistIds.length) {
      toast.error("No valid YouTube video or playlist links found in the text.");
      return;
    }

    const newVideoIds = [...extracted.videoIds];

    // If there are playlist IDs and option is enabled, resolve them
    if (extracted.playlistIds.length > 0 && expandPlaylists) {
      toast.info(`Expanding ${extracted.playlistIds.length} playlist(s)...`);
      for (const plId of extracted.playlistIds) {
        try {
          const res = await resolvePlaylist({ data: { url: `https://www.youtube.com/playlist?list=${plId}` } });
          for (const item of res.items) {
            if (!newVideoIds.includes(item.id)) {
              newVideoIds.push(item.id);
            }
          }
        } catch {
          toast.warning(`Could not expand playlist: ${plId}`);
        }
      }
    }

    if (!newVideoIds.length) {
      toast.error("No video items could be extracted.");
      return;
    }

    const existingIds = new Set(items.map((i) => i.id));
    const uniqueNewIds = newVideoIds.filter((id) => !existingIds.has(id));

    if (!uniqueNewIds.length) {
      toast.info("All entered links are already in the queue.");
      return;
    }

    const newItems = createBulkItems(uniqueNewIds, globalPreset);
    setItems((prev) => [...prev, ...newItems]);
    setInputText("");
    toast.success(`Added ${newItems.length} video(s) to the download queue.`);

    // Automatically trigger metadata resolution in background
    void resolveMetadataForItems(newItems);
  };

  // Background metadata resolver
  const resolveMetadataForItems = async (itemsToResolve: BulkItem[]) => {
    const ids = itemsToResolve.map((i) => i.id);
    if (!ids.length) return;

    setItems((prev) =>
      prev.map((item) => (ids.includes(item.id) ? { ...item, status: "resolving" } : item)),
    );

    try {
      const results = await resolveBulkVideos({ data: { ids } });
      setItems((prev) =>
        prev.map((item) => {
          const match = results.find((r) => r.id === item.id);
          if (!match) return item;
          if (match.ok && match.video) {
            const v = match.video;
            const best = pickBestPreset(v.presets);
            return {
              ...item,
              title: v.title,
              author: v.author,
              duration: v.duration,
              durationFormatted: v.duration
                ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, "0")}`
                : null,
              thumbnail: v.thumbnail,
              status: "ready",
              selectedItag: best?.itag ?? 137,
              selectedAudioItag: best?.audioItag ?? 140,
              sizeFormatted: best?.size ? `${(best.size / (1024 * 1024)).toFixed(1)} MB` : null,
              filename: `${v.title}.${best?.ext || "mp4"}`,
            };
          } else {
            return {
              ...item,
              status: "ready", // Still allow trying direct download
              error: match.error ?? null,
            };
          }
        }),
      );
    } catch {
      setItems((prev) =>
        prev.map((item) => (ids.includes(item.id) ? { ...item, status: "ready" } : item)),
      );
    }
  };

  // Process the queue with anti-throttling concurrency control
  const startQueue = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setIsPaused(false);
    abortControllerRef.current = new AbortController();

    toast.info(`Starting batch download queue (Concurrency: ${queueOptions.maxConcurrency})...`);

    const runWorker = async () => {
      while (isProcessingRef.current && !isPausedRef.current) {
        // Find next eligible item
        let nextItem: BulkItem | null = null;
        setItems((currentItems) => {
          const downloadingCount = currentItems.filter((i) => i.status === "downloading").length;
          if (downloadingCount >= queueOptions.maxConcurrency) return currentItems;

          const candidate = currentItems.find(
            (i) => i.status === "ready" || i.status === "pending" || (i.status === "failed" && i.retryCount < queueOptions.maxRetries),
          );

          if (candidate) {
            nextItem = candidate;
            return currentItems.map((item) =>
              item.id === candidate.id ? { ...item, status: "downloading", progress: 5 } : item,
            );
          }
          return currentItems;
        });

        if (!nextItem) {
          // Check if any are still downloading
          let activeCount = 0;
          setItems((current) => {
            activeCount = current.filter((i) => i.status === "downloading").length;
            return current;
          });

          if (activeCount === 0) {
            // Queue is complete
            setIsProcessing(false);
            toast.success("Batch download queue completed!");
            break;
          }

          // Wait a bit before checking for available slots
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        // Process this item
        const itemToProcess: BulkItem = nextItem;
        void processSingleItem(itemToProcess);

        // Anti-throttling stagger delay between launching successive downloads
        await new Promise((r) => setTimeout(r, queueOptions.staggerDelayMs));
      }
    };

    // Run workers up to max concurrency
    const workers = Array.from({ length: queueOptions.maxConcurrency }, () => runWorker());
    await Promise.all(workers);
  };

  // Download a single item through the Velo pipeline
  const processSingleItem = async (item: BulkItem) => {
    try {
      // 1. Resolve video details if not already resolved
      let title = item.title;
      let targetPresetItag = item.selectedItag ?? 137;
      let targetAudioItag = item.selectedAudioItag ?? 140;
      let ext = "mp4";

      if (!title) {
        const v = await resolveVideo({ data: { url: item.url } });
        title = v.title;
        const best = pickBestPreset(v.presets);
        targetPresetItag = best?.itag ?? 137;
        targetAudioItag = best?.audioItag ?? 140;
        ext = best?.ext ?? "mp4";
      }

      const filename = `${title || `video-${item.id}`}.${ext}`;
      const pendingSave = beginBuilderSave(filename);

      const presetObj: VideoPreset = {
        id: `bulk-${targetPresetItag}`,
        itag: targetPresetItag,
        audioItag: targetAudioItag,
        kind: "video",
        title: item.preset,
        hint: ext,
        ext,
        codec: null,
        size: null,
        height: null,
        hasAudio: true,
        availability: "muxed",
        streamType: "dash-mux",
        recommended: true,
      };

      await downloadPresetFile({
        videoId: item.id,
        title: title || item.id,
        preset: presetObj,
        pendingSave,
        signal: abortControllerRef.current?.signal,
        onProgress: (prog: DownloadProgress) => {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, progress: Math.max(10, Math.min(95, prog.percent)) }
                : i,
            ),
          );
        },
      });

      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "completed", progress: 100, filename, error: null }
            : i,
        ),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Download failed.";
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "failed",
                error: errMsg,
                retryCount: i.retryCount + 1,
              }
            : i,
        ),
      );
    }
  };

  const pauseQueue = () => {
    setIsPaused(true);
    setIsProcessing(false);
    abortControllerRef.current?.abort();
    toast.info("Batch download queue paused.");
  };

  const clearQueue = () => {
    if (isProcessing) {
      abortControllerRef.current?.abort();
    }
    setItems([]);
    setIsProcessing(false);
    setIsPaused(false);
    toast.info("Queue cleared.");
  };

  const retryFailed = () => {
    setItems((prev) =>
      prev.map((i) => (i.status === "failed" ? { ...i, status: "ready", error: null } : i)),
    );
    void startQueue();
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const pasteSampleBatch = () => {
    setInputText(SAMPLE_BATCH.join("\n"));
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty.");
        return;
      }
      setInputText(text.trim());
      toast.success("Pasted links from clipboard.");
    } catch {
      toast.error("Could not read clipboard. Paste directly into the box.");
    }
  };

  const copyScript = async () => {
    if (!items.length) return;
    const script = exportYtdlpBatchScript(items);
    await navigator.clipboard.writeText(script);
    toast.success("yt-dlp batch shell script copied to clipboard!");
    setShowExportMenu(false);
  };

  const copyUrlList = async () => {
    if (!items.length) return;
    const list = exportUrlList(items);
    await navigator.clipboard.writeText(list);
    toast.success("Clean URL list copied to clipboard!");
    setShowExportMenu(false);
  };

  const copyJson = async () => {
    if (!items.length) return;
    const json = exportBatchJson(items);
    await navigator.clipboard.writeText(json);
    toast.success("Queue metadata JSON copied to clipboard!");
    setShowExportMenu(false);
  };

  return (
    <div className="w-full space-y-6">
      {/* Top Banner / Hero */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-md p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center size-8 rounded-lg bg-accent/15 text-accent">
                <ListPlus className="size-4" />
              </span>
              <h2 className="text-lg font-bold tracking-tight text-fg">Bulk & Playlist Downloader</h2>
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider border-accent/40 text-accent">
                Anti-Throttle Queue
              </Badge>
            </div>
            <p className="text-xs text-muted mt-1 max-w-xl">
              Paste multiple YouTube links or playlists. Velo uses staggered bursts, BotGuard PO token rotation, and zero-loss copy-muxing to prevent 429 rate-limiting.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOptions(!showOptions)}
              className="text-xs cursor-pointer gap-1.5"
            >
              <Sliders className="size-3.5" />
              Queue Settings
            </Button>
          </div>
        </div>

        {/* Queue Settings Tray */}
        {showOptions ? (
          <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="text-subtle font-medium block mb-1">Quality Preset</label>
              <select
                value={globalPreset}
                onChange={(e) => {
                  const p = e.target.value as BulkQualityPreset;
                  setGlobalPreset(p);
                  setItems((prev) => prev.map((i) => ({ ...i, preset: p })));
                }}
                className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="1080p">🎬 1080p Full HD</option>
                <option value="720p">⚡ 720p HD</option>
                <option value="audio">🎵 Audio Only</option>
                <option value="transcript">📝 Subtitles Only</option>
              </select>
            </div>

            <div>
              <label className="text-subtle font-medium block mb-1">Max Concurrency</label>
              <select
                value={queueOptions.maxConcurrency}
                onChange={(e) =>
                  setQueueOptions((prev) => ({ ...prev, maxConcurrency: Number(e.target.value) }))
                }
                className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value={1}>1 (Safest — Single Stream)</option>
                <option value={2}>2 (Recommended — Fast & Safe)</option>
                <option value={3}>3 (High Throughput)</option>
              </select>
            </div>

            <div>
              <label className="text-subtle font-medium block mb-1">Stagger Delay (Anti-Burst)</label>
              <select
                value={queueOptions.staggerDelayMs}
                onChange={(e) =>
                  setQueueOptions((prev) => ({ ...prev, staggerDelayMs: Number(e.target.value) }))
                }
                className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value={1000}>1.0s (Fast)</option>
                <option value={1800}>1.8s (Recommended)</option>
                <option value={3000}>3.0s (Strict Rate Limit Protection)</option>
              </select>
            </div>

            <div>
              <label className="text-subtle font-medium block mb-1">Playlist Auto-Expand</label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer text-fg">
                <input
                  type="checkbox"
                  checked={expandPlaylists}
                  onChange={(e) => setExpandPlaylists(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent size-4"
                />
                Expand playlist items
              </label>
            </div>
          </div>
        ) : null}

        {/* Input Box Area */}
        <div className="mt-5 space-y-3">
          <div className="relative">
            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste YouTube URLs here (one per line, comma separated, or mixed text)...&#10;https://www.youtube.com/watch?v=...&#10;https://youtu.be/...&#10;https://www.youtube.com/playlist?list=..."
              className="w-full rounded-xl border border-border bg-elevated/80 p-3.5 text-xs text-fg font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y transition-all"
            />
            {inputText ? (
              <button
                type="button"
                onClick={() => setInputText("")}
                className="absolute top-3 right-3 text-subtle hover:text-fg p-1 rounded-md cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                onClick={pasteClipboard}
                className="cursor-pointer gap-1.5 text-xs h-8"
              >
                <ClipboardPaste className="size-3.5" />
                Paste Clipboard
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={pasteSampleBatch}
                className="cursor-pointer gap-1.5 text-xs h-8 text-subtle hover:text-fg"
              >
                Load Sample Batch
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {extracted.totalUnique > 0 || extracted.playlistIds.length > 0 ? (
                <span className="text-xs font-mono font-medium text-accent">
                  ✨ {extracted.totalUnique} video(s)
                  {extracted.playlistIds.length > 0 ? ` + ${extracted.playlistIds.length} playlist(s)` : ""} detected
                </span>
              ) : null}

              <Button
                onClick={handleLoadLinks}
                disabled={!extracted.totalUnique && !extracted.playlistIds.length}
                className="cursor-pointer gap-1.5 text-xs h-8 bg-accent text-accent-fg font-medium hover:bg-accent/90"
              >
                <ListPlus className="size-3.5" />
                Add to Queue
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Queue Section */}
      {items.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-md overflow-hidden shadow-sm">
          {/* Queue Header & Action Bar */}
          <div className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-elevated/40">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">Download Queue</h3>
                <Badge variant="outline" className="font-mono text-xs">
                  {stats.completed} / {stats.total} Finished
                </Badge>
                {stats.downloading > 0 ? (
                  <Badge variant="default" className="bg-accent text-accent-fg text-xs animate-pulse">
                    {stats.downloading} Active
                  </Badge>
                ) : null}
              </div>

              {/* Overall Progress Bar */}
              <div className="flex items-center gap-3 mt-2 w-full sm:w-80">
                <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{ width: `${stats.totalProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-muted">{stats.totalProgress}%</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isProcessing ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={pauseQueue}
                  className="cursor-pointer gap-1.5 text-xs h-8 text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                >
                  <Pause className="size-3.5" />
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={startQueue}
                  disabled={stats.isAllDone}
                  className="cursor-pointer gap-1.5 text-xs h-8 bg-accent text-accent-fg hover:bg-accent/90"
                >
                  <Play className="size-3.5" />
                  {stats.completed > 0 ? "Resume Queue" : "Start All Downloads"}
                </Button>
              )}

              {stats.failed > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={retryFailed}
                  className="cursor-pointer gap-1.5 text-xs h-8 text-rose-400 border-rose-400/30 hover:bg-rose-400/10"
                >
                  <RefreshCw className="size-3.5" />
                  Retry Failed ({stats.failed})
                </Button>
              ) : null}

              {/* Export Scripts Dropdown */}
              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="cursor-pointer gap-1.5 text-xs h-8"
                >
                  <Download className="size-3.5" />
                  Export Queue
                  <ChevronDown className="size-3 text-subtle" />
                </Button>

                {showExportMenu ? (
                  <div className="absolute right-0 mt-1 w-56 rounded-xl border border-border bg-elevated/95 backdrop-blur-md p-1.5 shadow-xl z-30 text-xs">
                    <button
                      type="button"
                      onClick={copyScript}
                      className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
                    >
                      <FileCode className="size-4 text-accent shrink-0" />
                      <div>
                        <div className="font-medium text-fg">yt-dlp Bash Script</div>
                        <div className="text-[10px] text-muted">Runs anti-throttle batch locally</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={copyUrlList}
                      className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
                    >
                      <FileText className="size-4 text-accent shrink-0" />
                      <div>
                        <div className="font-medium text-fg">Clean URL List</div>
                        <div className="text-[10px] text-muted">For IDM, JDownloader, aria2</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={copyJson}
                      className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
                    >
                      <Copy className="size-4 text-accent shrink-0" />
                      <div>
                        <div className="font-medium text-fg">JSON Metadata</div>
                        <div className="text-[10px] text-muted">Titles, URLs, and status</div>
                      </div>
                    </button>
                  </div>
                ) : null}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={clearQueue}
                className="cursor-pointer gap-1.5 text-xs h-8 text-subtle hover:text-danger hover:bg-danger/10"
              >
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </div>
          </div>

          {/* Queue Item List */}
          <div className="divide-y divide-border/30 max-h-[460px] overflow-y-auto p-2 sm:p-3 space-y-1">
            {items.map((item, idx) => {
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-xl transition-colors",
                    item.status === "downloading"
                      ? "bg-accent/10 border border-accent/30"
                      : item.status === "completed"
                        ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                        : item.status === "failed"
                          ? "bg-rose-500/5 hover:bg-rose-500/10"
                          : "hover:bg-elevated/60",
                  )}
                >
                  {/* Left: Thumbnail & Info */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-[11px] font-mono text-subtle w-5 shrink-0 text-center">
                      {idx + 1}
                    </span>

                    <div className="relative size-12 rounded-lg overflow-hidden bg-black/40 shrink-0 border border-border/50">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.title || item.id}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="size-full flex items-center justify-center text-muted">
                          <Play className="size-4" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => onSelectSingleVideo?.(item.url)}
                          className="font-medium text-xs text-fg hover:text-accent cursor-pointer truncate"
                        >
                          {item.title || `Video ID: ${item.id}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5 font-mono">
                        <span>{item.author || "YouTube"}</span>
                        {item.durationFormatted ? (
                          <>
                            <span>·</span>
                            <span>{item.durationFormatted}</span>
                          </>
                        ) : null}
                        {item.sizeFormatted ? (
                          <>
                            <span>·</span>
                            <span>{item.sizeFormatted}</span>
                          </>
                        ) : null}
                      </div>

                      {/* Error text if failed */}
                      {item.error ? (
                        <p className="text-[11px] text-rose-400 truncate mt-0.5">{item.error}</p>
                      ) : null}
                    </div>
                  </div>

                  {/* Right: Status & Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-8 sm:pl-0">
                    {/* Status indicator */}
                    <div className="flex items-center gap-2">
                      {item.status === "downloading" ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="size-3.5 animate-spin text-accent" />
                          <span className="text-xs font-mono font-medium text-accent">
                            {item.progress}%
                          </span>
                        </div>
                      ) : item.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="size-3.5" />
                          Done
                        </span>
                      ) : item.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-400">
                          <XCircle className="size-3.5" />
                          Failed
                        </span>
                      ) : item.status === "resolving" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-subtle">
                          <Loader2 className="size-3 animate-spin" />
                          Checking...
                        </span>
                      ) : (
                        <span className="text-xs text-subtle font-mono">Ready</span>
                      )}
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-subtle hover:text-danger p-1 rounded-md cursor-pointer transition-colors"
                      title="Remove from queue"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
