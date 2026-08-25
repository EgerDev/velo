import { createFileRoute } from "@tanstack/react-router";
import { parseVideoId } from "@/lib/youtube";

const LANG_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,8})?$/;
const VSS_RE = /^[a-zA-Z0-9._-]{1,24}$/;

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
