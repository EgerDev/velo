/** yt-dlp `--sub-langs` is argv, not a shell — only BCP-47-ish codes. */
export function sanitizeSubLang(lang: string): string {
  const cleaned = lang.trim();
  return /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(cleaned) ? cleaned : "en";
}
