export type TranscriptCue = {
  id: number;
  start: number; // in seconds
  end: number; // in seconds
  startFormatted: string; // e.g. "00:15"
  endFormatted: string; // e.g. "00:18"
  text: string;
};

export type TranscriptData = {
  videoId: string;
  languageCode: string;
  languageName: string;
  kind: "manual" | "asr";
  vssId: string;
  cues: TranscriptCue[];
  totalWords: number;
  readingMinutes: number;
};

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatSrtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00,000";
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function formatVttTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00.000";
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().replace(",", ".").split(":");
  let total = 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    const numH = Number(h);
    const numM = Number(m);
    const numS = Number(s);
    if (Number.isFinite(numH) && Number.isFinite(numM) && Number.isFinite(numS)) {
      total = numH * 3600 + numM * 60 + numS;
    }
  } else if (parts.length === 2) {
    const [m, s] = parts;
    const numM = Number(m);
    const numS = Number(s);
    if (Number.isFinite(numM) && Number.isFinite(numS)) {
      total = numM * 60 + numS;
    }
  } else {
    const num = Number(timeStr.replace(",", "."));
    if (Number.isFinite(num)) total = num;
  }
  return Math.max(0, Number.isFinite(total) ? total : 0);
}

/**
 * Clean HTML entities and tags from raw subtitle text
 */
export function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse WebVTT formatted text into structured cues
 */
export function parseWebVttIntoCues(vttText: string): TranscriptCue[] {
  const lines = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cues: TranscriptCue[] = [];
  let cueId = 1;

  const timePattern =
    /(?:(\d{1,2}):)?(\d{2}):(\d{2}[.,]\d{2,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2}[.,]\d{2,3})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim() ?? "";

    if (
      !line ||
      line.startsWith("WEBVTT") ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line.startsWith("NOTE")
    ) {
      i++;
      continue;
    }

    const timeMatch = line.match(timePattern);
    if (timeMatch) {
      const [fullMatch] = timeMatch;
      const parts = fullMatch.split("-->").map((s) => s.trim());
      const startSec = parseTimeToSeconds(parts[0]);
      const endSec = parseTimeToSeconds(parts[1]);

      i++;
      const textLines: string[] = [];
      // A cue ends at a genuinely empty line. YouTube's ASR vtt opens rolling
      // cues with a whitespace-only line, and treating that as the terminator
      // dropped the whole cue; `cleanSubtitleText` discards it harmlessly below.
      while (i < lines.length && lines[i] !== "" && !lines[i].match(timePattern)) {
        const cleaned = cleanSubtitleText(lines[i]);
        if (cleaned) textLines.push(cleaned);
        i++;
      }

      const text = textLines.join(" ").trim();
      if (text) {
        cues.push({
          id: cueId++,
          start: startSec,
          end: endSec,
          startFormatted: formatTime(startSec),
          endFormatted: formatTime(endSec),
          text,
        });
      }
      continue;
    }

    i++;
  }

  // Deduplicate adjacent cues with identical or rolling-window text
  const deduplicated: TranscriptCue[] = [];
  for (const cue of cues) {
    const prev = deduplicated[deduplicated.length - 1];
    if (prev && prev.text === cue.text) {
      prev.end = cue.end;
      prev.endFormatted = cue.endFormatted;
    } else if (prev && cue.text.startsWith(prev.text + " ")) {
      prev.text = cue.text;
      prev.end = cue.end;
      prev.endFormatted = cue.endFormatted;
    } else {
      deduplicated.push(cue);
    }
  }

  return deduplicated;
}

/**
 * Format cues as clean plain text (paragraph format)
 */
export function cuesToPlainText(cues: TranscriptCue[]): string {
  return cues.map((c) => c.text).join(" ");
}

/**
 * Format cues with timestamps (notes format)
 */
export function cuesToTimestampedText(cues: TranscriptCue[]): string {
  return cues.map((c) => `[${c.startFormatted}] ${c.text}`).join("\n");
}

