import { fileBasename, type VideoPreset } from "@/lib/youtube";
import type { HybridStep } from "@/lib/hybrid-download";
import { classifyDownloadError, isUserAbort, shouldEscalateSave, type DownloadErrorCode } from "@/lib/download-error";
import { beginBuilderSave, saveMediaBlob, type PendingSave } from "@/lib/builder-save";

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
  if (opts.signal) {
    if (opts.signal.aborted) abort.abort();
    else opts.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  onProgress({ label: "Hybrid: PO token + cookies + relays", percent: 8 });
  try {
    const [videoBlob, audioBlob] = await Promise.all([
      hybridFetchBlob({
        videoId,
        itag: preset.itag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, percent) => onProgress({ label: `Video · ${label}`, percent: Math.round(percent * 0.42) }),
        onSteps: (steps) => onProgress({ label: "Video · hybrid", percent: 20, steps }),
      }),
      hybridFetchBlob({
        videoId,
        itag: preset.audioItag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, percent) =>
          onProgress({ label: `Audio · ${label}`, percent: 42 + Math.round(percent * 0.4) }),
      }),
    ]);
    onProgress({ label: "Combining video + audio", percent: 84 });
    const { muxVideoAudio } = await import("@/lib/mux-client");
    const ext = preset.ext === "webm" ? "webm" : "mp4";
    const merged = await muxVideoAudio(videoBlob, audioBlob, ext, (progress) => {
      onProgress({
        label: "Combining video + audio",
        percent: Math.min(99, 84 + Math.round(progress * 15)),
      });
    });
    onProgress({ label: "Saving file", percent: 100 });
    if (opts.signal?.aborted) throw new Error("aborted");
    await saveMediaBlob(merged, `${fileBasename(title)}.${preset.ext}`, opts.pendingSave, {
      videoId,
      itag: preset.itag,
    }, opts.signal);
  } catch (err) {
    abort.abort();
    throw err;
  }
}

export async function downloadPresetFile(opts: {
  videoId: string;
  title: string;
  preset: VideoPreset;
  muxedFallback?: VideoPreset | null;
  signedIn?: boolean;
  pendingSave?: PendingSave;
  signal?: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}): Promise<DownloadOutcome> {
  const { videoId, title, preset, onProgress, signedIn } = opts;
  const base = fileBasename(title);
  const name = `${base}.${preset.ext}`;
  const pending = opts.pendingSave ?? beginBuilderSave(name);
  const { cookiesForDownload } = await import("@/lib/cookie-store");
  const cookies = cookiesForDownload(signedIn);

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
}
