/** yt-dlp `--sub-langs` is argv, not a shell — only BCP-47-ish codes. */
export function sanitizeSubLang(lang: string): string {
  const cleaned = lang.trim();
  return /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(cleaned) ? cleaned : "en";
}

/**
 * `--sub-langs` for a track or its auto-translation. yt-dlp names the
 * translation of a manual track `<target>-<source>` ("es-en": Spanish from
 * English); a bare `<target>` exists only for auto-captions. Asking for just
 * "es" selected nothing on a video with manual English subs. Each code is
 * sanitized on its own (the comma is ours, not the caller's).
 */
export function subLangsArg(lang: string, tlang?: string): string {
  const source = sanitizeSubLang(lang);
  if (!tlang) return source;
  const target = sanitizeSubLang(tlang);
  return `${target},${target}-${source}`;
}
