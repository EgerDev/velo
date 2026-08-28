import { cipherUrl, nsigCache, nsigCacheLookup, nsigReport, readNParam, rememberNsig } from "@/lib/nsig";
import { orderedParallelStream } from "@/lib/parallel-stream";
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
  signature_cipher?: string;
  cipher?: string;
  decipher: (player?: unknown) => Promise<string>;
};

async function findRawFormat(id: string, itag: number): Promise<{
  format: FormatLike;
  title: string;
  player: unknown;
  cpn: string;
}> {
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
    player: yt.session.player,
    cpn: info.cpn,
  };
}

function appendParam(url: string, key: string, value: string): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
}

async function openStream(url: string, range?: { start: number; end: number }, signal?: AbortSignal): Promise<Response> {
  const target = range ? appendParam(url, "range", `${range.start}-${range.end}`) : url;
  const response = await fetch(target, {
    method: "GET",
    headers: STREAM_HEADERS,
    redirect: "follow",
    signal,
  });
  return response;
}

/**
 * A googlevideo "200" carrying an HTML or JSON body is a soft-block page, not
 * media. Same test as bypass.server.ts / hybrid-download.ts, so the download
 * route sees a 403 and falls back instead of streaming the page as video.
 */
function isBlock(type: string | null, status: number): boolean {
  if (status < 200 || status >= 300) return true;
  const mime = (type ?? "").toLowerCase();
  return mime.includes("text/html") || mime.includes("application/json");
}

function bumpRn(url: string, n: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("rn", String(n));
    return parsed.toString();
  } catch {
    return appendParam(url, "rn", String(n));
  }
}

/**
 * Fetch a file over several concurrent range requests, emitting bytes in order.
 *
 * YouTube throttles per connection, so N connections each carrying a slice beat
 * one connection carrying everything. The ordering, backpressure and memory
 * bound live in `orderedParallelStream`; this only supplies the per-lane range
 * request, stamping a distinct `rn=` so each hop looks like its own client.
 */
function parallelStream(
  url: string,
  size: number,
  connections: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  return orderedParallelStream({
    size,
    connections,
    openRange: async (range, index, laneSignal) => {
      // Honour the caller's abort as well as the lane's own, so a disconnected
      // client stops the range fetches instead of running them to completion.
      const merged =
        signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([laneSignal, signal])
          : laneSignal;
      const response = await openStream(bumpRn(url, index + 1), range, merged);
      if (isBlock(response.headers.get("content-type"), response.status) || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("A parallel range request was blocked.");
      }
      return response.body;
    },
  });
}

export type PlaybackFile = {
  url: string;
  directUrl: string;
  filename: string;
  mime: string;
  ext: string;
  size: number | null;
};

async function decorateUrls(raw: string, cpn: string, videoId: string): Promise<{ url: string; directUrl: string }> {
  const { mintContentPoToken } = await import("@/lib/po-token.server");
  const { unlockStreamUrl } = await import("@/lib/stream-unlock");
  const pot = await mintContentPoToken(videoId);
  const unlocked = unlockStreamUrl(raw, { pot, cpn, stripAlr: true });
  const direct = new URL(unlocked.url);
  const redirector = new URL(direct.toString());
  redirector.hostname = "redirector.googlevideo.com";
  return { url: redirector.toString(), directUrl: direct.toString() };
}

