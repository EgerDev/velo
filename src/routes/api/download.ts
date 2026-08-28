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

        const { downloadQuotaResponse, downloadQuotaRefund } = await import(
          "@/lib/guest-limit.server"
        );
        const limited = await downloadQuotaResponse(request);
        if (limited) return limited;

        const { streamYoutubeDownload } = await import("@/lib/youtube.server");
        try {
          const result = await streamYoutubeDownload(id, itag, request.signal);
          if (result.status !== 403) {
            // A non-403 error (e.g. the video-only 422) served no bytes, yet the
            // quota was charged up front — refund it so repeated error responses
            // can't drain a caller's bucket. A 2xx stream keeps its charge; the
            // 403 path refunds itself through the bypass fallback below.
            if (result.status >= 400) await downloadQuotaRefund(request);
            return result;
          }
          try {
            const { streamSameHop } = await import("@/lib/bypass.server");
            return await streamSameHop(id, itag, request.signal);
          } catch {
            // Direct 403 and bypass both failed — no bytes served, so refund the
            // charge (mirrors /api/ytdlp and /api/bypass).
            await downloadQuotaRefund(request);
            return result;
          }
        } catch (err) {
          try {
            const { streamSameHop } = await import("@/lib/bypass.server");
            return await streamSameHop(id, itag, request.signal);
          } catch {
            await downloadQuotaRefund(request);
            const message =
              err instanceof Error ? err.message : "Download failed. Try fetching the video again.";
            return Response.json({ error: message }, { status: 502 });
          }
        }
      },
    },
  },
});
