import { createFileRoute } from "@tanstack/react-router";
import { parseVideoId } from "@/lib/youtube";

const LANG_RE = /^[a-zA-Z0-9_-]{2,20}$/;
const VSS_RE = /^[a-zA-Z0-9._~@-]{1,50}$/;

export const Route = createFileRoute("/api/captions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = parseVideoId(url.searchParams.get("id") ?? "");
        const lang = url.searchParams.get("lang") ?? "";
        const vss = url.searchParams.get("vss") ?? "";

        if (!id || !LANG_RE.test(lang) || !VSS_RE.test(vss)) {
          return Response.json({ error: "Missing video or caption track." }, { status: 400 });
        }

        // A caption lookup fans out to up to ~14 InnerTube calls plus a BotGuard
        // mint, so an unmetered flood of attacker-chosen ids can get the server
        // IP rate-banned by YouTube. Clear the cheap per-IP backstop first.
        const { metadataBackstopResponse } = await import("@/lib/guest-limit.server");
        const limited = metadataBackstopResponse(request);
        if (limited) return limited;

        const { streamYoutubeCaptions } = await import("@/lib/youtube.server");
        try {
          return await streamYoutubeCaptions(id, lang, vss);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Could not download captions.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
