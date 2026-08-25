import { formatDuration, parseClock } from "./youtube.ts";
import type { TranscriptCue } from "./transcript.ts";

export type Chapter = {
  index: number;
  start: number;
  end: number;
  title: string;
  startFormatted: string;
};

// A timestamp somewhere in a line: 0:00, 00:00, 1:02:03 — optionally wrapped
// in [] or (). Everything else on the line is the candidate title.
const LINE_TS_RE = /[[(]?\b(\d{1,2}:\d{2}(?::\d{2})?)\b[\])]?/;

function cleanTitle(raw: string): string {
  return raw
    .replace(/^[\s\-–—:|•.)\]]+/, "")
    .replace(/[\s\-–—:|•([]+$/, "")
    .trim();
}

/**
 * Parse a YouTube chapter list out of a video description.
 *
 * YouTube's own chapter rules are the model: a list of "timestamp title" lines,
 * the first at 0:00, timestamps ascending. Returns [] when the description does
 * not contain a plausible chapter list (fewer than 2 entries, not starting at
 * 0:00, or not strictly ascending).
 */
export function parseChapters(
  description: string | null | undefined,
  duration?: number | null,
): Chapter[] {
  if (!description) return [];

  const found: { start: number; title: string }[] = [];
  for (const line of description.split(/\r?\n/)) {
    const match = line.match(LINE_TS_RE);
    if (!match || match[1] == null || match.index == null) continue;
    const start = parseClock(match[1]);
    if (start == null) continue;
    const before = line.slice(0, match.index);
    let after = cleanTitle(line.slice(match.index + match[0].length));
    // Range-style lines ("0:00 - 1:00 Intro") carry a second timestamp; the
    // title is whatever follows the last one.
    for (let extra = after.match(LINE_TS_RE); extra?.index === 0; extra = after.match(LINE_TS_RE)) {
      after = cleanTitle(after.slice(extra[0].length));
    }
    // Prefer text after the timestamp ("0:00 Intro"); fall back to text
    // before it ("Intro - 0:00").
    const title = after || cleanTitle(before);
    if (!title) continue;
    found.push({ start, title });
  }

  if (found.length < 2) return [];
  if (found[0].start !== 0) return [];

  const chapters: Chapter[] = [];
  for (const item of found) {
    const prev = chapters[chapters.length - 1];
    if (prev && item.start <= prev.start) return []; // not a chapter list
    if (duration != null && duration > 0 && item.start >= duration) continue;
    chapters.push({
      index: chapters.length,
      start: item.start,
      end: 0, // filled below
      title: item.title,
      startFormatted: formatDuration(item.start),
    });
  }
  if (chapters.length < 2) return [];

  for (let i = 0; i < chapters.length; i += 1) {
    const next = chapters[i + 1];
    chapters[i].end = next ? next.start : Math.max(duration ?? 0, chapters[i].start + 1);
  }
  return chapters;
}

/** Adapt chapters to transcript cues so the NLE marker exporters can be reused. */
export function chaptersToCues(chapters: Chapter[]): TranscriptCue[] {
  return chapters.map((chapter) => ({
    id: chapter.index,
    start: chapter.start,
    end: chapter.end,
    startFormatted: chapter.startFormatted,
    endFormatted: formatDuration(chapter.end),
    text: chapter.title,
  }));
}
