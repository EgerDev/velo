/**
 * yt-dlp YouTube auth. Password / netrc / -u -p are rejected by the YouTube
 * extractor ("Login with password is not supported"). The working set is:
 *
 * 1. --cookies Netscape file (what Velo imports)
 * 2. visitor_data from VISITOR_INFO1_LIVE
 * 3. po_token stamped per player client (gvs + player)
 * 4. account cookies unlock web_embedded / web / mweb / web_safari (not android/ios)
 * 5. --cookies-from-browser only if YTDLP_BROWSER is set
 * 6. --proxy SOCKS5 for guest same-hop when this host's IP is 403
 */
import { parseCookieImport } from "./cookies.ts";
import { THROTTLE_FLAGS } from "./throttle.ts";

const SESSION_NAMES = /^(SID|HSID|SSID|SAPISID|LOGIN_INFO|__SECURE-1PSID|__SECURE-3PSID)$/i;

export const GUEST_CLIENTS = ["visionos", "web_embedded", "tv_simply", "android"] as const;
/** Cookie-capable InnerTube clients only. android/ios/visionos/tv_simply set SUPPORTS_COOKIES=False and are skipped when --cookies is set. */
export const SESSION_CLIENTS = [
  "web_embedded",
  "tv_downgraded",
  "web",
  "mweb",
  "web_safari",
] as const;
/** Proved 24 Aug 2026 via SOCKS: web_embedded has mux 18 without POT and 1080p dash with POT; tv_simply has mux 18; android is SABR-only without POT. */
export const SOCKS_CLIENTS = ["web_embedded", "tv_simply", "web_safari", "android"] as const;

export function socksClientsForItag(itag: number): readonly string[] {
  if (itag === 18 || itag === 22) return ["web_embedded", "tv_simply", "android"];
  if (itag >= 91 && itag <= 96) return ["web_embedded", "tv_simply"];
  if (itag === 137 || itag === 299 || itag === 135 || itag === 136) return ["web_embedded"];
  return ["web_embedded", "tv_simply", "android"];
}

/**
 * yt-dlp #17461 + live sweep 24 Aug 2026 (SOCKS, Me at the zoo):
 * android_vr 1.43–1.65 → bot wall; 1.66.0–1.81.0 extract itag 18 then GVS 403
 * (empty body) even with cold-start POT / cver / matching UA. web_embedded
 * returns ftyp on the same hop. There is no working android_vr version today.
 */
export function resolvePlayerClient(client: string): string {
  const parts = client
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const mapped = parts.map((id) => (id === "android_vr" ? "web_embedded" : id));
  return [...new Set(mapped)].join(",") || "web_embedded";
}

/** itag 137 (and 299/136/…) are video-only dash. Pair AAC, then HLS 1080, then 360. */
const VIDEO_ONLY = new Set([
  133, 134, 135, 136, 137, 160, 242, 243, 244, 247, 248, 264, 266, 271, 272, 278, 298, 299, 302,
  303, 308, 313, 336, 394, 395, 396, 397, 398, 399, 400, 401, 571, 598,
]);

/**
 * What actually works on this host (proved over SOCKS): 1080p H.264 + AAC,
 * then H.264 + Opus (mkv), then HLS stitch, then muxed 720/360. Skip 1080p60
 * / AV1 / VP9 on the automatic hop — they stall, throttle, or fail mux more often.
 * Do not fall through to muxed 720/360 here: Save would label 360p as Full HD.
 * Muxed 22/18 is offered as a user-confirmed fallback prompt after this selector
 * fails (pickMuxedFallback in routes/index.tsx), never substituted silently.
 */
export const WORKING_1080_SELECTOR = "137+140/137+251/96";
export const BEST_1080_SELECTOR = WORKING_1080_SELECTOR;
const ITAG_1080 = new Set([137, 299, 248, 399, 303, 96]);

export function isAudioItag(itag: number): boolean {
  return (
    itag === 140 ||
    itag === 139 ||
    itag === 141 ||
    itag === 171 ||
    itag === 172 ||
    itag === 249 ||
    itag === 250 ||
    itag === 251 ||
    itag === 252 ||
    itag === 256 ||
    itag === 258 ||
    itag === 233 ||
    itag === 234
  );
}

export function isVideoOnlyItag(itag: number): boolean {
  return VIDEO_ONLY.has(itag);
}

export function ytdlpRunTimeoutMs(opts: {
  itag: number;
  proxy?: string;
  cookiePath?: string;
}): number {
  if (opts.proxy || opts.cookiePath || isVideoOnlyItag(opts.itag) || opts.itag === 96)
    return 180_000;
  return 45_000;
}

