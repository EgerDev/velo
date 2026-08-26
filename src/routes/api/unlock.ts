import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseVideoId } from "@/lib/youtube";

const bodySchema = z.object({
  url: z.string().max(16_000).optional(),
  signatureCipher: z.string().max(16_000).optional(),
  cipher: z.string().max(16_000).optional(),
  videoId: z.string().max(20).optional(),
  cpn: z.string().max(32).optional(),
  pot: z.boolean().optional(),
});

export const Route = createFileRoute("/api/unlock")({
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
        if (!parsed.success) return Response.json({ error: "Need a stream URL." }, { status: 400 });
        const data = parsed.data;
        if (!data.url && !data.signatureCipher && !data.cipher) {
          return Response.json({ error: "Need a stream URL." }, { status: 400 });
        }
        const videoId = data.videoId ? parseVideoId(data.videoId) : undefined;

        // Server-side decipher (nsig VM) runs on every call and a BotGuard mint
        // when pot+videoId are set; without a quota gate an unauthenticated
        // caller rotating videoId defeats the mint cache and pins CPU + outbound
        // fetches. Every other expensive route gates the same way.
        const { downloadQuotaResponse, downloadQuotaRefund } = await import(
          "@/lib/guest-limit.server"
        );
        const limited = await downloadQuotaResponse(request, 1);
        if (limited) return limited;

        try {
          const { unlockPlaybackUrl } = await import("@/lib/youtube.server");
          const { analyzeStreamUrl } = await import("@/lib/stream-unlock");
          const unlocked = await unlockPlaybackUrl({ ...data, videoId: videoId ?? undefined });
          return Response.json({
            url: unlocked.url,
            applied: unlocked.applied,
            report: analyzeStreamUrl(unlocked.url),
          });
        } catch (err) {
          await downloadQuotaRefund(request, 1);
          const message = err instanceof Error ? err.message : "Unlock failed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
