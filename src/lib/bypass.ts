/**
 * Velo unlock chain.
 *
 * 1. Same-hop: watch page + media through ONE relay so `ip=` matches.
 * 2. Always run player.js nsig + s/sig on the server (even "plain" URLs).
 * 3. Dual POT: try with GVS token and without (wrong pot 403s).
 * 4. Stamp cver / rn / keepalive / drop alr.
 * 5. YouTube Origin/Referer/client headers on media.
 * 6. HLS stitch if progressive is SABR or 403.
 */
import { PUBLIC_RELAYS, type RelaySpec } from "@/lib/cors-relays";
import {
  appendParam,
  extractPlayerResponse,
  isVideoplaybackUrl,
  pickBypassFormat,
  sameHopPages,
  type BypassFormat,
  type PlayerSnapshot,
} from "@/lib/bypass-parse";
import {
  parseHls,
  pickHlsVariant,
  playbackHeaders,
  unlockStreamUrl,
  unlockVariants,
} from "@/lib/stream-unlock";
import { isImaUrl } from "@/lib/ima";
import { downloadHeaders } from "@/lib/guest-id";
import { isAudioItag } from "@/lib/ytdlp-auth";

export {
  extractJsonObject,
  extractPlayerResponse,
  pickBypassFormat,
  sameHopPages,
  stampPot,
} from "@/lib/bypass-parse";

function isBlockPage(response: Response): boolean {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("application/json") || type.includes("text/plain");
}

async function hopFetch(
  relay: RelaySpec,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController();
  const parent = init.signal;
  // Removed in the finally unless the response is handed off: the bulk queue
  // shares one signal across every hop, so a listener left behind per failed
  // fetch piles up for the life of the batch — but the caller still drains a
  // handed-off body, and Pause must be able to reach it (`once` self-removes
  // on an actual abort).
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else if (parent && typeof AbortSignal.any !== "function") {
    parent.addEventListener("abort", onAbort, { once: true });
  }
  const signal =
    parent && typeof AbortSignal.any === "function"
      ? AbortSignal.any([controller.signal, parent])
      : controller.signal;
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 18_000);
  let handedOff = false;
  try {
    const { timeoutMs: _timeoutMs, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (typeof window !== "undefined" && window.location?.origin && !headers.has("origin")) {
      headers.set("origin", window.location.origin);
    }
    if (!headers.has("user-agent") && typeof navigator !== "undefined") {
      headers.set("user-agent", navigator.userAgent);
    }
    const response = await fetch(relay.wrap(url), { redirect: "manual", ...rest, headers, signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error(`${relay.id} redirected`);
      const next = location.startsWith("http") ? location : new URL(location, relay.wrap(url)).toString();
      if (isImaUrl(next)) throw new Error(`${relay.id} redirected to an IMA ad`);
      if (isVideoplaybackUrl(next)) {
        handedOff = true;
        return await fetch(relay.wrap(next), { redirect: "manual", ...rest, headers, signal });
      }
      throw new Error(`${relay.id} redirected off-origin`);
    }
    handedOff = true;
    return response;
  } finally {
    clearTimeout(timer);
    if (!handedOff) parent?.removeEventListener("abort", onAbort);
  }
}

async function serverUnlock(format: BypassFormat, videoId: string, pot: string | null): Promise<string[]> {
  const raw = format.url || format.signatureCipher || format.cipher;
  if (!raw) throw new Error("Missing stream URL.");
  try {
    const response = await fetch("/api/unlock", {
      method: "POST",
      headers: downloadHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        url: format.url,
        signatureCipher: format.signatureCipher,
        cipher: format.cipher,
        videoId,
        pot: Boolean(pot),
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { url?: string };
      if (data.url) return unlockVariants(data.url, { pot, stripAlr: true });
    }
  } catch {
    /* fall through to local stamp */
  }
  if (format.signatureCipher || format.cipher) {
    const { decipherCipher } = await import("@/lib/resolve-video");
    const deciphered = await decipherCipher({
      data: {
        url: format.url,
        signatureCipher: format.signatureCipher,
        cipher: format.cipher,
      },
    });
    return unlockVariants(deciphered, { pot, stripAlr: true });
  }
  return unlockVariants(raw, { pot, stripAlr: true });
}

export async function readAll(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  if (!response.body) return response.blob();
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onBytes?.(loaded, total);
      }
    }
  } finally {
    reader.releaseLock();
  }
  // A relay that drops mid-body still ends with `done`, so without this a short
  // read was returned as a complete part and saved as a complete file.
  if (total > 0 && loaded < total) {
    throw new Error(`Download ended early — got ${loaded} of ${total} bytes.`);
  }
  // Blob copies its parts itself; a contiguous intermediate Uint8Array would
  // double peak memory for nothing.
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