/**
 * Neutralize the SRT/VTT "-->" timing delimiter inside cue payload text.
 * Decoded captions can legitimately contain "-->" (YouTube escapes it as
 * "--&gt;", which cleanSubtitleText decodes back), and per the WebVTT parsing
 * algorithm any payload line containing "-->" is treated as a malformed
 * timing line, so strict parsers drop the cue or reject the file. Swap it for
 * the visually equivalent "→" at serialization time only — the in-app
 * transcript view keeps the original text.
 */
function neutralizeTimingDelimiter(text: string): string {
  return text.replace(/-->/g, "→");
}

/**
 * Format cues as SubRip (.srt) subtitle format
 */
export function cuesToSrt(cues: TranscriptCue[]): string {
  return cues
    .map((c, idx) => {
      const startSrt = formatSrtTime(c.start);
      const endSrt = formatSrtTime(c.end);
      return `${idx + 1}\n${startSrt} --> ${endSrt}\n${neutralizeTimingDelimiter(c.text)}\n`;
    })
    .join("\n");
}

/**
 * Format cues as WebVTT (.vtt) subtitle format
 */
export function cuesToVtt(cues: TranscriptCue[]): string {
  const body = cues
    .map((c) => `${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${neutralizeTimingDelimiter(c.text)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}`;
}

/**
 * Format cues as structured JSON
 */
export function cuesToJson(cues: TranscriptCue[]): string {
  return JSON.stringify(cues, null, 2);
}

/**
 * AI Prompt Templates for one-click ChatGPT / Claude / Grok usage
 */
export type AiPromptTemplate = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  prompt: (title: string, transcriptText: string) => string;
};

export const AI_PROMPT_TEMPLATES: AiPromptTemplate[] = [
  {
    id: "summary",
    name: "Executive Summary",
    description: "High-level summary with key takeaways and bullet points",
    emoji: "📝",
    prompt: (title, text) =>
      `You are an expert executive assistant. Please analyze the following YouTube video transcript for the video titled "${title}".

Provide:
1. A concise 2-3 sentence executive summary.
2. The 5-7 most important key takeaways (bullet points).
3. Any actionable conclusions or insights mentioned.

Transcript:
"""
${text}
"""`,
  },
  {
    id: "notes",
    name: "Detailed Study Notes",
    description: "Structured outline with topics, explanations, and concepts",
    emoji: "📚",
    prompt: (title, text) =>
      `Please create structured, in-depth study notes based on this video transcript titled "${title}".

Format the notes with:
- Main Topic Headers (Markdown H2/H3)
- Key Concepts and their explanations
- Important definitions, examples, and data mentioned
- A concluding summary of core insights

Transcript:
"""
${text}
"""`,
  },
  {
    id: "qa",
    name: "Q&A & FAQ Generation",
    description: "Generate a list of questions and comprehensive answers",
    emoji: "❓",
    prompt: (title, text) =>
      `Based on the following transcript for "${title}", generate a comprehensive FAQ list of the top 8 questions a viewer might ask after watching this video, along with clear, factual answers derived directly from the content.

Transcript:
"""
${text}
"""`,
  },
  {
    id: "chapters",
    name: "Timestamps & Chapters",
    description: "Generate YouTube video chapter markers and outline",
    emoji: "⏱️",
    prompt: (title, text) =>
      `Read this transcript with timestamps for "${title}" and create a clean list of YouTube Chapters/Timestamps with concise, engaging chapter titles (e.g. 00:00 Intro, 02:15 Topic...).

Transcript:
"""
${text}
"""`,
  },
  {
    id: "action_items",
    name: "Action Items & Checklist",
    description: "Extract every practical step and recommendation",
    emoji: "✅",
    prompt: (title, text) =>
      `Extract all actionable advice, step-by-step guides, tools mentioned, and practical recommendations from the transcript for "${title}". Format as a clear, prioritized checklist.

Transcript:
"""
${text}
"""`,
  },
  {
    id: "social_thread",
    name: "Social Media Thread",
    description: "Viral Twitter/X or LinkedIn summary thread",
    emoji: "🧵",
    prompt: (title, text) =>
      `Turn this YouTube transcript for "${title}" into an engaging 5-8 post Twitter/X thread with a compelling hook, key insights, and a concluding takeaway.

Transcript:
"""
${text}
"""`,
  },
];
