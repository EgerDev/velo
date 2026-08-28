import { toast } from "sonner";
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
import type { ResolvedVideo } from "@/lib/youtube";

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function safeTitle(title: string) {
  return title.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 50);
}

export async function copyTranscript(
  format: "plain" | "timestamped" | "srt" | "vtt" | "json",
  cues: TranscriptCue[],
  onCopied: (format: string) => void,
) {
  if (!cues.length) return;
  const content =
    format === "plain"
      ? cuesToPlainText(cues)
      : format === "timestamped"
        ? cuesToTimestampedText(cues)
        : format === "srt"
          ? cuesToSrt(cues)
          : format === "vtt"
            ? cuesToVtt(cues)
            : cuesToJson(cues);
  try {
    await navigator.clipboard.writeText(content);
    onCopied(format);
    toast.success(`Copied ${format.toUpperCase()} transcript to clipboard!`);
  } catch {
    toast.error("Couldn’t copy to clipboard.");
  }
}

export function downloadTranscriptFile(
  format: "txt" | "srt" | "vtt" | "json",
  cues: TranscriptCue[],
  video: ResolvedVideo,
) {
  if (!cues.length) return;
  const packs = {
    txt: { content: cuesToTimestampedText(cues), mime: "text/plain;charset=utf-8" },
    srt: { content: cuesToSrt(cues), mime: "application/x-subrip;charset=utf-8" },
    vtt: { content: cuesToVtt(cues), mime: "text/vtt;charset=utf-8" },
    json: { content: cuesToJson(cues), mime: "application/json;charset=utf-8" },
  };
  const pack = packs[format];
  downloadBlob(pack.content, pack.mime, `${safeTitle(video.title)}-transcript.${format}`);
  toast.success(`Downloaded .${format} transcript file!`);
}

export function exportNleFile(formatId: NLEExportFormat, cues: TranscriptCue[], video: ResolvedVideo, fps: number) {
  if (!cues.length) return;
  const exported = exportNLETimeline(formatId, cues, { sequenceTitle: video.title, fps });
  downloadBlob(exported.content, exported.mimeType, `${safeTitle(video.title)}-${exported.filename}`);
  toast.success(`Exported ${exported.filename} for ${formatId}!`);
}

export async function copyAiPrompt(
  template: (typeof AI_PROMPT_TEMPLATES)[0],
  cues: TranscriptCue[],
  video: ResolvedVideo,
  onCopied: (id: string) => void,
) {
  if (!cues.length) return;
  try {
    await navigator.clipboard.writeText(template.prompt(video.title, cuesToPlainText(cues)));
    onCopied(template.id);
    toast.success(`Copied "${template.name}" prompt to clipboard!`);
  } catch {
    toast.error("Couldn’t copy prompt to clipboard.");
  }
}
