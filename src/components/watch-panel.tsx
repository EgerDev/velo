import { useEffect, useState } from "react";
import { Bell, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { youtubeWatchUrl } from "@/lib/youtube";
import { newSince, type ChannelFeed, type FeedVideo } from "@/lib/watch-feed";
import { useWatchStore, type WatchedChannel } from "@/lib/watch-store";

type WatchPanelProps = {
  onSelectVideo?: (url: string) => void;
};

type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; videos: FeedVideo[] };

async function fetchFeed(params: string): Promise<ChannelFeed> {
  const response = await fetch(`/api/feed?${params}`, { headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Feed error ${response.status}`);
  return body as ChannelFeed;
}

function timeAgo(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function ChannelCard({
  channel,
  onSelectVideo,
}: {
  channel: WatchedChannel;
  onSelectVideo?: (url: string) => void;
}) {
  const markSeen = useWatchStore((s) => s.markSeen);
  const remove = useWatchStore((s) => s.remove);
  const [feed, setFeed] = useState<FeedState>({ status: "loading" });

  async function load() {
    setFeed({ status: "loading" });
    try {
      const data = await fetchFeed(`channelId=${encodeURIComponent(channel.channelId)}`);
      setFeed({ status: "ready", videos: data.videos });
    } catch (err) {
      setFeed({ status: "error", message: err instanceof Error ? err.message : "Feed unavailable." });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.channelId]);

  const videos = feed.status === "ready" ? feed.videos : [];
  const fresh = newSince(videos, channel.lastSeenMs);
  const newestMs = videos[0]?.publishedMs ?? channel.lastSeenMs;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-elevated/40 px-3.5 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-fg">{channel.title}</span>
          {fresh.length > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
              <Bell className="size-2.5" />
              {fresh.length} new
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {fresh.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => markSeen(channel.channelId, newestMs)}>
              Mark seen
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Refresh" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Remove channel" onClick={() => remove(channel.channelId)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {feed.status === "loading" ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Loading latest…
        </p>
      ) : feed.status === "error" ? (
        <p className="px-3.5 py-3 text-xs text-subtle">{feed.message}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {videos.slice(0, 6).map((video) => {
            const isNew = video.publishedMs > channel.lastSeenMs;
            return (
              <li key={video.id}>
                <button
                  type="button"
                  onClick={() => onSelectVideo?.(youtubeWatchUrl(video.id))}
                  className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-elevated/40 cursor-pointer"
                >
                  <span className="relative shrink-0">
                    <img
                      src={video.thumbnail}
                      alt=""
                      loading="lazy"
                      className="h-9 w-16 rounded-md object-cover"
                    />
                    {isNew ? <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-xs leading-snug transition-colors group-hover:text-fg",
                        isNew ? "font-medium text-fg" : "text-muted",
                      )}
                    >
                      {video.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-subtle">
                      {timeAgo(video.publishedMs)}
                      {video.views != null ? ` · ${Intl.NumberFormat(undefined, { notation: "compact" }).format(video.views)} views` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WatchPanel({ onSelectVideo }: WatchPanelProps) {
  const channels = useWatchStore((s) => s.channels);
  const add = useWatchStore((s) => s.add);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);

  async function addChannel(raw: string) {
    const value = raw.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      const feed = await fetchFeed(`channel=${encodeURIComponent(value)}`);
      if (!feed.channelId) throw new Error("Couldn’t resolve that channel.");
      if (channels.some((c) => c.channelId === feed.channelId)) {
        toast.message("Already watching that channel.");
      } else {
        add({
          channelId: feed.channelId,
          title: feed.channelTitle ?? "Channel",
          // Treat existing uploads as already seen; only future ones ping.
          lastSeenMs: feed.videos[0]?.publishedMs ?? Date.now(),
        });
        toast.success(`Watching ${feed.channelTitle ?? "channel"}`);
      }
      setInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t add that channel.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <h2 className="font-display text-xl tracking-[var(--tracking-tight)] text-fg">Channel watch</h2>
        <p className="mt-1 text-sm text-muted">
          Track channels and see new uploads since your last visit — paste a channel URL, @handle, or
          UC… id. Watched channels live in this browser only.
        </p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void addChannel(input);
          }}
        >
          <div className="relative flex flex-1 items-center rounded-xl border border-border bg-surface/90 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 transition-all">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="youtube.com/@channel or UC…"
              aria-label="Channel URL, handle, or id"
              className="h-11 w-full bg-transparent px-3.5 text-sm text-fg placeholder:text-subtle/60 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {input ? (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => setInput("")}
                className="mr-1.5 flex size-7 items-center justify-center rounded-full text-subtle hover:bg-elevated hover:text-fg cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <Button type="submit" className="h-11 px-4 font-semibold shrink-0" disabled={adding || !input.trim()}>
            {adding ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Plus className="size-4 mr-1.5" />}
            {adding ? "Adding…" : "Watch"}
          </Button>
        </form>
      </div>

      {channels.length === 0 ? (
        <div className="panel px-5 py-8">
          <p className="font-display text-xl tracking-[var(--tracking-tight)] text-fg">No channels yet</p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
            Add a channel above and its latest uploads show up here. New videos since your last visit
            get a gold dot.
          </p>
        </div>
      ) : (
        <div className="stagger grid grid-cols-1 gap-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.channelId} channel={channel} onSelectVideo={onSelectVideo} />
          ))}
        </div>
      )}
    </div>
  );
}
