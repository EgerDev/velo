import { downloadHeaders } from "@/lib/guest-id";
import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";
import type { HybridStep } from "@/lib/hybrid-download";
import type { PendingSave } from "@/lib/builder-save";
import { saveMediaBlob } from "@/lib/builder-save";
import { fileBasename, type VideoPreset } from "@/lib/youtube";
import type { DownloadProgress } from "@/lib/download-client";
import { createSpeedProbe, formatSpeed } from "@/lib/speed-probe";
import { nameForBlob } from "@/lib/media-name";
import { readBlob } from "@/lib/hybrid-net";
import {
  emptyTransfer,
  noteFileBytes,
  presentedTransfer,
  settleTransfer,
} from "@/lib/transfer-progress";

function assertMedia(blob: Blob, type: string | null): Blob {
  const mime = type ?? blob.type;
  if (mime.includes("text/html") || mime.includes("application/json") || mime.includes("text/plain")) {
    throw new Error("Got a block page instead of media.");
  }
  if (blob.size < 2048) throw new Error("Empty stream.");
  return blob;
}

async function fetchServerItag(opts: {
  videoId: string;
  itag: number;
  cookies?: string;
  signal?: AbortSignal;
  onBytes?: (loaded: number, total: number) => void;
}): Promise<Blob> {
  const headers = downloadHeaders({ "content-type": "application/json" });
  const response = await fetch("/api/builder", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: opts.videoId,
      itag: opts.itag,
      cookies: opts.cookies || "",
    }),
    signal: opts.signal,
    redirect: "error",
  });
  if (!response.ok) throw await errorFromResponse(response, "Builder");
  return assertMedia(await readBlob(response, opts.onBytes), response.headers.get("content-type"));
}

export async function downloadViaBuilder(opts: {
  videoId: string;
  title?: string;
  filename: string;
  preset?: VideoPreset;
  itag?: number;
  cookies?: string;
  signal?: AbortSignal;
  pendingSave?: PendingSave;
  onProgress?: (progress: DownloadProgress) => void;
  onSteps?: (steps: HybridStep[]) => void;
}): Promise<void> {
  const itag = opts.itag ?? opts.preset?.itag;
  if (!itag) throw new Error("Missing quality.");
  const steps: HybridStep[] = [
    { id: "builder", label: "Matching hop — player and file share one IP", status: "running" },
  ];
  opts.onSteps?.(steps.slice());
  opts.onProgress?.({ label: "Preparing the file on the server", percent: 8, mode: "preparing", steps });

  try {
    // Server already muxes 137+140 (or HLS 96) on the matching hop.
    // A second /api/builder call for audio would double quota and race two SOCKS downloads.
    const probe = createSpeedProbe();
    let lastEmit = 0;
    let transfer = emptyTransfer();
    const blob = await fetchServerItag({
      videoId: opts.videoId,
      itag,
      cookies: opts.cookies,
      signal: opts.signal,
      onBytes: (loaded, total) => {
        const sample = probe.push(loaded, total);
        // Every fetch chunk lands here — thousands per file — and each emit
        // re-renders the whole page. ~10/s is plenty for a progress bar; the
        // final chunk always goes through so completion is never held back.
        const now = performance.now();
        if (loaded !== total && now - lastEmit < 100) return;
        lastEmit = now;
        transfer = noteFileBytes(transfer, "server", loaded, total);
        const view = presentedTransfer(transfer);
        opts.onProgress?.({
          label: sample.throttled
            ? `Throttled · ${formatSpeed(sample.bytesPerSec)} — nsig crawl`
            : `Downloading · ${formatSpeed(sample.bytesPerSec)}`,
          percent: view.percent,
          mode: view.mode,
          steps,
          bytesPerSec: sample.bytesPerSec,
          throttled: sample.throttled,
          ...(view.loaded != null && view.total != null ? { loaded: view.loaded, total: view.total } : {}),
        });
      },
    });
    steps[0] = {
      id: "builder",
      label: opts.preset?.audioItag
        ? `${opts.preset.height ?? 1080}p hop — video+AAC muxed on this origin`
        : "Matching hop — player and file share one IP",
      status: "ok",
      detail: opts.preset?.audioItag ? "137+aac" : "saved",
    };
    if (opts.signal?.aborted) throw new Error("aborted");
    const name = nameForBlob(opts.filename || `${fileBasename(opts.title || "video")}.mp4`, blob);
    await saveMediaBlob(blob, name, opts.pendingSave, { videoId: opts.videoId, itag }, opts.signal);
    transfer = settleTransfer(transfer, "complete");
    opts.onProgress?.({ label: "Saved", percent: presentedTransfer(transfer).percent, mode: "complete", steps });
  } catch (err) {
    steps[0] = {
      id: "builder",
      label: "Builder pipe (this origin + same-hop)",
      status: "fail",
      detail: err instanceof Error ? err.message : "failed",
    };
    opts.onSteps?.(steps.slice());
    throw classifyDownloadError(err);
  }
}