async function mediaThroughHop(
  relay: RelaySpec,
  urls: string[],
  size: number,
  videoId: string,
  signal?: AbortSignal,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const headers = playbackHeaders(videoId);
  let chosen: string | null = null;
  for (const url of urls) {
    const probe = await hopFetch(relay, appendParam(url, "range", "0-2047"), {
      signal,
      timeoutMs: 12_000,
      headers,
    });
    if (!probe.ok || isBlockPage(probe)) {
      await probe.body?.cancel().catch(() => undefined);
      continue;
    }
    await probe.body?.cancel().catch(() => undefined);
    chosen = url;
    break;
  }
  if (!chosen) throw new Error(`${relay.id} probe blocked`);

  const chunk = 2_500_000;
  if (size > chunk * 2) {
    const parts: Blob[] = [];
    let loaded = 0;
    let rn = 1;
    for (let start = 0; start < size; start += chunk) {
      const end = Math.min(size - 1, start + chunk - 1);
      const ranged = unlockStreamUrl(appendParam(chosen, "range", `${start}-${end}`), {
        stripAlr: true,
      }).url.replace(/([?&])rn=\d+/, `$1rn=${rn++}`);
      const part = await hopFetch(relay, ranged, { signal, timeoutMs: 40_000, headers });
      if (!part.ok || isBlockPage(part)) {
        await part.body?.cancel().catch(() => undefined);
        throw new Error(`${relay.id} range ${start} ${part.status}`);
      }
      const blob = await readAll(part);
      // Public relays re-chunk and may drop content-length, which leaves the
      // guard in readAll inert — so hold the part to the range that was asked for.
      const want = end - start + 1;
      if (blob.size !== want) {
        throw new Error(`${relay.id} range ${start} returned ${blob.size} of ${want} bytes`);
      }
      loaded += blob.size;
      onBytes?.(loaded, size);
      parts.push(blob);
    }
    return new Blob(parts);
  }

  const full = await hopFetch(relay, chosen, { signal, timeoutMs: 90_000, headers });
  if (!full.ok || isBlockPage(full)) {
    await full.body?.cancel().catch(() => undefined);
    throw new Error(`${relay.id} ${full.status} on media`);
  }
  const blob = await readAll(full, onBytes);
  if (blob.size < 2048) throw new Error(`${relay.id} empty media`);
  if (size > 0 && blob.size < size) {
    throw new Error(`${relay.id} ended early — got ${blob.size} of ${size} bytes`);
  }
  return blob;
}

function hlsPreferHeight(itag: number): number {
  if (itag === 18 || itag === 133 || itag === 160 || itag === 242 || itag === 278) return 360;
  if (itag === 22 || itag === 136 || itag === 247) return 720;
  if (itag === 135 || itag === 244) return 480;
  return 1080;
}