export function ytdlpFormatSelector(itag: number): string {
  if (itag === 18 || itag === 22) return String(itag);
  if (isAudioItag(itag)) return String(itag);
  if (ITAG_1080.has(itag)) {
    if (itag === 137 || itag === 96 || itag === 299) return WORKING_1080_SELECTOR;
    return `${itag}+140/${WORKING_1080_SELECTOR}`;
  }
  if (itag >= 91 && itag <= 95) return `${itag}/95`;
  if (VIDEO_ONLY.has(itag)) return `${itag}+140/${itag}+251/96`;
  return String(itag);
}

export type CookieSession = {
  header: string;
  netscape: string;
  visitorData: string | null;
  dataSyncId: string | null;
  loggedIn: boolean;
};

export function readCookieSession(raw: string | undefined): CookieSession | null {
  if (!raw?.trim()) return null;
  const parsed = parseCookieImport(raw);
  const fields = new Map<string, string>();
  for (const part of parsed.header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    fields.set(part.slice(0, idx).trim().toUpperCase(), part.slice(idx + 1).trim());
  }
  const visitor = fields.get("VISITOR_INFO1_LIVE") ?? null;
  const dataSyncId = fields.get("DATASYNC_ID") ?? fields.get("DELEGATED_SESSION_ID") ?? null;
  const loggedIn = [...fields.keys()].some((name) => SESSION_NAMES.test(name));
  return {
    header: parsed.header,
    netscape: parsed.netscape,
    visitorData: visitor,
    dataSyncId,
    loggedIn,
  };
}

/**
 * InnerTube user agents from yt-dlp 2026.08.19 (`INNERTUBE_CLIENTS`).
 * Do NOT pass these as `--user-agent` / `--add-headers User-Agent:` — that
 * overrides every request and makes android look like Chrome (403 / sign-in).
 * yt-dlp already sets `http_headers.User-Agent` from the chosen player_client.
 */
export const CLIENT_USER_AGENTS: Record<string, string> = {
  android: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
  android_vr:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  ios: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  mweb: "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)",
  web_safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
  tv: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
  tv_downgraded: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
  visionos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
};

export function userAgentForClient(client: string): string | undefined {
  const id = client.split(",")[0]?.trim();
  return id ? CLIENT_USER_AGENTS[id] : undefined;
}

/** Global UA flags. Always empty — InnerTube owns the header per client. */
export function ytdlpUserAgentArgs(_client: string): string[] {
  return [];
}

/**
 * `--user-agent` / `--referer` / `--add-header` (singular) / `--dump-user-agent`
 * are suppressed in yt-dlp 2026.08. Use `--add-headers Field:value` instead,
 * and never for User-Agent (clobbers player_client).
 */
export const YTDLP_DEPRECATED_HEADERS = [
  "--user-agent",
  "--referer",
  "--add-header",
  "--dump-user-agent",
] as const;

export function ytdlpHeaderArgs(): string[] {
  return ["--add-headers", "Accept-Language:en-US,en;q=0.9"];
}

/** TLS fingerprint via curl_cffi. Never on android/ios — that would replace their app UA with Chrome. */
export function ytdlpImpersonateArgs(client: string): string[] {
  const id = resolvePlayerClient(client).split(",")[0]?.trim() ?? "";
  if (id === "web_safari" || id === "mweb") return ["--impersonate", "safari"];
  if (id === "web" || id === "web_embedded" || id.startsWith("tv"))
    return ["--impersonate", "chrome"];
  return [];
}

export const YTDLP_CLIENT_EXTRACT = [
  {
    client: "web_embedded",
    formats: "DASH 137/248 + mux 18; 1080p with POT",
    cookies: true,
    impersonate: "chrome",
  },
  { client: "tv_simply", formats: "muxed 18 (guest, no cookies)", cookies: false, impersonate: "" },
  {
    client: "web_safari",
    formats: "HLS 96 muxed 1080p (logged-in only since 2026.07)",
    cookies: true,
    impersonate: "safari",
  },
  {
    client: "android",
    formats: "muxed 18/22; SABR-only without POT",
    cookies: false,
    impersonate: "",
  },
  { client: "mweb", formats: "ultralow + HLS", cookies: true, impersonate: "safari" },
  { client: "web", formats: "WEB dash (needs POT)", cookies: true, impersonate: "chrome" },
  {
    client: "tv_downgraded",
    formats: "TVHTML5 authed default",
    cookies: true,
    impersonate: "chrome",
  },
  {
    client: "visionos",
    formats: "dash ≤240p guest, no mux, no cookies",
    cookies: false,
    impersonate: "",
  },
] as const;

