const CONTAINER_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};
const CONTAINER_EXTS = new Set(Object.values(CONTAINER_EXT));

/**
 * A server-merged file carries its real container in Content-Type; the preset
 * only knows what it asked for. Swap the extension when both sides are known
 * containers. Unknown types and non-container names (`.info.json`) stay put.
 */
export function nameForBlob(filename: string, blob: Blob): string {
  const ext = CONTAINER_EXT[blob.type.split(";")[0].trim().toLowerCase()];
  if (!ext) return filename;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return `${filename}.${ext}`;
  const current = filename.slice(dot + 1).toLowerCase();
  if (current === ext || !CONTAINER_EXTS.has(current)) return filename;
  return `${filename.slice(0, dot)}.${ext}`;
}