async function hlsThroughHop(
  relay: RelaySpec,
  manifestUrl: string,
  videoId: string,
  signal?: AbortSignal,
  onProgress?: (label: string, percent: number) => void,
  preferHeight = 1080,
  pot: string | null = null,
): Promise<Blob> {
  const headers = playbackHeaders(videoId);
  const hopUrl = (raw: string) => {
    if (isImaUrl(raw)) throw new Error(`${relay.id} IMA URL`);
    if (/\.m3u8(?:[?&/]|$)|\/api\/manifest\/|file=index\.m3u8/i.test(raw)) return raw;
    const next = isVideoplaybackUrl(raw) ? unlockStreamUrl(raw, { pot, stripAlr: true }).url : raw;
    if (isImaUrl(next)) throw new Error(`${relay.id} IMA nested`);
    return next;
  };
  const masterRes = await hopFetch(relay, hopUrl(manifestUrl), { signal, timeoutMs: 16_000, headers });
  if (!masterRes.ok) {
    await masterRes.body?.cancel().catch(() => undefined);
    throw new Error(`${relay.id} HLS ${masterRes.status}`);
  }
  const masterText = await masterRes.text();
  const parsed = parseHls(masterText, manifestUrl);
  const mediaUrl = parsed.media.segments.length ? manifestUrl : pickHlsVariant(parsed.master, preferHeight);
  let media = parsed.media;
  if (mediaUrl && isImaUrl(mediaUrl)) throw new Error(`${relay.id} HLS is an IMA ad playlist`);
  if (mediaUrl && !media.segments.length) {
    const child = await hopFetch(relay, hopUrl(mediaUrl), { signal, timeoutMs: 16_000, headers });
    if (!child.ok) {
      await child.body?.cancel().catch(() => undefined);
      throw new Error(`${relay.id} HLS variant ${child.status}`);
    }
    media = parseHls(await child.text(), mediaUrl).media;
  }
  const parts: Blob[] = [];
  if (media.init && !isImaUrl(media.init)) {
    const initRes = await hopFetch(relay, hopUrl(media.init), { signal, timeoutMs: 20_000, headers });
    if (initRes.ok && !isBlockPage(initRes)) parts.push(await readAll(initRes));
    else {
      await initRes.body?.cancel().catch(() => undefined);
      throw new Error(`${relay.id} HLS init missing`);
    }
  }
  const segments = media.segments.filter((seg) => !isImaUrl(seg));
  const total = segments.length;
  if (!total) throw new Error(`${relay.id} empty HLS`);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error("aborted");
    const seg = segments[i];
    if (!seg) continue;
    const res = await hopFetch(relay, hopUrl(seg), { signal, timeoutMs: 30_000, headers });
    if (!res.ok || isBlockPage(res)) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`${relay.id} HLS segment ${i}`);
    }
    parts.push(await readAll(res));
    onProgress?.("HLS segments", Math.min(92, 20 + Math.round(((i + 1) / total) * 70)));
  }
  return new Blob(parts, { type: media.init ? "video/mp4" : "video/mp2t" });
}

async function tryProgressive(
  relay: RelaySpec,
  player: PlayerSnapshot,
  videoId: string,
  itag: number,
  pot: string | null,
  signal: AbortSignal | undefined,
  onBytes: ((loaded: number, total: number) => void) | undefined,
): Promise<Blob> {
  const format = pickBypassFormat(player.formats, itag);
  if (!format) throw new Error(`${relay.id} no itag ${itag}`);
  const urls = await serverUnlock(format, videoId, pot);
  const size = Number(format.contentLength) || 0;
  return mediaThroughHop(relay, urls, size, videoId, signal, onBytes);
}

export async function fetchSameHopBlob(opts: {
  videoId: string;
  itag: number;
  pot?: string | null;
  signal?: AbortSignal;
  onProgress?: (label: string, percent: number) => void;
}): Promise<Blob> {
  const { videoId, itag, pot, signal, onProgress } = opts;
  const errors: string[] = [];
  const pages = sameHopPages(videoId);
  let lastPct = -1;
  const onBytes = (loaded: number, total: number) => {
    const pct = total > 0 ? Math.min(92, 30 + Math.round((loaded / total) * 60)) : 50;
    // Every network chunk lands here and each emit re-renders the page; only
    // report when the bar would actually move.
    if (pct === lastPct) return;
    lastPct = pct;
    onProgress?.("Velo unlock", pct);
  };

  for (const relay of PUBLIC_RELAYS) {
    if (signal?.aborted) throw new Error("aborted");
    for (const page of pages) {
      onProgress?.(`${relay.id} · ${new URL(page).hostname}`, 12);
      try {
        const response = await hopFetch(relay, page, { signal, timeoutMs: 16_000 });
        if (!response.ok) {
          errors.push(`${relay.id} ${new URL(page).hostname} ${response.status}`);
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        const html = await response.text();
        const player = extractPlayerResponse(html);
        if (!player) {
          errors.push(`${relay.id} no player`);
          continue;
        }
        try {
          return await tryProgressive(relay, player, videoId, itag, pot ?? null, signal, onBytes);
        } catch (err) {
          const why = err instanceof Error ? err.message : "progressive failed";
          if (signal?.aborted || /abort/i.test(why)) throw err;
          errors.push(why);
          if (player.hlsManifestUrl && !isImaUrl(player.hlsManifestUrl) && !isAudioItag(itag)) {
            onProgress?.(`${relay.id} HLS fallback`, 18);
            return await hlsThroughHop(relay, player.hlsManifestUrl, videoId, signal, onProgress, hlsPreferHeight(itag), pot ?? null);
          }
        }
      } catch (err) {
        errors.push(`${relay.id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  }

  throw new Error(errors.slice(0, 5).join(" · ") || "Velo unlock missed.");
}