/** All yt-dlp 2026.08.19 InnerTube clients (INNERTUBE_CLIENTS). android_vr is 403 since 2026.08.17. */
export const YTDLP_PLAYER_CLIENTS = [
  {
    id: "web_embedded",
    innertube: "WEB_EMBEDDED_PLAYER",
    cookies: true,
    js: true,
    pot: "optional",
    note: "Guest mux 18; 1080p dash with video-bound GVS POT",
  },
  {
    id: "web",
    innertube: "WEB",
    cookies: true,
    js: true,
    pot: "gvs required",
    note: "Default with JS; empty without POT on this host",
  },
  {
    id: "web_safari",
    innertube: "WEB + Safari UA",
    cookies: true,
    js: true,
    pot: "gvs required",
    note: "HLS 91–96; logged-out returns no formats since 2026.07",
  },
  {
    id: "mweb",
    innertube: "MWEB",
    cookies: true,
    js: true,
    pot: "gvs required",
    note: "iPad UA; ultralow",
  },
  {
    id: "web_music",
    innertube: "WEB_REMIX",
    cookies: true,
    js: true,
    pot: "gvs required",
    note: "music.youtube.com only",
  },
  {
    id: "web_creator",
    innertube: "WEB_CREATOR",
    cookies: true,
    js: true,
    pot: "gvs required",
    note: "REQUIRE_AUTH; premium age-gate",
  },
  {
    id: "android",
    innertube: "ANDROID 21.26.364",
    cookies: false,
    js: false,
    pot: "gvs required",
    note: "SABR-only without POT (issue 12482)",
  },
  {
    id: "android_vr",
    innertube: "ANDROID_VR 1.65.10",
    cookies: false,
    js: false,
    pot: "alias",
    note: "Swept 1.43–1.81 on 24 Aug 2026: <1.66 LOGIN_REQUIRED; 1.66–1.81 extract 18 then empty GVS 403. Alias → web_embedded (ftyp OK)",
  },
  {
    id: "ios",
    innertube: "IOS 21.26.4",
    cookies: false,
    js: false,
    pot: "gvs required",
    note: "HLS live; empty VOD without POT here",
  },
  {
    id: "visionos",
    innertube: "VISIONOS",
    cookies: false,
    js: false,
    pot: "optional",
    note: "yt-dlp guest default; dash ≤240p, no mux",
  },
  {
    id: "tv",
    innertube: "TVHTML5 Cobalt",
    cookies: true,
    js: true,
    pot: "optional",
    note: "Often 'page needs to be reloaded'",
  },
  {
    id: "tv_downgraded",
    innertube: "TVHTML5 5.x",
    cookies: true,
    js: true,
    pot: "optional",
    note: "Logged-in default with web_embedded",
  },
  {
    id: "tv_simply",
    innertube: "TVHTML5_SIMPLY",
    cookies: false,
    js: true,
    pot: "gvs recommended",
    note: "Guest mux 18 without cookies",
  },
] as const;

/**
 * APIs besides yt-dlp player_client. Probed 24 Aug 2026 on this host:
 * Invidious/Piped public instances 403/disabled; Cobalt needs hostname-bound Turnstile;
 * Data API v3 has no streams. youtubei.js clients below are not in yt-dlp.
 */
export const YOUTUBE_ALT_APIS = [
  {
    id: "tv_embedded",
    via: "youtubei.js",
    innertube: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    note: "Embed TV; already in Innertube metadata loop",
  },
  {
    id: "android_music",
    via: "youtubei.js",
    innertube: "ANDROID_MUSIC 7.x",
    note: "Raw player POST LOGIN_REQUIRED; still tried with session POT",
  },
  {
    id: "android_creator",
    via: "youtubei.js",
    innertube: "ANDROID_CREATOR",
    note: "YouTube Studio Android; session POT",
  },
  {
    id: "web_kids",
    via: "youtubei.js",
    innertube: "WEB_KIDS",
    note: "Made-for-kids titles; 'reload' on zoo",
  },
  {
    id: "ios",
    via: "youtubei.js",
    innertube: "IOS",
    note: "play=OK but SABR (0 URLs) without POT",
  },
  {
    id: "invidious",
    via: "public API",
    innertube: "—",
    note: "yewtu.be 403, nadeko endpoint disabled, fdn NXDOMAIN",
  },
  { id: "piped", via: "public API", innertube: "—", note: "kavin 502, adminforge timeout" },
  {
    id: "cobalt",
    via: "cobalt.tools",
    innertube: "—",
    note: "Turnstile is hostname-bound; cannot mint from this origin",
  },
  {
    id: "data_api_v3",
    via: "googleapis",
    innertube: "—",
    note: "Metadata only — no googlevideo URLs",
  },
] as const;

