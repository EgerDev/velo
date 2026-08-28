export type ParsedCookies = {
  netscape: string;
  header: string;
  count: number;
};

type JsonCookie = {
  domain?: string;
  host?: string;
  Host?: string;
  name?: string;
  value?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  expires?: number;
  expirationDateUnix?: number;
};

type HarFile = {
  log?: {
    entries?: Array<{
      request?: {
        url?: string;
        cookies?: JsonCookie[];
        headers?: Array<{ name?: string; value?: string }>;
      };
      response?: {
        cookies?: JsonCookie[];
        headers?: Array<{ name?: string; value?: string }>;
      };
    }>;
  };
  entries?: HarFile["log"] extends { entries?: infer E } ? E : never;
};

function isYoutubeDomain(domain: string): boolean {
  const host = domain.replace(/^\./, "").toLowerCase();
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

/**
 * Match on the HOST, not anywhere in the URL string.
 *
 * A substring test says yes to `https://tracker.example.net/p?dest=youtube.com`,
 * and the header cookies on such an entry are pushed with no domain — so they
 * inherit the `.google.com` / `.youtube.com` default and get shipped to YouTube
 * as if they were Google's. Third-party session cookies must never survive this.
 */
function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isYoutubeDomain(host) || host === "googlevideo.com" || host.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
}

const GOOGLE_COOKIE_NAMES = /^(SID|HSID|SSID|APISID|SAPISID|__SECURE-1PSID|__SECURE-3PSID|__SECURE-1PAPISID|__SECURE-3PAPISID)$/i;

/**
 * Where a cookie with no recorded domain belongs.
 *
 * yt-dlp reads the jar scoped to www.youtube.com, so a bare `Cookie:` paste or
 * a DevTools table — which the UI tells people to take from a signed-in
 * youtube.com tab — has to land on `.youtube.com`, or the extractor never sees
 * the session at all. Google-account cookies are issued on `.google.com` too in
 * a real browser and some Google endpoints read them there, so mirror those
 * across both domains exactly like a real export would.
 */
function defaultCookieDomains(name: string): string[] {
  return GOOGLE_COOKIE_NAMES.test(name) ? [".youtube.com", ".google.com"] : [".youtube.com"];
}

function defaultCookieDomain(name: string): string {
  return defaultCookieDomains(name)[0]!;
}

type CookiePair = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
};

function netscapeLine(cookie: CookiePair) {
  const domain = cookie.domain && isYoutubeDomain(cookie.domain) ? cookie.domain : defaultCookieDomain(cookie.name);
  const host = domain.startsWith(".") ? domain : `.${domain.replace(/^\./, "")}`;
  // The jar is tab-delimited and newline-separated, so an unsanitized value
  // forges extra rows for arbitrary domains and desyncs the reported count.
  const clean = (value: string) => value.replace(/[\t\r\n]/g, "");
  const fields = [
    host,
    "TRUE",
    clean(cookie.path || "/"),
    cookie.secure === false ? "FALSE" : "TRUE",
    String(Math.max(0, Math.floor(cookie.expires ?? 0))),
    clean(cookie.name),
    clean(cookie.value),
  ].join("\t");
  return cookie.httpOnly ? `#HttpOnly_${fields}` : fields;
}

function cookieDomain(cookie: JsonCookie): string | undefined {
  return cookie.domain || cookie.host || cookie.Host;
}

