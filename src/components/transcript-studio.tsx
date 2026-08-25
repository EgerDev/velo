import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileText,
  Film,
  Languages,
  Layers,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  type ResolvedVideo,
} from "@/lib/youtube";
import {
  AI_PROMPT_TEMPLATES,
  cuesToJson,
  cuesToPlainText,
  cuesToSrt,
  cuesToTimestampedText,
  cuesToVtt,
  type TranscriptCue,
} from "@/lib/transcript";
import { exportNLETimeline, type NLEExportFormat } from "@/lib/nle-export";
import { fetchTranscript, resolveVideo } from "@/lib/resolve-video";

type TranscriptStudioProps = {
  initialUrl?: string;
  onOpenInDownloader?: (url: string) => void;
};

const SAMPLE_PODCASTS = [
  { icon: "🎙️", label: "Lex Fridman Podcast", query: "https://www.youtube.com/watch?v=kYfNvmF00U4" },
  { icon: "🧠", label: "Huberman Lab", query: "https://www.youtube.com/watch?v=gXDMoiEkyuQ" },
  { icon: "🔬", label: "Veritasium Science", query: "https://www.youtube.com/watch?v=r_sP9Z86mP8" },
  { icon: "🎓", label: "Stanford AI Lecture", query: "https://www.youtube.com/watch?v=aircAruvnKk" },
];

