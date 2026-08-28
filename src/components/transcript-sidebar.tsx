import { Check, Copy, Film, Languages, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AI_PROMPT_TEMPLATES } from "@/lib/transcript";
import { formatDuration } from "@/lib/youtube";
import type { TranscriptViewProps } from "@/components/transcript-props";

export function TranscriptSidebar(props: TranscriptViewProps) {
  const {
    urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
    selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
    handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
    copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
    seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
    activeCues, excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
    translatedTo, readingMinutes, playingTime,
  } = props;
  if (!video) return null;

  return (
    <>
            {/* Left Column: Player & AI Studio (5 cols) */}
            <div className="lg:col-span-5 space-y-5">
              {/* Synchronized Player */}
              <div className="panel overflow-hidden">
                <div className="relative aspect-video bg-black/60">
                  <iframe
                    key={`studio-player-${video.id}`}
                    id="transcript-studio-iframe"
                    title={`Transcript Player ${video.title}`}
                    src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=0&rel=0&enablejsapi=1`}
                    className="size-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="p-3 bg-surface/50 border-t border-border/60 flex items-center justify-between text-xs text-muted">
                  <span>Click any transcript cue to jump to that timestamp</span>
                  {playingTime != null && (
                    <span className="font-mono text-accent font-medium">
                      Seeked to {formatDuration(playingTime)}
                    </span>
                  )}
                </div>
              </div>

              {/* Language Switcher */}
              {video.captions.length > 0 && (
                <div className="panel p-4 space-y-2.5">
                  <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                    <Languages className="size-3.5 text-accent" />
                    Transcript Language ({video.captions.length} available)
                  </label>
                  <select
                    aria-label="Transcript language"
                    value={selectedLanguage}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                  >
                    {video.captions.map((cap) => (
                      <option key={cap.vssId} value={cap.vssId}>
                        {cap.languageName} {cap.kind === "asr" ? "(Auto-Generated ASR)" : "(Human Verified)"}
                      </option>
                    ))}
                  </select>

                  {translationLanguages.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      <label
                        htmlFor="transcript-translate"
                        className="flex items-center justify-between text-xs font-semibold text-fg"
                      >
                        <span>Auto-translate</span>
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-subtle">
                          free · {translationLanguages.length} languages
                        </span>
                      </label>
                      <select
                        id="transcript-translate"
                        value={canTranslate ? translateTo : ""}
                        disabled={!canTranslate}
                        onChange={(e) => handleTranslateChange(e.target.value)}
                        className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">Off — original {selectedTrack?.languageName ?? "text"}</option>
                        {translationLanguages.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] leading-snug text-subtle">
                        {canTranslate
                          ? "YouTube's own machine translation — the same free option the player offers. Exports and AI prompts use the translated text."
                          : "This track can't be auto-translated by YouTube; pick another."}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* 1-Click AI Prompt Library */}
              <div className="panel p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-accent" />
                    <h3 className="font-semibold text-sm text-fg">1-Click AI Prompt Library</h3>
                  </div>
                  <span className="text-[10px] text-muted font-mono uppercase bg-elevated px-1.5 py-0.5 rounded">
                    ChatGPT / Claude / Grok
                  </span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  Generate instant structured prompts combined with this full video transcript:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {AI_PROMPT_TEMPLATES.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => void copyAiPrompt(tmpl)}
                      className={cn(
                        "flex flex-col items-start p-3 rounded-xl border transition-all text-left group cursor-pointer",
                        copiedPromptId === tmpl.id
                          ? "border-success/50 bg-success/10 text-success"
                          : "border-border/80 bg-elevated/40 hover:bg-elevated hover:border-accent/40 text-fg",
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-semibold">{tmpl.name}</span>
                        {copiedPromptId === tmpl.id ? (
                          <Check className="size-3.5 text-success" />
                        ) : (
                          <Copy className="size-3 text-subtle group-hover:text-fg transition-colors" />
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-muted line-clamp-2 leading-snug">
                        {tmpl.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

    </>
  );
}