function collect(pairs: CookiePair[]): ParsedCookies {
  const lines = ["# Netscape HTTP Cookie File"];
  const header: string[] = [];
  const seen = new Set<string>();
  // One credential can legitimately occupy several jar rows — mirrored across
  // .youtube.com and .google.com here, and present on both domains in any real
  // browser export. The `Cookie:` header and the count are per NAME, so the
  // reported total means "cookies you have" and stays identical when the jar is
  // parsed again (the vault re-parses what it saved).
  const named = new Set<string>();
  for (const cookie of pairs) {
    if (!cookie.name || cookie.value == null) continue;
    if (cookie.domain && !isYoutubeDomain(cookie.domain)) continue;
    const domains = cookie.domain ? [cookie.domain] : defaultCookieDomains(cookie.name);
    for (const domain of domains) {
      const key = `${domain}:${cookie.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(netscapeLine({ ...cookie, domain }));
    }
    if (!named.has(cookie.name)) {
      named.add(cookie.name);
      header.push(`${cookie.name}=${cookie.value}`);
    }
  }
  if (header.length === 0) throw new Error("No YouTube session tokens in that export.");
  return { netscape: `${lines.join("\n")}\n`, header: header.join("; "), count: header.length };
}

/**
 * Cookie expiry, normalised to whole Unix seconds.
 *
 * Sources disagree on the shape: extension exports use a numeric epoch (seconds
 * or milliseconds), the HAR 1.2 spec stores an ISO-8601 date string, and a
 * `Set-Cookie` header carries an HTTP-date. Reading only numbers silently threw
 * away every date-shaped expiry, which then wrote a session-cookie `0` and made
 * the "your session is stale, re-export" check unreachable.
 */
export function cookieExpiryToUnix(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return cookieExpiryToUnix(numeric);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed / 1000);
}

const unixExpiry = cookieExpiryToUnix;

function fromCookieList(list: JsonCookie[]): ParsedCookies {
  const pairs: CookiePair[] = [];
  for (const cookie of list) {
    if (!cookie?.name || cookie.value == null) continue;
    const domain = cookieDomain(cookie);
    if (domain && !isYoutubeDomain(domain)) continue;
    const expires = unixExpiry(cookie.expirationDate ?? cookie.expires ?? cookie.expirationDateUnix);
    pairs.push({
      name: cookie.name,
      value: String(cookie.value),
      domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expires: typeof expires === "number" ? expires : undefined,
    });
  }
  return collect(pairs);
}

function fromHeader(raw: string): ParsedCookies {
  const cleaned = raw.replace(/^cookie:\s*/i, "").trim();
  const pairs: Array<{ name: string; value: string }> = [];
  for (const part of cleaned.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || !value) continue;
    pairs.push({ name, value });
  }
  return collect(pairs);
}

function fromCurl(raw: string): ParsedCookies {
  // Chrome's "Copy as cURL (cmd)" escapes with a caret: `^"` around values,
  // `^` before a line break, and `^` ahead of `%` and friends inside values.
  // Strip it once so the quote-anchored matches below see a plain command.
  const text = /\^["\r\n]/.test(raw) ? raw.replace(/\^([\s\S])/g, "$1") : raw;
  const cookieHeader =
    text.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i)?.[1] ||
    text.match(/--header\s+['"]cookie:\s*([^'"]+)['"]/i)?.[1] ||
    text.match(/-b\s+['"]([^'"]+)['"]/i)?.[1] ||
    text.match(/--cookie\s+['"]([^'"]+)['"]/i)?.[1];
  if (!cookieHeader) throw new Error("No Cookie header in that cURL command.");
  return fromHeader(cookieHeader);
}

function fromHar(parsed: HarFile): ParsedCookies {
  const pairs: CookiePair[] = [];
  const entries = parsed.log?.entries ?? parsed.entries ?? [];
  let redacted = false;
  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    // An entry with no usable URL is not a free pass on a credential path.
    if (!isYoutubeUrl(url)) continue;
    for (const cookie of [...(entry.request?.cookies ?? []), ...(entry.response?.cookies ?? [])]) {
      if (!cookie.name || cookie.value == null) continue;
      if (/^\[redacted\]$/i.test(String(cookie.value))) {
        redacted = true;
        continue;
      }
      pairs.push({
        name: cookie.name,
        value: String(cookie.value),
        domain: cookieDomain(cookie),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expires: unixExpiry(cookie.expirationDate ?? cookie.expires ?? cookie.expirationDateUnix),
      });
    }
    for (const header of entry.request?.headers ?? []) {
      if ((header.name ?? "").toLowerCase() !== "cookie" || !header.value) continue;
      if (/redacted/i.test(header.value)) {
        redacted = true;
        continue;
      }
      for (const part of header.value.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 1) continue;
        pairs.push({ name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() });
      }
    }
    for (const header of entry.response?.headers ?? []) {
      if ((header.name ?? "").toLowerCase() !== "set-cookie" || !header.value) continue;
      const first = header.value.split(";")[0] ?? "";
      const idx = first.indexOf("=");
      if (idx < 1) continue;
      const domain = header.value.match(/domain=([^;]+)/i)?.[1]?.trim();
      const maxAge = header.value.match(/max-age=(-?\d+)/i)?.[1];
      // Max-Age wins over Expires per RFC 6265.
      const expiresAt = header.value.match(/expires=([^;]+)/i)?.[1]?.trim();
      pairs.push({
        name: first.slice(0, idx).trim(),
        value: first.slice(idx + 1).trim(),
        domain,
        httpOnly: /;\s*httponly/i.test(header.value),
        secure: /;\s*secure/i.test(header.value),
        expires: maxAge
          ? unixExpiry(Math.floor(Date.now() / 1000) + Number(maxAge))
          : unixExpiry(expiresAt),
      });
    }
  }
  if (pairs.length === 0 && redacted) {
    throw new Error('HAR cookies are redacted. Re-export with “Allow to generate HAR with sensitive data”.');
  }
  return collect(pairs);
}

