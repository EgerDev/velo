const DOMAINS = [".youtube.com", "youtube.com", ".youtube-nocookie.com"];
const SESSION_COOKIE_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "SIDCC",
  "LOGIN_INFO",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
]);

let lastCapture = null;
const capturedPairs = new Map();

function toNetscape(cookies) {
  const lines = ["# Netscape HTTP Cookie File", "# Exported by Velo YouTube Session"];
  const header = [];
  const seen = new Set();
  for (const cookie of cookies) {
    const key = `${cookie.domain}:${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = cookie.domain?.startsWith(".") ? cookie.domain : `.${cookie.domain || "youtube.com"}`;
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
    const prefix = cookie.httpOnly ? "#HttpOnly_" : "";
    lines.push(
      `${prefix}${domain}\tTRUE\t${cookie.path || "/"}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}`,
    );
    header.push(`${cookie.name}=${cookie.value}`);
  }
  return { netscape: `${lines.join("\n")}\n`, header: header.join("; "), count: header.length };
}

function parseHeader(header) {
  const pairs = [];
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    pairs.push({ name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() });
  }
  return pairs;
}

function buildHar(url, cookieHeader) {
  return {
    log: {
      version: "1.2",
      creator: { name: "Velo YouTube Session", version: "1.1.0" },
      entries: [
        {
          startedDateTime: new Date().toISOString(),
          request: {
            method: "GET",
            url: url || "https://www.youtube.com/",
            headers: [{ name: "Cookie", value: cookieHeader }],
            cookies: parseHeader(cookieHeader),
          },
        },
      ],
    },
  };
}

function isYoutubeDomain(domain) {
  const host = (domain || "").replace(/^\./, "");
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com";
}

async function extractSession() {
  const bags = await Promise.all(DOMAINS.map((domain) => chrome.cookies.getAll({ domain })));
  const cookies = bags.flat().filter((cookie) => {
    if (!SESSION_COOKIE_NAMES.has(cookie.name)) return false;
    return isYoutubeDomain(cookie.domain);
  });
  if (!cookies.length) {
    throw new Error("No YouTube cookies found. Sign in at youtube.com, then try again.");
  }
  return toNetscape(cookies);
}

function rememberCapture(payload) {
  lastCapture = payload;
  try {
    void chrome.storage?.session?.set({ veloLastHar: payload });
  } catch {
    /* session storage optional */
  }
}

async function loadCapture() {
  if (lastCapture) return lastCapture;
  try {
    const stored = await chrome.storage.session.get("veloLastHar");
    if (stored?.veloLastHar?.header) {
      lastCapture = stored.veloLastHar;
      return lastCapture;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function attachCapture(extra) {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const cookie = details.requestHeaders?.find((header) => header.name.toLowerCase() === "cookie");
      if (!cookie?.value) return;
      rememberCapture({ url: details.url, header: cookie.value, at: Date.now() });
      for (const pair of parseHeader(cookie.value)) {
        capturedPairs.set(pair.name, pair.value);
      }
    },
    { urls: ["*://*.youtube.com/*", "*://*.googlevideo.com/*", "*://*.youtube-nocookie.com/*"] },
    extra,
  );
}

try {
  attachCapture(["requestHeaders", "extraHeaders"]);
} catch {
  try {
    attachCapture(["requestHeaders"]);
  } catch {
    /* capture unavailable */
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "extract-session") {
    extractSession()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : "Extract failed." }));
    return true;
  }
  if (message?.type === "capture-har") {
    loadCapture()
      .then((capture) => {
        if (!capture && capturedPairs.size === 0) {
          sendResponse({
            ok: false,
            error: "No YouTube traffic yet. Open youtube.com, play a video, then capture again.",
          });
          return;
        }
        const header =
          capture?.header ||
          [...capturedPairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
        const har = buildHar(capture?.url, header);
        sendResponse({
          ok: true,
          har: JSON.stringify(har, null, 2),
          header,
          count: header.split(";").length,
        });
      })
      .catch(() => sendResponse({ ok: false, error: "Capture failed." }));
    return true;
  }
  return undefined;
});
