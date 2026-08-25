import { isImaUrl } from "./ima.ts";
import { unlockStreamUrl } from "./stream-unlock.ts";

export type BypassFormat = {
  itag?: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType?: string;
  contentLength?: string;
  qualityLabel?: string;
  audioQuality?: string;
};

export type PlayerSnapshot = {
  status?: string;
  reason?: string;
  formats: BypassFormat[];
  hlsManifestUrl?: string;
  dashManifestUrl?: string;
};

/**
 * The first `{…}` object after `marker`, as raw source.
 *
 * Brace counting has to skip string contents: a `}` in any value — a video
 * title is the common one — would otherwise close the object early. Matching
 * braces rather than pattern-matching the call site also means the surrounding
 * syntax is irrelevant, so `f({…})`, `f({…}, 1)`, `f(\n{…}\n)` and a missing
 * trailing semicolon all read the same.
 */
export function sliceBalancedObject(html: string, marker: string): string | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') inString = !inString;
    else if (inString) continue;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonObject(html: string, marker: string): unknown {
  const raw = sliceBalancedObject(html, marker);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function extractPlayerResponse(html: string): PlayerSnapshot | null {
  const marker = "ytInitialPlayerResponse";
  let from = 0;
  while (from < html.length) {
    const idx = html.indexOf(marker, from);
    if (idx < 0) return null;
    const assign = html.slice(idx, idx + 96);
    if (/ytInitialPlayerResponse\s*=\s*null/.test(assign)) {
      from = idx + marker.length;
      continue;
    }
    const start = html.indexOf("{", idx);
    if (start < 0) return null;
    const player = extractJsonObject(html.slice(idx), marker) as {
      streamingData?: {
        formats?: BypassFormat[];
        adaptiveFormats?: BypassFormat[];
        hlsManifestUrl?: string;
        dashManifestUrl?: string;
      };
      playabilityStatus?: { status?: string; reason?: string };
    } | null;
    if (!player) {
      from = idx + marker.length;
      continue;
    }
    const formats = [
      ...(player.streamingData?.formats ?? []),
      ...(player.streamingData?.adaptiveFormats ?? []),
    ].filter(
      (item) => !isImaUrl(item.url) && !isImaUrl(item.signatureCipher) && !isImaUrl(item.cipher),
    );
    if (!formats.length && !player.streamingData?.hlsManifestUrl) {
      from = idx + marker.length;
      continue;
    }
    return {
      status: player.playabilityStatus?.status,
      reason: player.playabilityStatus?.reason,
      formats,
      hlsManifestUrl: player.streamingData?.hlsManifestUrl,
      dashManifestUrl: player.streamingData?.dashManifestUrl,
    };
  }
  return null;
}

export function pickBypassFormat(formats: BypassFormat[], itag: number): BypassFormat | null {
  return (
    formats.find(
      (item) =>
        item.itag === itag &&
        !isImaUrl(item.url) &&
        !isImaUrl(item.signatureCipher) &&
        !isImaUrl(item.cipher),
    ) ?? null
  );
}

export function sameHopPages(videoId: string): string[] {
  return [
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
  ];
}

export function isVideoplaybackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /(^|\.)googlevideo\.com$/i.test(url.hostname) && url.pathname.includes("/videoplayback");
  } catch {
    return false;
  }
}

export function appendParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
  }
}

export function stampPot(url: string, pot: string | null | undefined): string {
  return unlockStreamUrl(url, { pot, stripAlr: true }).url;
}
