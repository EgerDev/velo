import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const urlSchema = z.object({
  url: z.string().min(1).max(500),
});

const querySchema = z.object({
  query: z.string().min(1).max(200),
});

const probeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  itag: z.number().int().positive(),
});

const cipherSchema = z.object({
  url: z.string().max(16_000).optional(),
  signatureCipher: z.string().max(16_000).optional(),
  cipher: z.string().max(16_000).optional(),
});

export const resolveVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => urlSchema.parse(input))
  .handler(async ({ data }) => {
    const { resolveYoutubeVideo } = await import("@/lib/youtube.server");
    return resolveYoutubeVideo(data.url);
  });

export const probeDownload = createServerFn({ method: "POST" })
  .validator((input: unknown) => probeSchema.parse(input))
  .handler(async ({ data }) => {
    const { probeYoutubeDownload } = await import("@/lib/youtube.server");
    return probeYoutubeDownload(data.id, data.itag);
  });

export const searchVideos = createServerFn({ method: "POST" })
  .validator((input: unknown) => querySchema.parse(input))
  .handler(async ({ data }) => {
    const { searchYoutubeVideos } = await import("@/lib/youtube.server");
    return searchYoutubeVideos(data.query);
  });

export const decipherCipher = createServerFn({ method: "POST" })
  .validator((input: unknown) => cipherSchema.parse(input))
  .handler(async ({ data }) => {
    const { decipherRawFormat } = await import("@/lib/youtube.server");
    return decipherRawFormat(data);
  });

export const mintPoToken = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/) }).parse(input))
  .handler(async ({ data }) => {
    const { mintPoTokenDetailed } = await import("@/lib/po-token.server");
    return mintPoTokenDetailed(data.id);
  });

export const resolvePlayback = createServerFn({ method: "POST" })
  .validator((input: unknown) => probeSchema.parse(input))
  .handler(async ({ data }) => {
    const { getPlaybackUrl } = await import("@/lib/youtube.server");
    return getPlaybackUrl(data.id, data.itag);
  });

export const resolvePlaylist = createServerFn({ method: "POST" })
  .validator((input: unknown) => urlSchema.parse(input))
  .handler(async ({ data }) => {
    const { resolveYoutubePlaylist } = await import("@/lib/youtube.server");
    return resolveYoutubePlaylist(data.url);
  });

export const fetchTranscript = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
        languageCode: z.string().max(20).optional(),
        vssId: z.string().max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getTranscriptText } = await import("@/lib/youtube.server");
    return getTranscriptText(data.id, data.languageCode, data.vssId);
  });

