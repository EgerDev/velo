/**
 * Grok Builder media pipe: YouTube bytes never leave this origin.
 * The preview iframe cannot follow googlevideo.com (IP-bound, no download attr).
 * All three server paths run here so the browser only talks to `/api/builder`.
 */

function isMediaResponse(response: Response): boolean {
  if (response.status !== 200 || !response.body) return false;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  return !type.includes("application/json") && !type.includes("text/html") && !type.includes("text/plain");
}

function tag(response: Response, via: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Velo-Builder", via);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "no-store");
  if (!headers.get("Content-Disposition")) {
    headers.set("Content-Disposition", "attachment");
  }
  return new Response(response.body, { status: 200, headers });
}

export async function streamBuilderDownload(opts: {
  id: string;
  itag: number;
  cookies?: string;
  pot?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const errors: string[] = [];
  const muxed = opts.itag === 18 || opts.itag === 22;

  const tryInnertube = async () => {
    const { streamYoutubeDownload } = await import("@/lib/youtube.server");
    const result = await streamYoutubeDownload(opts.id, opts.itag);
    if (isMediaResponse(result)) return tag(result, "innertube");
    let detail = `innertube ${result.status}`;
    try {
      const data = (await result.clone().json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      /* ignore */
    }
    await result.body?.cancel().catch(() => undefined);
    throw new Error(detail);
  };

  const tryYtdlp = async () => {
    const { downloadWithYtdlp } = await import("@/lib/ytdlp.server");
    const result = await downloadWithYtdlp({
      id: opts.id,
      itag: opts.itag,
      cookies: opts.cookies,
      pot: opts.pot,
      signal: opts.signal,
    });
    if (isMediaResponse(result)) return tag(result, "ytdlp");
    await result.body?.cancel().catch(() => undefined);
    throw new Error(`yt-dlp ${result.status}`);
  };

  const order = muxed ? [tryInnertube, tryYtdlp] : [tryYtdlp];
  for (const step of order) {
    try {
      return await step();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      if (opts.signal?.aborted || /^aborted$/i.test(msg)) throw err;
      errors.push(msg);
    }
  }

  throw new Error(
    errors.slice(0, 4).join(" · ") ||
      "YouTube blocked every Builder path. Sign in and import cookies, then try again.",
  );
}
