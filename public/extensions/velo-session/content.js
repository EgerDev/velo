chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "velo-inject-session") return undefined;
  window.postMessage(
    {
      source: "velo-extension",
      type: "velo-youtube-cookies",
      netscape: message.netscape,
      header: message.header,
      count: message.count,
    },
    "*",
  );
  sendResponse({ ok: true });
  return true;
});
