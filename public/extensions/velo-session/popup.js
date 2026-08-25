const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

async function extract() {
  const response = await chrome.runtime.sendMessage({ type: "extract-session" });
  if (!response?.ok) throw new Error(response?.error || "Could not extract session.");
  return response.session;
}

function looksLikeVelo(tab) {
  const hay = `${tab.url || ""} ${tab.title || ""}`.toLowerCase();
  return hay.includes("velo") || hay.includes("localhost") || hay.includes("grok-sandbox") || hay.includes("127.0.0.1");
}

async function sendToVelo(netscape) {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter(looksLikeVelo);
  if (!targets.length) throw new Error("Open Velo first, then click Send.");
  let sent = 0;
  for (const tab of targets) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "velo-inject-session", netscape });
      sent += 1;
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (payload) => {
          window.postMessage({ source: "velo-extension", ...payload }, "*");
        },
        args: [{ type: "velo-youtube-cookies", netscape }],
      });
      sent += 1;
    }
  }
  return sent;
}

document.getElementById("send").addEventListener("click", async () => {
  setStatus("Extracting…");
  try {
    const session = await extract();
    const sent = await sendToVelo(session.netscape);
    setStatus(`Sent ${session.count} tokens to ${sent} Velo tab${sent === 1 ? "" : "s"}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Send failed.");
  }
});

document.getElementById("har").addEventListener("click", async () => {
  setStatus("Capturing live YouTube traffic…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "capture-har" });
    if (!response?.ok) throw new Error(response?.error || "Capture failed.");
    await navigator.clipboard.writeText(response.har);
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(response.har)}`;
    await chrome.downloads.download({ url, filename: "youtube-session.har", saveAs: true });
    try {
      await sendToVelo(`Cookie: ${response.header}`);
    } catch {
      /* Velo tab optional for HAR download */
    }
    setStatus(`Captured ${response.count} tokens. HAR copied and downloaded.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "HAR capture failed.");
  }
});

document.getElementById("copy").addEventListener("click", async () => {
  setStatus("Extracting…");
  try {
    const session = await extract();
    await navigator.clipboard.writeText(session.netscape);
    setStatus(`Copied ${session.count} tokens. Paste them in Velo.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Copy failed.");
  }
});

document.getElementById("download").addEventListener("click", async () => {
  setStatus("Extracting…");
  try {
    const session = await extract();
    const url = `data:text/plain;charset=utf-8,${encodeURIComponent(session.netscape)}`;
    await chrome.downloads.download({ url, filename: "youtube-cookies.txt", saveAs: true });
    setStatus(`Downloading ${session.count} tokens.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Download failed.");
  }
});
