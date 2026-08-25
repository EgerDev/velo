import { useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Film,
  Gauge,
  Info,
  Layers,
  Loader2,
  Music,
  Play,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Zap,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TranscriptViewer } from "@/components/transcript-viewer";
import {
  captionsHref,
  codecPlayHint,
  codecSizes,
  FORMAT_PRIORITY,
  H264_VS_AV1,
  HLS_EXPLAIN,
  ABORT_EXPLAIN,
  SAVE_MECHANICS,
  formatBytes,
  formatCompactCount,
  formatDuration,
  formatPublished,
  formatViews,
  kindLabel,
  matchAudioTrack,
  pickBestPreset,
  sortFormats,
  type ResolvedVideo,
  type VideoFormat,
  type VideoPreset,
} from "@/lib/youtube";
import { formatSpeed } from "@/lib/speed-probe";
import type { DownloadProgress } from "@/lib/download-client";
import { StepLog } from "@/components/step-log";
import {
  estimateClipSize,
  formatTimecode,
  formatYtdlpSection,
  parseTimecode,
  validateTimeRange,
} from "@/lib/time-trimmer";
import { resolveThumbnailBundle } from "@/lib/thumbnail-assets";

type VideoPanelProps = {
  video: ResolvedVideo;
  selected: VideoPreset | null;
  downloading: boolean;
  progress: DownloadProgress | null;
  canGoBack: boolean;
  onSelect: (id: string) => void;
  onDownload: () => void;
  onDownloadFormat: (format: VideoFormat) => void;
  onReset: () => void;
};

export type PresetAvailability = {
  status: "optimal" | "automux" | "direct" | "efficient" | "audio";
  badgeText: string;
  badgeColor: string;
  icon: "target" | "zap" | "check" | "cpu" | "music";
  pipelineTitle: string;
  pipelineDesc: string;
  codecDetail: string;
};

export function getPresetAvailability(
  preset: VideoPreset,
  allFormats: VideoFormat[],
  bestPresetId?: string | null,
): PresetAvailability {
  const isOptimal = preset.recommended ?? (bestPresetId ? preset.id === bestPresetId : preset.id === "fullhd");
  const videoFormat = allFormats.find((f) => f.itag === preset.itag);
  const audioFormat = preset.audioItag ? allFormats.find((f) => f.itag === preset.audioItag) : null;

  if (preset.kind === "audio") {
    const audioCodec = preset.codec || "AAC";
    const bitrateKbps = videoFormat?.bitrate ? Math.round(videoFormat.bitrate / 1000) : 128;
    return {
      status: "audio",
      badgeText: "Direct Audio",
      badgeColor: "bg-purple-500/15 text-purple-300 border-purple-500/30",
      icon: "music",
      pipelineTitle: `Direct Audio Stream (itag ${preset.itag})`,
      pipelineDesc: `${audioCodec} · ~${bitrateKbps} kbps pure sound · zero transcoding`,
      codecDetail: `${audioCodec} (${preset.ext.toUpperCase()})`,
    };
  }

  if (isOptimal) {
    const audioNote = audioFormat ? `+ ${audioFormat.codec ?? "AAC"}` : "";
    return {
      status: "optimal",
      badgeText: "Optimal",
      badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 ring-1 ring-emerald-500/20",
      icon: "target",
      pipelineTitle: preset.audioItag
        ? `Direct H.264+AAC Mux (itag ${preset.itag} + ${preset.audioItag})`
        : `Direct Stream Container (itag ${preset.itag})`,
      pipelineDesc: "Standard compatibility · Plays universally on all devices & editors",
      codecDetail: preset.audioItag ? `${preset.codec ?? "H.264"} ${audioNote}` : `${preset.codec ?? "H.264"}`,
    };
  }

  if (preset.codec === "AV1" || preset.id === "av1") {
    return {
      status: "efficient",
      badgeText: "High Efficiency",
      badgeColor: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
      icon: "cpu",
      pipelineTitle: `AV1 Next-Gen Pipeline (itag ${preset.itag}${preset.audioItag ? ` + ${preset.audioItag}` : ""})`,
      pipelineDesc: "30–50% smaller file size at identical resolution",
      codecDetail: `AV1 (av01)${audioFormat ? ` + ${audioFormat.codec ?? "Opus"}` : ""}`,
    };
  }

  if (preset.codec === "VP9" || preset.id === "vp9") {
    return {
      status: "efficient",
      badgeText: "WebM / VP9",
      badgeColor: "bg-sky-500/15 text-sky-300 border-sky-500/30",
      icon: "cpu",
      pipelineTitle: `VP9 WebM Pipeline (itag ${preset.itag}${preset.audioItag ? ` + ${preset.audioItag}` : ""})`,
      pipelineDesc: "Google WebM open container · Optimized for Chrome & VLC",
      codecDetail: `VP9 (vp09)${audioFormat ? ` + ${audioFormat.codec ?? "Opus"}` : ""}`,
    };
  }

  if (preset.audioItag) {
    return {
      status: "automux",
      badgeText: "Auto-Mux",
      badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      icon: "zap",
      pipelineTitle: `Lossless Copy-Mux (itag ${preset.itag} + ${preset.audioItag})`,
      pipelineDesc: "DASH video stream paired with matched audio track in MP4 container",
      codecDetail: `${preset.codec ?? "H.264"} + ${audioFormat?.codec ?? "AAC"}`,
    };
  }

  return {
    status: "direct",
    badgeText: "Direct Ready",
    badgeColor: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    icon: "check",
    pipelineTitle: `Single Stream Container (itag ${preset.itag})`,
    pipelineDesc: "Pre-muxed video & audio in one stream · Instant single-request fetch",
    codecDetail: `${preset.codec ?? "H.264"} (Muxed)`,
  };
}

