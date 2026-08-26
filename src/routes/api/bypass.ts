import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { parseVideoId } from "@/lib/youtube";

export const Route = createFileRoute("/api/bypass")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = parseVideoId(url.searchParams.get("id") ?? "");
        const itag = Number(url.searchParams.get("itag") ?? "");
        if (!id || !Number.isInteger(itag) || itag <= 0) {
          return Response.json({ error: "Missing video or quality." }, { status: 400 });
        }

        const { downloadQuotaResponse, downloadQuotaRefund } = await import("@/lib/guest-limit.server");
        const limited = await downloadQuotaResponse(request, 1);
        if (limited) return limited;

        try {
          const { streamSameHop } = await import("@/lib/bypass.server");
          return await streamSameHop(id, itag, request.signal);
        } catch (err) {
          await downloadQuotaRefund(request, 1);
          const message = err instanceof Error ? err.message : "Bypass missed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
