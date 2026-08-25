import "@/lib/ipv4-bind.server";
import { PUBLIC_RELAYS } from "@/lib/cors-relays";
import {
  appendParam,
  extractPlayerResponse,
  pickBypassFormat,
  sameHopPages,
} from "@/lib/bypass-parse";
import { decipherRawFormat } from "@/lib/youtube.server";
import { unlockStreamUrl } from "@/lib/stream-unlock";

function isBlock(type: string | null, status: number): boolean {
  if (status < 200 || status >= 300) return true;
  const mime = (type ?? "").toLowerCase();
  return mime.includes("text/html") || mime.includes("application/json");
}

async function hop(url: string, wrap: (value: string) => string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(wrap(url), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "*/*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        referer: "https://www.youtube.com/",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function streamSameHop(id: string, itag: number): Promise<Response> {
  const errors: string[] = [];
  const relays = PUBLIC_RELAYS.slice(0, 2);
  const pages = sameHopPages(id).slice(0, 2);
  for (const relay of relays) {
    for (const page of pages) {
      try {
        const pageRes = await hop(page, relay.wrap, 8_000);
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
        const probe = await hop(appendParam(mediaUrl, "range", "0-2047"), relay.wrap, 12_000);
        if (isBlock(probe.headers.get("content-type"), probe.status)) {
          errors.push(`${relay.id} probe ${probe.status}`);
          await probe.body?.cancel().catch(() => undefined);
          continue;
        }
        await probe.body?.cancel().catch(() => undefined);
        const media = await hop(mediaUrl, relay.wrap, 90_000);
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
        errors.push(`${relay.id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  }
  throw new Error(errors.slice(0, 4).join(" · ") || "Same-hop bypass missed.");
}

