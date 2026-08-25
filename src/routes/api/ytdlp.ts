import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseVideoId } from "@/lib/youtube";

const bodySchema = z.object({
  id: z.string(),
  itag: z.number().int().positive(),
  cookies: z.string().max(400_000).optional(),
  pot: z.string().max(4000).optional(),
});

export const Route = createFileRoute("/api/ytdlp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) {
          return Response.json({ error: "Need a video id and quality." }, { status: 400 });
        }
        const id = parseVideoId(parsed.data.id);
        if (!id) return Response.json({ error: "Bad video id." }, { status: 400 });

        const { cookiesNeedSession, downloadQuotaResponse, downloadQuotaRefund } = await import("@/lib/guest-limit.server");
        const blocked = await cookiesNeedSession(request, parsed.data.cookies);
        if (blocked) return blocked;

        const limited = await downloadQuotaResponse(request, 1);
        if (limited) return limited;
        try {
          const { downloadWithYtdlp } = await import("@/lib/ytdlp.server");
          return await downloadWithYtdlp({
            id,
            itag: parsed.data.itag,
            cookies: parsed.data.cookies,
            pot: parsed.data.pot,
            signal: request.signal,
          });
        } catch (err) {
          await downloadQuotaRefund(request, 1);
          const { isQueueError } = await import("@/lib/download-pool.server");
          if (isQueueError(err)) {
            const message = err instanceof Error ? err.message : "Lots of people are saving right now.";
            return Response.json(
              { error: message, code: "queue" },
              { status: 503, headers: { "Retry-After": "8" } },
            );
          }
          const message = err instanceof Error ? err.message : "yt-dlp failed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});