const NLE_EXPORT_OPTIONS: {
  id: NLEExportFormat;
  name: string;
  app: string;
  ext: string;
  desc: string;
  badge: string;
  color: string;
}[] = [
  {
    id: "davinci",
    name: "DaVinci Resolve Marker CSV",
    app: "DaVinci Resolve",
    ext: ".csv",
    desc: "SMPTE Timecode In/Out, Marker Name, Notes & Colors",
    badge: "Resolve CSV",
    color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  },
  {
    id: "fcpxml",
    name: "Final Cut Pro XML",
    app: "Final Cut Pro",
    ext: ".fcpxml",
    desc: "FCPXML 1.9 Timeline Sequence with <marker> tags",
    badge: "FCPXML",
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
  {
    id: "premiere",
    name: "Adobe Premiere Pro EDL",
    app: "Premiere Pro",
    ext: ".edl",
    desc: "CMX 3600 Edit Decision List Marker Events",
    badge: "Premiere EDL",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    id: "audacity",
    name: "Audacity / DAW Label Track",
    app: "Audacity / Logic / Pro Tools",
    ext: ".txt",
    desc: "Tab-delimited start/end time markers with cue labels",
    badge: "DAW Labels",
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
];

export function TranscriptStudio({ initialUrl = "", onOpenInDownloader }: TranscriptStudioProps) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [deletedCueIds, setDeletedCueIds] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [playingTime, setPlayingTime] = useState<number | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [showNleMenu, setShowNleMenu] = useState(false);
  const [fps, setFps] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);

  // Active cues excluding deleted/removed sections
  const activeCues = useMemo(() => {
    return cues.filter((cue) => !deletedCueIds.has(cue.id));
  }, [cues, deletedCueIds]);

  // Search filtered cues
  const filteredCues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeCues;
    return activeCues.filter((cue) => cue.text.toLowerCase().includes(q));
  }, [activeCues, searchQuery]);

  // Word statistics & estimated reading time
  const stats = useMemo(() => {
    const fullText = activeCues.map((c) => c.text).join(" ");
    const words = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
    const readingMinutes = Math.max(1, Math.round(words / 200));
    return {
      words,
      readingMinutes,
      cuesCount: activeCues.length,
      excludedCount: deletedCueIds.size,
    };
  }, [activeCues, deletedCueIds]);

  async function loadVideoTranscript(targetUrl: string) {
    const cleanUrl = targetUrl.trim();
    if (!cleanUrl) return;

    setError(null);
    setLoading(true);
    try {
      const resolved = await resolveVideo({ data: { url: cleanUrl } });
      setVideo(resolved);

      if (!resolved.captions || resolved.captions.length === 0) {
        setError("No subtitle or transcript tracks found for this video.");
        setCues([]);
        setLoading(false);
        return;
      }

      // Default to English or first available track
      const defaultTrack =
        resolved.captions.find((c) => c.languageCode === "en") ?? resolved.captions[0];
      setSelectedLanguage(defaultTrack.vssId);
      await loadCaptionContent(resolved.id, defaultTrack.vssId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load video transcripts.");
      setVideo(null);
      setCues([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadCaptionContent(videoId: string, vssId: string) {
    setLoadingTranscript(true);
    setDeletedCueIds(new Set());
    try {
      const res = await fetchTranscript({ data: { id: videoId, vssId } });
      setCues(res.cues);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch transcript text.");
      setCues([]);
    } finally {
      setLoadingTranscript(false);
    }
  }

  function handleLanguageChange(vssId: string) {
    if (!video || vssId === selectedLanguage) return;
    setSelectedLanguage(vssId);
    void loadCaptionContent(video.id, vssId);
  }

  function toggleDeleteCue(id: number) {
    setDeletedCueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function restoreAllCues() {
    setDeletedCueIds(new Set());
    toast.success("Restored all deleted segments.");
  }

  async function copyFormattedTranscript(format: "plain" | "timestamped" | "srt" | "vtt" | "json") {
    if (!activeCues.length) return;
    let content = "";
    if (format === "plain") content = cuesToPlainText(activeCues);
    else if (format === "timestamped") content = cuesToTimestampedText(activeCues);
    else if (format === "srt") content = cuesToSrt(activeCues);
    else if (format === "vtt") content = cuesToVtt(activeCues);
    else if (format === "json") content = cuesToJson(activeCues);

    try {
      await navigator.clipboard.writeText(content);
      setCopiedFormat(format);
      setTimeout(() => setCopiedFormat(null), 2000);
      toast.success(`Copied ${format.toUpperCase()} transcript to clipboard!`);
    } catch {
      toast.error("Couldn’t copy to clipboard.");
    }
  }

  function downloadTranscriptFile(format: "txt" | "srt" | "vtt" | "json") {
    if (!activeCues.length || !video) return;
    let content = "";
    let mime = "text/plain";
    const ext = format;

    if (format === "txt") {
      content = cuesToTimestampedText(activeCues);
      mime = "text/plain;charset=utf-8";
    } else if (format === "srt") {
      content = cuesToSrt(activeCues);
      mime = "application/x-subrip;charset=utf-8";
    } else if (format === "vtt") {
      content = cuesToVtt(activeCues);
      mime = "text/vtt;charset=utf-8";
    } else if (format === "json") {
      content = cuesToJson(activeCues);
      mime = "application/json;charset=utf-8";
    }

    const blob = new Blob([content], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    const safeTitle = video.title.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 50);
    a.download = `${safeTitle}-transcript.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    toast.success(`Downloaded .${ext} transcript file!`);
  }

  function handleNleExport(formatId: NLEExportFormat) {
    if (!activeCues.length || !video) return;
    const exported = exportNLETimeline(formatId, activeCues, { sequenceTitle: video.title, fps });
    const blob = new Blob([exported.content], { type: exported.mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = exported.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    setShowNleMenu(false);
    toast.success(`Exported ${exported.filename} for ${formatId}!`);
  }

  async function copyAiPrompt(template: (typeof AI_PROMPT_TEMPLATES)[0]) {
    if (!activeCues.length || !video) return;
    const plainTranscript = cuesToPlainText(activeCues);
    const fullPrompt = `${template.prompt}\n\n---\nVIDEO TITLE: ${video.title}\nCHANNEL: ${video.author}\n\nTRANSCRIPT:\n${plainTranscript}`;

    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopiedPromptId(template.id);
      setTimeout(() => setCopiedPromptId(null), 2500);
      toast.success(`Copied "${template.name}" prompt to clipboard! Ready to paste in ChatGPT, Claude, Grok, or DeepSeek.`);
    } catch {
      toast.error("Couldn’t copy prompt to clipboard.");
    }
  }

  return (
    <div className="w-full space-y-6">
      {/* Search / Ingest Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadVideoTranscript(urlInput);
        }}
        className="group relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl bg-surface/90 p-2 border border-white/10 shadow-lg backdrop-blur-xl focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
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
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle hover:text-fg hover:bg-white/10 transition-colors mr-1.5 cursor-pointer"
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
      <div className="mt-4 flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar flex-nowrap">
        <span className="text-[11px] font-medium text-subtle shrink-0 mr-1 hidden sm:inline">Try:</span>
        {SAMPLE_PODCASTS.map((sample) => (
          <button
            key={sample.label}
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-elevated/70 px-3 py-1.5 text-xs font-medium text-muted hover:border-accent/50 hover:bg-elevated hover:text-fg transition-all active:scale-95 shadow-xs cursor-pointer whitespace-nowrap"
            onClick={() => {
              setUrlInput(sample.query);
              void loadVideoTranscript(sample.query);
            }}
          >
            <span className="text-xs">{sample.icon}</span>
            <span>{sample.label}</span>
          </button>
        ))}
      </div>

      {/* Error Alert Card */}
      {error ? (
        <div className="panel rise overflow-hidden border border-rose-500/30 bg-rose-500/10 p-4 sm:p-5 text-fg shadow-lg" role="alert">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-rose-500/20 p-2 text-rose-400 shrink-0 mt-0.5">
              <AlertTriangle className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm sm:text-base text-rose-200">
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
                  className="h-8 text-xs bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 border-0"
                  onClick={() => {
                    setUrlInput(SAMPLE_PODCASTS[0].query);
                    void loadVideoTranscript(SAMPLE_PODCASTS[0].query);
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Check className="size-3" />
                  Transcript Ready
                </span>
              </div>
              <p className="mt-1 text-xs text-muted flex items-center gap-3">
                <span>By <strong className="text-fg font-medium">{video.author}</strong></span>
                <span>·</span>
                <span>{formatDuration(video.duration)} duration</span>
                <span>·</span>
                <span className="font-mono">{stats.words.toLocaleString()} words (~{stats.readingMinutes} min read)</span>
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

          {/* Two-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Player & AI Studio (5 cols) */}
            <div className="lg:col-span-5 space-y-5">
              {/* Synchronized Player */}
              <div className="panel overflow-hidden">
                <div className="relative aspect-video bg-black/60">
                  <iframe
                    key={`studio-player-${playingTime}`}
                    title={`Transcript Player ${video.title}`}
                    src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=0&rel=0${playingTime != null ? `&start=${Math.floor(playingTime)}` : ""}`}
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
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                          : "border-border/80 bg-elevated/40 hover:bg-elevated hover:border-accent/40 text-fg",
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-semibold">{tmpl.name}</span>
                        {copiedPromptId === tmpl.id ? (
                          <Check className="size-3.5 text-emerald-400" />
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

            {/* Right Column: High-Capacity Cue Reader & Exporters (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              {/* Actions & Exporter Bar */}
              <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-subtle" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search words in transcript..."
                    className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-border bg-elevated text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-subtle hover:text-fg"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                {/* Quick Exporter Dropdowns */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs font-medium bg-elevated/80 hover:bg-elevated text-fg border border-border"
                    onClick={() => void copyFormattedTranscript("plain")}
                  >
                    {copiedFormat === "plain" ? <Check className="size-3 mr-1 text-emerald-400" /> : <Copy className="size-3 mr-1" />}
                    Copy Text
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs font-medium bg-elevated/80 hover:bg-elevated text-fg border border-border"
                    onClick={() => void copyFormattedTranscript("timestamped")}
                  >
                    {copiedFormat === "timestamped" ? <Check className="size-3 mr-1 text-emerald-400" /> : <Clock className="size-3 mr-1" />}
                    Timestamps
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium bg-elevated/50 hover:bg-elevated text-fg border border-border"
                    onClick={() => downloadTranscriptFile("srt")}
                  >
                    <Download className="size-3 mr-1" />
                    .SRT
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium bg-elevated/50 hover:bg-elevated text-fg border border-border"
                    onClick={() => downloadTranscriptFile("vtt")}
                  >
                    <Download className="size-3 mr-1" />
                    .VTT
                  </Button>
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
                    <Layers className="size-4 text-purple-400" />
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
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                  <span>{deletedCueIds.size} unwanted segment(s) excluded from export</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-amber-300 hover:text-white"
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

                <div className="max-h-[560px] overflow-y-auto p-4 space-y-2.5 divide-y divide-border/40">
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
                            isDeleted ? "opacity-35 line-through bg-rose-500/5" : "hover:bg-elevated/60",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setPlayingTime(cue.start)}
                            className="font-mono text-xs text-accent font-semibold hover:underline shrink-0 pt-0.5 cursor-pointer"
                            title={`Jump video to ${cue.startFormatted}`}
                          >
                            {cue.startFormatted}
                          </button>
                          <p
                            className="text-xs text-fg leading-relaxed flex-1 cursor-pointer"
                            onClick={() => setPlayingTime(cue.start)}
                          >
                            {cue.text}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleDeleteCue(cue.id)}
                            className="text-subtle hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 cursor-pointer"
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
          </div>
        </div>
      )}
    </div>
  );
}
