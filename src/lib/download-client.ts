import { fileBasename, type VideoPreset } from "@/lib/youtube";
import type { HybridStep } from "@/lib/hybrid-download";
import { classifyDownloadError, isUserAbort, shouldEscalateSave, type DownloadErrorCode } from "@/lib/download-error";
import {
  beginBuilderSave,
  discardPendingSave,
  saveMediaBlob,
  type PendingSave,
} from "@/lib/builder-save";
import { linkAbort } from "@/lib/abort-link";

export type DownloadProgress = {
  label: string;
  percent: number;
  steps?: HybridStep[];
  failed?: boolean;
  errorCode?: DownloadErrorCode;
  hint?: string;
  bytesPerSec?: number;
  loaded?: number;
  total?: number;
  throttled?: boolean;
};

export type OfferedFile = {
  url: string;
  filename: string;
  mime: string;
  kind: "video" | "audio" | "av";
  qualityLabel: string;
  itag: number;
};

export type DownloadOutcome = {
  mode: "merged";
  itag: number;
  ext: string;
  title: string;
};

async function hybridMux(opts: {
  videoId: string;
  title: string;
  preset: VideoPreset;
  signedIn?: boolean;
  pendingSave?: PendingSave;
  signal?: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}): Promise<void> {
  const { videoId, title, preset, onProgress } = opts;
  if (!preset.audioItag) throw new Error("No audio track.");
  const { hybridFetchBlob } = await import("@/lib/hybrid-download");
  const { cookiesForDownload } = await import("@/lib/cookie-store");
  const cookies = cookiesForDownload(opts.signedIn);
  const abort = new AbortController();
  const detach = linkAbort(opts.signal, abort);
  onProgress({ label: "Hybrid: PO token + cookies + relays", percent: 8 });
  try {
    // The two legs run concurrently, so their progress must fold into ONE
    // monotonic number — mapping each to a sequential 0–42 / 42–82 window made
    // the single reported percent thrash backwards on every interleaved event.
    // Track each leg's fraction and emit the weighted sum (video 42, audio 40).
    let videoFrac = 0;
    let audioFrac = 0;
    let steps: HybridStep[] | undefined;
    const combined = () => Math.round(videoFrac * 42 + audioFrac * 40);
    const [videoBlob, audioBlob] = await Promise.all([
      hybridFetchBlob({
        videoId,
        itag: preset.itag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, percent) => {
          videoFrac = percent / 100;
          onProgress({ label: `Video · ${label}`, percent: combined(), steps });
        },
        onSteps: (next) => {
          steps = next;
          onProgress({ label: "Video · hybrid", percent: combined(), steps });
        },
      }),
      hybridFetchBlob({
        videoId,
        itag: preset.audioItag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, percent) => {
          audioFrac = percent / 100;
          onProgress({ label: `Audio · ${label}`, percent: combined(), steps });
        },
      }),
    ]);
    if (opts.signal?.aborted) throw new Error("aborted");
    onProgress({ label: "Combining video + audio", percent: 84 });
    const { muxVideoAudio } = await import("@/lib/mux-client");
    const ext = preset.ext === "webm" ? "webm" : "mp4";
    const merged = await muxVideoAudio(
      videoBlob,
      audioBlob,
      ext,
      (progress) => {
        onProgress({
          label: "Combining video + audio",
          percent: Math.min(99, 84 + Math.round(progress * 15)),
        });
      },
      opts.signal,
    );
    onProgress({ label: "Saving file", percent: 100 });
    if (opts.signal?.aborted) throw new Error("aborted");
    await saveMediaBlob(merged, `${fileBasename(title)}.${preset.ext}`, opts.pendingSave, {
      videoId,
      itag: preset.itag,
    }, opts.signal);
  } catch (err) {
    abort.abort();
    throw err;
  } finally {
    detach();
  }
}

export async function downloadPresetFile(opts: {
  videoId: string;
  title: string;
  preset: VideoPreset;
  signedIn?: boolean;
  pendingSave?: PendingSave;
  signal?: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}): Promise<DownloadOutcome> {
  const { videoId, title, preset, onProgress, signedIn } = opts;
  const base = fileBasename(title);
  const name = `${base}.${preset.ext}`;
  // Release the picker handle on failure only when we opened it here; when the
  // caller passed one in, the caller owns its disposal.
  const owned = !opts.pendingSave;
  const pending = opts.pendingSave ?? beginBuilderSave(name);
  const { cookiesForDownload } = await import("@/lib/cookie-store");
  const cookies = cookiesForDownload(signedIn);

  try {
    try {
      const { downloadViaBuilder } = await import("@/lib/builder-download");
      await downloadViaBuilder({
        videoId,
        title,
        filename: name,
        preset,
        cookies,
        pendingSave: pending,
        signal: opts.signal,
        onProgress,
      });
      return { mode: "merged", itag: preset.itag, ext: preset.ext, title: preset.title };
    } catch (builderErr) {
      if (isUserAbort(builderErr, opts.signal)) throw builderErr;
      if (!shouldEscalateSave(builderErr)) throw classifyDownloadError(builderErr);

      onProgress({
        label: "Builder pipe missed — trying the hybrid race",
        percent: 24,
      });
      try {
        if (!preset.audioItag || preset.audioItag === 251) {
          if (!preset.audioItag && (preset.kind === "video" || preset.hasAudio === false)) {
            throw new Error("Need an audio track for this quality.");
          }
          const { downloadViaHybrid } = await import("@/lib/hybrid-download");
          await downloadViaHybrid({
            videoId,
            itag: preset.itag,
            filename: name,
            cookies,
            pendingSave: pending,
            signal: opts.signal,
            onProgress: (label, percent) => onProgress({ label, percent }),
          });
          return { mode: "merged", itag: preset.itag, ext: preset.ext, title: preset.title };
        }
        await hybridMux({
          videoId,
          title,
          preset,
          signedIn,
          pendingSave: pending,
          signal: opts.signal,
          onProgress,
        });
        return { mode: "merged", itag: preset.itag, ext: preset.ext, title: preset.title };
      } catch (hybridErr) {
        if (isUserAbort(hybridErr, opts.signal)) throw hybridErr;
        const { downloadHint } = await import("@/lib/download-error");
        const error = classifyDownloadError(
          [
            builderErr instanceof Error ? builderErr.message : "Builder failed",
            hybridErr instanceof Error ? hybridErr.message : "Hybrid failed",
          ].join(" · "),
        );
        onProgress({
          label: error.message,
          percent: 100,
          failed: true,
          errorCode: error.code,
          hint: downloadHint(error.code, !signedIn),
        });
        throw error;
      }
    }
  } catch (err) {
    if (owned) void discardPendingSave(pending);
    throw err;
  }
}
