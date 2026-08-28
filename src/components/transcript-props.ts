import { AI_PROMPT_TEMPLATES } from "@/lib/transcript";
import type { NLEExportFormat } from "@/lib/nle-export";

export const NLE_EXPORT_OPTIONS: {
  id: NLEExportFormat;
  name: string;
  app: string;
  ext: string;
  desc: string;
  badge: string;
  color: string;
}[] = [
  { id: "davinci", name: "DaVinci Resolve Marker CSV", app: "DaVinci Resolve", ext: ".csv", desc: "SMPTE Timecode In/Out, Marker Name, Notes & Colors", badge: "Resolve CSV", color: "text-accent bg-accent/10 border-accent/20" },
  { id: "fcpxml", name: "Final Cut Pro XML", app: "Final Cut Pro", ext: ".fcpxml", desc: "FCPXML 1.9 Timeline Sequence with <marker> tags", badge: "FCPXML", color: "text-accent bg-accent/10 border-accent/20" },
  { id: "premiere", name: "Adobe Premiere Pro EDL", app: "Premiere Pro", ext: ".edl", desc: "CMX 3600 Edit Decision List Marker Events", badge: "Premiere EDL", color: "text-warn bg-warn/10 border-warn/20" },
  { id: "audacity", name: "Audacity / DAW Label Track", app: "Audacity / Logic / Pro Tools", ext: ".txt", desc: "Tab-delimited start/end time markers with cue labels", badge: "DAW Labels", color: "text-success bg-success/10 border-success/20" },
];
import type { ResolvedVideo } from "@/lib/youtube";
import type { TranscriptCue } from "@/lib/transcript";

export type TranscriptViewProps = {
  urlInput: string;
  setUrlInput: (v: string) => void;
  loadVideoTranscript: (url: string) => void;
  loading: boolean;
  samples: { label: string; tag: string; query: string }[];
  error: string | null;
  setError: (v: string | null) => void;
  video: ResolvedVideo | null;
  selectedLanguage: string;
  handleLanguageChange: (v: string) => void;
  translationLanguages: { code: string; name: string }[];
  canTranslate: boolean;
  translateTo: string;
  handleTranslateChange: (v: string) => void;
  selectedTrack: { languageName?: string; translatable?: boolean } | null;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  copyFormattedTranscript: (format: "plain" | "timestamped" | "srt" | "vtt" | "json") => void;
  copiedFormat: string | null;
  downloadTranscriptFile: (format: "txt" | "srt" | "vtt" | "json") => void;
  cues: TranscriptCue[];
  deletedCueIds: Set<number>;
  toggleDeleteCue: (id: number) => void;
  restoreAllCues: () => void;
  seekTo: (t: number) => void;
  handleNleExport: (format: NLEExportFormat) => void;
  copyAiPrompt: (template: (typeof AI_PROMPT_TEMPLATES)[0]) => void;
  copiedPromptId: string | null;
  loadingTranscript: boolean;
  filteredCues: TranscriptCue[];
  activeCues: TranscriptCue[];
  excludedCount: number;
  fps: number;
  setFps: (n: number) => void;
  showNleMenu: boolean;
  setShowNleMenu: (v: boolean | ((p: boolean) => boolean)) => void;
  onOpenInDownloader?: (url: string) => void;
  translatedTo: { code: string; name: string } | null;
  readingMinutes: number;
  playingTime: number | null;
  stats: { words: number; readingMinutes: number; cuesCount: number; excludedCount: number };
};