export function ytdlpClients(loggedIn: boolean): readonly string[] {
  return loggedIn ? SESSION_CLIENTS : GUEST_CLIENTS;
}

/** InnerTube clients that accept WebPO (yt_dlp.extractor.youtube.pot.utils.WEBPO_CLIENTS). */
const WEBPO_CLIENTS = new Set([
  "web",
  "web_safari",
  "web_embedded",
  "web_music",
  "web_creator",
  "mweb",
  "tv",
  "tv_downgraded",
  "tv_simply",
]);

export function poTokenArgs(client: string, pot?: string, playerPot?: string): string {
  const gvs = (pot || "").replace(/[^A-Za-z0-9_-]/g, "");
  const player = (playerPot || pot || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!gvs && !player) return "";
  const id = resolvePlayerClient(client).split(",")[0] || "web_embedded";
  if (!WEBPO_CLIENTS.has(id)) return "";
  const parts: string[] = [];
  if (gvs) parts.push(`${id}.gvs+${gvs}`);
  if (player) parts.push(`${id}.player+${player}`);
  return `po_token=${parts.join(",")}`;
}

/**
 * youtube extractor-args (yt-dlp 2026.08.19 `_video.py` / `_base.py`).
 * player_client, po_token=CLIENT.CONTEXT+TOKEN (gvs|player|subs),
 * visitor_data (only without cookies), data_sync_id (logged-in GVS),
 * player_js_variant, fetch_pot.
 * fetch_pot=never only when we already stamped a video-id POT.
 */
export function extractorArgs(
  client: string,
  pot?: string,
  visitor?: string | null,
  playerPot?: string,
  dataSyncId?: string | null,
): string {
  const resolved = resolvePlayerClient(client);
  const parts = [`youtube:player_client=${resolved}`, "player_js_variant=main"];
  if (visitor) parts.push(`visitor_data=${visitor.replace(/[^A-Za-z0-9_=%-]/g, "")}`);
  if (dataSyncId) parts.push(`data_sync_id=${dataSyncId.replace(/[^A-Za-z0-9_|=%-]/g, "")}`);
  const po = poTokenArgs(resolved, pot, playerPot);
  if (po) {
    parts.push("fetch_pot=never");
    parts.push(po);
  }
  return parts.join(";");
}

/** How Velo mints PO tokens (bgutils-js BotGuard, not yt-dlp's empty POT providers). */
export const PO_TOKEN_STEPS = [
  { step: "1 homepage", detail: "Fetch youtube.com, parse ytcfg + ytAtN BotGuard challenge" },
  { step: "2 VM", detail: "Run BotGuard interpreter in jsdom, snapshot webPoSignalOutput" },
  { step: "3 GenerateIT", detail: "POST integrity token (request key O43z0dpjhgX20SCx4KAo)" },
  { step: "4 mint", detail: "WebPoMinter binds the token to the video id (player + GVS)" },
  { step: "5 stamp", detail: "yt-dlp youtube:po_token=web_embedded.gvs+X,web_embedded.player+X" },
  {
    step: "fallback",
    detail:
      "Cold-start token if BotGuard walls; fetch_pot=never only when a token is already stamped",
  },
] as const;

export function browserCookieArgs(): string[] {
  const browser = process.env.YTDLP_BROWSER?.trim().toLowerCase();
  if (!browser) return [];
  if (!/^(chrome|chromium|edge|brave|firefox|opera|safari|vivaldi|whale)$/.test(browser)) return [];
  return ["--cookies-from-browser", browser];
}

