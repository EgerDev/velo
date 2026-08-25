// Velo Chrome Extension - YouTube Content Script

(function () {
  "use strict";

  const VELO_BUTTON_CLASS = "velo-yt-action-btn";
  const VELO_SHORTS_CLASS = "velo-shorts-action-btn";
  const VELO_THUMBNAIL_CLASS = "velo-thumb-queue-btn";

  function extractVideoId(url = window.location.href) {
    try {
      const u = new URL(url);
      if (u.searchParams.has("v")) return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
      if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    } catch {
      const match = url.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    }
    return null;
  }

  // 1. Show Toast inside YouTube
  function showToast(message, icon = "⚡") {
    let container = document.getElementById("velo-yt-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "velo-yt-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "velo-yt-toast";
    toast.innerHTML = `<span class="velo-toast-icon">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("velo-toast-fade");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 2. Inject Velo Buttons Under Standard Video Player
  function injectPlayerButtons() {
    const videoId = extractVideoId();
    if (!videoId || window.location.pathname.startsWith("/shorts/")) return;

    // Check if already injected for this exact video
    const existing = document.querySelector(`.${VELO_BUTTON_CLASS}`);
    if (existing && existing.getAttribute("data-video-id") === videoId) return;
    if (existing) existing.remove();

    const targetBar =
      document.querySelector("#top-level-buttons-computed") ||
      document.querySelector("ytd-watch-metadata #actions") ||
      document.querySelector("#menu-container");

    if (!targetBar) return;

    const btnGroup = document.createElement("div");
    btnGroup.className = `${VELO_BUTTON_CLASS} velo-action-group`;
    btnGroup.setAttribute("data-video-id", videoId);

    // 1. Velo Download Button
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "velo-pill-btn velo-primary";
    downloadBtn.innerHTML = `
      <svg class="velo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Velo 1080p</span>
    `;
    downloadBtn.onclick = async () => {
      const { settings } = await chrome.storage.sync.get("settings");
      const serverUrl = settings?.veloServerUrl || "http://127.0.0.1:8080";
      window.open(`${serverUrl}/?v=${videoId}&auto=1`, "_blank");
    };

    // 2. Velo Transcript Button
    const transcriptBtn = document.createElement("button");
    transcriptBtn.className = "velo-pill-btn velo-secondary";
    transcriptBtn.innerHTML = `
      <svg class="velo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      <span>Transcript AI</span>
    `;
    transcriptBtn.onclick = async () => {
      const { settings } = await chrome.storage.sync.get("settings");
      const serverUrl = settings?.veloServerUrl || "http://127.0.0.1:8080";
      window.open(`${serverUrl}/?v=${videoId}&tab=transcript`, "_blank");
    };

    // 3. Velo Queue Button
    const queueBtn = document.createElement("button");
    queueBtn.className = "velo-pill-btn velo-ghost";
    queueBtn.title = "Save to Velo Download Queue";
    queueBtn.innerHTML = `
      <svg class="velo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Queue</span>
    `;
    queueBtn.onclick = async () => {
      const title = document.querySelector("h1.ytd-watch-metadata")?.textContent?.trim() || document.title.replace(" - YouTube", "");
      const author = document.querySelector("#channel-name")?.textContent?.trim() || "";
      await chrome.runtime.sendMessage({
        type: "QUEUE_ADD",
        item: {
          id: videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title,
          author,
          addedAt: Date.now(),
        },
      });
      showToast("Added to Velo Download Queue!", "📑");
    };

    btnGroup.appendChild(downloadBtn);
    btnGroup.appendChild(transcriptBtn);
    btnGroup.appendChild(queueBtn);
    targetBar.appendChild(btnGroup);
  }

  // 3. Inject Floating Button on YouTube Shorts
  function injectShortsButton() {
    if (!window.location.pathname.startsWith("/shorts/")) return;
    const videoId = extractVideoId();
    if (!videoId) return;

    const existing = document.querySelector(`.${VELO_SHORTS_CLASS}`);
    if (existing && existing.getAttribute("data-shorts-id") === videoId) return;
    if (existing) existing.remove();

    const shortsContainer = document.querySelector("ytd-shorts #actions") || document.body;
    if (!shortsContainer) return;

    const shortsBtn = document.createElement("button");
    shortsBtn.className = `${VELO_SHORTS_CLASS} velo-shorts-floating-btn`;
    shortsBtn.setAttribute("data-shorts-id", videoId);
    shortsBtn.title = "Download Short in 1080p Full HD";
    shortsBtn.innerHTML = `
      <div class="velo-shorts-inner">
        <svg class="velo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        <span>Velo Short</span>
      </div>
    `;
    shortsBtn.onclick = async () => {
      const { settings } = await chrome.storage.sync.get("settings");
      const serverUrl = settings?.veloServerUrl || "http://127.0.0.1:8080";
      window.open(`${serverUrl}/?v=${videoId}&auto=1`, "_blank");
    };

    shortsContainer.appendChild(shortsBtn);
  }

  // 4. Inject Queue Buttons on Video Thumbnails
  function injectThumbnailBadges() {
    const thumbnails = document.querySelectorAll("ytd-thumbnail:not([data-velo-injected])");
    thumbnails.forEach((thumb) => {
      thumb.setAttribute("data-velo-injected", "true");
      const link = thumb.querySelector("a#thumbnail");
      if (!link) return;

      const videoId = extractVideoId(link.href);
      if (!videoId) return;

      const badge = document.createElement("button");
      badge.className = VELO_THUMBNAIL_CLASS;
      badge.title = "Add video to Velo queue";
      badge.innerHTML = `+ Velo`;
      badge.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const currentLink = thumb.querySelector("a#thumbnail");
        const currentId = extractVideoId(currentLink?.href) || videoId;
        const titleElem = thumb.closest("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer")?.querySelector("#video-title");
        const title = titleElem?.textContent?.trim() || `Video ${currentId}`;

        await chrome.runtime.sendMessage({
          type: "QUEUE_ADD",
          item: {
            id: currentId,
            url: `https://www.youtube.com/watch?v=${currentId}`,
            title,
            addedAt: Date.now(),
          },
        });
        showToast("Added to Velo Queue!", "📑");
      };

      thumb.appendChild(badge);
    });
  }

  // 5. Lifecycle Watcher for YouTube SPA Navigations (Debounced for 60fps performance)
  function initObserver() {
    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectPlayerButtons();
        injectShortsButton();
        injectThumbnailBadges();
      }, 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("yt-navigate-finish", () => {
      setTimeout(() => {
        injectPlayerButtons();
        injectShortsButton();
        injectThumbnailBadges();
      }, 500);
    });

    // Initial pass
    setTimeout(() => {
      injectPlayerButtons();
      injectShortsButton();
      injectThumbnailBadges();
    }, 1000);
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initObserver);
  } else {
    initObserver();
  }
})();
