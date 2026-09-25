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
import {
  emptyTransfer,
  foldMuxView,
  foldTransferProgress,
  presentedTransfer,
  settleTransfer,
  type PresentedTransfer,
} from "@/lib/transfer-progress";

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
  aborted?: boolean;
  /** How to read `percent`. Stage-only is indeterminate; segments are not bytes. */
  mode?: "preparing" | "bytes" | "segments" | "complete" | "failed" | "aborted";
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

/**
 * The in-browser mux holds its whole output in one buffer (MP4 fast-start) and
 * copies it into the saved Blob — about 2x the file in the tab at the peak. On
 * a long 1080p file that crashes a phone, so refuse up front: ~15% of device
 * RAM per file (navigator.deviceMemory; 4 GB assumed where the API is absent).
 * ponytail: size cap, not a streaming muxer; stream (fragmented MP4) if this
 * fallback ever carries large files routinely.
 */
function assertBrowserMuxFits(bytes: number | null | undefined) {
  if (!bytes) return;
  const deviceGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const limit = Math.min(1.5 * 2 ** 30, deviceGb * 2 ** 30 * 0.15);
  if (bytes > limit) {
    throw new Error(
      `This file (${Math.round(bytes / 2 ** 20)} MB) is too large to combine in the browser on this device. Try again in a moment, or pick a lower quality.`,
    );
  }
}

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
  // Before downloading: don't spend the bandwidth on a file we can't combine.
  assertBrowserMuxFits(preset.size);
  const { hybridFetchBlob } = await import("@/lib/hybrid-download");
  const { cookiesForDownload } = await import("@/lib/cookie-store");
  const cookies = cookiesForDownload(opts.signedIn);
  const abort = new AbortController();
  const detach = linkAbort(opts.signal, abort);
  // Don't seed the idle leg at 0. A video reading has to be able to stand
  // alone so a later audio tick cannot average it backward.
  let transfer = emptyTransfer();
  onProgress({ label: "Trying yt-dlp and the relay", ...presentedTransfer(transfer) });
  try {
    // Each child view is folded whole: bytes keep loaded/total, segments stay
    // segments. Keeping only the percent turned 500/1000 + 100/100 into a
    // stage average and the panel called that "no progress".
    let steps: HybridStep[] | undefined;
    const emit = (label: string, id: "video" | "audio", view: PresentedTransfer) => {
      transfer = foldMuxView(transfer, id, view);
      onProgress({ label, ...presentedTransfer(transfer), steps });
    };
    const [videoBlob, audioBlob] = await Promise.all([
      hybridFetchBlob({
        videoId,
        itag: preset.itag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, view) => emit(`Video · ${label}`, "video", view),
        onSteps: (next) => {
          steps = next;
          onProgress({ label: "Video · hybrid", ...presentedTransfer(transfer), steps });
        },
      }),
      hybridFetchBlob({
        videoId,
        itag: preset.audioItag,
        audioItag: preset.audioItag,
        cookies,
        signal: abort.signal,
        onProgress: (label, view) => emit(`Audio · ${label}`, "audio", view),
      }),
    ]);
    if (opts.signal?.aborted) throw new Error("aborted");
    assertBrowserMuxFits(videoBlob.size + audioBlob.size); // when preset.size was unknown
    onProgress({ label: "Combining video + audio", ...presentedTransfer(transfer) });
    const { muxVideoAudio } = await import("@/lib/mux-client");
    const ext = preset.ext === "webm" ? "webm" : "mp4";
    const merged = await muxVideoAudio(
      videoBlob,
      audioBlob,
      ext,
      (progress) => {
        transfer = foldTransferProgress(transfer, { id: "mux", percent: Math.round(progress * 100) });
        onProgress({
          label: "Combining video + audio",
          ...presentedTransfer(transfer),
        });
      },
      opts.signal,
    );
    if (opts.signal?.aborted) throw new Error("aborted");
    await saveMediaBlob(merged, `${fileBasename(title)}.${preset.ext}`, opts.pendingSave, {
      videoId,
      itag: preset.itag,
    }, opts.signal);
    transfer = settleTransfer(transfer, "complete");
    onProgress({ label: "Saved", ...presentedTransfer(transfer) });
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
            onProgress: (label, view) => onProgress({ label, ...view }),
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
        const failed = presentedTransfer(settleTransfer(emptyTransfer(), "failed"));
        onProgress({
          label: error.message,
          percent: failed.percent,
          mode: failed.mode,
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
