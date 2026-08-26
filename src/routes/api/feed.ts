import { createFileRoute } from "@tanstack/react-router";
import { feedUrlForChannelId, parseChannelFeed, parseChannelInput } from "@/lib/watch-feed";

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Resolve an @handle / user / custom channel URL to its UC… id by reading the
 * channel page (YouTube embeds `"externalId":"UC…"` / canonical link). Returns
 * null when nothing resolvable is found.
 */
async function resolveChannelId(raw: string): Promise<string | null> {
  const ref = parseChannelInput(raw);
  if (!ref) return null;
  if ("channelId" in ref) return ref.channelId;
  const path =
    "handle" in ref
      ? `@${ref.handle}`
      : "vanity" in ref
        ? `c/${ref.vanity}`
        : `user/${ref.user}`;
  const page = await fetch(`https://www.youtube.com/${path}`, {
    headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!page.ok) return null;
  const html = await page.text();
  const match =
    html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) ??
    html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ??
    html.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  return match?.[1] ?? null;
}

/**
 * Server-side fetch of a channel's public Atom feed. YouTube's feeds host does
 * not send CORS headers, so the browser can't read it directly — this route is
 * the proxy. Accepts either a resolved `channelId` or a raw `channel` input
 * (@handle, /channel/…, /user/…), and is locked to validated channel ids so it
 * can't be used as an open fetch relay.
 */
export const Route = createFileRoute("/api/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const rawChannel = params.get("channel") ?? "";
        const directId = params.get("channelId") ?? "";

        // Resolving a raw @handle/vanity fetches a YouTube page server-side, so
        // gate the route on the cheap per-IP backstop before any upstream work.
        const { metadataBackstopResponse } = await import("@/lib/guest-limit.server");
        const limited = metadataBackstopResponse(request);
        if (limited) return limited;

        let channelId = CHANNEL_ID_RE.test(directId) ? directId : "";
        if (!channelId && rawChannel) {
          try {
            channelId = (await resolveChannelId(rawChannel)) ?? "";
          } catch {
            channelId = "";
          }
        }
        if (!CHANNEL_ID_RE.test(channelId)) {
          return Response.json(
            { error: "Couldn’t resolve that channel. Paste a channel URL, @handle, or UC… id." },
            { status: 400 },
          );
        }

        try {
          const upstream = await fetch(feedUrlForChannelId(channelId), {
            headers: { accept: "application/atom+xml,text/xml" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!upstream.ok) {
            return Response.json({ error: `Feed unavailable (${upstream.status}).` }, { status: 502 });
          }
          const feed = parseChannelFeed(await upstream.text());
          if (!feed.videos.length) {
            return Response.json({ error: "No videos found for that channel." }, { status: 404 });
          }
          // The id we fetched with is authoritative — the feed header can carry a
          // prefix-stripped variant, and the client refetches by this id.
          return Response.json({ ...feed, channelId }, { headers: { "Cache-Control": "public, max-age=600" } });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not read that channel feed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
