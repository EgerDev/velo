// SponsorBlock (sponsor.ajay.app) crowd-sources labeled skip segments for
// YouTube videos. Pure helpers only — the caller does the fetch and hands the
// JSON to parseSegments. The one async export (hashVideoIdPrefix) exists
// because SponsorBlock's privacy-preserving lookup queries by a 4-char SHA-256
// prefix instead of the raw videoID; matching client-side keeps the full ID
// off the wire.

export type SponsorCategory =
  | "sponsor"
  | "selfpromo"
  | "interaction"
  | "intro"
  | "outro"
  | "preview"
  | "music_offtopic"
  | "filler";

export const SPONSOR_CATEGORIES: { id: SponsorCategory; label: string; description: string }[] = [
  { id: "sponsor", label: "Sponsor", description: "Paid promotion or sponsor read" },
  { id: "selfpromo", label: "Self-promo / merch", description: "Creator's own merch, courses, or other channels" },
  { id: "interaction", label: "Interaction reminder (like/subscribe)", description: "Asking to like, subscribe, or comment" },
  { id: "intro", label: "Intro / intermission", description: "Intro animation or pause without content" },
  { id: "outro", label: "Endcards / outro", description: "Endcards, credits, or outro without content" },
  { id: "preview", label: "Preview / recap", description: "Preview of upcoming content or recap of previous videos" },
  { id: "music_offtopic", label: "Non-music section", description: "Non-music part of a music video" },
  { id: "filler", label: "Filler / tangent", description: "Tangent or filler not needed to follow the video" },
];

const CATEGORY_LABELS = new Map<string, string>(SPONSOR_CATEGORIES.map((c) => [c.id, c.label]));

export type SponsorSegment = {
  uuid: string;
  category: SponsorCategory;
  start: number;
  end: number;
  label: string;
};

const API_BASE = "https://sponsor.ajay.app/api/skipSegments";
// Prefix search takes 4-32 hex chars; the API rejects anything else, so fail
// fast here instead of shipping a doomed request.
const HASH_PREFIX_RE = /^[0-9a-f]{4,32}$/;

export function segmentsApiUrl(hashPrefix: string, categories?: SponsorCategory[]): string {
  if (!HASH_PREFIX_RE.test(hashPrefix)) {
    throw new TypeError(`Invalid SponsorBlock hash prefix: ${JSON.stringify(hashPrefix)}`);
  }
  const cats = categories?.length ? categories : SPONSOR_CATEGORIES.map((c) => c.id);
  // The API expects the categories/actionTypes params as JSON arrays.
  const params = new URLSearchParams({
    categories: JSON.stringify(cats),
    actionTypes: JSON.stringify(["skip"]),
  });
  return `${API_BASE}/${hashPrefix}?${params}`;
}

export async function hashVideoIdPrefix(videoId: string, chars = 4): Promise<string> {
  // Web Crypto keeps this isomorphic — globalThis.crypto exists in browsers
  // and Node 20+ alike. Video IDs are ASCII, so TextEncoder is byte-exact.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function parseSegments(apiJson: unknown, videoId: string): SponsorSegment[] {
  // The hash-prefix query returns every video sharing the prefix; only one (if
  // any) is ours. Everything here is untrusted network data, so never throw.
  if (!Array.isArray(apiJson)) return [];
  const entry = apiJson.find(
    (v): v is { segments: unknown } =>
      typeof v === "object" && v !== null && (v as { videoID?: unknown }).videoID === videoId,
  );
  if (!entry || !Array.isArray(entry.segments)) return [];

  const out: SponsorSegment[] = [];
  for (const raw of entry.segments) {
    if (typeof raw !== "object" || raw === null) continue;
    const seg = raw as { UUID?: unknown; category?: unknown; actionType?: unknown; segment?: unknown };
    const label = typeof seg.category === "string" ? CATEGORY_LABELS.get(seg.category) : undefined;
    if (!label) continue; // unknown category (API adds new ones over time)
    // actionTypes is filtered server-side, but a mirror or cached response may
    // still include mute/poi entries — only "skip" segments are time ranges.
    if (seg.actionType !== undefined && seg.actionType !== "skip") continue;
    if (!Array.isArray(seg.segment)) continue;
    const start = toFiniteNumber(seg.segment[0]);
    const end = toFiniteNumber(seg.segment[1]);
    if (start === null || end === null || start < 0 || end <= start) continue;
    out.push({
      uuid: typeof seg.UUID === "string" ? seg.UUID : "",
      category: seg.category as SponsorCategory,
      start,
      end,
      label,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function totalSponsorSeconds(segments: SponsorSegment[]): number {
  return Math.round(segments.reduce((sum, s) => sum + (s.end - s.start), 0));
}

export function isInSegment(seconds: number, segments: SponsorSegment[]): SponsorSegment | null {
  // [start, end): at `end` playback has already resumed normal content.
  return segments.find((s) => seconds >= s.start && seconds < s.end) ?? null;
}
