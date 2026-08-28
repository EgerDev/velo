const UNSAFE = new Set('<>:"/\\|?*');

/** Drop path/control characters without a control-char regex (eslint no-control-regex). */
export function stripUnsafeFilenameChars(title: string): string {
  let out = "";
  for (const ch of title) {
    const code = ch.charCodeAt(0);
    if (code < 32 || UNSAFE.has(ch)) continue;
    out += ch;
  }
  return out;
}

export function fileBasename(title: string, fallback = "video", max = 120): string {
  const cleaned = stripUnsafeFilenameChars(title).replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, max);
}