function fromJson(raw: string): ParsedCookies {
  const parsed = JSON.parse(raw) as HarFile | JsonCookie[] | { cookies?: JsonCookie[] };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && ("log" in parsed || "entries" in parsed)) {
    return fromHar(parsed as HarFile);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { cookies?: JsonCookie[] }).cookies;
  if (!Array.isArray(list)) throw new Error("JSON cookies must be an array or a HAR export.");
  return fromCookieList(list);
}

function fromNetscape(raw: string): ParsedCookies {
  const header: string[] = [];
  // Same rule as `collect`: one entry per cookie NAME, not per jar row. A real
  // export (and our own mirrored output) carries a credential on both
  // .youtube.com and .google.com, and counting rows made the total climb every
  // time the vault re-parsed the jar it had just saved.
  const named = new Set<string>();
  const kept = ["# Netscape HTTP Cookie File"];
  for (const line of raw.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#HttpOnly_")) trimmed = trimmed.slice("#HttpOnly_".length);
    else if (trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expires, name, value] = parts;
    if (!domain || !name) continue;
    if (!isYoutubeDomain(domain)) continue;
    kept.push(
      netscapeLine({
        domain,
        path: path || "/",
        secure: secure === "TRUE" || secure === "true",
        expires: Number(expires) || 0,
        name,
        value,
        httpOnly: line.trim().startsWith("#HttpOnly_"),
      }),
    );
    if (!named.has(name)) {
      named.add(name);
      header.push(`${name}=${value}`);
    }
  }
  if (header.length === 0) throw new Error("No YouTube cookies in that Netscape file.");
  return { netscape: `${kept.join("\n")}\n`, header: header.join("; "), count: header.length };
}

function looksLikeHeader(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    /^(cookie:\s*)?(sid|hsid|ssid|sapisid|login_info|__secure-)/i.test(raw.trim()) ||
    (raw.includes(";") && raw.includes("=") && /(SID|SAPISID|LOGIN_INFO|HSID)=/.test(raw) && !raw.includes("\t"))
  ) && !lower.includes("netscape");
}

