const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseVideoId(value: string): string | null {
  const raw = value.trim();
  if (VIDEO_ID_RE.test(raw)) return raw;
  const fromQuery = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromPath = raw.match(/\/(?:shorts|embed|live|watch|v)\/([a-zA-Z0-9_-]{11})/);
  if (fromPath?.[1]) return fromPath[1];
  const short = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  return short?.[1] ?? null;
}

export type ParsedCookies = {
  netscape: string;
  header: string;
  count: number;
};

export type HarPlayback = {
  url: string;
  itag: number;
  mime: string;
  contentLength: number | null;
  kind: "video" | "audio" | "av";
  videoId: string | null;
};

export type HarWaterfallKind = "watch" | "player" | "innertube" | "media" | "cdn" | "other";

export type HarWaterfallRow = {
  index: number;
  startedMs: number;
  durationMs: number;
  waitMs: number;
  receiveMs: number;
  method: string;
  status: number;
  url: string;
  host: string;
  path: string;
  kind: HarWaterfallKind;
  itag: number | null;
  cookieCount: number;
  size: number | null;
};

export type HarHeaderReport = {
  cookieNames: string[];
  missingSession: string[];
  hasSid: boolean;
  hasSapisid: boolean;
  hasLoginInfo: boolean;
  visitorId: string | null;
  clientName: string | null;
  clientVersion: string | null;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
  authorization: string | null;
  interesting: Array<{ name: string; value: string }>;
};

export type ParsedHar = {
  cookies: ParsedCookies | null;
  playbacks: HarPlayback[];
  videoIds: string[];
  poTokens: string[];
  entryCount: number;
  youtubeEntryCount: number;
  warnings: string[];
  waterfall: HarWaterfallRow[];
  headers: HarHeaderReport;
  spanMs: number;
};

type HarHeader = { name?: string; value?: string };
type HarCookie = { name?: string; value?: string; domain?: string; path?: string };
type HarPostData = { text?: string; encoding?: string };
type HarContent = { text?: string; encoding?: string; mimeType?: string; size?: number };

type HarTimings = {
  blocked?: number;
  dns?: number;
  connect?: number;
  send?: number;
  wait?: number;
  receive?: number;
  ssl?: number;
};

type HarEntry = {
  pageref?: string;
  startedDateTime?: string;
  time?: number;
  timings?: HarTimings;
  _resourceType?: string;
  request?: {
    method?: string;
    url?: string;
    queryString?: Array<{ name?: string; value?: string }>;
    cookies?: HarCookie[];
    headers?: HarHeader[];
    postData?: HarPostData;
  };
  response?: {
    status?: number;
    cookies?: HarCookie[];
    headers?: HarHeader[];
    content?: HarContent;
    bodySize?: number;
  };
};

type HarFile = {
  log?: { entries?: HarEntry[]; comment?: string };
  entries?: HarEntry[];
};

const REDACTED = /^(?:\[redacted\]|redacted|\*+|xxx+)$/i;
const SESSION_COOKIES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
];
const INTERESTING_HEADERS = [
  "cookie",
  "authorization",
  "x-goog-visitor-id",
  "x-goog-visitorid",
  "x-youtube-client-name",
  "x-youtube-client-version",
  "x-youtube-page-cl",
  "origin",
  "referer",
  "user-agent",
  "range",
  "x-client-data",
];

function headerValue(headers: HarHeader[] | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return headers?.find((header) => (header.name ?? "").toLowerCase() === wanted)?.value ?? undefined;
}

function headerValues(headers: HarHeader[] | undefined, name: string): string[] {
  const wanted = name.toLowerCase();
  return (headers ?? [])
    .filter((header) => (header.name ?? "").toLowerCase() === wanted)
    .map((header) => header.value ?? "")
    .filter(Boolean);
}

function isYoutubeUrl(url: string): boolean {
  return /youtube\.com|googlevideo\.com|youtube-nocookie\.com|google\.com/i.test(url);
}

