// Velo Chrome Extension - Background Service Worker (Manifest V3)

const DEFAULT_SETTINGS = {
  veloServerUrl: "http://127.0.0.1:8080",
  defaultPreset: "1080p",
  defaultAudioFormat: "mp3",
  autoQueuePlaylists: true,
  notifyOnDownload: true,
};

// 1. Initialize on Install / Startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Velo] Service Worker installed.");
  
  // Set default settings if not present
  const stored = await chrome.storage.sync.get(["settings"]);
  if (!stored.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }

  // Setup Context Menus
  setupContextMenus();

  // Initialize badge count
  updateQueueBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateQueueBadge();
});

// YouTube link forms that can appear anywhere on the web. Used as
// targetUrlPatterns so the menu keys off the *clicked link*, not the host page.
const YT_TARGET_PATTERNS = [
  "*://www.youtube.com/watch*",
  "*://m.youtube.com/watch*",
  "*://music.youtube.com/watch*",
  "*://www.youtube.com/shorts/*",
  "*://m.youtube.com/shorts/*",
  "*://www.youtube.com/embed/*",
  "*://youtu.be/*",
];
// The page itself being a YouTube page — for the background/page-context menu
// that acts on whatever video the tab is currently showing.
const YT_PAGE_PATTERNS = [
  "*://www.youtube.com/*",
  "*://m.youtube.com/*",
  "*://music.youtube.com/*",
];

const VELO_ITEMS = [
  { id: "velo_download_1080p", title: "⚡ Download 1080p Video" },
  { id: "velo_download_audio", title: "🎵 Download Audio (MP3/M4A)" },
  { id: "velo_add_queue", title: "➕ Save to Download Queue" },
  { id: "velo_open_web", title: "🚀 Open in Velo Studio" },
];

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    const handleErr = () => chrome.runtime.lastError;

    // Two parents: one scoped to clicked YouTube links/videos anywhere on the
    // web (targetUrlPatterns), one scoped to the YouTube page you're on
    // (documentUrlPatterns). documentUrlPatterns + targetUrlPatterns on a
    // single item are AND-ed, which is what broke cross-web link support, so
    // they must live on separate menus.
    const parents = [
      { id: "velo_root_link", contexts: ["link", "video"], targetUrlPatterns: YT_TARGET_PATTERNS },
      { id: "velo_root_page", contexts: ["page"], documentUrlPatterns: YT_PAGE_PATTERNS },
    ];

    for (const parent of parents) {
      chrome.contextMenus.create(
        {
          id: parent.id,
          title: "Velo YouTube Tools",
          contexts: parent.contexts,
          ...(parent.targetUrlPatterns ? { targetUrlPatterns: parent.targetUrlPatterns } : {}),
          ...(parent.documentUrlPatterns ? { documentUrlPatterns: parent.documentUrlPatterns } : {}),
        },
        handleErr,
      );
      for (const item of VELO_ITEMS) {
        chrome.contextMenus.create(
          {
            id: `${item.id}::${parent.id}`,
            parentId: parent.id,
            title: item.title,
            contexts: parent.contexts,
          },
          handleErr,
        );
      }
    }
  });
}

// 2. Extract Video ID from arbitrary YouTube URL
function extractVideoId(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("v")) return parsed.searchParams.get("v");
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2]?.split("?")[0] || null;
    if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2]?.split("?")[0] || null;
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("?")[0] || null;
  } catch {
    const match = rawUrl.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }
  return null;
}

// 3. Handle Context Menu Actions
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.linkUrl || info.srcUrl || tab?.url;
  const videoId = extractVideoId(targetUrl);

  if (!videoId) {
    notifyUser("Velo", "Please click on a valid YouTube video or link.");
    return;
  }

  const { settings } = await chrome.storage.sync.get("settings");
  const serverUrl = settings?.veloServerUrl || DEFAULT_SETTINGS.veloServerUrl;
  const fullVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Menu items are registered under two parents, so the id carries a
  // "::<parentId>" suffix — act on the action prefix.
  const action = String(info.menuItemId).split("::")[0];
  switch (action) {
    case "velo_download_1080p":
    case "velo_download_audio":
    case "velo_open_web": {
      // Open Velo Web App with video query
      const tabUrl = `${serverUrl}/?v=${videoId}&auto=1`;
      chrome.tabs.create({ url: tabUrl });
      break;
    }

    case "velo_add_queue": {
      await addToQueue({
        id: videoId,
        url: fullVideoUrl,
        title: tab?.title?.replace(" - YouTube", "") || `Video ${videoId}`,
        addedAt: Date.now(),
      });
      notifyUser("Velo Queue", `Added video to download queue.`);
      break;
    }
  }
});

