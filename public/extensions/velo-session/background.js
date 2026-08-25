const DOMAINS = [".youtube.com", "youtube.com", ".google.com", "google.com", ".youtube-nocookie.com"];

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

async function extractSession() {
  const bags = await Promise.all(DOMAINS.map((domain) => chrome.cookies.getAll({ domain })));
  const cookies = bags.flat().filter((cookie) => /youtube|google/i.test(cookie.domain || ""));
  if (!cookies.length) {
    throw new Error("No YouTube cookies found. Sign in at youtube.com, then try again.");
  }
  return toNetscape(cookies);
}

function attachCapture(extra) {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const cookie = details.requestHeaders?.find((header) => header.name.toLowerCase() === "cookie");
      if (!cookie?.value) return;
      lastCapture = { url: details.url, header: cookie.value, at: Date.now() };
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
    if (!lastCapture && capturedPairs.size === 0) {
      sendResponse({
        ok: false,
        error: "No YouTube traffic yet. Open youtube.com, play a video, then capture again.",
      });
      return true;
    }
    const header =
      lastCapture?.header ||
      [...capturedPairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const har = buildHar(lastCapture?.url, header);
    sendResponse({
      ok: true,
      har: JSON.stringify(har, null, 2),
      header,
      count: header.split(";").length,
    });
    return true;
  }
  return undefined;
});