function pushVideoId(ids: Set<string>, value: string | null | undefined) {
  if (!value) return;
  const id = parseVideoId(value);
  if (id) ids.add(id);
}

function decodeContent(content: HarContent | undefined): string {
  if (!content?.text) return "";
  if ((content.encoding ?? "").toLowerCase() === "base64") {
    try {
      return atob(content.text);
    } catch {
      return content.text;
    }
  }
  return content.text;
}

function parseSetCookie(raw: string): HarCookie | null {
  const first = raw.split(";")[0] ?? "";
  const idx = first.indexOf("=");
  if (idx < 1) return null;
  const name = first.slice(0, idx).trim();
  const value = first.slice(idx + 1).trim();
  if (!name || REDACTED.test(value)) return null;
  const domain = raw.match(/domain=([^;]+)/i)?.[1]?.trim();
  return { name, value, domain };
}

function collectCookiePairs(entries: HarEntry[]): Array<{ name: string; value: string; domain?: string }> {
  const pairs: Array<{ name: string; value: string; domain?: string }> = [];
  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    if (url && !isYoutubeUrl(url)) continue;
    for (const cookie of [...(entry.request?.cookies ?? []), ...(entry.response?.cookies ?? [])]) {
      if (!cookie.name || cookie.value == null || REDACTED.test(cookie.value)) continue;
      pairs.push({ name: cookie.name, value: String(cookie.value), domain: cookie.domain });
    }
    for (const header of headerValues(entry.request?.headers, "cookie")) {
      for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 1) continue;
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!name || !value || REDACTED.test(value)) continue;
        pairs.push({ name, value });
      }
    }
    for (const header of headerValues(entry.response?.headers, "set-cookie")) {
      const parsed = parseSetCookie(header);
      if (parsed?.name && parsed.value) pairs.push(parsed as { name: string; value: string; domain?: string });
    }
  }
  return pairs;
}

