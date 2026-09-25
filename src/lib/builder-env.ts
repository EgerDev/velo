export function safeDownloadName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const trimmed = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  const base = trimmed.slice(0, 180) || "video";
  return base.endsWith(".") ? `${base}mp4` : base;
}