function fromDevToolsTable(raw: string): ParsedCookies | null {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const header = lines[0].toLowerCase().split("\t");
  const named = header.includes("name") && header.includes("value");
  const pairs: Array<{ name: string; value: string; domain?: string }> = [];
  if (named) {
    const nameIdx = header.indexOf("name");
    const valueIdx = header.indexOf("value");
    const domainIdx = header.indexOf("domain");
    for (const line of lines.slice(1)) {
      const parts = line.split("\t");
      const name = parts[nameIdx]?.trim();
      const value = parts[valueIdx]?.trim();
      const domain = domainIdx >= 0 ? parts[domainIdx]?.trim() : ".youtube.com";
      if (!name || value == null) continue;
      if (domain && !isYoutubeDomain(domain)) continue;
      pairs.push({ name, value, domain });
    }
  } else {
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      if (parts[1] === "TRUE" || parts[1] === "FALSE") return null;
      const name = parts[0]?.trim();
      const value = parts[1]?.trim();
      const domain = parts[2]?.trim();
      if (!name || value == null) continue;
      if (domain && !isYoutubeDomain(domain) && !/youtube|google/i.test(domain)) continue;
      pairs.push({ name, value, domain });
    }
  }
  if (!pairs.length) return null;
  return collect(pairs);
}

export function parseCookieImport(raw: string): ParsedCookies {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste a cookies.txt, HAR, cURL, Cookie-Editor JSON, or DevTools table first.");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return fromJson(trimmed);
  if (/^\s*curl\s/i.test(trimmed) || /(?:^|\s)(?:--cookie|-b)\s/.test(trimmed)) return fromCurl(trimmed);
  // Tried before the header path: a headerless DevTools row starts with a
  // cookie name, which looksLikeHeader would otherwise claim. A Netscape jar
  // bails out on its TRUE/FALSE column and falls through unchanged.
  if (trimmed.includes("\t")) {
    const table = fromDevToolsTable(trimmed);
    if (table) return table;
  }
  if (looksLikeHeader(trimmed)) return fromHeader(trimmed);
  if (!trimmed.includes("\t") && !trimmed.includes("youtube.com")) {
    throw new Error("That doesn’t look like cookies.txt, HAR, cURL, Cookie-Editor JSON, or a Cookie header.");
  }
  return fromNetscape(trimmed);
}

export type CookieFormatKind = "netscape" | "json" | "header" | "har" | "curl" | "devtools" | "unknown";

export type CookieFormatReport = {
  format: CookieFormatKind;
  count: number;
  httpOnly: number;
  hasLogin: boolean;
  hasSapisid: boolean;
  hasSid: boolean;
  issues: string[];
  rows: CookieRow[];
  expiredNames: string[];
  sessionNames: string[];
  sidExpiresAt: number | null;
};

export type CookieRow = {
  name: string;
  expires: number;
  httpOnly: boolean;
};

