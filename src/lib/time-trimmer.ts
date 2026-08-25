/**
 * Time-Range Trimmer Utilities for Velo
 * Supports parsing, formatting, bounding, and section argument generation.
 */

/**
 * Parses time strings like "01:23", "01:23:45", "75s", "120" into total seconds.
 */
export function parseTimecode(input: string): number | null {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim().toLowerCase().replace(/s$/, "");

  // Pure numeric seconds (e.g. "120" or "45.5")
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const s = parseFloat(raw);
    return isNaN(s) || s < 0 ? null : s;
  }

  // MM:SS or HH:MM:SS format
  const parts = raw.split(":").map((p) => parseFloat(p.trim()));
  if (parts.some((p) => isNaN(p) || p < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (minutes === undefined || seconds === undefined || seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (hours === undefined || minutes === undefined || seconds === undefined || minutes >= 60 || seconds >= 60) {
      return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

/**
 * Formats total seconds into standard readable MM:SS or HH:MM:SS format.
 */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

export type TimeRangeValidation = {
  valid: boolean;
  start: number;
  end: number;
  duration: number;
  error?: string;
};

/**
 * Validates start and end timecodes against optional maximum duration.
 */
export function validateTimeRange(
  startSec: number,
  endSec: number,
  maxDuration?: number,
): TimeRangeValidation {
  const start = Math.max(0, startSec);
  let end = endSec;

  if (maxDuration && maxDuration > 0) {
    if (start >= maxDuration) {
      return {
        valid: false,
        start,
        end,
        duration: 0,
        error: "Start time exceeds video duration.",
      };
    }
    end = Math.min(end, maxDuration);
  }

  if (end <= start) {
    return {
      valid: false,
      start,
      end,
      duration: 0,
      error: "End time must be greater than start time.",
    };
  }

  const duration = end - start;

  if (duration < 1) {
    return {
      valid: false,
      start,
      end,
      duration,
      error: "Clip duration must be at least 1 second.",
    };
  }

  return {
    valid: true,
    start,
    end,
    duration,
  };
}

/**
 * Formats time range into yt-dlp section filter string.
 * Example: "*01:23-04:56"
 */
export function formatYtdlpSection(startSec: number, endSec: number): string {
  const startStr = formatTimecode(startSec);
  const endStr = formatTimecode(endSec);
  return `*${startStr}-${endStr}`;
}

/**
 * Estimates clip file size based on full media size and duration ratio.
 */
export function estimateClipSize(
  fullSizeBytes: number | null | undefined,
  totalDurationSec: number,
  clipDurationSec: number,
): number | null {
  if (!fullSizeBytes || totalDurationSec <= 0 || clipDurationSec <= 0) return null;
  const ratio = Math.min(1, Math.max(0, clipDurationSec / totalDurationSec));
  return Math.round(fullSizeBytes * ratio);
}
