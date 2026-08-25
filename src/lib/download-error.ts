export type DownloadErrorCode =
  | "blocked"
  | "bot"
  | "rate"
  | "queue"
  | "timeout"
  | "empty"
  | "cookies"
  | "network"
  | "unknown";

export class DownloadError extends Error {
  code: DownloadErrorCode;
  steps: string[];
  retryAfterSec?: number;
  status?: number;

  constructor(
    message: string,
    code: DownloadErrorCode = "unknown",
    steps: string[] = [],
    retryAfterSec?: number,
    status?: number,
  ) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
    this.steps = steps;
    this.retryAfterSec = retryAfterSec;
    this.status = status;
  }
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  const sec = Number(trimmed);
  if (Number.isFinite(sec) && sec >= 0) return Math.max(1, Math.min(3600, Math.ceil(sec)));
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) return Math.max(1, Math.min(3600, Math.ceil((when - Date.now()) / 1000)));
  return undefined;
}

export function formatRetryAfter(sec?: number): string {
  if (sec == null || sec <= 0) return "";
  if (sec < 60) return `Retry in ${sec}s.`;
  const min = Math.ceil(sec / 60);
  return `Retry in ${min} min.`;
}

type ClassifyOpts = { status?: number; retryAfterSec?: number; code?: string };

export function classifyDownloadError(
  err: unknown,
  extraSteps: string[] = [],
  opts: ClassifyOpts = {},
): DownloadError {
  if (err instanceof DownloadError) {
    const next = extraSteps.length
      ? new DownloadError(err.message, err.code, [...err.steps, ...extraSteps], err.retryAfterSec, err.status)
      : err;
    if (opts.retryAfterSec != null) next.retryAfterSec = opts.retryAfterSec;
    if (opts.status != null) next.status = opts.status;
    return next;
  }
  const message = err instanceof Error ? err.message : "Download failed.";
  const lower = message.toLowerCase();
  const steps = extraSteps.length ? extraSteps : [message];
  const retryAfterSec = opts.retryAfterSec;
  const status = opts.status;
  const bodyCode = opts.code?.toLowerCase();

  const as = (code: DownloadErrorCode) => new DownloadError(message, code, steps, retryAfterSec, status);

  if (bodyCode === "rate") return as("rate");
  if (bodyCode === "queue" || bodyCode === "busy") return as("queue");
  if (
    status === 429 ||
    lower.includes("download cap") ||
    lower.includes("guest cap") ||
    lower.includes("burst cap") ||
    lower.includes("too many downloads") ||
    /\b429\b/.test(lower)
  ) {
    return as("rate");
  }
  if (
    status === 503 ||
    /\b503\b/.test(lower) ||
    lower.includes("lots of people are saving") ||
    lower.includes("queued") ||
    lower.includes("sandbox busy") ||
    lower.includes("too many concurrent") ||
    lower.includes("all yt-dlp clients failed") ||
    lower.includes("every builder path")
  ) {
    return as("queue");
  }
  if (
    lower.includes("not a bot") ||
    lower.includes("botguard") ||
    lower.includes("sign in to confirm") ||
    lower.includes("sign in to use a youtube session")
  ) {
    return as("bot");
  }
  if (lower.includes("403") || lower.includes("blocked") || lower.includes("access denied") || lower.includes("locked cdn")) {
    return as("blocked");
  }
  if (lower.includes("cookie")) return as("cookies");
  if (lower.includes("timed out") || lower.includes("timeout")) return as("timeout");
  if (lower.includes("empty") || lower.includes("no file") || lower.includes("no stream")) {
    return as("empty");
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("relay")) {
    return as("network");
  }
  return as("unknown");
}

export async function errorFromResponse(response: Response, prefix = "Download"): Promise<DownloadError> {
  const retryAfterSec = parseRetryAfter(response.headers.get("Retry-After"));
  let message = `${prefix} ${response.status}`;
  let code: string | undefined;
  try {
    const data = (await response.clone().json()) as { error?: string; code?: string };
    if (data.error) message = data.error;
    if (data.code) code = data.code;
  } catch {
    /* keep status text */
  }
  return classifyDownloadError(message, [message], { status: response.status, retryAfterSec, code });
}

export function isUserAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = err instanceof Error ? err.name : "";
  const msg = (err instanceof Error ? err.message : String(err)).trim();
  if (name === "AbortError" && signal === undefined) return /^(aborted|the operation was aborted.*)$/i.test(msg);
  return /^aborted$/i.test(msg);
}

export function downloadHint(code: DownloadErrorCode, guest = false, retryAfterSec?: number): string {
  const when = formatRetryAfter(retryAfterSec);
  if (code === "queue") {
    return [
      guest
        ? "Lots of people are saving Full HD right now. Wait — signing in will not skip the line."
        : "This preview is at capacity. Wait; retrying now makes the queue longer.",
      when,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (guest && code === "blocked") {
    return "YouTube bound the file to a different IP than this host. Save already retries through a matching hop — wait a moment and try again.";
  }
  if (guest && (code === "bot" || code === "cookies")) {
    return "Guest downloads cannot attach youtube.com cookies. Sign in, import cookies.txt, then retry.";
  }
  switch (code) {
    case "rate":
      return [
        guest
          ? "Guest cap reached (about 12 files every 10 minutes). Wait — do not hammer Save."
          : "This account hit the download cap. Wait; do not retry immediately.",
        when,
      ]
        .filter(Boolean)
        .join(" ");
    case "blocked":
      return "YouTube locked this transfer. Import cookies.txt or retry Compatible 360p.";
    case "bot":
      return "YouTube wants a real session. Paste cookies from a signed-in browser under History.";
    case "cookies":
      return "That cookie export could not be used. Re-export Netscape cookies while signed into YouTube.";
    case "timeout":
      return "A path stalled. Wait, then Save once — do not stack retries.";
    case "empty":
      return "The extractor found metadata but no bytes. Retry, or pick a lower quality.";
    case "network":
      return "A CORS relay dropped. Wait a few seconds, then Save once.";
    default:
      return "Retry the save once. If the preview is busy, wait for the queue — signing in will not help.";
  }
}

export function shouldEscalateSave(err: unknown): boolean {
  const code = classifyDownloadError(err).code;
  return code !== "rate" && code !== "queue";
}