export async function decipherRawFormat(input: {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
}): Promise<string> {
  const yt = await getClient();
  const player = yt.session.player as {
    decipher?: (
      url?: string,
      signatureCipher?: string,
      cipher?: string,
      cache?: Map<string, string>,
    ) => Promise<string>;
  } | null;
  if (!player?.decipher) throw new Error("Player script isn’t ready. Try again.");
  const raw = input.url || input.signatureCipher || input.cipher;
  if (!raw) throw new Error("Missing stream cipher.");
  // The pre-decipher stream URL: a bare `url`, or the one buried inside the
  // signatureCipher/cipher query string. `readNParam` can't see the `n` inside
  // a raw cipher (it's percent-encoded), so derive the real URL first.
  const rawUrl = input.url ?? cipherUrl(input.signatureCipher) ?? cipherUrl(input.cipher) ?? undefined;
  const rawN = readNParam(rawUrl);
  try {
    const cached = nsigCacheLookup(rawN);
    const solved = await player.decipher(input.url, input.signatureCipher, input.cipher, nsigCache);
    const report = nsigReport(rawUrl, solved, "miss" in cached ? "miss" : "hit");
    rememberNsig(report.raw, report.solved);
    if (report.raw && !report.transformed) {
      nsigCache.delete(report.raw);
      throw new Error("nsig cache miss — player.js failed to transform n.");
    }
    return solved;
  } catch (err) {
    if (rawN) nsigCache.delete(rawN);
    throw err instanceof Error ? err : new Error("nsig cache miss — player.js failed to transform n.");
  }
}

export async function unlockPlaybackUrl(input: {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  videoId?: string;
  cpn?: string;
  pot?: boolean;
}): Promise<{ url: string; applied: string[] }> {
  const deciphered = await decipherRawFormat(input);
  let pot: string | null = null;
  if (input.pot !== false && input.videoId) {
    const { mintContentPoToken } = await import("@/lib/po-token.server");
    pot = await mintContentPoToken(input.videoId);
  }
  const { unlockStreamUrl } = await import("@/lib/stream-unlock");
  return unlockStreamUrl(deciphered, { pot, cpn: input.cpn, stripAlr: true });
}

export async function getPlaybackUrl(id: string, itag: number): Promise<PlaybackFile> {
  const { format, title, cpn } = await findRawFormat(id, itag);
  const deciphered = await decipherRawFormat({
    url: format.url,
    signatureCipher: format.signature_cipher,
    cipher: format.cipher,
  });
  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const urls = await decorateUrls(deciphered, cpn, id);
  return {
    url: urls.url,
    directUrl: urls.directUrl,
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
  // The client races this against the same-hop path and aborts the loser, so
  // without these checks the server keeps resolving, deciphering, minting a POT
  // and probing googlevideo for a connection that is already gone.
  if (signal?.aborted) throw new Error("aborted");
  const { format, title, cpn } = await findRawFormat(id, itag);
  if (format.has_video && !format.has_audio) {
    return Response.json(
      { error: "This quality is video-only. Save uses yt-dlp to mux 137+140." },
      { status: 422 },
    );
  }
  if (signal?.aborted) throw new Error("aborted");
  const deciphered = await decipherRawFormat({
    url: format.url,
    signatureCipher: format.signature_cipher,
    cipher: format.cipher,
  });
  const urls = await decorateUrls(deciphered, cpn, id);
  if (signal?.aborted) throw new Error("aborted");

  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const size = format.content_length;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(title, ext),
    "Cache-Control": "no-store",
  };

  const probe = await openStream(urls.directUrl, { start: 0, end: 2047 }, signal);
  if (isBlock(probe.headers.get("content-type"), probe.status)) {
    await probe.body?.cancel().catch(() => undefined);
    return Response.json(
      { error: "YouTube blocked this server. The app will try PO token + CORS relays." },
      { status: 403 },
    );
  }
  await probe.body?.cancel().catch(() => undefined);

  const useParallel = typeof size === "number" && size > 8 * 1024 * 1024;
  if (useParallel) {
    headers["Content-Length"] = String(size);
    const body = parallelStream(urls.directUrl, size, 4, signal);
    return new Response(body, { status: 200, headers });
  }

  const upstream = await openStream(urls.directUrl, undefined, signal);
  if (isBlock(upstream.headers.get("content-type"), upstream.status) || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return Response.json(
      { error: "YouTube blocked this server. The app will try PO token + CORS relays." },
      { status: 403 },
    );
  }

  const length = upstream.headers.get("content-length") || (size ? String(size) : null);
  if (length) headers["Content-Length"] = length;

  return new Response(upstream.body, { status: 200, headers });
}