export function listImportedCookies(netscape: string): CookieRow[] {
  const rows: CookieRow[] = [];
  for (const line of netscape.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    const httpOnly = trimmed.startsWith("#HttpOnly_");
    if (httpOnly) trimmed = trimmed.slice("#HttpOnly_".length);
    else if (trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const expires = Number(parts[4]) || 0;
    const name = parts[5];
    if (!name) continue;
    rows.push({ name, expires, httpOnly });
  }
  return rows;
}

export function detectCookieFormat(raw: string): CookieFormatKind {
  const trimmed = raw.trim();
  if (!trimmed) return "unknown";
  if (trimmed.startsWith("{") && /"log"\s*:/.test(trimmed.slice(0, 800))) return "har";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  if (/^\s*curl\s/i.test(trimmed) || /(?:^|\s)(?:--cookie|-b)\s/.test(trimmed)) return "curl";
  if (trimmed.includes("\t") && fromDevToolsTable(trimmed)) return "devtools";
  if (looksLikeHeader(trimmed)) return "header";
  if (trimmed.includes("\t") && /(SID|SAPISID|LOGIN_INFO|#HttpOnly_)/.test(trimmed)) return "netscape";
  if (trimmed.includes("Netscape HTTP Cookie File")) return "netscape";
  return "unknown";
}

export function analyzeCookieFormat(raw: string, now = Date.now()): CookieFormatReport {
  const format = detectCookieFormat(raw);
  const empty = {
    format,
    count: 0,
    httpOnly: 0,
    hasLogin: false,
    hasSapisid: false,
    hasSid: false,
    issues: [] as string[],
    rows: [] as CookieRow[],
    expiredNames: [] as string[],
    sessionNames: [] as string[],
    sidExpiresAt: null as number | null,
  };
  const issues: string[] = [];
  if (raw.includes("\r\n")) issues.push("CRLF line endings were converted to LF (yt-dlp wants Unix newlines).");
  if (format === "netscape" && !/# Netscape HTTP Cookie File|# HTTP Cookie File/i.test(raw)) {
    issues.push("Missing Netscape header line — Velo will add it.");
  }
  if (format === "header") issues.push("Cookie header has no HttpOnly flag; yt-dlp still accepts the Netscape rewrite.");
  if (format === "devtools") issues.push("DevTools tables omit expiry; yt-dlp treats them as session cookies.");
  try {
    const parsed = parseCookieImport(raw);
    const rows = listImportedCookies(parsed.netscape);
    const names = rows.map((row) => row.name);
    const httpOnly = rows.filter((row) => row.httpOnly).length;
    const hasLogin = names.some((name) => name.toUpperCase() === "LOGIN_INFO");
    const hasSapisid = names.some((name) => name.toUpperCase().includes("SAPISID"));
    const hasSid = names.some((name) => name.toUpperCase() === "SID");
    const nowSec = Math.floor(now / 1000);
    // A credential mirrored onto both .youtube.com and .google.com is one
    // cookie in two rows — report the name once.
    const uniq = (values: string[]) => [...new Set(values)];
    const expiredNames = uniq(
      rows.filter((row) => row.expires > 0 && row.expires < nowSec).map((row) => row.name),
    );
    const sessionNames = uniq(rows.filter((row) => row.expires <= 0).map((row) => row.name));
    const sid = rows.find((row) => row.name.toUpperCase() === "SID");
    const sidExpiresAt = sid && sid.expires > 0 ? sid.expires : null;
    if (!hasSapisid && !hasLogin) issues.push("No SAPISID / LOGIN_INFO — YouTube may still treat this as signed out.");
    if (!hasSid) issues.push("No SID cookie. Google only issues SID at sign-in — export again from a signed-in youtube.com tab.");
    if (expiredNames.length) {
      issues.push(`Expired: ${expiredNames.slice(0, 4).join(", ")}. Re-export from a fresh sign-in.`);
    } else if (sessionNames.some((name) => name.toUpperCase() === "SID")) {
      issues.push("SID has no expiry in this export (session cookie). It still works until Google rotates it.");
    }
    return {
      format,
      count: parsed.count,
      httpOnly,
      hasLogin,
      hasSapisid,
      hasSid,
      issues: [...issues, ...empty.issues],
      rows,
      expiredNames,
      sessionNames,
      sidExpiresAt,
    };
  } catch (err) {
    issues.push(err instanceof Error ? err.message : "Could not parse.");
    return { ...empty, issues };
  }
}

/** Google issues SID; Velo never mints one. */
export const SID_EXPLAIN =
  "SID is minted by Google at sign-in. It holds an encrypted, signed record of your account id and last login, paired with HttpOnly HSID so XSS can’t steal the pair. Nobody can generate a valid SID locally — export it from a browser that is already signed in.";

export const COOKIE_TTL_EXPLAIN =
  "SID, HSID, SSID, and SAPISID last about 2 years. PREF is ~8 months from last use. LOGIN_INFO is YouTube’s own login blob and is rotated while youtube.com stays open — so an unexpired file can still go stale. Re-export if saves start hitting the bot wall.";