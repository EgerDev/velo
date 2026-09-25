import { fileBasename } from "@/lib/safe-filename";
import { getClient, getPlayableInfo, STREAM_HEADERS, type PlayableInfo } from "@/lib/youtube-client.server";
import { containerExt } from "@/lib/youtube-map.server";

function contentDisposition(title: string, ext: string): string {
  const base = fileBasename(title);
  const ascii = `${base.replace(/[^\x20-\x7E]/g, "_")}.${ext}`;
  const encoded = encodeURIComponent(`${base}.${ext}`).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

type FormatLike = {
  itag: number;
  mime_type: string;
  has_audio: boolean;
  has_video: boolean;
  content_length?: number;
  is_type_otf?: boolean;
  url?: string;
  decipher: (player?: unknown) => Promise<string>;
};

async function findRawFormat(id: string, itag: number): Promise<{ format: FormatLike; title: string }> {
  const yt = await getClient();
  let info: PlayableInfo;
  try {
    info = await getPlayableInfo(yt, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach YouTube.";
    throw new Error(message.replace(/^InnertubeError:\s*/i, ""));
  }
  const status = info.playability_status?.status;
  if (status && status !== "OK") {
    throw new Error(info.playability_status?.reason || "YouTube won’t play this video.");
  }
  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const format = raw.find((f) => f.itag === itag);
  if (!format || (format as { is_type_otf?: boolean }).is_type_otf) {
    throw new Error("That quality is no longer available. Fetch the video again.");
  }
  return {
    format: format as unknown as FormatLike,
    title: info.basic_info.title?.trim() || "video",
  };
}

/**
 * The format's URL exactly as YouTube returned it. The client is created with
 * `retrieve_player: false`, so there is no player script: youtubei.js's
 * documented no-player `decipher()` returns the plain `url` (or "" for a
 * format that only carries a signatureCipher). Nothing is deciphered and no
 * YouTube JavaScript runs (roadmap D7/C5).
 */
export async function plainFormatUrl(format: Pick<FormatLike, "decipher">): Promise<string> {
  const url = await format.decipher();
  if (!url) throw new Error("This quality isn’t available as a direct download. Pick another quality.");
  return url;
}

function appendParam(url: string, key: string, value: string): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
}

/**
 * One media fetch. When the operator configured an http(s) proxy, the request
 * rides it through undici's own fetch (Node's global fetch rejects a foreign
 * undici dispatcher); otherwise it is the plain global fetch.
 */
async function openStream(url: string, range?: { start: number; end: number }, signal?: AbortSignal): Promise<Response> {
  const target = range ? appendParam(url, "range", `${range.start}-${range.end}`) : url;
  const { proxiedFetch } = await import("@/lib/user-proxy.server");
  const response = await proxiedFetch(target, {
    headers: STREAM_HEADERS,
    signal,
    redirect: "follow",
  });
  return response;
}

/**
 * A googlevideo "200" carrying an HTML or JSON body is a soft-block page, not
 * media. The download route sees a 403 instead of streaming the page as video.
 */
function isBlock(type: string | null, status: number): boolean {
  if (status < 200 || status >= 300) return true;
  const mime = (type ?? "").toLowerCase();
  return mime.includes("text/html") || mime.includes("application/json");
}

const BLOCKED = "YouTube refused to serve this file to the server. Try again later or pick another quality.";

export type PlaybackFile = {
  url: string;
  directUrl: string;
  filename: string;
  mime: string;
  ext: string;
  size: number | null;
};

export async function getPlaybackUrl(id: string, itag: number): Promise<PlaybackFile> {
  const { format, title } = await findRawFormat(id, itag);
  const url = await plainFormatUrl(format);
  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  return {
    url,
    directUrl: url,
    filename: `${fileBasename(title)}.${ext}`,
    mime,
    ext,
    size: typeof format.content_length === "number" ? format.content_length : null,
  };
}

export async function streamYoutubeDownload(
  id: string,
  itag: number,
  signal?: AbortSignal,
): Promise<Response> {
  // The client may abort (Close, a new Save) while this resolves; without these
  // checks the server keeps resolving and probing googlevideo for a connection
  // that is already gone.
  if (signal?.aborted) throw new Error("aborted");
  const { format, title } = await findRawFormat(id, itag);
  if (format.has_video && !format.has_audio) {
    return Response.json(
      { error: "This quality is video-only. Save uses yt-dlp to mux 137+140." },
      { status: 422 },
    );
  }
  const url = await plainFormatUrl(format);
  if (signal?.aborted) throw new Error("aborted");

  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const size = format.content_length;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(title, ext),
    "Cache-Control": "no-store",
  };

  const probe = await openStream(url, { start: 0, end: 2047 }, signal);
  if (isBlock(probe.headers.get("content-type"), probe.status)) {
    await probe.body?.cancel().catch(() => undefined);
    return Response.json({ error: BLOCKED }, { status: 403 });
  }
  await probe.body?.cancel().catch(() => undefined);

  const upstream = await openStream(url, undefined, signal);
  if (isBlock(upstream.headers.get("content-type"), upstream.status) || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return Response.json({ error: BLOCKED }, { status: 403 });
  }

  const length = upstream.headers.get("content-length") || (size ? String(size) : null);
  if (length) headers["Content-Length"] = length;

  return new Response(upstream.body, { status: 200, headers });
}
