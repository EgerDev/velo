import { Check, ChevronDown, Clock, Copy, Download, Layers, Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AI_PROMPT_TEMPLATES } from "@/lib/transcript";
import { formatDuration } from "@/lib/youtube";
import { NLE_EXPORT_OPTIONS, type TranscriptViewProps } from "@/components/transcript-props";

export function TranscriptReader(props: TranscriptViewProps) {
  const {
    urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
    selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
    handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
    copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
    seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
    activeCues, excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
    translatedTo, readingMinutes, stats,
  } = props;

  return (
    <>
            {/* Right Column: High-Capacity Cue Reader & Exporters (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              {/* Actions & Exporter Bar */}
              <div className="panel p-4 space-y-3">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-subtle" />
                  <input
                    type="text"
                    aria-label="Search transcript"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search words in transcript..."
                    className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-elevated text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle hover:text-fg"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                {/* Copy / download actions. Every button flexes to fill the row
                    and wraps, so the last one is never clipped at narrow widths. */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9 min-w-[7.5rem] flex-1 text-xs font-medium border border-border"
                    onClick={() => void copyFormattedTranscript("plain")}
                  >
                    {copiedFormat === "plain" ? <Check className="text-success" /> : <Copy />}
                    Copy text
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9 min-w-[7.5rem] flex-1 text-xs font-medium border border-border"
                    onClick={() => void copyFormattedTranscript("timestamped")}
                  >
                    {copiedFormat === "timestamped" ? <Check className="text-success" /> : <Clock />}
                    Copy with times
                  </Button>
                  {(["srt", "vtt", "txt", "json"] as const).map((format) => (
                    <Button
                      key={format}
                      variant="outline"
                      size="sm"
                      className="h-9 min-w-[5.5rem] flex-1 font-mono text-xs font-medium border border-border"
                      onClick={() => downloadTranscriptFile(format)}
                    >
                      <Download />.{format.toUpperCase()}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-subtle">
                  <span>{stats.words.toLocaleString()} words</span>
                  <span>~{stats.readingMinutes} min read</span>
                  <span>{stats.cuesCount} cues</span>
                  {stats.excludedCount > 0 ? <span className="text-warn">{stats.excludedCount} removed</span> : null}
                  {translatedTo ? (
                    <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-accent">
                      translated → {translatedTo.name}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* NLE Marker Export Accordion */}
              <div className="panel p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowNleMenu(!showNleMenu)}
                  className="flex items-center justify-between w-full text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-accent" />
                    <span className="text-xs font-semibold text-fg">NLE Timeline Marker Exporters (DaVinci, Final Cut, Premiere, Audacity)</span>
                  </div>
                  <ChevronDown className={cn("size-4 text-subtle transition-transform", showNleMenu && "rotate-180")} />
                </button>

                {showNleMenu && (
                  <div className="pt-2 border-t border-border space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Framerate (FPS):</span>
                      <div className="flex items-center gap-1 font-mono">
                        {[24, 25, 29.97, 30, 59.94, 60].map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setFps(f)}
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer",
                              fps === f
                                ? "bg-accent text-accent-fg"
                                : "bg-elevated text-muted hover:text-fg",
                            )}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {NLE_EXPORT_OPTIONS.map((nle) => (
                        <button
                          key={nle.id}
                          type="button"
                          onClick={() => handleNleExport(nle.id)}
                          className="flex flex-col items-start p-3 rounded-xl border border-border/80 bg-elevated/40 hover:bg-elevated hover:border-accent/40 transition-all text-left group cursor-pointer"
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xs font-semibold text-fg">{nle.name}</span>
                            <span className={cn("text-[10px] font-mono font-medium px-1.5 py-0.2 rounded border", nle.color)}>
                              {nle.badge}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted line-clamp-1">{nle.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Exclusion Summary if any deleted */}
              {deletedCueIds.size > 0 && (
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-warn/10 border border-warn/30 text-xs text-warn">
                  <span>{deletedCueIds.size} unwanted segment(s) excluded from export</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-warn hover:text-fg"
                    onClick={restoreAllCues}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Restore All
                  </Button>
                </div>
              )}

              {/* Interactive Cue Reader Container */}
              <div className="panel overflow-hidden">
                <div className="p-3 bg-surface border-b border-border flex items-center justify-between text-xs text-muted">
                  <span>
                    Showing {filteredCues.length} of {activeCues.length} cues
                    {searchQuery ? ` matching "${searchQuery}"` : ""}
                  </span>
                  <span>Hover to cut/remove segment</span>
                </div>

                <div className="max-h-[72vh] min-h-[320px] overflow-y-auto p-4 space-y-2.5 divide-y divide-border/40">
                  {loadingTranscript ? (
                    <div className="py-12 flex flex-col items-center justify-center text-muted gap-2 text-xs">
                      <Loader2 className="size-6 animate-spin text-accent" />
                      Loading and parsing subtitles…
                    </div>
                  ) : filteredCues.length === 0 ? (
                    <div className="py-12 text-center text-muted text-xs">
                      No matching cues found.
                    </div>
                  ) : (
                    filteredCues.map((cue) => {
                      const isDeleted = deletedCueIds.has(cue.id);
                      return (
                        <div
                          key={cue.id}
                          className={cn(
                            "pt-2 flex items-start justify-between gap-3 group rounded-lg p-2 transition-colors",
                            isDeleted ? "opacity-35 line-through bg-danger/5" : "hover:bg-elevated/60",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => seekTo(cue.start)}
                            className="font-mono text-xs text-accent font-semibold hover:underline shrink-0 pt-0.5 cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-accent rounded-sm"
                            title={`Jump video to ${cue.startFormatted}`}
                          >
                            {cue.startFormatted}
                          </button>
                          <button
                            type="button"
                            dir="auto"
                            className="text-xs text-fg text-start leading-relaxed flex-1 cursor-pointer hover:text-fg transition-colors bg-transparent border-0 p-0 focus:outline-hidden focus:ring-1 focus:ring-accent/40 rounded-sm"
                            onClick={() => seekTo(cue.start)}
                          >
                            {cue.text}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleDeleteCue(cue.id)}
                            className="text-subtle hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity shrink-0 p-1 cursor-pointer rounded-sm"
                            title={isDeleted ? "Restore cue" : "Remove unwanted section"}
                          >
                            {isDeleted ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
    </>
  );
}
