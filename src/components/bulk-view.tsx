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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BulkItem, BulkQualityPreset, BulkQueueOptions } from "@/lib/bulk-download";
import { BulkQueueItem } from "@/components/bulk-queue-item";
import { BulkSettings } from "@/components/bulk-settings";
import { BulkExportMenu } from "@/components/bulk-export-menu";

export type BulkViewProps = {
  inputText: string;
  setInputText: (v: string) => void;
  showOptions: boolean;
  setShowOptions: (v: boolean | ((p: boolean) => boolean)) => void;
  globalPreset: BulkQualityPreset;
  setGlobalPreset: (v: BulkQualityPreset) => void;
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
  queueOptions: BulkQueueOptions;
  setQueueOptions: (v: BulkQueueOptions | ((p: BulkQueueOptions) => BulkQueueOptions)) => void;
  expandPlaylists: boolean;
  setExpandPlaylists: (v: boolean) => void;
  extracted: { totalUnique: number; playlistIds: string[]; videoIds: string[] };
  handleLoadLinks: () => void;
  pasteSampleBatch: () => void;
  items: BulkItem[];
  stats: { total: number; completed: number; failed: number; downloading: number; totalProgress: number; isAllDone: boolean };
  isProcessing: boolean;
  startQueue: () => void;
  pauseQueue: () => void;
  retryFailed: () => void;
  clearQueue: () => void;
  showExportMenu: boolean;
  setShowExportMenu: (v: boolean | ((p: boolean) => boolean)) => void;
  copyScript: () => void;
  copyUrlList: () => void;
  copyJson: () => void;
  onSelectSingleVideo?: (url: string) => void;
  removeItem: (id: string) => void;
};

export function BulkView({
  inputText, setInputText, showOptions, setShowOptions, globalPreset, setGlobalPreset,
  mutate, queueOptions, setQueueOptions, expandPlaylists, setExpandPlaylists,
  extracted, handleLoadLinks, pasteSampleBatch, items, stats, isProcessing,
  startQueue, pauseQueue, retryFailed, clearQueue, showExportMenu, setShowExportMenu,
  copyScript, copyUrlList, copyJson, onSelectSingleVideo, removeItem,
}: BulkViewProps) {

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

        {showOptions ? (
          <BulkSettings
            globalPreset={globalPreset}
            setGlobalPreset={setGlobalPreset}
            mutate={mutate}
            queueOptions={queueOptions}
            setQueueOptions={setQueueOptions}
            expandPlaylists={expandPlaylists}
            setExpandPlaylists={setExpandPlaylists}
          />
        ) : null}

        {/* Input Box Area */}
        <div className="mt-5 space-y-3">
          <div className="relative">
            <textarea
              rows={4}
              aria-label="YouTube links to queue"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste YouTube URLs here (one per line, comma separated, or mixed text)...&#10;https://www.youtube.com/watch?v=...&#10;https://youtu.be/...&#10;https://www.youtube.com/playlist?list=..."
              className="w-full rounded-xl border border-border bg-elevated/80 p-3.5 text-xs text-fg font-mono placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y transition-all"
            />
            {inputText ? (
              <button
                type="button"
                aria-label="Clear pasted links"
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
                onClick={pasteSampleBatch}
                className="cursor-pointer gap-1.5 text-xs h-8 border-border/80 bg-elevated/70 hover:bg-elevated text-fg"
              >
                Load Sample Batch
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {extracted.totalUnique > 0 || extracted.playlistIds.length > 0 ? (
                <span className="text-xs font-mono font-medium text-accent">
                  {extracted.totalUnique} video(s)
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
                <div
                  role="progressbar"
                  aria-label="Batch download progress"
                  aria-valuenow={stats.totalProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="flex-1 h-2 rounded-full bg-border overflow-hidden"
                >
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
                  className="cursor-pointer gap-1.5 text-xs h-8 text-warn border-warn/30 hover:bg-warn/10"
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
                  className="cursor-pointer gap-1.5 text-xs h-8 text-danger border-danger/30 hover:bg-danger/10"
                >
                  <RefreshCw className="size-3.5" />
                  Retry Failed ({stats.failed})
                </Button>
              ) : null}

              <BulkExportMenu
                open={showExportMenu}
                setOpen={setShowExportMenu}
                onScript={copyScript}
                onUrls={copyUrlList}
                onJson={copyJson}
              />

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
            {items.map((item, idx) => (
              <BulkQueueItem
                key={item.id}
                item={item}
                index={idx}
                onOpen={onSelectSingleVideo}
                onRemove={removeItem}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

