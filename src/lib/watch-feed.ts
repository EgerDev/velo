import { cleanYoutubeInput } from "./youtube.ts";

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

// Feed lookups only work against the main site — music/nocookie hosts don't
// serve /channel or /@handle pages, so keep the allowlist tighter than youtube.ts.
const FEED_HOSTS = new Set(["youtube.com", "m.youtube.com", "www.youtube.com"]);

export type ChannelRef = { channelId: string } | { handle: string } | { user: string };

function asChannelUrl(raw: string): URL | null {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : raw.includes("youtube") ? `https://${raw}` : raw;
  try {
    const url = new URL(withProtocol);
    if (!FEED_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseChannelInput(input: string): ChannelRef | null {
  const raw = cleanYoutubeInput(input);
  if (!raw) return null;

  if (CHANNEL_ID_RE.test(raw)) return { channelId: raw };

  if (raw.startsWith("@")) {
    const handle = raw.slice(1);
    return HANDLE_RE.test(handle) ? { handle } : null;
  }

  const url = asChannelUrl(raw);
  if (!url) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const head = parts[0] ?? "";

  if (head.startsWith("@")) {
    const handle = head.slice(1);
    return HANDLE_RE.test(handle) ? { handle } : null;
  }
  if (head === "channel") {
    const id = parts[1] ?? "";
    return CHANNEL_ID_RE.test(id) ? { channelId: id } : null;
  }
  // /c/ vanity names resolve the same way legacy /user/ names do.
  if (head === "user" || head === "c") {
    const user = parts[1] ?? "";
    return user ? { user } : null;
  }

  return null;
}

export function feedUrlForChannelId(channelId: string): string {
  if (!CHANNEL_ID_RE.test(channelId)) {
    throw new TypeError(`Invalid YouTube channel id: ${channelId}`);
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export type FeedVideo = {
  id: string;
  title: string;
  publishedAt: string;
  publishedMs: number;
  author: string;
  description: string;
  views: number | null;
  thumbnail: string;
};

export type ChannelFeed = {
  channelId: string | null;
  channelTitle: string | null;
  videos: FeedVideo[];
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(xml: string, tag: string): string | null {
  // Escape only what tag names can carry (the "yt:" / "media:" colon is safe).
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}

export function parseChannelFeed(xml: string): ChannelFeed {
  const empty: ChannelFeed = { channelId: null, channelTitle: null, videos: [] };
  if (typeof xml !== "string" || !/<feed[\s>]/.test(xml)) return empty;

  // Entries also carry <yt:channelId> and <title>, so channel-level fields
  // must come from the header — everything before the first <entry>.
  const firstEntry = xml.search(/<entry[\s>]/);
  const header = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const channelId = tagText(header, "yt:channelId");
  const channelTitle = tagText(header, "title");

  const videos: FeedVideo[] = [];
  for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1];
    const id = tagText(entry, "yt:videoId")?.trim();
    if (!id) continue;

    const publishedAt = tagText(entry, "published")?.trim() ?? "";
    const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN;
    const author = tagText(tagText(entry, "author") ?? "", "name") ?? "";
    const group = tagText(entry, "media:group") ?? entry;
    const viewsMatch = group.match(/<media:statistics\b[^>]*\bviews="(\d+)"/);
    const views = viewsMatch ? Number(viewsMatch[1]) : null;

    videos.push({
      id,
      title: decodeEntities(tagText(entry, "title") ?? "").trim(),
      publishedAt,
      publishedMs: Number.isFinite(publishedMs) ? publishedMs : 0,
      author: decodeEntities(author).trim(),
      description: decodeEntities(tagText(group, "media:description") ?? ""),
      views: views != null && Number.isFinite(views) ? views : null,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    });
  }

  videos.sort((a, b) => b.publishedMs - a.publishedMs);

  return {
    channelId: channelId ? decodeEntities(channelId).trim() : null,
    channelTitle: channelTitle != null ? decodeEntities(channelTitle).trim() : null,
    videos,
  };
}

export function newSince(videos: FeedVideo[], sinceMs: number): FeedVideo[] {
  return videos.filter((v) => v.publishedMs > sinceMs).sort((a, b) => b.publishedMs - a.publishedMs);
}
