import "@/lib/ipv4-bind.server";
import { createFileRoute } from "@tanstack/react-router";
import { isMediaHostTarget, isRelayTarget, publicRelayUrls } from "@/lib/cors-relays";

/** Overall ceiling per upstream hop so a stalled relay cannot pin a connection. */
const RELAY_HOP_TIMEOUT_MS = 20_000;

/**
 * The upstream headers worth forwarding to the client.
 *
 * `Range` is forwarded upstream and the status is passed straight through, so a
 * 206 must carry its `Content-Range` — without it the client sees a partial body
 * described as a complete one, which breaks seeking and resume-after-failure.
 *
 * `Content-Length` is only safe when upstream sent identity: `fetch` has already
 * decoded gzip/br, so a compressed length would truncate the body. Media is
 * normally uncompressed, so progress reporting still gets a length.
 */
function relayHeaders(upstream: Response, relayHost: string): Record<string, string> {
  const out: Record<string, string> = { "Cache-Control": "no-store", "X-Velo-Relay": relayHost };
  const copy = (from: string, to: string) => {
    const value = upstream.headers.get(from);
    if (value) out[to] = value;
  };
  copy("content-type", "Content-Type");
  copy("content-range", "Content-Range");
  copy("accept-ranges", "Accept-Ranges");
  copy("content-disposition", "Content-Disposition");
  if (!upstream.headers.get("content-encoding")) copy("content-length", "Content-Length");
  return out;
}

export const Route = createFileRoute("/api/relay")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        if (!isRelayTarget(target)) {
          return Response.json(
            { error: "Relay only fetches YouTube / googlevideo HTTPS URLs." },
            { status: 400 },
          );
        }

        const { downloadQuotaResponse, downloadQuotaRefund, metadataBackstopResponse } =
          await import("@/lib/guest-limit.server");
        // Meter EVERY request. googlevideo bytes (any path) spend a download
        // token; page/HTML fetches clear the cheap per-IP metadata backstop.
        // Without this the non-media path was an unauthenticated, uncapped proxy
        // that also amplified onto three third-party CORS services per request.
        const media = isMediaHostTarget(target);
        if (media) {
          const limited = await downloadQuotaResponse(request, 1);
          if (limited) return limited;
        } else {
          const limited = metadataBackstopResponse(request);
          if (limited) return limited;
        }

        const range = request.headers.get("range") ?? undefined;
        const attempts = [target, ...publicRelayUrls(target)];
        const errors: string[] = [];

        for (const href of attempts) {
          if (request.signal.aborted) break;
          try {
            const headers: Record<string, string> = {
              accept: "*/*",
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
              referer: "https://www.youtube.com/",
            };
            if (range) headers.range = range;
            const signal = AbortSignal.any([
              request.signal,
              AbortSignal.timeout(RELAY_HOP_TIMEOUT_MS),
            ]);
            const upstream = await fetch(href, { headers, redirect: "manual", signal });
            if (upstream.status >= 300 && upstream.status < 400) {
              const location = upstream.headers.get("location");
              await upstream.body?.cancel().catch(() => undefined);
              if (!location || !isRelayTarget(new URL(location, href).toString())) {
                errors.push(`${new URL(href).hostname} redirect`);
                continue;
              }
              const hopped = await fetch(new URL(location, href).toString(), {
                headers,
                redirect: "manual",
                signal,
              });
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
              return new Response(hopped.body, {
                status: hopped.status,
                headers: relayHeaders(hopped, new URL(href).hostname),
              });
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
            return new Response(upstream.body, {
              status: upstream.status,
              headers: relayHeaders(upstream, new URL(href).hostname),
            });
          } catch (err) {
            errors.push(err instanceof Error ? err.message : "relay failed");
          }
        }

        if (media) await downloadQuotaRefund(request, 1);
        return Response.json(
          { error: errors.slice(0, 4).join(" · ") || "Every relay missed." },
          { status: 502 },
        );
      },
    },
  },
});