function proxyArg(raw: string): string {
  return raw.replace(/^socks5:\/\//i, "socks5h://").replace(/^socks:\/\//i, "socks5h://");
}

/**
 * `--force-ipv4` sets source_address=0.0.0.0 (yt-dlp options.py). Direct hops
 * need it so player + CDN share IPv4. SOCKS hops must NOT force family — the
 * proxy owns the YouTube-side address (ip=); forcing 0.0.0.0 breaks IPv6-only
 * proxies and can desync curl_cffi CONNECT.
 */
export function ytdlpFamilyArgs(proxy?: string): string[] {
  return proxy ? [] : ["--force-ipv4"];
}

export function ytdlpArgv(opts: {
  dir: string;
  id: string;
  itag: number;
  client: string;
  cookiePath?: string;
  pot?: string;
  playerPot?: string;
  visitorData?: string | null;
  dataSyncId?: string | null;
  proxy?: string;
  impersonate?: boolean;
}): string[] {
  const client = resolvePlayerClient(opts.client);
  const args = [
    "-m",
    "yt_dlp",
    "--no-js-runtimes",
    "--js-runtimes",
    "node",
    ...ytdlpFamilyArgs(opts.proxy),
  ];
  if (opts.proxy) args.push("--proxy", proxyArg(opts.proxy));
  const id = client.split(",")[0] ?? "";
  const cookiesOk = !/^(android|ios|visionos|tv_simply)$/.test(id);
  const hasFileCookies = Boolean(opts.cookiePath && cookiesOk);
  const browser = hasFileCookies ? [] : browserCookieArgs();
  const hasCookies = hasFileCookies || browser.length > 0;
  if (hasFileCookies) args.push("--cookies", opts.cookiePath!);
  else args.push(...browser);
  args.push(...ytdlpUserAgentArgs(client));
  args.push(...ytdlpHeaderArgs());
  if (opts.impersonate) args.push(...ytdlpImpersonateArgs(client));
  args.push(
    "--remote-components",
    "ejs:github",
    "--extractor-args",
    extractorArgs(
      client,
      opts.pot,
      hasCookies ? null : opts.visitorData,
      opts.playerPot,
      hasCookies ? (opts.dataSyncId ?? null) : null,
    ),
    "--no-playlist",
    "--newline",
    "--check-formats",
    ...THROTTLE_FLAGS,
    "--merge-output-format",
    "mp4/mkv",
    "-f",
    ytdlpFormatSelector(opts.itag),
    "-o",
    `${opts.dir}/media.%(ext)s`,
    `https://www.youtube.com/watch?v=${opts.id}`,
  );
  return args;
}

/** yt-dlp 2026.08.19 YouTube extractor layout (package `yt_dlp.extractor.youtube`). */
export const YTDLP_EXTRACTOR_LAYERS = [
  { layer: "match", file: "_video.py YoutubeIE", does: "11-char id, youtu.be, embed, shorts" },
  {
    layer: "webpage",
    file: "_video.py _WEBPAGE_CLIENTS",
    does: "web / web_safari watch HTML + ytcfg",
  },
  {
    layer: "innertube",
    file: "_base.py INNERTUBE_CLIENTS",
    does: "player API JSON per player_client",
  },
  { layer: "jsc", file: "jsc/_director.py", does: "nsig + sig via node ejs challenge solver" },
  {
    layer: "pot",
    file: "pot/_director.py",
    does: "gvs + player PO tokens (we mint, yt-dlp has none built-in)",
  },
  {
    layer: "formats",
    file: "_video.py streamingData",
    does: "itag list; SABR rows have no URL until POT",
  },
  {
    layer: "download",
    file: "networking urllib+curl_cffi",
    does: "googlevideo; impersonate only on web clients",
  },
] as const;

/**
 * Every youtube extractor-arg in yt-dlp 2026.08.19. `use` is what Velo does.
 * Unknown args are ignored by yt-dlp; passing the wrong one (missing_pot,
 * use_ad_playback_context=true, visitor_data+cookies) still breaks 1080p.
 */
export const YTDLP_EXTRACTOR_ARGS = [
  { arg: "player_client", use: "always", note: "web_embedded first; android_vr aliases to it" },
  {
    arg: "po_token",
    use: "when minted",
    note: "CLIENT.gvs+X,CLIENT.player+X — video-id bind (GVS experiment)",
  },
  { arg: "visitor_data", use: "guest only", note: "never with --cookies / --cookies-from-browser" },
  {
    arg: "data_sync_id",
    use: "logged-in if present",
    note: "GVS account bind; DATASYNC_ID from the dump",
  },
  {
    arg: "player_js_variant",
    use: "main",
    note: "stable player.js; pinning player_js_version breaks nsig",
  },
  {
    arg: "fetch_pot",
    use: "never iff stamped",
    note: "omit (auto) when we have no token so yt-dlp can still fetch",
  },
  { arg: "use_ad_playback_context", use: "omit", note: "true is the IMA/DAI ad player — never" },
  { arg: "formats", use: "omit missing_pot", note: "would list SABR rows with no URL as 1080p" },
  { arg: "player_skip", use: "omit", note: "need js + configs for nsig" },
  { arg: "skip", use: "omit", note: "need dash + hls" },
  { arg: "webpage_client", use: "omit", note: "default web watch HTML is fine" },
  { arg: "player_js_version", use: "omit", note: "pinning a hash breaks nsig after a player roll" },
  { arg: "player_params", use: "omit", note: "InnerTube default pp is already in the client" },
  { arg: "innertube_host", use: "omit", note: "www.youtube.com; music host is web_music only" },
  { arg: "raise_incomplete_data", use: "omit", note: "would abort on missing likeCount" },
] as const;

/** Official yt-dlp 2026.08.19 process codes (`yt_dlp/__init__.py` main / _exit). */
export const YTDLP_EXIT = {
  ok: 0,
  error: 1,
  cli: 2,
  update: 100,
  cancelled: 101,
  sighup: 129,
  sigint: 130,
  sigquit: 131,
  sigabrt: 134,
  sigkill: 137,
  sigterm: 143,
} as const;

export const YTDLP_SIGNAL_EXIT: Record<string, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGABRT: 134,
  SIGKILL: 137,
  SIGTERM: 143,
};

