import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { parseVideoId } from "@/lib/youtube";

export const Route = createFileRoute("/api/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const idRaw = url.searchParams.get("id") ?? "";
        const itagRaw = url.searchParams.get("itag") ?? "";
        const id = parseVideoId(idRaw);
        const itag = Number(itagRaw);

        if (!id || !Number.isInteger(itag) || itag <= 0) {
          return Response.json({ error: "Missing video or quality." }, { status: 400 });
        }

        const { downloadQuotaResponse } = await import("@/lib/guest-limit.server");
        const limited = await downloadQuotaResponse(request);
        if (limited) return limited;

        const { streamYoutubeDownload } = await import("@/lib/youtube.server");
        try {
          const result = await streamYoutubeDownload(id, itag);
          if (result.status !== 403) return result;
          try {
            const { streamSameHop } = await import("@/lib/bypass.server");
            return await streamSameHop(id, itag);
          } catch {
            return result;
          }
        } catch (err) {
          try {
            const { streamSameHop } = await import("@/lib/bypass.server");
            return await streamSameHop(id, itag);
          } catch {
            const message =
              err instanceof Error ? err.message : "Download failed. Try fetching the video again.";
            return Response.json({ error: message }, { status: 502 });
          }
        }
      },
    },
  },
});