// 4. Queue Management Helpers
let queueLock = Promise.resolve();

// Serializes a queue mutation behind `queueLock`. The lock itself must always
// settle fulfilled: if a failed op (storage quota, transient IO) left it
// rejected, every later mutation would chain off that rejection and silently
// no-op for the rest of the service-worker lifetime. So the op's own outcome —
// rejection included, which the message handlers below turn into {ok:false} —
// is returned to the caller, while the lock advances through handlers that
// swallow it.
function withQueueLock(run) {
  // Run whether the previous op fulfilled or rejected, so one failure can't
  // block the ops queued behind it.
  const result = queueLock.then(run, run);
  queueLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getQueue() {
  const data = await chrome.storage.local.get(["velo_queue"]);
  return data.velo_queue || [];
}

async function addToQueue(item) {
  return withQueueLock(async () => {
    const queue = await getQueue();
    const exists = queue.some((i) => i.id === item.id);
    if (!exists) {
      queue.push(item);
      await chrome.storage.local.set({ velo_queue: queue });
      await updateQueueBadge();
    }
    return queue;
  });
}

// Every queue mutation goes through `queueLock`. The popup dispatches QUEUE_ADD
// and QUEUE_REMOVE independently, so an unserialized read-modify-write here
// loses the removal to a concurrent add holding a stale array.
async function removeFromQueue(id) {
  return withQueueLock(async () => {
    const queue = (await getQueue()).filter((i) => i.id !== id);
    await chrome.storage.local.set({ velo_queue: queue });
    await updateQueueBadge();
    return queue;
  });
}

async function clearQueue() {
  return withQueueLock(async () => {
    await chrome.storage.local.set({ velo_queue: [] });
    await updateQueueBadge();
    return [];
  });
}

async function updateQueueBadge() {
  const queue = await getQueue();
  const count = queue.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#f43f5e" }); // Accent red/rose
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// 5. YouTube Cookie Extraction Helper
async function getYouTubeSessionCookies() {
  try {
    const cookieNames = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "SIDCC", "LOGIN_INFO", "SSID", "HSID", "SID"];
    const cookies = await chrome.cookies.getAll({ domain: ".youtube.com" });
    const session = {};
    for (const c of cookies) {
      if (cookieNames.includes(c.name)) {
        session[c.name] = c.value;
      }
    }
    return {
      cookieHeader: Object.entries(session)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      hasLogin: Boolean(session["SAPISID"] || session["LOGIN_INFO"]),
    };
  } catch (err) {
    console.error("[Velo] Failed to extract cookies:", err);
    return { cookieHeader: "", hasLogin: false };
  }
}

// 6. Message Listener from Content Scripts and Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "QUEUE_ADD") {
    addToQueue(request.item)
      .then((queue) => sendResponse({ ok: true, queue }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === "QUEUE_GET") {
    getQueue()
      .then((queue) => sendResponse({ ok: true, queue }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === "QUEUE_REMOVE") {
    removeFromQueue(request.id)
      .then((queue) => sendResponse({ ok: true, queue }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === "QUEUE_CLEAR") {
    clearQueue()
      .then(() => sendResponse({ ok: true, queue: [] }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.type === "GET_SESSION_COOKIES") {
    getYouTubeSessionCookies()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ cookieHeader: "", hasLogin: false, error: err.message }));
    return true;
  }

  if (request.type === "NOTIFY") {
    notifyUser(request.title, request.message);
    sendResponse({ ok: true });
    return true;
  }
});

function notifyUser(title, message) {
  // Try notification or fallback to console
  console.log(`[Velo Notification] ${title}: ${message}`);
}
