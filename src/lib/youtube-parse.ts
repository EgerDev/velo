const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^(PL|UU|OL|RD|FL)[a-zA-Z0-9_-]{2,}$/;

const HOSTS = new Set([
  "youtube.com",
  "music.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

function normalizeHost(host: string): string {
  return host.replace(/^www\./, "").toLowerCase();
}

export function cleanYoutubeInput(input: string): string {
  return input
    .trim()
    .replace(/^[\uFEFF\u200B\u200C\u200D]+/, "")
    .replace(/^['"`<[]+/, "")
    .replace(/['"`>\]]+$/, "")
    .trim();
}

function withProtocol(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes("youtube") || raw.includes("youtu.be")) return `https://${raw}`;
  return raw;
}

function asYoutubeUrl(raw: string): URL | null {
  try {
    const url = new URL(withProtocol(raw));
    const host = normalizeHost(url.hostname);
    if (!HOSTS.has(host) && !host.endsWith(".youtube.com")) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseVideoId(input: string): string | null {
  const raw = cleanYoutubeInput(input);
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  // Direct shorts match (e.g. shorts/3jz_K5qX52o). Truly bare paths only — a
  // string with a host in front (protocol or not) has to clear the host
  // allowlist below, the same as `watch?v=` does.
  const shortsDirect = raw.match(/^\/?shorts\/([a-zA-Z0-9_-]{11})(?=[/?#]|$)/i);
  if (shortsDirect && shortsDirect[1]) return shortsDirect[1];

  const url = asYoutubeUrl(raw);
  if (!url) return null;
  const host = normalizeHost(url.hostname);

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;

  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  const maybeId = parts[1];
  // /embed/videoseries?list=… is a playlist embed. The sentinel is coincidentally
  // 11 characters, so it matches VIDEO_ID_RE and would be resolved as a video.
  if (maybeId === "videoseries") return null;
  if (
    maybeId &&
    VIDEO_ID_RE.test(maybeId) &&
    (kind === "shorts" || kind === "embed" || kind === "live" || kind === "v" || kind === "watch")
  ) {
    return maybeId;
  }

  return null;
}

export function parsePlaylistId(input: string): string | null {
  const raw = cleanYoutubeInput(input);
  if (!raw) return null;
  if (PLAYLIST_ID_RE.test(raw)) return raw;

  const url = asYoutubeUrl(raw);
  if (!url) return null;
  const list = url.searchParams.get("list");
  if (!list) return null;
  if (list === "WL" || list === "LL") return null;
  if (PLAYLIST_ID_RE.test(list) || /^[a-zA-Z0-9_-]{13,80}$/.test(list)) return list;
  return null;
}

export function looksLikeYoutubeUrl(input: string): boolean {
  const raw = cleanYoutubeInput(input);
  if (!raw) return false;
  if (VIDEO_ID_RE.test(raw) || PLAYLIST_ID_RE.test(raw)) return true;
  return asYoutubeUrl(raw) !== null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.trim();

  // Support ISO 8601 format (e.g. PT1H2M3S, PT5M30S, PT45S)
  const isoMatch = cleaned.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (isoMatch) {
    const h = parseInt(isoMatch[1] || "0", 10);
    const m = parseInt(isoMatch[2] || "0", 10);
    const s = parseInt(isoMatch[3] || "0", 10);
    return h * 3600 + m * 60 + s;
  }

  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) return null;
  const parts = cleaned.split(":").map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "Size varies";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const digits = n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[i]}`;
}

export function formatViews(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return "";
  if (count < 1_000) return `${count} views`;
  for (const u of [
    { v: 1_000_000_000, s: "B" },
    { v: 1_000_000, s: "M" },
    { v: 1_000, s: "K" },
  ]) {
    if (count >= u.v) {
      const n = count / u.v;
      const digits = n >= 10 ? 0 : 1;
      return `${n.toFixed(digits)}${u.s} views`;
    }
  }
  return `${count} views`;
}

export function formatCompactCount(count: number | null | undefined, noun: string): string {
  if (count == null || !Number.isFinite(count)) return "";
  if (count < 1_000) return `${count} ${noun}`;
  for (const u of [
    { v: 1_000_000_000, s: "B" },
    { v: 1_000_000, s: "M" },
    { v: 1_000, s: "K" },
  ]) {
    if (count >= u.v) {
      const n = count / u.v;
      const digits = n >= 10 ? 0 : 1;
      return `${n.toFixed(digits)}${u.s} ${noun}`;
    }
  }
  return `${count} ${noun}`;
}

export function formatPublished(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function codecFromMime(mime: string): string | null {
  const match = mime.match(/codecs="?([a-z0-9.]+)"?/i);
  if (!match?.[1]) return null;
  const base = match[1].split(".")[0]?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    avc1: "H.264",
    avc3: "H.264",
    vp9: "VP9",
    vp09: "VP9",
    av01: "AV1",
    mp4a: "AAC",
    opus: "Opus",
    hev1: "H.265",
    hvc1: "H.265",
    vorbis: "Vorbis",
  };
  return names[base] ?? base.toUpperCase();
}
