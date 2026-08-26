const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

async function extract() {
  const response = await chrome.runtime.sendMessage({ type: "extract-session" });
  if (!response?.ok) throw new Error(response?.error || "Could not extract session.");
  return response.session;
}

function isVeloHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "grok.com" ||
    hostname.endsWith(".grok.com") ||
    hostname === "grok.me" ||
    hostname.endsWith(".grok.me") ||
    hostname.endsWith(".grok-sandbox.com")
  );
}

function isVeloTab(tab) {
  try {
    const host = new URL(tab.url || "").hostname;
    if (!isVeloHost(host)) return false;
    const title = (tab.title || "").trim();
    return title === "Velo" || title.startsWith("Velo ");
  } catch {
    return false;
  }
}

async function sendToVelo(netscape) {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter(isVeloTab);
  if (!targets.length) throw new Error("Focus a Velo tab, then click Send.");
  let sent = 0;
  let lastError = null;
  for (const tab of targets) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "velo-inject-session", netscape });
      sent += 1;
    } catch (err) {
      lastError = err;
    }
  }
  if (!sent) throw lastError instanceof Error ? lastError : new Error("Open Velo first, then click Send.");
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
