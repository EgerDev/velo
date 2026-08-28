import type { Chapter } from "./chapters.ts";
import { escapeVttText, formatVttTime } from "./transcript.ts";

export type Sidecar = {
  content: string;
  filename: string;
  mimeType: string;
};

function safeStem(title: string): string {
  return (
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "video"
  );
}

/** `<stem>.description.txt` — the plain description, editors read it as show notes. */
export function descriptionSidecar(title: string, description: string | null | undefined): Sidecar | null {
  const body = (description ?? "").trim();
  if (!body) return null;
  return {
    content: `${title}\n\n${body}\n`,
    filename: `${safeStem(title)}.description.txt`,
    mimeType: "text/plain;charset=utf-8",
  };
}

/**
 * `<stem>.chapters.vtt` — a WebVTT cue per chapter. NLEs and players (VLC,
 * mpv, Premiere) read a sibling .vtt as named chapter markers.
 */
export function chaptersVttSidecar(title: string, chapters: Chapter[]): Sidecar | null {
  if (!chapters.length) return null;
  const lines = ["WEBVTT", ""];
  for (const chapter of chapters) {
    // Total-ms arithmetic: rounding the fraction on its own can yield a
    // 4-digit ms field (12.9996 -> "12.1000") that players reject.
    lines.push(`${formatVttTime(chapter.start)} --> ${formatVttTime(chapter.end)}`);
    lines.push(escapeVttText(chapter.title));
    lines.push("");
  }
  return {
    content: lines.join("\n"),
    filename: `${safeStem(title)}.chapters.vtt`,
    mimeType: "text/vtt;charset=utf-8",
  };
}
