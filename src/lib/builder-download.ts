import { downloadHeaders } from "@/lib/guest-id";
import { mintPoToken } from "@/lib/resolve-video";
import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";
import type { HybridStep } from "@/lib/hybrid-download";
import type { PendingSave } from "@/lib/builder-save";
import { saveMediaBlob } from "@/lib/builder-save";
import { fileBasename, type VideoPreset } from "@/lib/youtube";
import type { DownloadProgress } from "@/lib/download-client";
import { createSpeedProbe, formatSpeed } from "@/lib/speed-probe";
import { isVideoOnlyItag } from "@/lib/ytdlp-auth";
import { linkAbort } from "@/lib/abort-link";
import { nameForBlob } from "@/lib/media-name";
import { readBlob } from "@/lib/hybrid-net";
import {
  applyPresentedHop,
  emptyTransfer,
  noteFileBytes,
  presentedTransfer,
  settleTransfer,
  type PresentedTransfer,
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
  pot?: string;
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
      pot: opts.pot || "",
    }),
    signal: opts.signal,
    redirect: "error",
  });
  if (!response.ok) throw await errorFromResponse(response, "Builder");
  return assertMedia(await readBlob(response, opts.onBytes), response.headers.get("content-type"));
}

function raceBlobs(
  tasks: { run: (signal: AbortSignal) => Promise<Blob> }[],
  parent?: AbortSignal,
): Promise<Blob> {
  const abort = new AbortController();
  const detach = linkAbort(parent, abort);
  return new Promise<Blob>((resolve, reject) => {
    const errors: string[] = [];
    let open = tasks.length;
    let won = false;
    if (abort.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    abort.signal.addEventListener(
      "abort",
      () => {
        if (!won) reject(new Error("aborted"));
      },
      { once: true },
    );
    for (const task of tasks) {
      void task.run(abort.signal).then(
        (blob) => {
          if (won) return;
          won = true;
          abort.abort();
          resolve(blob);
        },
        (err) => {
          if (abort.signal.aborted && won) return;
          errors.push(err instanceof Error ? err.message : "failed");
          open -= 1;
          if (!won && open === 0) reject(new Error(errors.slice(0, 3).join(" · ")));
        },
      );
    }
  }).finally(detach);
}

export async function fetchBuilderBlob(opts: {
  videoId: string;
  itag: number;
  cookies?: string;
  pot?: string;
  signal?: AbortSignal;
  onBytes?: (loaded: number, total: number) => void;
  onProgress?: (label: string, view: PresentedTransfer) => void;
}): Promise<Blob> {
  const { fetchSameHopBlob } = await import("@/lib/bypass");
  const server = { run: (signal: AbortSignal) => fetchServerItag({ ...opts, signal }) };
  if (isVideoOnlyItag(opts.itag)) {
    return server.run(opts.signal ?? new AbortController().signal);
  }
  return raceBlobs(
    [
      server,
      {
        run: (signal) =>
          fetchSameHopBlob({
            videoId: opts.videoId,
            itag: opts.itag,
            pot: opts.pot,
            signal,
            onProgress: (label, view) => opts.onProgress?.(label, view),
          }).then((blob) => assertMedia(blob, blob.type)),
      },
    ],
    opts.signal,
  );
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

  let pot = "";
  try {
    const info = await mintPoToken({ data: { id: opts.videoId } });
    pot = info?.token ?? "";
  } catch {
    /* guest still works */
  }

  try {
    // Server already muxes 137+140 (or HLS 96) on the matching hop.
    // A second /api/builder call for audio would double quota and race two SOCKS downloads.
    const probe = createSpeedProbe();
    let lastEmit = 0;
    let transfer = emptyTransfer();
    const blob = await fetchBuilderBlob({
      videoId: opts.videoId,
      itag,
      cookies: opts.cookies,
      pot,
      signal: opts.signal,
      onProgress: (label, hopView) => {
        transfer = applyPresentedHop(transfer, hopView);
        const view = presentedTransfer(transfer);
        opts.onProgress?.({
          label,
          percent: view.percent,
          mode: view.mode,
          steps,
          ...(view.loaded != null && view.total != null ? { loaded: view.loaded, total: view.total } : {}),
        });
      },
      onBytes: (loaded, total) => {
        const sample = probe.push(loaded, total);
        // Every fetch chunk lands here — thousands per file — and each emit
        // re-renders the whole page. ~10/s is plenty for a progress bar; the
        // final chunk always goes through so completion is never held back.
        const now = performance.now();
        if (loaded !== total && now - lastEmit < 100) return;
        lastEmit = now;
        // Server bytes are their own leg. abandonFile runs only inside the
        // same-hop attempt, so an HLS tick cannot clear this loaded/total.
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
