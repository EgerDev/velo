import { useEffect, useState } from "react";
import { Clock, Download, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration } from "@/lib/youtube";
import { useHistoryStore, type HistoryItem } from "@/lib/history-store";
import {
  cacheKey,
  clearCachedMedia,
  listCachedKeys,
  removeCachedMedia,
  storageStatus,
  type StorageStatus,
} from "@/lib/media-cache";

function timeAgo(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

type HistoryListProps = {
  onOpen: (item: HistoryItem) => void;
  onRedownload: (item: HistoryItem) => void;
  downloading?: boolean;
};

export function HistoryList({ onOpen, onRedownload, downloading }: HistoryListProps) {
  const items = useHistoryStore((s) => s.items);
  const remove = useHistoryStore((s) => s.remove);
  const clear = useHistoryStore((s) => s.clear);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cachedKeys, setCachedKeys] = useState<Set<string>>(new Set());
  const [storage, setStorage] = useState<StorageStatus | null>(null);

  async function refreshCache() {
    const [keys, status] = await Promise.all([listCachedKeys(), storageStatus()]);
    setCachedKeys(new Set(keys));
    setStorage(status);
  }

  useEffect(() => {
    void refreshCache();
  }, [items]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  if (items.length === 0) {
    return (
      <div className="panel px-5 py-8">
        <p className="font-display text-xl tracking-[var(--tracking-tight)] text-fg">No cuts yet</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
          Saved files land here so you can open them again without hunting for the link.
        </p>
      </div>
    );
  }

  const persistHint = storage?.persisted
    ? "Copies stay until you clear this site."
    : storage && storage.quota > 0 && storage.quota < 50 * 1024 * 1024
      ? "This preview’s storage quota is small — a 1080p file may not cache."
      : "Chrome may drop copies if storage is low or you clear cookies.";
  const quotaLabel =
    storage && storage.quota > 0
      ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)} (${Math.round(storage.percent)}%)`
      : storage && storage.usage > 0
        ? `${formatBytes(storage.usage)} cached`
        : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-[var(--tracking-display)] text-fg">Recent</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Clock className="size-3.5" />
            <span className="tabular-nums">{items.length} saved</span>
          </p>
          <p className="mt-1 max-w-md text-xs text-subtle">
            {persistHint}
            {quotaLabel ? ` · ${quotaLabel}` : ""}
          </p>
        </div>
        <Button
          variant={confirmClear ? "destructive" : "ghost"}
          size="sm"
          onClick={() => {
            if (confirmClear) {
              void clearCachedMedia();
              clear();
              setCachedKeys(new Set());
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
            }
          }}
        >
          {confirmClear ? "Clear list + copies" : "Clear"}
        </Button>
      </div>
      <ul className="stagger flex flex-col gap-2">
        {items.map((item) => {
          const local = cachedKeys.has(cacheKey(item.id, item.lastItag));
          return (
            <li key={`${item.id}-${item.downloadedAt}`}>
              <article className="lift glass group flex gap-3 rounded-xl p-2">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => onOpen(item)}
                  className="relative size-20 shrink-0 overflow-hidden rounded-md bg-elevated sm:aspect-video sm:h-24 sm:w-auto sm:min-w-40"
                >
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="size-full object-cover outline outline-1 -outline-offset-1 outline-fg/10"
                  />
                </button>
                <div className="min-w-0 flex-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="block w-full text-left"
                  >
                    <h3 className="truncate text-sm font-medium text-fg">{item.title}</h3>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {item.author}
                      {item.duration != null ? ` · ${formatDuration(item.duration)}` : ""}
                    </p>
                  </button>
                  <p className="mt-1 truncate text-xs text-subtle">
                    {item.lastPreset} · {timeAgo(item.downloadedAt)}
                    {local ? " · on this device" : " · fetch from YouTube"}
                  </p>
                  <div className="mt-2 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={downloading}
                      aria-label={local ? "Save copy" : "Fetch from YouTube again"}
                      title={
                        local
                          ? "Save the copy already on this device"
                          : "No local copy — fetch from YouTube again"
                      }
                      onClick={() => onRedownload(item)}
                    >
                      <Download />
                    </Button>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open on YouTube"
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove from history"
                      onClick={() => {
                        void removeCachedMedia(item.id).catch(() => undefined);
                        remove(item.id);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
