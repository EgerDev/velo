import { errorFromResponse } from "@/lib/download-error";
import { downloadHeaders } from "@/lib/guest-id";
import { linkAbort } from "@/lib/abort-link";
import { assertMedia, readBlob } from "@/lib/hybrid-net";

export async function ytdlpBlob(
  videoId: string,
  itag: number,
  cookies?: string,
  pot?: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const headers = downloadHeaders({ "content-type": "application/json" });
  const controller = new AbortController();
  const detach = linkAbort(signal, controller);
  const timer = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch("/api/ytdlp", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: videoId, itag, cookies: cookies || "", pot: pot || "" }),
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!response.ok) throw await errorFromResponse(response, "yt-dlp");
    return assertMedia(await readBlob(response), response.headers.get("content-type"));
  } finally {
    window.clearTimeout(timer);
    detach();
  }
}
