function isGrokParent(origin: string): boolean {
  try {
    const url = new URL(origin);
    return isGrokHost(url.hostname);
  } catch {
    return false;
  }
}

/** grok.com chat, grok.me app, and preview guests. */
export function isGrokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "grok.com" ||
    host.endsWith(".grok.com") ||
    host === "grok.me" ||
    host.endsWith(".grok.me")
  );
}

export function isSandboxHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "grok-sandbox.com" ||
    host.endsWith(".grok-sandbox.com") ||
    host === "grok.me" ||
    host.endsWith(".grok.me")
  );
}

/** True when this document is the Grok live-preview iframe. */
export function isBuilderPreview(): boolean {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  if (isSandboxHost(window.location.hostname)) return true;
  try {
    const ancestor = window.location.ancestorOrigins?.[0];
    if (ancestor) {
      const origin = ancestor.includes("://") ? new URL(ancestor).origin : `https://${ancestor}`;
      if (isGrokParent(origin)) return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (document.referrer && isGrokParent(new URL(document.referrer).origin)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function safeDownloadName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const trimmed = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  const base = trimmed.slice(0, 180) || "video";
  return base.endsWith(".") ? `${base}mp4` : base;
}
