import type { Chapter } from "./chapters.ts";

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

function vttTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms, 3)}`;
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
    lines.push(`${vttTimestamp(chapter.start)} --> ${vttTimestamp(chapter.end)}`);
    lines.push(chapter.title);
    lines.push("");
  }
  return {
    content: lines.join("\n"),
    filename: `${safeStem(title)}.chapters.vtt`,
    mimeType: "text/vtt;charset=utf-8",
  };
}
