import "@/lib/ipv4-bind.server";
import { PUBLIC_RELAYS } from "@/lib/cors-relays";
import {
  appendParam,
  extractPlayerResponse,
  isVideoplaybackUrl,
  pickBypassFormat,
  sameHopPages,
} from "@/lib/bypass-parse";
import { isImaUrl } from "@/lib/ima";
import { decipherRawFormat } from "@/lib/youtube.server";
import { unlockStreamUrl } from "@/lib/stream-unlock";

const HOP_HEADERS = {
  accept: "*/*",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  referer: "https://www.youtube.com/",
};

// Twin of the client isBlockPage() in bypass.ts — keep the two in sync. A
// public relay's error/rate-limit notice can arrive as HTTP 200 text/plain,
// which must fail over to the next relay, not stream back as the "video".
export function isBlock(type: string | null, status: number): boolean {
  if (status < 200 || status >= 300) return true;
  const mime = (type ?? "").toLowerCase();
  return mime.includes("text/html") || mime.includes("application/json") || mime.includes("text/plain");
}

async function hop(
  url: string,
  wrap: (value: string) => string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Merge the caller's signal (client disconnect) with the per-hop timeout.
  // The timer is still cleared in `finally` the moment headers arrive, so the
  // timeout keeps bounding only time-to-headers — while the caller's signal
  // stays armed through the streaming phase and cancels the upstream fetch
  // when the client goes away. Mirrors the client hopFetch in bypass.ts.
  const hopSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    // redirect:"manual", not "follow": a relay 3xx (its own error redirect, a
    // passed-through upstream Location, or a malicious/MITM'd one) must not send
    // the server fetching an arbitrary host — internal IPs included — and stream
    // that body back to the client. Only chase a googlevideo videoplayback hop,
    // which also preserves the relay's `ip=` same-hop binding. Mirrors the
    // client hopFetch guard in bypass.ts.
    const res = await fetch(wrap(url), {
      redirect: "manual",
      signal: hopSignal,
      headers: HOP_HEADERS,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("relay redirected with no location");
      const next = location.startsWith("http")
        ? location
        : new URL(location, wrap(url)).toString();
      if (isImaUrl(next)) throw new Error("relay redirected to an IMA ad");
      if (!isVideoplaybackUrl(next)) throw new Error("relay redirected off-origin");
      return await fetch(wrap(next), {
        redirect: "manual",
        signal: hopSignal,
        headers: HOP_HEADERS,
      });
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function streamSameHop(id: string, itag: number, signal?: AbortSignal): Promise<Response> {
  const errors: string[] = [];
  const relays = PUBLIC_RELAYS.slice(0, 2);
  const pages = sameHopPages(id).slice(0, 2);
  for (const relay of relays) {
    for (const page of pages) {
      // A disconnected client gets no failover: stop the setup work outright.
      signal?.throwIfAborted();
      try {
        const pageRes = await hop(page, relay.wrap, 8_000, signal);
        if (!pageRes.ok) {
          errors.push(`${relay.id} ${pageRes.status}`);
          await pageRes.body?.cancel().catch(() => undefined);
          continue;
        }
        const html = await pageRes.text();
        const player = extractPlayerResponse(html);
        if (!player?.formats.length) {
          errors.push(`${relay.id} ${player?.reason || "no player"}`);
          continue;
        }
        const format = pickBypassFormat(player.formats, itag);
        if (!format) {
          errors.push(`${relay.id} no itag ${itag}`);
          continue;
        }
        const raw = await decipherRawFormat({
          url: format.url,
          signatureCipher: format.signatureCipher,
          cipher: format.cipher,
        });
        const mediaUrl = unlockStreamUrl(raw, { stripAlr: true }).url;
        const probe = await hop(appendParam(mediaUrl, "range", "0-2047"), relay.wrap, 12_000, signal);
        if (isBlock(probe.headers.get("content-type"), probe.status)) {
          errors.push(`${relay.id} probe ${probe.status}`);
          await probe.body?.cancel().catch(() => undefined);
          continue;
        }
        await probe.body?.cancel().catch(() => undefined);
        const media = await hop(mediaUrl, relay.wrap, 90_000, signal);
        if (isBlock(media.headers.get("content-type"), media.status) || !media.body) {
          errors.push(`${relay.id} media ${media.status}`);
          await media.body?.cancel().catch(() => undefined);
          continue;
        }
        const type = media.headers.get("content-type") || "application/octet-stream";
        return new Response(media.body, {
          status: 200,
          headers: {
            "Content-Type": type,
            "Content-Disposition": "attachment",
            "Cache-Control": "no-store",
            "X-Velo-Bypass": relay.id,
          },
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(`${relay.id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  }
  throw new Error(errors.slice(0, 4).join(" · ") || "Same-hop bypass missed.");
}