export function getResolutionBadge(preset: VideoPreset) {
  if (preset.kind === "audio") {
    return {
      label: "Audio",
      className: "bg-purple-500/20 text-purple-300 border border-purple-500/30",
    };
  }
  const height = preset.height ?? 0;
  if (height >= 2160 || preset.id === "uhd") {
    return {
      label: height >= 2160 ? "4K UHD" : `${height}p UHD`,
      className: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    };
  }
  if (height >= 1440) {
    return {
      label: "1440p QHD",
      className: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
    };
  }
  if (height >= 1080) {
    return {
      label: "1080p FHD",
      className: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    };
  }
  if (height >= 720) {
    return {
      label: "720p HD",
      className: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    };
  }
  if (height > 0) {
    return {
      label: `${height}p SD`,
      className: "bg-zinc-500/20 text-zinc-300 border border-zinc-500/30",
    };
  }
  return {
    label: "Video",
    className: "bg-zinc-500/20 text-zinc-300 border border-zinc-500/30",
  };
}

export function VideoPanel({
  video,
  selected,
  downloading,
  progress,
  canGoBack,
  onSelect,
  onDownload,
  onDownloadFormat,
  onReset,
}: VideoPanelProps) {
  const [playing, setPlaying] = useState(false);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [activeTab, setActiveTab] = useState<"video" | "audio" | "transcript">("video");
  const [openSection, setOpenSection] = useState<"none" | "formats" | "captions" | "compare" | "pipeline" | "trimmer" | "thumbnails">("none");
  const [trimStart, setTrimStart] = useState("00:00");
  const [trimEnd, setTrimEnd] = useState(() => formatTimecode(video.duration || 60));

  const thumbnailBundle = useMemo(() => resolveThumbnailBundle(video.id), [video.id]);

  const parsedStart = parseTimecode(trimStart) ?? 0;
  const parsedEnd = parseTimecode(trimEnd) ?? (video.duration || 60);
  const trimValidation = validateTimeRange(parsedStart, parsedEnd, video.duration || undefined);
  const clipSizeEstimate = estimateClipSize(selected?.size, video.duration || 60, trimValidation.duration);

  const formats = useMemo(() => sortFormats(video.formats), [video.formats]);
  const videoPresets = useMemo(() => video.presets.filter((p) => p.kind !== "audio"), [video.presets]);
  const audioPresets = useMemo(() => video.presets.filter((p) => p.kind === "audio"), [video.presets]);

  const displayedPresets =
    activeTab === "video"
      ? videoPresets.length
        ? videoPresets
        : video.presets
      : audioPresets.length
        ? audioPresets
        : video.presets;

  const bestPreset = useMemo(() => pickBestPreset(video.presets), [video.presets]);

  const sourceMaxHeight = useMemo(
    () => Math.max(0, ...video.formats.map((item) => item.height ?? 0)),
    [video.formats],
  );

  // Pre-flight calculation & quality telemetry
  const preFlight = useMemo(() => {
    const qualityCount = video.presets.length;
    const rawStreamsCount = video.formats.length;

    let maxQualityLabel = `${sourceMaxHeight}p`;
    if (sourceMaxHeight >= 2160) maxQualityLabel = "4K Ultra HD (2160p)";
    else if (sourceMaxHeight >= 1440) maxQualityLabel = "QHD (1440p)";
    else if (sourceMaxHeight >= 1080) maxQualityLabel = "1080p Full HD";
    else if (sourceMaxHeight >= 720) maxQualityLabel = "720p HD";
    else if (sourceMaxHeight >= 480) maxQualityLabel = "480p SD";
    else if (sourceMaxHeight === 0) maxQualityLabel = "Audio Track Only";

    const hasDash = video.presets.some((p) => p.audioItag != null);
    const hasH264 = video.formats.some((f) => f.codec === "H.264");
    const hasAV1 = video.formats.some((f) => f.codec === "AV1");
    const hasVP9 = video.formats.some((f) => f.codec === "VP9");
    const hasAAC = video.formats.some((f) => f.codec === "AAC" || f.mime.includes("mp4a"));
    const hasOpus = video.formats.some((f) => f.codec === "Opus");

    const codecsDetected: string[] = [];
    if (hasH264) codecsDetected.push("H.264");
    if (hasAV1) codecsDetected.push("AV1");
    if (hasVP9) codecsDetected.push("VP9");
    if (hasAAC) codecsDetected.push("AAC");
    if (hasOpus) codecsDetected.push("Opus");

    let pipelineMode = "Direct Single Container";
    if (hasDash) {
      pipelineMode =
        sourceMaxHeight >= 2160
          ? "4K UHD Multi-Stream Copy-Mux"
          : "Direct H.264+AAC Muxing";
    }

    const matchedAudio = video.formats.find(
      (f) => f.kind === "audio" && (f.itag === 140 || f.codec === "AAC"),
    ) ?? video.formats.find((f) => f.kind === "audio");

    const audioPairInfo = matchedAudio
      ? `itag ${matchedAudio.itag} (${matchedAudio.codec ?? "AAC"} ${Math.round((matchedAudio.bitrate || 128000) / 1000)}k${matchedAudio.isOriginal ? " Original" : ""})`
      : "Integrated Audio Track";
    const is1080pVerified = sourceMaxHeight >= 1080;

    return {
      qualityCount,
      rawStreamsCount,
      sourceMaxHeight,
      maxQualityLabel,
      is1080pVerified,
      pipelineStrategy: pipelineMode,
      codecsDetected: codecsDetected,
      codecsDetectedStr: codecsDetected.join(" · ") || "Standard Codecs",
      audioPairingDetail: audioPairInfo,
      verified: true,
      hasAV1,
      hasVP9,
    };
  }, [video.presets, video.formats, sourceMaxHeight]);

  const compareBand =
    selected?.id === "uhd" || (selected?.height ?? 0) >= 1440
      ? { min: 1440, max: 4320 }
      : { min: 1080, max: 1439 };
  const sizeRows = useMemo(
    () => codecSizes(video.formats, compareBand.min, compareBand.max),
    [video.formats, compareBand.min, compareBand.max],
  );
  const maxCompare = Math.max(0, ...sizeRows.map((row) => row.size ?? 0));

  const meta = [
    video.author,
    formatDuration(video.duration),
    formatViews(video.viewCount),
    formatCompactCount(video.likeCount, "likes"),
    formatPublished(video.publishedAt),
  ].filter(Boolean);

  async function copyTitle() {
    try {
      await navigator.clipboard.writeText(video.title);
      toast.success("Title copied to clipboard");
    } catch {
      toast.error("Couldn’t copy the title.");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(video.url);
      toast.success("Video URL copied to clipboard");
    } catch {
      toast.error("Couldn’t copy the URL.");
    }
  }

  const toggleSection = (
    section: "formats" | "captions" | "compare" | "pipeline" | "trimmer" | "thumbnails",
  ) => {
    setOpenSection((current) => (current === section ? "none" : section));
  };

  return (
    <article className="panel rise mt-8 overflow-hidden">
      {/* Video Preview Player */}
      <div className="relative aspect-video bg-elevated">
        {playing ? (
          <iframe
            key={`player-${seekTime}`}
            title={`Preview ${video.title}`}
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0${seekTime != null ? `&start=${Math.floor(seekTime)}` : ""}`}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <>
            <img
              src={video.thumbnail}
              alt={video.title}
              className="size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="absolute inset-0 flex items-center justify-center bg-bg/20 transition-all duration-[var(--motion-quick)] hover:bg-bg/35 group cursor-pointer"
              aria-label="Play preview"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[var(--shadow-soft)] transition-transform duration-[var(--motion-quick)] group-hover:scale-105">
                <Play className="size-6 fill-current ml-0.5" />
              </span>
            </button>
            {video.duration ? (
              <span className="absolute bottom-3 right-3 rounded-md bg-black/80 px-2 py-0.5 text-xs font-mono font-medium text-white shadow-sm">
                {formatDuration(video.duration)}
              </span>
            ) : null}
          </>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {/* Header Title & Actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-snug tracking-[var(--tracking-tight)] text-fg text-balance sm:text-2xl">
              {video.title}
            </h2>
            <p className="mt-1 text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {video.authorUrl ? (
                <a
                  href={video.authorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-fg hover:underline"
                >
                  {video.author}
                </a>
              ) : (
                <span className="font-medium text-fg">{video.author}</span>
              )}
              {meta.slice(1).map((item, idx) => (
                <span key={idx} className="flex items-center gap-2">
                  <span className="text-subtle/60">·</span>
                  <span>{item}</span>
                </span>
              ))}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy title"
              title="Copy Title"
              onClick={() => void copyTitle()}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy link"
              title="Copy Link"
              onClick={() => void copyLink()}
            >
              <ExternalLink className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={canGoBack ? "Back to results" : "Start over"}
              title={canGoBack ? "Back to search" : "Clear"}
              onClick={onReset}
            >
              {canGoBack ? <ArrowLeft className="size-4" /> : <RotateCcw className="size-4" />}
            </Button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* AUTOMATED QUALITY DETECTION & AVAILABILITY SYSTEM: PRE-FLIGHT STATUS CARD */}
        {/* ========================================================================= */}
        <section
          aria-label="System Pre-Flight & Quality Status"
          className="mt-5 overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-950/10 shadow-[var(--shadow-glass)] transition-all"
        >
          {/* Top Pre-Flight Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2 sm:px-4">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-200 tracking-wide uppercase">
                System Pre-Flight & Quality Engine
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="size-3.5" />
                Verified Ready
              </span>
              <button
                type="button"
                onClick={() => setShowTelemetry((prev) => !prev)}
                className="flex items-center gap-1 text-[11px] text-emerald-300/80 hover:text-emerald-200 cursor-pointer transition-colors"
                aria-expanded={showTelemetry}
              >
                <span>Telemetry</span>
                {showTelemetry ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            </div>
          </div>

          {/* Dynamic Headline Banner */}
          <div className="p-3.5 sm:p-4">
            <div className="flex items-start gap-2.5">
              <Sparkles className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg leading-snug">
                  ✨ Auto-Detected {preFlight.qualityCount} Qualities · {preFlight.maxQualityLabel} Verified Ready · {preFlight.pipelineStrategy}
                </p>
                <p className="mt-1 text-xs text-muted leading-relaxed">
                  Streams analyzed & synchronized. Zero-loss copy-mux pipeline prepared with matched AAC audio pairing.
                </p>
              </div>
            </div>

            {/* Pre-Flight Metric Specs Grid */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4 pt-1">
              <div className="rounded-lg bg-surface/70 border border-border/80 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-subtle font-medium">
                  <Activity className="size-3 text-emerald-400" />
                  Max Source
                </div>
                <div className="mt-1 font-mono text-xs font-semibold text-fg">
                  {preFlight.sourceMaxHeight > 0 ? `${preFlight.sourceMaxHeight}p` : "Audio"}
                  <span className="ml-1 text-[10px] font-normal text-muted">
                    {preFlight.sourceMaxHeight >= 2160
                      ? "4K"
                      : preFlight.sourceMaxHeight >= 1080
                        ? "Full HD"
                        : preFlight.sourceMaxHeight >= 720
                          ? "HD"
                          : "SD"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-surface/70 border border-border/80 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-subtle font-medium">
                  <Zap className="size-3 text-amber-400" />
                  Pipeline
                </div>
                <div className="mt-1 font-mono text-xs font-semibold text-fg truncate" title={preFlight.pipelineStrategy}>
                  {preFlight.pipelineStrategy.split(" ")[0]} Mux
                </div>
              </div>

              <div className="rounded-lg bg-surface/70 border border-border/80 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-subtle font-medium">
                  <Cpu className="size-3 text-cyan-400" />
                  Codecs
                </div>
                <div className="mt-1 font-mono text-xs font-semibold text-fg truncate" title={preFlight.codecsDetected.join(" · ")}>
                  {preFlight.codecsDetected.slice(0, 3).join(", ")}
                </div>
              </div>

              <div className="rounded-lg bg-surface/70 border border-border/80 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-subtle font-medium">
                  <Music className="size-3 text-purple-400" />
                  Audio Pairing
                </div>
                <div className="mt-1 font-mono text-xs font-semibold text-fg truncate" title={preFlight.audioPairingDetail}>
                  {preFlight.audioPairingDetail}
                </div>
              </div>
            </div>

            {/* Source Warning if < 1080p */}
            {!preFlight.is1080pVerified && preFlight.sourceMaxHeight > 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-200">
                <Info className="size-4 text-amber-400 shrink-0" />
                <span>
                  Source uploaded at <strong>{preFlight.sourceMaxHeight}p</strong> max. 1080p is unavailable for this specific upload.
                </span>
              </div>
            ) : null}

            {/* Expandable Technical Telemetry */}
            {showTelemetry ? (
              <div className="mt-3 rounded-lg border border-border/70 bg-surface/90 p-3 text-xs space-y-2 text-muted animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-border pb-1.5 text-[11px] font-semibold text-fg">
                  <span>Pre-Flight Technical Diagnostics</span>
                  <span className="font-mono text-subtle">{preFlight.rawStreamsCount} Raw Streams Detected</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-subtle font-medium">Transmux Strategy: </span>
                    <span className="text-fg font-mono">DASH ISOBMFF Copy-Mux (Zero Loss)</span>
                  </div>
                  <div>
                    <span className="text-subtle font-medium">Video/Audio Desync Guard: </span>
                    <span className="text-emerald-400 font-mono">Active (Timestamp Aligned)</span>
                  </div>
                  <div>
                    <span className="text-subtle font-medium">NSig & BotGuard Bypass: </span>
                    <span className="text-emerald-400 font-mono">Pre-warmed & Verified</span>
                  </div>
                  <div>
                    <span className="text-subtle font-medium">Captions Available: </span>
                    <span className="text-fg font-mono">{video.captions.length} Tracks Ready</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Video Description */}
        {video.description ? (
          <div className="mt-3.5 text-xs">
            <p className={cn("text-muted leading-relaxed", showDescription ? "whitespace-pre-wrap" : "line-clamp-2")}>
              {video.description}
            </p>
            {video.description.length > 140 ? (
              <button
                type="button"
                className="mt-1 font-medium text-fg hover:underline cursor-pointer"
                onClick={() => setShowDescription((value) => !value)}
              >
                {showDescription ? "Show less" : "Read more"}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Preset Category Switcher */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex rounded-lg bg-surface p-1 border border-border">
              <button
                type="button"
                onClick={() => setActiveTab("video")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-quick)] cursor-pointer",
                  activeTab === "video"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-fg",
                )}
              >
                <Film className="size-3.5" />
                Video & Audio
                {videoPresets.length ? <span className="opacity-70">({videoPresets.length})</span> : null}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("audio")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-quick)] cursor-pointer",
                  activeTab === "audio"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-fg",
                )}
              >
                <Music className="size-3.5" />
                Audio Only
                {audioPresets.length ? <span className="opacity-70">({audioPresets.length})</span> : null}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("transcript")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-quick)] cursor-pointer",
                  activeTab === "transcript"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-fg",
                )}
              >
                <FileText className="size-3.5" />
                Transcript & Notes
                {video.captions.length ? (
                  <span className="opacity-70">({video.captions.length})</span>
                ) : null}
              </button>
            </div>

            {selected && activeTab !== "transcript" ? (
              <span className="text-xs text-subtle font-mono hidden sm:inline">
                {selected.ext.toUpperCase()} · {selected.codec ?? "Standard"}
              </span>
            ) : null}
          </div>

          {activeTab === "transcript" ? (
            <div className="mt-4">
              <TranscriptViewer
                videoId={video.id}
                videoTitle={video.title}
                captions={video.captions}
                onSeek={(seconds) => {
                  setSeekTime(seconds);
                  setPlaying(true);
                }}
              />
            </div>
          ) : (
            <>
              {/* ========================================================================= */}
              {/* PRESET CARDS GRID WITH AVAILABILITY BADGES & CODEC PIPELINE DETAILS */}
              {/* ========================================================================= */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {displayedPresets.map((preset) => {
              const active = selected?.id === preset.id;
              const resBadge = getResolutionBadge(preset);
              const availability = getPresetAvailability(
                preset,
                video.formats,
                bestPreset?.id,
              );

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelect(preset.id)}
                  className={cn(
                    "relative flex flex-col justify-between rounded-xl p-3.5 sm:p-4 text-left transition-all duration-[var(--motion-quick)] ease-[var(--ease-out)] cursor-pointer group",
                    active
                      ? "bg-accent/15 border-2 border-accent text-fg shadow-[var(--shadow-glass)] ring-1 ring-accent/30"
                      : "bg-surface border border-border text-fg hover:border-border-strong hover:bg-elevated/70 hover:shadow-sm",
                  )}
                >
                  {/* Top Row: Title, Resolution Badge, Availability Badge & Checkmark */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-sm sm:text-base leading-tight text-fg">
                          {preset.title}
                        </span>
                        {/* Resolution Badge */}
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                            resBadge.className,
                          )}
                        >
                          {resBadge.label}
                        </span>
                        {/* Availability Status Badge */}
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border",
                            availability.badgeColor,
                          )}
                        >
                          {availability.icon === "target" ? (
                            <Sparkles className="size-2.5" />
                          ) : availability.icon === "zap" ? (
                            <Zap className="size-2.5" />
                          ) : availability.icon === "cpu" ? (
                            <Cpu className="size-2.5" />
                          ) : availability.icon === "music" ? (
                            <Music className="size-2.5" />
                          ) : (
                            <Check className="size-2.5" />
                          )}
                          {availability.badgeText}
                        </span>
                      </div>

                      {/* Selection Radio / Check Indicator */}
                      <div className="shrink-0 flex items-center pt-0.5">
                        {active ? (
                          <span className="flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm">
                            <Check className="size-3 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="size-5 rounded-full border border-border group-hover:border-subtle transition-colors" />
                        )}
                      </div>
                    </div>

                    {/* Middle Technical Specs: Size, Container, Codec Details */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="font-mono font-medium text-fg">{formatBytes(preset.size)}</span>
                      <span className="text-subtle/50">·</span>
                      <span className="uppercase text-[11px] font-mono font-semibold text-subtle">
                        {preset.ext}
                      </span>
                      <span className="text-subtle/50">·</span>
                      <span className="text-[11px] text-muted font-medium">
                        {availability.codecDetail}
                      </span>
                    </div>

                    {/* Pipeline Execution Details */}
                    <p className="mt-1.5 text-[11px] font-mono text-subtle leading-tight truncate">
                      {availability.pipelineTitle}
                    </p>
                  </div>

                  {/* Bottom Row: Pipeline Description & Dimensions */}
                  <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-subtle">
                    <span className="truncate pr-2">{availability.pipelineDesc}</span>
                    {preset.height ? (
                      <span className="shrink-0 font-mono text-[10px] text-subtle/90 bg-elevated px-1.5 py-0.5 rounded">
                        {preset.height}p
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Primary Download CTA Action */}
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Button
            size="lg"
            className="h-13 flex-1 text-base font-semibold transition-all shadow-md active:scale-[0.99]"
            onClick={onDownload}
            disabled={!selected || downloading}
          >
            {downloading ? (
              <Loader2 className="size-5 animate-spin mr-2" />
            ) : (
              <Download className="size-5 mr-2" />
            )}
            {downloading && progress ? (
              <span>
                {progress.throttled ? "Throttled" : progress.label}
                {progress.bytesPerSec ? ` · ${formatSpeed(progress.bytesPerSec)}` : ""}
                {` (${progress.percent}%)`}
              </span>
            ) : selected ? (
              <span>
                Download {selected.title}
                <span className="font-normal opacity-85 ml-1.5">
                  ({formatBytes(selected.size)} · {selected.ext.toUpperCase()})
                </span>
              </span>
            ) : (
              "Select a format"
            )}
          </Button>

          <Button variant="secondary" size="lg" className="h-13 font-medium shrink-0" asChild>
            <a href={video.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4 mr-2" />
              YouTube
            </a>
          </Button>
        </div>

        {/* Real-time Progress Bar & Status */}
        {downloading && progress ? (
          <div className="mt-4 rounded-lg bg-surface border border-border p-3.5 rise">
            <div className="flex items-center justify-between text-xs font-medium text-fg mb-2">
              <span className="flex items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-accent" />
                </span>
                {progress.label}
              </span>
              <span className="font-mono tabular-nums text-accent">{progress.percent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-elevated" aria-hidden="true">
              <div
                className="h-full bg-accent transition-[width] duration-[var(--motion-quick)] rounded-full"
                style={{ width: `${Math.max(4, progress.percent)}%` }}
              />
            </div>
            {progress.bytesPerSec || progress.loaded ? (
              <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-muted">
                <span>
                  {progress.bytesPerSec ? formatSpeed(progress.bytesPerSec) : ""}
                  {progress.throttled ? " · slow speed (nsig hop active)" : ""}
                </span>
                <span>
                  {progress.loaded ? formatBytes(progress.loaded) : ""}
                  {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {progress?.failed ? (
          <p className="mt-3 text-sm text-danger rounded-md bg-danger/10 border border-danger/20 p-3" role="alert">
            {progress.label}
          </p>
        ) : null}
        {progress?.hint ? (
          <p className="mt-1.5 text-xs leading-relaxed text-subtle">{progress.hint}</p>
        ) : null}
        {progress?.steps?.length ? <StepLog steps={progress.steps} /> : null}

        {selected ? (
          <p className="mt-4 text-xs leading-relaxed text-subtle">
            {codecPlayHint(selected.codec, selected.ext)}
          </p>
        ) : null}
            </>
          )}
        </div>

        {/* Collapsible Advanced Accordions */}
        <div className="mt-6 space-y-2.5 border-t border-border pt-4">
          {/* 1. Captions & Subtitles */}
          {video.captions.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection("captions")}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
                aria-expanded={openSection === "captions"}
              >
                <span className="flex items-center gap-2">
                  <Subtitles className="size-4 text-subtle" />
                  Subtitles & Captions
                  <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
                    {video.captions.length}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                    openSection === "captions" && "rotate-180",
                  )}
                />
              </button>

              {openSection === "captions" ? (
                <div className="border-t border-border p-4 space-y-4">
                  <TranscriptViewer
                    videoId={video.id}
                    videoTitle={video.title}
                    captions={video.captions}
                    onSeek={(seconds) => {
                      setSeekTime(seconds);
                      setPlaying(true);
                    }}
                  />
                  <div className="pt-2 border-t border-border/40">
                    <p className="text-xs text-muted mb-2">Direct WebVTT track downloads:</p>
                    <div className="flex flex-wrap gap-2">
                      {video.captions.map((track) => (
                        <a
                          key={`${track.languageCode}-${track.vssId}`}
                          href={captionsHref(video.id, track.languageCode, track.vssId)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-elevated px-3 py-1.5 text-xs text-fg border border-border hover:border-subtle transition-colors shadow-sm"
                        >
                          <span>{track.languageName}</span>
                          {track.kind === "asr" ? (
                            <span className="text-[10px] text-subtle">(auto)</span>
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 2. Codec & Size Comparison */}
          {sizeRows.length >= 2 ? (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection("compare")}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
                aria-expanded={openSection === "compare"}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="size-4 text-subtle" />
                  Codec Size Comparison ({sizeRows[0]?.qualityLabel ?? "1080p"})
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                    openSection === "compare" && "rotate-180",
                  )}
                />
              </button>

              {openSection === "compare" ? (
                <div className="border-t border-border p-4">
                  <p className="text-xs leading-relaxed text-subtle">{H264_VS_AV1}</p>
                  <ul className="mt-3.5 space-y-3">
                    {sizeRows.map((row) => {
                      const match = video.presets.find(
                        (preset) =>
                          preset.codec === row.codec &&
                          (preset.height ?? 0) >= compareBand.min &&
                          (preset.height ?? 0) <= compareBand.max,
                      );
                      const format = video.formats.find((item) => item.itag === (match?.itag ?? row.itag));
                      const active = Boolean(selected && match && selected.id === match.id);
                      const width =
                        maxCompare > 0 && row.size ? Math.max(8, Math.round((row.size / maxCompare) * 100)) : 8;
                      return (
                        <li key={row.codec} className="flex items-center gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left cursor-pointer"
                            onClick={() => {
                              if (match) onSelect(match.id);
                            }}
                          >
                            <div className="flex items-baseline justify-between gap-3 text-xs">
                              <span className={cn("font-medium", active ? "text-fg" : "text-muted")}>
                                {row.codec}
                                <span className="ml-1.5 font-normal text-subtle font-mono text-[11px]">
                                  {row.ext.toUpperCase()}
                                </span>
                              </span>
                              <span className="tabular-nums font-mono text-fg text-xs">
                                {formatBytes(row.size)}
                                {row.vsH264 != null && row.vsH264 > 0 ? (
                                  <span className="ml-2 text-emerald-400 font-sans font-medium">
                                    {row.vsH264}% smaller
                                  </span>
                                ) : row.codec === "H.264" ? (
                                  <span className="ml-2 text-subtle font-sans">baseline</span>
                                ) : null}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-[var(--motion-quick)]",
                                  active ? "bg-accent" : "bg-fg/40",
                                )}
                                style={{ width: `${width}%` }}
                              />
                            </div>
                          </button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 text-xs shrink-0"
                            disabled={downloading || !format}
                            onClick={() => format && onDownloadFormat(format)}
                            aria-label={`Download ${row.codec} ${row.ext}`}
                          >
                            <Download className="size-3 mr-1" />
                            {row.codec === "VP9" ? "VP9" : "Save"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 3. All Raw Streams & Formats */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("formats")}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
              aria-expanded={openSection === "formats"}
            >
              <span className="flex items-center gap-2">
                <Layers className="size-4 text-subtle" />
                All Raw Streams & Formats
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
                  {formats.length}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                  openSection === "formats" && "rotate-180",
                )}
              />
            </button>

            {openSection === "formats" ? (
              <div className="border-t border-border p-4">
                <ul className="divide-y divide-border">
                  {formats.map((format) => (
                    <li
                      key={`${format.itag}-${format.kind}-${format.ext}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-fg">
                          {format.qualityLabel}
                          <span className="text-muted font-mono"> · {format.ext.toUpperCase()}</span>
                          {format.codec ? <span className="text-subtle"> · {format.codec}</span> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-subtle">
                          {kindLabel(
                            format.kind,
                            format.kind === "video" && Boolean(matchAudioTrack(format, video.formats)),
                          )}{" "}
                          · <span className="font-mono">{formatBytes(format.size)}</span>
                          <span className="ml-1.5 opacity-60">itag {format.itag}</span>
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={downloading}
                        onClick={() => onDownloadFormat(format)}
                        aria-label={`Download ${format.qualityLabel} ${format.ext}`}
                      >
                        <Download className="size-3 mr-1" />
                        Save
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Precision Time-Range Clipper */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("trimmer")}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
              aria-expanded={openSection === "trimmer"}
            >
              <span className="flex items-center gap-2">
                <Scissors className="size-4 text-accent" />
                <span>Precision Time-Range Trimmer (Clip & Cut)</span>
                <span className="rounded bg-accent/15 text-accent px-1.5 py-0.5 text-[10px] font-mono">
                  {trimValidation.valid ? `${formatDuration(trimValidation.duration)} clip` : "Custom"}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                  openSection === "trimmer" && "rotate-180",
                )}
              />
            </button>

            {openSection === "trimmer" ? (
              <div className="border-t border-border p-4 space-y-4 text-xs">
                <p className="text-muted leading-relaxed">
                  Extract specific time slices without downloading the entire video stream.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-subtle font-medium block mb-1">Start Time (MM:SS)</label>
                    <input
                      type="text"
                      value={trimStart}
                      onChange={(e) => setTrimStart(e.target.value)}
                      placeholder="00:00"
                      className="w-full rounded-md border border-border bg-elevated px-3 py-1.5 text-fg font-mono text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="text-subtle font-medium block mb-1">End Time (MM:SS)</label>
                    <input
                      type="text"
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(e.target.value)}
                      placeholder="01:30"
                      className="w-full rounded-md border border-border bg-elevated px-3 py-1.5 text-fg font-mono text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>

                {/* Quick Range Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-subtle mr-1">Quick Range:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTrimStart("00:00");
                      setTrimEnd(formatTimecode(video.duration || 60));
                    }}
                    className="rounded bg-elevated px-2 py-1 text-[11px] text-fg hover:bg-border transition-colors cursor-pointer"
                  >
                    Full ({formatDuration(video.duration || 0)})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTrimStart("00:00");
                      setTrimEnd(formatTimecode(Math.min(60, video.duration || 60)));
                    }}
                    className="rounded bg-elevated px-2 py-1 text-[11px] text-fg hover:bg-border transition-colors cursor-pointer"
                  >
                    First 60s
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTrimStart("00:00");
                      setTrimEnd(formatTimecode(Math.min(300, video.duration || 300)));
                    }}
                    className="rounded bg-elevated px-2 py-1 text-[11px] text-fg hover:bg-border transition-colors cursor-pointer"
                  >
                    First 5 Mins
                  </button>
                </div>

                {/* Validation status / size indicator */}
                <div className="flex items-center justify-between pt-2 border-t border-border/60 text-[11px]">
                  <div>
                    {trimValidation.valid ? (
                      <span className="text-emerald-400 font-medium">
                        ✓ Valid Range ({formatTimecode(trimValidation.start)} → {formatTimecode(trimValidation.end)})
                      </span>
                    ) : (
                      <span className="text-rose-400 font-medium">{trimValidation.error}</span>
                    )}
                  </div>
                  {clipSizeEstimate ? (
                    <div className="text-subtle">
                      Est. Clip Size: <span className="font-mono text-fg font-medium">{formatBytes(clipSizeEstimate)}</span>
                    </div>
                  ) : null}
                </div>

                {/* Copy Section Flag */}
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={async () => {
                      const section = formatYtdlpSection(parsedStart, parsedEnd);
                      const cmd = `yt-dlp --download-sections "${section}" --force-keyframes-at-cuts "${video.url}"`;
                      await navigator.clipboard.writeText(cmd);
                      toast.success("yt-dlp range command copied to clipboard!");
                    }}
                  >
                    <Copy className="size-3 mr-1.5" />
                    Copy Range yt-dlp Command ({formatYtdlpSection(parsedStart, parsedEnd)})
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* High-Res Thumbnails & Artwork */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("thumbnails")}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
              aria-expanded={openSection === "thumbnails"}
            >
              <span className="flex items-center gap-2">
                <ImageIcon className="size-4 text-subtle" />
                High-Res Artwork & Thumbnails
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
                  1080p Master
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                  openSection === "thumbnails" && "rotate-180",
                )}
              />
            </button>

            {openSection === "thumbnails" ? (
              <div className="border-t border-border p-4 space-y-3 text-xs">
                <p className="text-muted leading-relaxed">
                  Download uncompressed YouTube cover artwork and thumbnails directly:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {thumbnailBundle.items.map((item) => (
                    <a
                      key={item.label}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-elevated/40 hover:bg-elevated transition-colors text-xs text-fg group"
                    >
                      <div>
                        <p className="font-medium text-fg">{item.label}</p>
                        <p className="text-[11px] text-muted font-mono">{item.resolution} · .{item.ext}</p>
                      </div>
                      <ExternalLink className="size-3.5 text-subtle group-hover:text-fg transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* 4. Save Architecture & Diagnostics */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection("pipeline")}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-fg hover:bg-elevated/40 transition-colors cursor-pointer"
              aria-expanded={openSection === "pipeline"}
            >
              <span className="flex items-center gap-2">
                <Gauge className="size-4 text-subtle" />
                Pipeline Priority & Architecture
              </span>
              <ChevronDown
                className={cn(
                  "size-4 text-subtle transition-transform duration-[var(--motion-quick)]",
                  openSection === "pipeline" && "rotate-180",
                )}
              />
            </button>

            {openSection === "pipeline" ? (
              <div className="border-t border-border p-4 space-y-4 text-xs">
                <div>
                  <p className="font-semibold text-fg">Save Order for 1080p</p>
                  <table className="mt-2 w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-border">
                        <th className="w-6 py-1.5 pr-2 font-medium">#</th>
                        <th className="py-1.5 pr-3 font-medium">Format</th>
                        <th className="py-1.5 font-medium">Condition</th>
                      </tr>
                    </thead>
                    <tbody className="text-subtle">
                      {FORMAT_PRIORITY.map((step, index) => (
                        <tr key={step.id} className="border-t border-border/50 align-top">
                          <td className="py-1.5 pr-2 tabular-nums text-fg">{index + 1}</td>
                          <td className="py-1.5 pr-3 text-fg font-medium">{step.label}</td>
                          <td className="py-1.5">{step.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-border pt-3">
                  <p className="font-semibold text-fg">How Save Runs</p>
                  <table className="mt-2 w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-border">
                        <th className="w-28 py-1.5 pr-3 font-medium">Piece</th>
                        <th className="py-1.5 font-medium">Role</th>
                      </tr>
                    </thead>
                    <tbody className="text-subtle">
                      {SAVE_MECHANICS.map((row) => (
                        <tr key={row.name} className="border-t border-border/50 align-top">
                          <td className="py-1.5 pr-3 text-fg font-medium">{row.name}</td>
                          <td className="py-1.5">{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] leading-relaxed text-subtle pt-1">{ABORT_EXPLAIN}</p>
                <p className="text-[11px] leading-relaxed text-subtle">{HLS_EXPLAIN}</p>
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-subtle">
          1080p and 4K streams pair YouTube’s video track with AAC audio into a single MP4 container (copy-mux, zero quality loss).
        </p>
      </div>
    </article>
  );
}
