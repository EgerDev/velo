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

function assertMedia(blob: Blob, type: string | null): Blob {
  const mime = type ?? blob.type;
  if (mime.includes("text/html") || mime.includes("application/json") || mime.includes("text/plain")) {
    throw new Error("Got a block page instead of media.");
  }
  if (blob.size < 2048) throw new Error("Empty stream.");
  return blob;
}

async function readBlob(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  if (!response.body) return response.blob();
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onBytes?.(loaded, total);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([bytes.buffer], {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
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
  onProgress?: (label: string, percent: number) => void;
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
            onProgress: (label, percent) => opts.onProgress?.(label, percent),
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
  opts.onProgress?.({ label: "Builder pipe — server and same-hop race", percent: 8, steps });

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
    const blob = await fetchBuilderBlob({
      videoId: opts.videoId,
      itag,
      cookies: opts.cookies,
      pot,
      signal: opts.signal,
      onProgress: (label, percent) => opts.onProgress?.({ label, percent, steps }),
      onBytes: (loaded, total) => {
        const sample = probe.push(loaded, total);
        const percent = total > 0 ? Math.min(96, 8 + Math.round((loaded / total) * 88)) : 24;
        opts.onProgress?.({
          label: sample.throttled
            ? `Throttled · ${formatSpeed(sample.bytesPerSec)} — nsig crawl`
            : `Downloading · ${formatSpeed(sample.bytesPerSec)}`,
          percent,
          steps,
          bytesPerSec: sample.bytesPerSec,
          loaded: sample.loaded,
          total: sample.total,
          throttled: sample.throttled,
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
    opts.onProgress?.({ label: "Saving file", percent: 100, steps });
    if (opts.signal?.aborted) throw new Error("aborted");
    const name = opts.filename || `${fileBasename(opts.title || "video")}.mp4`;
    await saveMediaBlob(blob, name, opts.pendingSave, { videoId: opts.videoId, itag }, opts.signal);
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
