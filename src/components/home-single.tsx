import type { FormEvent, RefObject } from "react";
import { AlertTriangle, Download as DownloadIcon, Gauge, Link2, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResultList } from "@/components/result-list";
import { SampleChipRow } from "@/components/sample-chips";
import { SaveStage } from "@/components/save-stage";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoPanel } from "@/components/video-panel";
import { SAMPLES } from "@/lib/home-draft";
import { formatAsPreset } from "@/lib/home-format";
import type { ResultsView } from "@/lib/home-draft";
import type { DownloadProgress, OfferedFile } from "@/lib/download-client";
import type { ResolvedVideo, VideoFormat, VideoPreset } from "@/lib/youtube";

export type FallbackPrompt = {
  target: ResolvedVideo;
  requestedPreset: VideoPreset;
  fallbackPreset: VideoPreset;
  errorText?: string;
};

export function HomeSingle(props: {
  url: string;
  urlRef: RefObject<string>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  submitKind: "search" | "playlist" | "fetch" | "idle";
  status: "idle" | "loading" | "error";
  error: string | null;
  isPending: boolean;
  video: ResolvedVideo | null;
  selected: VideoPreset | null;
  downloading: boolean;
  progress: DownloadProgress | null;
  offer: OfferedFile[] | null;
  results: ResultsView | null;
  fallbackPrompt: FallbackPrompt | null;
  onUrl: (value: string) => void;
  onLookup: (raw?: string) => void;
  onClearError: () => void;
  onDownload: (target: ResolvedVideo, preset: VideoPreset, usedFallback?: boolean) => void;
  onSelectPreset: (id: string | null) => void;
  onResetVideo: () => void;
  onCloseOffer: () => void;
  onFallback: (prompt: FallbackPrompt | null) => void;
}) {
  const submitLabel =
    props.submitKind === "search" ? "Search" : props.submitKind === "playlist" ? "Open playlist" : "Fetch";
  const SubmitIcon = props.submitKind === "search" ? Search : props.submitKind === "playlist" ? Link2 : Gauge;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("url");
    const typed = field instanceof HTMLInputElement ? field.value : props.urlRef.current;
    void props.onLookup(typed);
  }

  return (
    <>
      <form
        className="group relative mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl bg-surface/90 p-2 border border-border shadow-lg backdrop-blur-xl focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
        onSubmit={onSubmit}
      >
        <div className="relative flex flex-1 items-center min-w-0">
          {props.submitKind === "fetch" || props.submitKind === "playlist" ? (
            <Link2 className="size-4 text-accent shrink-0 ml-3 mr-1" />
          ) : (
            <Search className="size-4 text-subtle shrink-0 ml-3 mr-1 group-focus-within:text-fg transition-colors" />
          )}
          <input
            ref={props.searchInputRef}
            name="url"
            value={props.url}
            onChange={(event) => props.onUrl(event.target.value)}
            placeholder="Paste a YouTube link or search..."
            aria-label="YouTube link or search"
            className="h-11 w-full bg-transparent px-2.5 text-sm sm:text-base text-fg placeholder:text-subtle/60 focus:outline-none font-sans"
            autoComplete="off"
            spellCheck={false}
          />
          {props.url ? (
            <button
              type="button"
              aria-label="Clear input"
              onClick={() => props.onUrl("")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle hover:text-fg hover:bg-elevated transition-colors mr-1.5 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="submit"
          className="h-10 min-w-24 px-4 text-xs font-semibold rounded-xl flex-1 sm:flex-none bg-accent text-accent-fg hover:opacity-90 transition-all shadow-sm shrink-0"
          disabled={props.status === "loading"}
        >
          {props.status === "loading" ? (
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
          ) : (
            <SubmitIcon className="size-3.5 mr-1.5" />
          )}
          {props.status === "loading" ? "Working…" : submitLabel}
        </Button>
      </form>

      <SampleChipRow samples={SAMPLES} onPick={(sample) => void props.onLookup(sample.query)} />

      {props.error ? (
        <div className="panel rise mt-5 overflow-hidden border border-danger/30 bg-danger/10 p-4 sm:p-5 text-fg shadow-lg" role="alert">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-danger/20 p-2 text-danger shrink-0 mt-0.5">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm sm:text-base text-danger">Couldn’t resolve that link</h3>
              <p className="mt-1 text-xs sm:text-sm text-muted leading-relaxed">{props.error}</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-surface/80 hover:bg-elevated"
                  onClick={props.onClearError}
                >
                  Clear input
                </Button>
                <Button type="button" variant="secondary" size="sm" className="h-8 text-xs" onClick={() => void props.onLookup(SAMPLES[0].query)}>
                  Try the 4K HDR demo
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {props.fallbackPrompt ? (
        <div className="panel rise mt-5 border border-warn/30 bg-warn/10 p-4 sm:p-5 text-fg" role="alert">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-warn/20 p-2 text-warn shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base text-warn">
                {props.fallbackPrompt.requestedPreset.title} was restricted by YouTube
              </h3>
              <p className="mt-1 text-sm text-muted">
                YouTube blocked direct downloading for{" "}
                <strong className="text-fg">{props.fallbackPrompt.requestedPreset.title}</strong> without signed-in session
                credentials.
              </p>
              <p className="mt-2 text-sm text-fg">
                Continue and save in <strong className="text-warn">{props.fallbackPrompt.fallbackPreset.title}</strong> instead?
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button
                  type="button"
                  className="h-10 font-medium"
                  onClick={() => {
                    const prompt = props.fallbackPrompt;
                    if (!prompt) return;
                    props.onFallback(null);
                    void props.onDownload(prompt.target, prompt.fallbackPreset, true);
                  }}
                >
                  <DownloadIcon className="size-4 mr-1.5" />
                  Save {props.fallbackPrompt.fallbackPreset.title}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10"
                  onClick={() => {
                    props.onFallback(null);
                    const el = document.getElementById("session-cookies");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                    else toast.info("Import your YouTube session cookies below to unlock full resolution.");
                  }}
                >
                  Import Cookies
                </Button>
                <Button type="button" variant="ghost" className="h-10 text-muted hover:text-fg" onClick={() => props.onFallback(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {props.status === "loading" ? (
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

      {props.video && props.status !== "loading" ? (
        <VideoPanel
          video={props.video}
          selected={props.selected}
          downloading={props.downloading}
          progress={props.progress}
          canGoBack={Boolean(props.results)}
          onSelect={props.onSelectPreset}
          onDownload={() => {
            if (props.isPending) {
              toast.error("Still checking your session.");
              return;
            }
            if (props.video && props.selected) void props.onDownload(props.video, props.selected);
          }}
          onDownloadFormat={(format: VideoFormat) => {
            if (!props.video) return;
            void props.onDownload(props.video, formatAsPreset(format, props.video.formats));
          }}
          onReset={props.onResetVideo}
        />
      ) : null}

      {props.offer && props.video ? (
        <SaveStage files={props.offer} videoId={props.video.id} thumbnail={props.video.thumbnail} onClose={props.onCloseOffer} />
      ) : null}

      {props.results?.kind === "search" && !props.video ? (
        <ResultList
          title="Search"
          subtitle={props.results.query}
          items={props.results.items}
          onPick={(item) => void props.onLookup(`https://www.youtube.com/watch?v=${item.id}`)}
        />
      ) : null}

      {props.results?.kind === "playlist" && !props.video ? (
        <ResultList
          title={props.results.playlist.title}
          subtitle={props.results.playlist.author ?? "Playlist"}
          items={props.results.playlist.items}
          onPick={(item) => void props.onLookup(`https://www.youtube.com/watch?v=${item.id}`)}
        />
      ) : null}
    </>
  );
}