function cookiesFromPairs(pairs: Array<{ name: string; value: string; domain?: string }>): ParsedCookies | null {
  if (!pairs.length) return null;
  const lines = ["# Netscape HTTP Cookie File", "# Parsed from HAR"];
  const header: string[] = [];
  const seen = new Set<string>();
  for (const cookie of pairs) {
    const domain = cookie.domain || ".youtube.com";
    const key = `${domain}:${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const host = domain.startsWith(".") ? domain : `.${domain.replace(/^\./, "")}`;
    lines.push(`${host}\tTRUE\t/\tTRUE\t0\t${cookie.name}\t${cookie.value}`);
    header.push(`${cookie.name}=${cookie.value}`);
  }
  if (!header.length) return null;
  return { netscape: `${lines.join("\n")}\n`, header: header.join("; "), count: header.length };
}

function playbackFromUrl(rawUrl: string, videoId: string | null): HarPlayback | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!url.hostname.includes("googlevideo.com")) return null;
  if (!url.pathname.includes("videoplayback")) return null;
  const itag = Number(url.searchParams.get("itag") || 0);
  if (!Number.isFinite(itag) || itag <= 0) return null;
  const mime = decodeURIComponent(url.searchParams.get("mime") || "application/octet-stream");
  const clen = Number(url.searchParams.get("clen") || 0);
  const kind: HarPlayback["kind"] = mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "av";
  return {
    url: rawUrl,
    itag,
    mime,
    contentLength: Number.isFinite(clen) && clen > 0 ? clen : null,
    kind,
    videoId,
  };
}

function classifyUrl(url: string): HarWaterfallKind {
  if (url.includes("videoplayback")) return "media";
  if (url.includes("/youtubei/v1/player")) return "player";
  if (url.includes("/youtubei/")) return "innertube";
  if (/\/watch|\/shorts|\/embed/.test(url)) return "watch";
  if (url.includes("googlevideo.com")) return "cdn";
  return "other";
}

function cookieNamesFromHeader(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

function analyzeHeaders(entries: HarEntry[], cookieNames: string[]): HarHeaderReport {
  const names = new Set(cookieNames);
  let visitorId: string | null = null;
  let clientName: string | null = null;
  let clientVersion: string | null = null;
  let userAgent: string | null = null;
  let origin: string | null = null;
  let referer: string | null = null;
  let authorization: string | null = null;
  const interesting: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    if (url && !isYoutubeUrl(url)) continue;
    for (const header of entry.request?.headers ?? []) {
      const name = (header.name ?? "").toLowerCase();
      const value = header.value ?? "";
      if (!name || !value || REDACTED.test(value)) continue;
      if (name === "x-goog-visitor-id" || name === "x-goog-visitorid") visitorId = value;
      if (name === "x-youtube-client-name") clientName = value;
      if (name === "x-youtube-client-version") clientVersion = value;
      if (name === "user-agent") userAgent = value;
      if (name === "origin") origin = value;
      if (name === "referer") referer = value;
      if (name === "authorization") authorization = value.length > 48 ? `${value.slice(0, 48)}…` : value;
      if (INTERESTING_HEADERS.includes(name) && name !== "cookie") {
        const key = `${name}:${value.slice(0, 80)}`;
        if (!seen.has(key)) {
          seen.add(key);
          interesting.push({
            name,
            value: value.length > 96 ? `${value.slice(0, 96)}…` : value,
          });
        }
      }
    }
  }

  const missingSession = SESSION_COOKIES.filter((name) => ![...names].some((cookie) => cookie.toLowerCase() === name.toLowerCase()));
  return {
    cookieNames: [...names].sort(),
    missingSession,
    hasSid: names.has("SID") || names.has("sid"),
    hasSapisid: [...names].some((name) => name.toUpperCase().includes("SAPISID")),
    hasLoginInfo: [...names].some((name) => name.toUpperCase() === "LOGIN_INFO"),
    visitorId,
    clientName,
    clientVersion,
    userAgent,
    origin,
    referer,
    authorization,
    interesting: interesting.slice(0, 12),
  };
}

function buildWaterfall(entries: HarEntry[]): { rows: HarWaterfallRow[]; spanMs: number } {
  const raw: HarWaterfallRow[] = [];
  for (const [index, entry] of entries.entries()) {
    const url = entry.request?.url ?? "";
    if (!url || !isYoutubeUrl(url)) continue;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    const startedMs = entry.startedDateTime ? Date.parse(entry.startedDateTime) : Number.NaN;
    const waitMs = Math.max(0, entry.timings?.wait ?? 0);
    const receiveMs = Math.max(0, entry.timings?.receive ?? 0);
    const durationMs = Math.max(0, entry.time ?? waitMs + receiveMs);
    const cookieHeader = headerValue(entry.request?.headers, "cookie") ?? "";
    const itag = Number(parsed?.searchParams.get("itag") || 0) || null;
    raw.push({
      index,
      startedMs: Number.isFinite(startedMs) ? startedMs : 0,
      durationMs,
      waitMs,
      receiveMs,
      method: (entry.request?.method ?? "GET").toUpperCase(),
      status: entry.response?.status ?? 0,
      url,
      host: parsed?.host ?? "",
      path: parsed ? `${parsed.pathname}${parsed.search ? "?…" : ""}` : url.slice(0, 80),
      kind: classifyUrl(url),
      itag: itag && itag > 0 ? itag : null,
      cookieCount: cookieNamesFromHeader(cookieHeader).length || (entry.request?.cookies?.length ?? 0),
      size: entry.response?.content?.size ?? entry.response?.bodySize ?? null,
    });
  }
  raw.sort((a, b) => a.startedMs - b.startedMs);
  const first = raw[0]?.startedMs ?? 0;
  const last = raw.reduce((max, row) => Math.max(max, row.startedMs + row.durationMs), first);
  const spanMs = Math.max(1, last - first);
  const rows = raw.slice(0, 48).map((row) => ({ ...row, startedMs: row.startedMs - first }));
  return { rows, spanMs };
}

function entriesOf(parsed: HarFile): HarEntry[] {
  if (Array.isArray(parsed.log?.entries)) return parsed.log.entries;
  if (Array.isArray(parsed.entries)) return parsed.entries;
  return [];
}

export function isHarJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return false;
  return /"log"\s*:/.test(trimmed.slice(0, 800)) || /"entries"\s*:/.test(trimmed.slice(0, 2000));
}

export function looksLikeSessionExport(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (isHarJson(trimmed)) return true;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return true;
  if (/^\s*curl\s/i.test(trimmed)) return true;
  if (trimmed.includes("Netscape HTTP Cookie File")) return true;
  if (/(SID|SAPISID|LOGIN_INFO|HSID)=/.test(trimmed)) return true;
  if (/^name\t/i.test(trimmed) && /SID|SAPISID|LOGIN_INFO/i.test(trimmed)) return true;
  return false;
}

export function parseHar(raw: string | HarFile): ParsedHar {
  const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as HarFile;
  const entries = entriesOf(parsed);
  if (!entries.length) throw new Error("That JSON is not a HAR file (no log.entries).");

  const videoIds = new Set<string>();
  const poTokens = new Set<string>();
  const playbacks: HarPlayback[] = [];
  const seenItag = new Set<string>();
  let youtubeEntryCount = 0;
  let sawYoutube = false;
  let sawRedacted = false;

  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    if (url && isYoutubeUrl(url)) {
      youtubeEntryCount += 1;
      sawYoutube = true;
    }
    pushVideoId(videoIds, url);
    pushVideoId(videoIds, headerValue(entry.request?.headers, "referer"));
    for (const query of entry.request?.queryString ?? []) {
      if (query.name === "v" || query.name === "videoId") pushVideoId(videoIds, query.value);
      if (query.name === "pot" && query.value) poTokens.add(query.value);
    }
    const post = entry.request?.postData?.text ?? "";
    const postVideo = post.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/)?.[1];
    pushVideoId(videoIds, postVideo);
    const body = decodeContent(entry.response?.content);
    const bodyVideo = body.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/)?.[1];
    pushVideoId(videoIds, bodyVideo);

    const cookieHeader = headerValue(entry.request?.headers, "cookie") ?? "";
    if (REDACTED.test(cookieHeader) || cookieHeader.toLowerCase().includes("[redacted]")) sawRedacted = true;

    const nearestId = [...videoIds][videoIds.size - 1] ?? null;
    const playback = playbackFromUrl(url, nearestId);
    if (playback) {
      const key = `${playback.videoId ?? ""}:${playback.itag}`;
      if (!seenItag.has(key)) {
        seenItag.add(key);
        playbacks.push(playback);
      }
    }
  }

  const cookies = cookiesFromPairs(collectCookiePairs(entries));
  const { rows, spanMs } = buildWaterfall(entries);
  const headers = analyzeHeaders(entries, cookies ? cookies.header.split("; ").map((part) => part.split("=")[0] ?? "") : []);
  const warnings: string[] = [];
  if (sawRedacted && !cookies) {
    warnings.push('Cookie values are redacted. Re-export with “Allow to generate HAR with sensitive data”.');
  } else if (sawYoutube && !cookies) {
    warnings.push("HAR has YouTube traffic but no Cookie headers. Enable sensitive data and reload youtube.com.");
  }
  if (cookies && headers.missingSession.length) {
    warnings.push(`Session looks incomplete (missing ${headers.missingSession.slice(0, 3).join(", ")}). Sign in on youtube.com and export again.`);
  }
  if (!cookies && !playbacks.length) {
    throw new Error(warnings[0] || "No YouTube cookies or media URLs in that HAR.");
  }

  return {
    cookies,
    playbacks,
    videoIds: [...videoIds],
    poTokens: [...poTokens],
    entryCount: entries.length,
    youtubeEntryCount,
    warnings,
    waterfall: rows,
    headers,
    spanMs,
  };
}