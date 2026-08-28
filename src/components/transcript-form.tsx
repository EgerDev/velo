import { AlertTriangle, Check, FileText, Film, Link2, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/youtube";
import { SampleChipRow } from "@/components/sample-chips";
import type { TranscriptViewProps } from "@/components/transcript-props";

export function TranscriptForm(props: TranscriptViewProps) {
  const {
    urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
    selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
    handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
    copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
    seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
    activeCues, excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
    translatedTo, readingMinutes,
  } = props;

  return (
    <>
      {/* Search / Ingest Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadVideoTranscript(urlInput);
        }}
        className="group relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl bg-surface/90 p-2 border border-border shadow-lg backdrop-blur-xl focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
      >
        <div className="relative flex flex-1 items-center min-w-0">
          {urlInput ? (
            <Link2 className="size-4 text-accent shrink-0 ml-3 mr-1" />
          ) : (
            <FileText className="size-4 text-subtle shrink-0 ml-3 mr-1 group-focus-within:text-fg transition-colors" />
          )}
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste YouTube link for instant transcript extraction..."
            aria-label="YouTube link for transcript"
            className="h-11 w-full bg-transparent px-2.5 text-sm sm:text-base text-fg placeholder:text-subtle/60 focus:outline-none font-sans"
            autoComplete="off"
            spellCheck={false}
          />
          {urlInput ? (
            <button
              type="button"
              aria-label="Clear input"
              onClick={() => setUrlInput("")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle hover:text-fg hover:bg-elevated transition-colors mr-1.5 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

          <Button
            type="submit"
            disabled={loading}
            className="h-10 min-w-24 px-4 text-xs font-semibold rounded-xl flex-1 sm:flex-none bg-accent text-accent-fg hover:opacity-90 transition-all shadow-sm shrink-0"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Sparkles className="size-3.5 mr-1.5" />}
            {loading ? "Working…" : "Get Transcript"}
          </Button>
      </form>

      {/* Quick Curated Podcast & Lecture Presets */}
      <SampleChipRow
        samples={samples}
        onPick={(sample) => {
          setUrlInput(sample.query);
          void loadVideoTranscript(sample.query);
        }}
      />

      {/* Error Alert Card */}
      {error ? (
        <div className="panel rise overflow-hidden border border-danger/30 bg-danger/10 p-4 sm:p-5 text-fg shadow-lg" role="alert">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-danger/20 p-2 text-danger shrink-0 mt-0.5">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm sm:text-base text-danger">
                Transcript Extraction Issue
              </h3>
              <p className="mt-1 text-xs sm:text-sm text-muted leading-relaxed">
                {error}
              </p>
              <div className="mt-3.5 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-surface/80 border-border/80 hover:bg-elevated"
                  onClick={() => {
                    setError(null);
                    setUrlInput("");
                  }}
                >
                  Clear Input
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs bg-danger/20 text-danger hover:bg-danger/30 border-0"
                  onClick={() => {
                    setUrlInput(samples[0].query);
                    void loadVideoTranscript(samples[0].query);
                  }}
                >
                  Try Lex Fridman Podcast
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Studio Two-Column Workspace */}
      {video && (
        <div className="space-y-6 rise">
          {/* Studio Header Bar */}
          <div className="panel p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-lg sm:text-xl text-fg font-semibold leading-snug">
                  {video.title}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/15 text-success border border-success/30">
                  <Check className="size-3" />
                  Transcript Ready
                </span>
              </div>
              <p className="mt-1 text-xs text-muted flex items-center gap-3">
                <span>By <strong className="text-fg font-medium">{video.author}</strong></span>
                <span>·</span>
                <span>{formatDuration(video.duration)} duration</span>
                <span>·</span>
                <span className="font-mono">{readingMinutes} min read</span>
              </p>
            </div>

            {/* Downloader Jump Action */}
            {onOpenInDownloader && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs bg-elevated/60 border-border hover:bg-elevated text-fg cursor-pointer shrink-0"
                onClick={() => onOpenInDownloader(video.url)}
              >
                <Film className="size-3.5 mr-1.5 text-accent" />
                Open in Video Downloader
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
