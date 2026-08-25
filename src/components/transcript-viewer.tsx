import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  FileText,
  Languages,
  Loader2,
  Play,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AI_PROMPT_TEMPLATES,
  cuesToJson,
  cuesToPlainText,
  cuesToSrt,
  cuesToTimestampedText,
  cuesToVtt,
  type TranscriptCue,
} from "@/lib/transcript";
import type { CaptionTrack } from "@/lib/youtube";
import { fetchTranscript } from "@/lib/resolve-video";

type TranscriptViewerProps = {
  videoId: string;
  videoTitle: string;
  captions: CaptionTrack[];
  onSeek?: (seconds: number) => void;
};

export function TranscriptViewer({ videoId, videoTitle, captions, onSeek }: TranscriptViewerProps) {
  const [selectedTrack, setSelectedTrack] = useState<CaptionTrack | null>(() => {
    return captions.find((c) => c.kind === "manual") ?? captions[0] ?? null;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [totalWords, setTotalWords] = useState(0);
  const [readingMinutes, setReadingMinutes] = useState(1);

  const [searchQuery, setSearchQuery] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showAiPrompts, setShowAiPrompts] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [activeCueId, setActiveCueId] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Fetch transcript when video or track changes
  useEffect(() => {
    let cancelled = false;
    if (!videoId || !selectedTrack) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchTranscript({
          data: {
            id: videoId,
            languageCode: selectedTrack?.languageCode,
            vssId: selectedTrack?.vssId,
          },
        });
        if (!cancelled) {
          setCues(res.cues);
          setTotalWords(res.totalWords);
          setReadingMinutes(res.readingMinutes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load transcript.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [videoId, selectedTrack]);

  // Filtered cues based on search query
  const filteredCues = useMemo(() => {
    if (!searchQuery.trim()) return cues;
    const q = searchQuery.toLowerCase().trim();
    return cues.filter((cue) => cue.text.toLowerCase().includes(q));
  }, [cues, searchQuery]);

  // Copy helper
  const handleCopy = async (type: "plain" | "timestamps" | "srt" | "vtt" | "json") => {
    if (!cues.length) return;
    try {
      let content = "";
      if (type === "plain") content = cuesToPlainText(cues);
      else if (type === "timestamps") content = cuesToTimestampedText(cues);
      else if (type === "srt") content = cuesToSrt(cues);
      else if (type === "vtt") content = cuesToVtt(cues);
      else if (type === "json") content = cuesToJson(cues);

      await navigator.clipboard.writeText(content);
      setCopiedType(type);
      toast.success(
        type === "plain"
          ? "Plain text copied to clipboard"
          : type === "timestamps"
            ? "Transcript with timestamps copied"
            : `${type.toUpperCase()} content copied`,
      );
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      toast.error("Could not copy transcript to clipboard.");
    }
  };

  // Download helper
  const handleDownload = (format: "txt" | "srt" | "vtt" | "json") => {
    if (!cues.length) return;
    try {
      let content = "";
      let mime = "text/plain";
      if (format === "txt") {
        content = showTimestamps ? cuesToTimestampedText(cues) : cuesToPlainText(cues);
      } else if (format === "srt") {
        content = cuesToSrt(cues);
      } else if (format === "vtt") {
        content = cuesToVtt(cues);
        mime = "text/vtt";
      } else if (format === "json") {
        content = cuesToJson(cues);
        mime = "application/json";
      }

      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cleanTitle = videoTitle.replace(/[^\w\s-]/g, "").trim() || "transcript";
      const lang = selectedTrack?.languageCode || "en";
      a.href = url;
      a.download = `${cleanTitle}.${lang}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded .${format} transcript`);
    } catch {
      toast.error(`Could not download .${format} file.`);
    }
  };

  // AI Prompt Copy Helper
  const handleCopyAiPrompt = async (templateId: string) => {
    const template = AI_PROMPT_TEMPLATES.find((t) => t.id === templateId);
    if (!template || !cues.length) return;
    try {
      const text = showTimestamps ? cuesToTimestampedText(cues) : cuesToPlainText(cues);
      const fullPrompt = template.prompt(videoTitle, text);
      await navigator.clipboard.writeText(fullPrompt);
      toast.success(`Copied "${template.name}" prompt + transcript for ChatGPT / Grok!`);
    } catch {
      toast.error("Could not copy AI prompt.");
    }
  };

  const handleCueClick = (cue: TranscriptCue) => {
    setActiveCueId(cue.id);
    if (onSeek) onSeek(cue.start);
  };

  return (
    <div className="rounded-xl bg-surface/90 border border-border overflow-hidden shadow-lg">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-border bg-elevated/40 flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <FileText className="size-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm sm:text-base text-fg">Full Transcript & Captions</h3>
                {selectedTrack ? (
                  <span className="inline-flex items-center rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                    {selectedTrack.languageName}
                    {selectedTrack.kind === "asr" ? " (Auto)" : ""}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-subtle mt-0.5 flex items-center gap-2 flex-wrap">
                <span>⏱️ ~{readingMinutes} min read</span>
                <span>·</span>
                <span>{totalWords.toLocaleString()} words</span>
                <span>·</span>
                <span>{cues.length} cues</span>
              </p>
            </div>
          </div>

          {/* Language Track Selector */}
          {captions.length > 1 ? (
            <div className="flex items-center gap-2">
              <Languages className="size-4 text-subtle shrink-0" />
              <select
                value={`${selectedTrack?.languageCode}:${selectedTrack?.vssId}`}
                onChange={(e) => {
                  const [code, vss] = e.target.value.split(":");
                  const found = captions.find((c) => c.languageCode === code && c.vssId === vss);
                  if (found) setSelectedTrack(found);
                }}
                className="rounded-lg bg-surface border border-border px-2.5 py-1.5 text-xs text-fg focus:border-accent focus:outline-none cursor-pointer"
              >
                {captions.map((c) => (
                  <option key={`${c.languageCode}:${c.vssId}`} value={`${c.languageCode}:${c.vssId}`}>
                    {c.languageName} {c.kind === "asr" ? "(Auto-generated)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Action Controls & Search Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          {/* Live Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-subtle pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transcript..."
              className="w-full rounded-lg bg-surface/80 border border-border/80 pl-8 pr-8 py-1.5 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-fg cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Timestamp Toggle */}
            <Button
              variant={showTimestamps ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowTimestamps(!showTimestamps)}
              title="Toggle timestamps"
              className="text-xs h-8 px-2.5"
            >
              <Clock className="size-3.5 mr-1" />
              {showTimestamps ? "Timestamps ON" : "Timestamps OFF"}
            </Button>

            {/* AI Prompts Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAiPrompts(!showAiPrompts)}
              className={cn("text-xs h-8 px-2.5", showAiPrompts && "bg-accent/15 border-accent text-accent")}
            >
              <Sparkles className="size-3.5 mr-1.5 text-amber-400" />
              AI Prompts
            </Button>

            {/* Quick Copy Menu */}
            <div className="flex items-center rounded-lg bg-surface border border-border p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCopy(showTimestamps ? "timestamps" : "plain")}
                className="text-xs h-7 px-2.5 text-fg hover:text-accent"
              >
                {copiedType ? <Check className="size-3.5 mr-1 text-emerald-400" /> : <Copy className="size-3.5 mr-1" />}
                Copy Text
              </Button>
            </div>

            {/* Download Dropdown */}
            <div className="flex items-center rounded-lg bg-surface border border-border p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload("txt")}
                className="text-xs h-7 px-2 text-fg hover:text-accent"
                title="Download TXT"
              >
                TXT
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload("srt")}
                className="text-xs h-7 px-2 text-fg hover:text-accent"
                title="Download SRT Subtitles"
              >
                SRT
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload("vtt")}
                className="text-xs h-7 px-2 text-fg hover:text-accent"
                title="Download WebVTT"
              >
                VTT
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload("json")}
                className="text-xs h-7 px-2 text-fg hover:text-accent"
                title="Download JSON Cues"
              >
                JSON
              </Button>
            </div>
          </div>
        </div>

        {/* AI Prompt Templates Tray (Expandable) */}
        {showAiPrompts ? (
          <div className="mt-2 rounded-lg bg-surface/90 border border-accent/30 p-3.5 rise">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-4 text-amber-400" />
                <span className="font-semibold text-xs text-fg">1-Click AI Prompts (ChatGPT / Claude / Grok)</span>
              </div>
              <span className="text-[11px] text-subtle">Click any template to copy with full transcript</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {AI_PROMPT_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => void handleCopyAiPrompt(tmpl.id)}
                  className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-elevated/60 p-2.5 text-left transition-all hover:border-accent hover:bg-elevated cursor-pointer group"
                >
                  <span className="text-base">{tmpl.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs text-fg group-hover:text-accent">{tmpl.name}</span>
                      <Copy className="size-3 text-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-muted line-clamp-1 mt-0.5">{tmpl.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Transcript Body / Cue Stream */}
      <div className="relative">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-muted">
            <Loader2 className="size-6 animate-spin text-accent mb-2" />
            <p className="text-xs">Fetching transcript segments from YouTube...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted">
            <p className="text-xs text-danger mb-2 font-medium">{error}</p>
            <p className="text-[11px] text-subtle">
              Captions may be restricted or auto-translation timed out for this video.
            </p>
          </div>
        ) : !filteredCues.length ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted">
            <Search className="size-5 text-subtle mb-1.5" />
            <p className="text-xs">No transcript cues match "{searchQuery}"</p>
          </div>
        ) : (
          <div
            ref={listRef}
            className="max-h-[380px] overflow-y-auto p-3 sm:p-4 space-y-1.5 divide-y divide-border/20"
          >
            {filteredCues.map((cue) => {
              const isActive = activeCueId === cue.id;
              return (
                <div
                  key={cue.id}
                  onClick={() => handleCueClick(cue)}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg p-2 transition-all cursor-pointer",
                    isActive
                      ? "bg-accent/15 border border-accent/40 shadow-sm"
                      : "hover:bg-elevated/70 hover:border-border/50 border border-transparent",
                  )}
                >
                  {/* Timestamp Pill */}
                  {showTimestamps ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono font-medium shrink-0 transition-colors",
                        isActive
                          ? "bg-accent text-accent-fg"
                          : "bg-elevated text-accent group-hover:bg-accent/20 group-hover:text-fg",
                      )}
                    >
                      <Play className="size-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      {cue.startFormatted}
                    </button>
                  ) : null}

                  {/* Cue Text */}
                  <p className="text-xs text-fg leading-relaxed flex-1 select-text">
                    {searchQuery ? (
                      <HighlightText text={cue.text} query={searchQuery} />
                    ) : (
                      cue.text
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-elevated/30 border-t border-border flex items-center justify-between text-[11px] text-subtle">
        <span>💡 Click any timestamp to jump to that moment in the video</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCopy("plain")}
            className="hover:text-fg cursor-pointer"
          >
            Copy Clean Text
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => void handleCopy("timestamps")}
            className="hover:text-fg cursor-pointer"
          >
            Copy with Times
          </button>
        </div>
      </div>
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber-400/30 text-amber-200 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