export function ytdlpExitFromClose(code: number | null, signal: string | null | undefined): number {
  if (typeof code === "number") return code;
  if (signal && YTDLP_SIGNAL_EXIT[signal] != null) return YTDLP_SIGNAL_EXIT[signal]!;
  return YTDLP_EXIT.error;
}

export type YtdlpExtractLog = {
  clients: string[];
  jsRuntime: string | null;
  curlCffi: boolean;
  potProviders: string | null;
  sabr: boolean;
  selectedFormats: string | null;
  nsig: boolean;
  playerJs: string | null;
  ipv6Mismatch: boolean;
  gvsVideoBound: boolean;
};

export function looksLikeIpv6Mismatch(text: string): boolean {
  return (
    /ip=fda3/i.test(text) ||
    /ip=%5[bB]/i.test(text) ||
    /ip=[0-9a-f]{1,4}:[0-9a-f:]+/i.test(text) ||
    /Cannot assign requested address/i.test(text) ||
    /Address family not supported/i.test(text) ||
    (/Network is unreachable/i.test(text) && /:[0-9a-f]{0,4}:/.test(text)) ||
    /Failed to establish.*\[::/i.test(text)
  );
}

export function parseYtdlpLog(text: string): YtdlpExtractLog {
  const clients = [...text.matchAll(/Downloading ([a-z][a-z0-9_ ]*) player API JSON/gi)].map(
    (row) => row[1]!.replace(/\s+/g, "_").toLowerCase(),
  );
  const js = text.match(/JS runtimes:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const pot = text.match(/PO Token Providers:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const selected = text.match(/Downloading \d+ format\(s\):\s*([0-9+/, ]+)/i)?.[1]?.trim() ?? null;
  const playerJs = text.match(/Downloading player ([0-9a-f]+)/i)?.[1] ?? null;
  return {
    clients: [...new Set(clients)],
    jsRuntime: js,
    curlCffi: /curl_cffi/i.test(text),
    potProviders: pot,
    sabr: /SABR-only streaming experiment/i.test(text),
    selectedFormats: selected,
    nsig: /Solving JS challenges/i.test(text) || /jsc:node/i.test(text),
    playerJs,
    ipv6Mismatch: looksLikeIpv6Mismatch(text),
    gvsVideoBound: /bind GVS PO Token to video ID/i.test(text),
  };
}

export type YtdlpFailureKind =
  | "ok"
  | "cli"
  | "update"
  | "cancelled"
  | "timeout"
  | "killed"
  | "forbidden"
  | "sabr"
  | "nsig"
  | "ipv6"
  | "private"
  | "geo"
  | "age"
  | "formats"
  | "ffmpeg"
  | "network"
  | "pot"
  | "signin"
  | "download";

export type YtdlpNext = "retry" | "next-client" | "next-socks" | "stop";

export type YtdlpFailure = {
  kind: YtdlpFailureKind;
  code: number;
  retryable: boolean;
  nextHop: boolean;
  nextClient: boolean;
  next: YtdlpNext;
  hint: string;
  errorLine: string;
};

export type YtdlpExitInput = {
  code: number | null;
  stderr?: string;
  signal?: string | null;
  timedOut?: boolean;
};

function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  const errors = lines.filter(
    (row) =>
      /^ERROR:/i.test(row) || /\[download\] Got error:/i.test(row) || /^Postprocessing:/i.test(row),
  );
  // Redact the FULL proxy authority — userinfo, host and port — keeping only
  // the scheme. This string reaches an unauthenticated caller as the
  // /api/ytdlp 502 body, and a dead SOCKS hop puts the whole
  // `user:pass@host:port` into yt-dlp's stderr verbatim; the internal hop
  // address is as sensitive as the credentials. `[^\s/]` stops at the first
  // slash, so an https path (e.g. a watch URL's video id) stays readable —
  // only the authority is masked.
  return (errors.at(-1) ?? lines.at(-1) ?? stderr.trim())
    .replace(/^ERROR:\s*/i, "")
    .replace(/\b(socks[45]?[ah]?|https?):\/\/[^\s/]+/gi, "$1://***");
}

/**
 * Map yt-dlp process status + stderr to a retry plan.
 * Official codes (2026.08.19): 0 ok · 1 DownloadError · 2 CLI · 100 updater · 101 cancelled.
 * 128+N is the kernel (137 SIGKILL = our timeout killTree), not YouTube.
 * Signal/timeout beat leftover 403/SABR on stderr.
 */
export function classifyYtdlpFailure(input: YtdlpExitInput): YtdlpFailure {
  const stderr = input.stderr ?? "";
  const log = parseYtdlpLog(stderr);
  const line = lastErrorLine(stderr);
  const code = ytdlpExitFromClose(input.code, input.signal);
  const blob = `${line}\n${stderr}`.toLowerCase();

  const fail = (kind: YtdlpFailureKind, next: YtdlpNext, hint: string): YtdlpFailure => ({
    kind,
    code,
    retryable: next === "retry",
    nextHop: next === "next-socks",
    nextClient: next === "next-client",
    next,
    hint,
    errorLine: line.slice(0, 220),
  });

  if (input.timedOut || /yt-dlp timed out/i.test(stderr)) {
    return fail("timeout", "next-socks", "timed out — next matching hop");
  }
  if (input.signal === "SIGKILL" || code === YTDLP_EXIT.sigkill) {
    return fail("killed", "next-socks", "process killed — next hop (not a CDN 403)");
  }
  if (input.signal === "SIGTERM" || code === YTDLP_EXIT.sigterm) {
    return fail("killed", "retry", "process stopped — retry");
  }
  if (code === YTDLP_EXIT.ok) return fail("ok", "stop", "ok");
  if (code === YTDLP_EXIT.cli)
    return fail("cli", "stop", `yt-dlp options were rejected: ${line || "exit 2"}`);
  if (code === YTDLP_EXIT.update) return fail("update", "stop", "yt-dlp self-update failed");
  if (code === YTDLP_EXIT.cancelled || code === YTDLP_EXIT.sigint) {
    return fail("cancelled", "stop", "download cancelled");
  }

  if (log.ipv6Mismatch || looksLikeIpv6Mismatch(stderr)) {
    return fail(
      "ipv6",
      "next-socks",
      "IPv6/IPv4 mismatch — YouTube signed a different family than the file hop.",
    );
  }
  if (/unable to connect|unsupported url scheme/i.test(blob) && /proxy|socks|scheme/i.test(blob)) {
    return fail("network", "next-socks", "proxy hop is dead");
  }
  if (/ffmpeg is not installed|ffmpeg not found|ffprobe not found/i.test(blob)) {
    return fail("ffmpeg", "stop", "ffmpeg missing — cannot merge 137+140");
  }
  if (/not available from your location|geo restriction|geo.restricted/i.test(blob)) {
    return fail("geo", "next-socks", "geo-blocked on this hop");
  }
  if (/private video|members.only|this video is available to this channel's members/i.test(blob)) {
    return fail("private", "stop", "private or members-only — import cookies");
  }
  if (/age-restricted|confirm your age|age.verification|age.check.required/i.test(blob)) {
    return fail("age", "next-client", "age-gated — try web_embedded or cookies");
  }
  if (/sign in to confirm|not a bot|login_required|use --cookies/i.test(blob)) {
    return fail("signin", "next-client", "bot wall — next client, then cookies");
  }
  if (log.sabr || /sabr-only|forcing sabr streaming|issues\/12482/i.test(blob)) {
    return fail("sabr", "next-client", "SABR-only — need a video-bound PO token or a muxed client");
  }
  if (/gvs po token|po token which was not provided|missing required visitor data/i.test(blob)) {
    return fail("pot", "next-client", "PO token missing — remint GVS+player, next client");
  }
  if (
    /error solving n challenge|n result is invalid|nsig extraction failed|n-sig extraction/i.test(
      blob,
    )
  ) {
    return fail("nsig", "retry", "nsig failed — retry node ejs, then next client");
  }
  if (/http error 403|unable to download video data:.*403|\b403 forbidden\b/i.test(blob)) {
    return fail("forbidden", "next-socks", "CDN 403 — next matching hop");
  }
  if (/no video formats found|requested format is not available/i.test(blob)) {
    return fail("formats", "next-client", "no playable formats on this client");
  }
  if (
    /timed out|timeout|errno 110|errno 101|network is unreachable|connection refused|connection reset|\b502\b|\b503\b|\b522\b/i.test(
      blob,
    )
  ) {
    return fail("network", "next-socks", line || "network failed — next hop");
  }
  return fail("download", "next-client", line || `yt-dlp exit ${code}`);
}

export function mapYtdlpExit(
  code: number | null,
  stderr: string,
  extra: { signal?: string | null; timedOut?: boolean } = {},
): YtdlpFailure {
  return classifyYtdlpFailure({ code, stderr, ...extra });
}

export function formatYtdlpFailure(client: string, fail: YtdlpFailure): string {
  const picked = fail.errorLine ? ` · ${fail.errorLine}` : "";
  return `${client}: ${fail.kind} · ${fail.hint}${picked}`.replace(/\s+/g, " ").slice(0, 280);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The Python interpreter that runs yt-dlp.
 *
 * A bare `python3` assumes that exact name is on PATH, which is false for a
 * virtualenv, pyenv, a distro that only ships `python`, and most slim container
 * images — so a deploy needs a way to name the interpreter it actually has.
 */
export function pythonBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.VELO_PYTHON?.trim() || env.PYTHON_BIN?.trim() || "python3";
}

/** A spawn that failed because the binary is absent, not because it ran and failed. */
export function isMissingInterpreterError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

export type PythonProbe =
  | { ok: true; version: string }
  | { ok: false; reason: "no-interpreter" | "no-ytdlp" | "broken"; message: string };

/**
 * Read a `<python> -m yt_dlp --version` probe.
 *
 * The distinction that matters is "no interpreter" vs "interpreter but no
 * yt-dlp": they look identical in a stack trace and have completely different
 * fixes, and without this the whole thing surfaced as four repetitions of
 * `spawn python3 ENOENT` after every client had been tried in turn.
 */
export function classifyPythonProbe(input: {
  bin: string;
  spawnError?: unknown;
  code?: number;
  stdout?: string;
  stderr?: string;
}): PythonProbe {
  const { bin, spawnError, code = 0, stdout = "", stderr = "" } = input;
  if (spawnError !== undefined && spawnError !== null) {
    if (isMissingInterpreterError(spawnError)) {
      return {
        ok: false,
        reason: "no-interpreter",
        message: `Python 3 is not available as \`${bin}\`. Install Python 3, or set VELO_PYTHON to the interpreter to use.`,
      };
    }
    return {
      ok: false,
      reason: "broken",
      message: `Could not start \`${bin}\`: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
    };
  }
  if (/no module named ['"]?yt_dlp/i.test(stderr)) {
    return {
      ok: false,
      reason: "no-ytdlp",
      message: `yt-dlp is not installed for \`${bin}\`. Install it with \`${bin} -m pip install -U yt-dlp\`.`,
    };
  }
  const version = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (code !== 0 || !version) {
    return {
      ok: false,
      reason: "broken",
      message:
        `\`${bin} -m yt_dlp --version\` failed (exit ${code}). ${stderr.trim().split("\n").pop() ?? ""}`.trim(),
    };
  }
  return { ok: true, version };
}

/** Copy-paste command matching Save. POT is required for 1080p; without it yt-dlp falls to 18. */
export function ytdlpWorkingCommand(opts: Parameters<typeof ytdlpArgv>[0]): string {
  return [pythonBin(), ...ytdlpArgv(opts).map(shellQuote)].join(" ");
}

/**
 * Proved 24 Aug 2026 on this host (Me at the zoo, SOCKS, yt-dlp 2026.08.19):
 * web_embedded + chrome impersonate extracts; without po_token only itag 18 is playable.
 * android without POT is SABR-only (same 18). 1080p needs dual gvs+player po_token.
 * SOCKS example omits --force-ipv4 — the hop owns the YouTube-side family.
 */
export const YTDLP_WORKING_EXAMPLE =
  "python3 -m yt_dlp --no-js-runtimes --js-runtimes node --proxy socks5h://HOST:PORT --impersonate chrome --add-headers Accept-Language:en-US,en;q=0.9 --extractor-args youtube:player_client=web_embedded --remote-components ejs:github --no-playlist --check-formats --throttled-rate 100K --http-chunk-size 10M --concurrent-fragments 1 --merge-output-format mp4/mkv -f 137+140/137+251/96 https://www.youtube.com/watch?v=jNQXAC9IVRw";
