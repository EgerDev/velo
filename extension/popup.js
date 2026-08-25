// Velo Chrome Extension - Popup Logic

document.addEventListener("DOMContentLoaded", async () => {
  let activeVideo = null;
  let activeTranscriptCues = [];
  let currentSettings = {
    veloServerUrl: "http://127.0.0.1:8080",
    defaultPreset: "1080p",
  };

  // Load Settings
  const stored = await chrome.storage.sync.get("settings");
  if (stored.settings) currentSettings = { ...currentSettings, ...stored.settings };

  // DOM Elements
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const queueBadge = document.getElementById("tab-queue-badge");

  // Video Tab Elements
  const videoDetected = document.getElementById("video-detected");
  const videoNone = document.getElementById("video-none");
  const videoThumb = document.getElementById("video-thumb");
  const videoTitle = document.getElementById("video-title");
  const videoChannel = document.getElementById("video-channel");
  const videoDuration = document.getElementById("video-duration");
  const btnDl1080p = document.getElementById("btn-dl-1080p");
  const btnDlAudio = document.getElementById("btn-dl-audio");
  const btnAddQueue = document.getElementById("btn-add-queue");
  const btnOpenVelo = document.getElementById("btn-open-velo");
  const manualUrlInput = document.getElementById("manual-url-input");
  const btnManualFetch = document.getElementById("btn-manual-fetch");
  const btnSyncSession = document.getElementById("btn-sync-session");
  const btnOptions = document.getElementById("btn-options");

  // Transcript Tab Elements
  const statWords = document.getElementById("stat-words");
  const statReading = document.getElementById("stat-reading");
  const btnCopyPlain = document.getElementById("btn-copy-plain");
  const btnCopySrt = document.getElementById("btn-copy-srt");
  const btnExportVtt = document.getElementById("btn-export-vtt");
  const transcriptSearch = document.getElementById("transcript-search");
  const transcriptCuesList = document.getElementById("transcript-cues-list");
  const aiPromptBtns = document.querySelectorAll(".ai-prompt-btn");

  // Queue Tab Elements
  const queueCountLabel = document.getElementById("queue-count-label");
  const queueItemsList = document.getElementById("queue-items-list");
  const btnDownloadQueue = document.getElementById("btn-download-queue");
  const btnClearQueue = document.getElementById("btn-clear-queue");

  // 1. Tab Switching
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.getElementById(`tab-content-${tabId}`)?.classList.add("active");

      if (tabId === "queue") loadQueueUI();
      if (tabId === "transcript" && activeVideo && !activeTranscriptCues.length) {
        loadTranscripts(activeVideo.id);
      }
    });
  });

  // Settings & Sync buttons
  btnOptions?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  btnSyncSession?.addEventListener("click", syncSessionWithVelo);

  // 2. Detect Active YouTube Video
  async function detectActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showEmptyState();
      return;
    }

    const videoId = extractVideoId(tab.url);
    if (!videoId) {
      showEmptyState();
      return;
    }

    const title = tab.title ? tab.title.replace(" - YouTube", "") : `Video ${videoId}`;
    activeVideo = {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      author: "YouTube Creator",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };

    renderActiveVideo(activeVideo);
  }

  function renderActiveVideo(video) {
    videoNone.style.display = "none";
    videoDetected.style.display = "block";
    videoThumb.src = video.thumbnail;
    videoTitle.textContent = video.title;
    videoChannel.textContent = video.author;
    videoDuration.textContent = "YouTube";
  }

  function showEmptyState() {
    videoDetected.style.display = "none";
    videoNone.style.display = "block";
  }

  function extractVideoId(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.searchParams.has("v")) return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2]?.split("?")[0] || null;
      if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    } catch {
      const match = rawUrl.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    }
    return null;
  }

  // 3. Actions on Active Video
  btnDl1080p?.addEventListener("click", () => {
    if (!activeVideo) return;
    window.open(`${currentSettings.veloServerUrl}/?v=${activeVideo.id}&auto=1`, "_blank");
  });

  btnDlAudio?.addEventListener("click", () => {
    if (!activeVideo) return;
    window.open(`${currentSettings.veloServerUrl}/?v=${activeVideo.id}&tab=audio&auto=1`, "_blank");
  });

  btnOpenVelo?.addEventListener("click", () => {
    if (!activeVideo) return;
    window.open(`${currentSettings.veloServerUrl}/?v=${activeVideo.id}`, "_blank");
  });

  btnAddQueue?.addEventListener("click", async () => {
    if (!activeVideo) return;
    await chrome.runtime.sendMessage({
      type: "QUEUE_ADD",
      item: {
        id: activeVideo.id,
        url: activeVideo.url,
        title: activeVideo.title,
        addedAt: Date.now(),
      },
    });
    btnAddQueue.innerHTML = "<span>✓ Added to Queue</span>";
    setTimeout(() => {
      btnAddQueue.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>Add to Queue</span>
      `;
    }, 1500);
    updateQueueBadgeCount();
  });

  manualUrlInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnManualFetch?.click();
  });

  btnManualFetch?.addEventListener("click", () => {
    const val = manualUrlInput.value.trim();
    const id = extractVideoId(val);
    if (!id) return;
    activeVideo = {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: `YouTube Video (${id})`,
      author: "YouTube Creator",
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
    renderActiveVideo(activeVideo);
  });

  // 4. Transcript AI Studio
  async function loadTranscripts(videoId) {
    transcriptCuesList.innerHTML = `<div class="loading-spinner">Fetching transcript text…</div>`;
    try {
      // Direct YouTube timedtext fetch with ASR fallback
      let res = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`);
      if (!res.ok) {
        res = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`);
      }
      if (!res.ok) throw new Error("No English captions returned directly");
      const data = await res.json();
      
      const parsedCues = [];
      if (data.events) {
        data.events.forEach((ev, idx) => {
          if (!ev.segs) return;
          const text = ev.segs.map((s) => s.utf8).join("").trim();
          if (!text || text === "\n") return;
          const startSec = (ev.tStartMs || 0) / 1000;
          const m = Math.floor(startSec / 60);
          const s = Math.floor(startSec % 60);
          const timeFormatted = `${m}:${String(s).padStart(2, "0")}`;
          parsedCues.push({ id: idx, start: startSec, startFormatted: timeFormatted, text });
        });
      }

      activeTranscriptCues = parsedCues;
      renderCues(parsedCues);
    } catch {
      transcriptCuesList.innerHTML = `
        <div class="loading-spinner">
          <p>Direct captions restricted. Open in Velo AI Studio to parse:</p>
          <button id="btn-open-transcript-velo" class="btn btn-sm btn-secondary" style="margin-top: 8px;">
            Open Velo Transcript Studio
          </button>
        </div>
      `;
      document.getElementById("btn-open-transcript-velo")?.addEventListener("click", () => {
        window.open(`${currentSettings.veloServerUrl}/?v=${videoId}&tab=transcript`, "_blank");
      });
    }
  }

  function renderCues(cues) {
    if (!cues.length) {
      transcriptCuesList.innerHTML = `<div class="loading-spinner">No transcript cues found.</div>`;
      return;
    }

    const fullText = cues.map((c) => c.text).join(" ");
    const words = fullText.split(/\s+/).length;
    statWords.textContent = `${words.toLocaleString()} words`;
    statReading.textContent = `~${Math.max(1, Math.round(words / 200))} min read`;

    transcriptCuesList.innerHTML = cues
      .map(
        (c) => `
        <div class="cue-item">
          <span class="cue-time">${c.startFormatted}</span>
          <span class="cue-text">${escapeHtml(c.text)}</span>
        </div>
      `,
      )
      .join("");
  }

  transcriptSearch?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderCues(activeTranscriptCues);
      return;
    }
    const filtered = activeTranscriptCues.filter((c) => c.text.toLowerCase().includes(q));
    renderCues(filtered);
  });

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  // 1-Click AI Prompts
  aiPromptBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!activeTranscriptCues.length || !activeVideo) return;
      const type = btn.getAttribute("data-prompt");
      const transcriptText = activeTranscriptCues.map((c) => c.text).join(" ");
      let promptTitle = "";
      let promptInstr = "";

      if (type === "summary") {
        promptTitle = "EXECUTIVE SUMMARY";
        promptInstr = "Please provide an executive summary, key takeaways, and main themes of this video transcript:";
      } else if (type === "notes") {
        promptTitle = "STUDY NOTES";
        promptInstr = "Please create structured study notes with bullet points, core concepts, and key definitions from this transcript:";
      } else if (type === "qa") {
        promptTitle = "Q&A & FAQ";
        promptInstr = "Generate 5-10 insightful questions and answers based on this video transcript:";
      } else if (type === "chapters") {
        promptTitle = "CHAPTER TIMESTAMPS";
        promptInstr = "Generate YouTube video chapter timestamps (00:00 - Intro, etc.) based on these timestamped sections:";
      }

      const fullPrompt = `${promptInstr}\n\nVIDEO: ${activeVideo.title}\n\nTRANSCRIPT:\n${transcriptText}`;
      await copyToClipboard(fullPrompt);
      const originalText = btn.innerHTML;
      btn.innerHTML = "<span>✓ Copied!</span>";
      setTimeout(() => (btn.innerHTML = originalText), 1500);
    });
  });

  btnCopyPlain?.addEventListener("click", async () => {
    if (!activeTranscriptCues.length) return;
    const text = activeTranscriptCues.map((c) => c.text).join(" ");
    await copyToClipboard(text);
    btnCopyPlain.textContent = "✓ Copied";
    setTimeout(() => (btnCopyPlain.textContent = "Copy Text"), 1500);
  });

  /**
   * SubRip demands HH:MM:SS,mmm. `startFormatted` is an M:SS display string, so
   * interpolating it produced "0:03,000" and "62:05,000" — no hours field and no
   * wrap at 60 minutes, which no player will load.
   */
  function srtTime(seconds) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const pad = (n, width) => String(n).padStart(width, "0");
    return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor((ms % 3600000) / 60000), 2)}:${pad(Math.floor((ms % 60000) / 1000), 2)},${pad(ms % 1000, 3)}`;
  }

  /** Each cue runs until the next one, not for a hardcoded 500 ms. */
  function cueEnd(index) {
    return activeTranscriptCues[index + 1]?.start ?? activeTranscriptCues[index].start + 2;
  }

  btnCopySrt?.addEventListener("click", async () => {
    if (!activeTranscriptCues.length) return;
    const srt = activeTranscriptCues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(cueEnd(i))}\n${c.text}\n`)
      .join("\n");
    await copyToClipboard(srt);
    btnCopySrt.textContent = "✓ Copied";
    setTimeout(() => (btnCopySrt.textContent = "Copy .SRT"), 1500);
  });

  btnExportVtt?.addEventListener("click", async () => {
    if (!activeTranscriptCues.length) return;
    const body = activeTranscriptCues
      .map(
        (c, i) =>
          `${srtTime(c.start).replace(",", ".")} --> ${srtTime(cueEnd(i)).replace(",", ".")}\n${c.text}`,
      )
      .join("\n\n");
    await copyToClipboard(`WEBVTT\n\n${body}`);
    btnExportVtt.textContent = "✓ Copied";
    setTimeout(() => (btnExportVtt.textContent = "Download .VTT"), 1500);
  });

  // 5. Queue Tab Logic
  async function loadQueueUI() {
    let queue = [];
    try {
      const res = await chrome.runtime.sendMessage({ type: "QUEUE_GET" });
      queue = res?.queue || [];
    } catch (err) {
      console.warn("[Velo] Failed to fetch queue from background worker:", err);
    }
    queueCountLabel.textContent = `${queue.length} video(s) in queue`;
    queueBadge.textContent = String(queue.length);

    if (!queue.length) {
      queueItemsList.innerHTML = `<div class="loading-spinner">No videos queued. Add with right-click or in-page button!</div>`;
      return;
    }

    queueItemsList.innerHTML = queue
      .map(
        (item) => `
        <div class="queue-item" data-id="${escapeHtml(item.id)}">
          <div class="queue-item-info">
            <div class="queue-item-title">${escapeHtml(item.title || item.id)}</div>
            <div class="queue-item-date">Added ${new Date(item.addedAt).toLocaleDateString()}</div>
          </div>
          <button class="queue-item-remove" data-remove="${escapeHtml(item.id)}" title="Remove">✕</button>
        </div>
      `,
      )
      .join("");

    // Hook remove buttons with robust event handling
    document.querySelectorAll("[data-remove]").forEach((b) => {
      b.addEventListener("click", async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("[data-remove]") : e.target;
        const id = btn ? btn.getAttribute("data-remove") : null;
        if (id) {
          await chrome.runtime.sendMessage({ type: "QUEUE_REMOVE", id });
          loadQueueUI();
        }
      });
    });
  }

  btnDownloadQueue?.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "QUEUE_GET" });
    const queue = res?.queue || [];
    if (!queue.length) return;
    const ids = queue.map((i) => i.id).join(",");
    window.open(`${currentSettings.veloServerUrl}/?batch=${ids}`, "_blank");
  });

  btnClearQueue?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "QUEUE_CLEAR" });
    loadQueueUI();
  });

  async function updateQueueBadgeCount() {
    const res = await chrome.runtime.sendMessage({ type: "QUEUE_GET" });
    queueBadge.textContent = String(res?.queue?.length || 0);
  }

  // 6. 1-Click Cookie Session Sync with Velo
  async function syncSessionWithVelo() {
    btnSyncSession.classList.add("spinning");
    const cookieRes = await chrome.runtime.sendMessage({ type: "GET_SESSION_COOKIES" });
    if (cookieRes?.cookieHeader) {
      // Hand the session over through the clipboard and let Velo's own cookie
      // import take it. Nothing reads a stored copy, so writing SID / SAPISID /
      // __Secure-3PAPISID to extension storage only left Google account
      // credentials sitting at rest indefinitely for no benefit.
      await copyToClipboard(cookieRes.cookieHeader);
      await chrome.storage.local.remove("velo_synced_cookies");
      window.open(`${currentSettings.veloServerUrl}/?cookie_sync=1`, "_blank");
    }
    setTimeout(() => btnSyncSession.classList.remove("spinning"), 1000);
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }

  // Run initialization
  await detectActiveTab();
  await updateQueueBadgeCount();
});
