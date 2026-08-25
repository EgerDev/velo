import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { isRelayTarget, publicRelayUrls } from "@/lib/cors-relays";
import { isVideoplaybackUrl } from "@/lib/bypass-parse";

export const Route = createFileRoute("/api/relay")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        if (!isRelayTarget(target)) {
          return Response.json({ error: "Relay only fetches YouTube / googlevideo HTTPS URLs." }, { status: 400 });
        }

        const { downloadQuotaResponse, downloadQuotaRefund } = await import("@/lib/guest-limit.server");
        const media = isVideoplaybackUrl(target);
        if (media) {
          const limited = await downloadQuotaResponse(request, 1);
          if (limited) return limited;
        }

        const range = request.headers.get("range") ?? undefined;
        const attempts = [target, ...publicRelayUrls(target)];
        const errors: string[] = [];

        for (const href of attempts) {
          try {
            const headers: Record<string, string> = {
              accept: "*/*",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
              referer: "https://www.youtube.com/",
            };
            if (range) headers.range = range;
            const upstream = await fetch(href, { headers, redirect: "manual" });
            if (upstream.status >= 300 && upstream.status < 400) {
              const location = upstream.headers.get("location");
              await upstream.body?.cancel().catch(() => undefined);
              if (!location || !isRelayTarget(new URL(location, href).toString())) {
                errors.push(`${new URL(href).hostname} redirect`);
                continue;
              }
              const hopped = await fetch(new URL(location, href).toString(), { headers, redirect: "manual" });
              if (hopped.status >= 300 && hopped.status < 400) {
                await hopped.body?.cancel().catch(() => undefined);
                errors.push(`${new URL(href).hostname} extra-redirect`);
                continue;
              }
              if (!hopped.ok) {
                errors.push(`${new URL(href).hostname} ${hopped.status}`);
                await hopped.body?.cancel().catch(() => undefined);
                continue;
              }
              const hopType = hopped.headers.get("content-type") ?? "";
              const hopOut: Record<string, string> = {
                "Cache-Control": "no-store",
                "X-Velo-Relay": new URL(href).hostname,
              };
              if (hopType) hopOut["Content-Type"] = hopType;
              return new Response(hopped.body, { status: hopped.status, headers: hopOut });
            }
            const type = upstream.headers.get("content-type") ?? "";
            if (!upstream.ok) {
              errors.push(`${new URL(href).hostname} ${upstream.status}`);
              await upstream.body?.cancel().catch(() => undefined);
              continue;
            }
            if (type.includes("text/html") && /googlevideo\.com/i.test(target)) {
              errors.push(`${new URL(href).hostname} html`);
              await upstream.body?.cancel().catch(() => undefined);
              continue;
            }
            const out: Record<string, string> = {
              "Cache-Control": "no-store",
              "X-Velo-Relay": new URL(href).hostname,
            };
            if (type) out["Content-Type"] = type;
            const length = upstream.headers.get("content-length");
            if (length) out["Content-Length"] = length;
            const disposition = upstream.headers.get("content-disposition");
            if (disposition) out["Content-Disposition"] = disposition;
            return new Response(upstream.body, { status: upstream.status, headers: out });
          } catch (err) {
            errors.push(err instanceof Error ? err.message : "relay failed");
          }
        }

        if (media) await downloadQuotaRefund(request, 1);
        return Response.json({ error: errors.slice(0, 4).join(" · ") || "Every relay missed." }, { status: 502 });
      },
    },
  },
});
