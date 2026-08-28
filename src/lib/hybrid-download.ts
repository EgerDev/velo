import { classifyDownloadError } from "@/lib/download-error";
import { withRetry, isRetryable } from "@/lib/retry";
import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";
import { isBuilderPreview, isSandboxHost } from "@/lib/builder-env";
import { saveMediaBlob, type PendingSave } from "@/lib/builder-save";
import { nameForBlob } from "@/lib/media-name";
import { isAudioItag, isVideoOnlyItag } from "@/lib/ytdlp-auth";
import { linkAbort } from "@/lib/abort-link";
import { isImaUrl } from "@/lib/ima";
import { downloadHeaders } from "@/lib/guest-id";
import {
  type HybridStep,
  type StepHandler,
  assertMedia,
  proxyFetch,
  readBlob,
  stampClientPot,
  withTimeout,
} from "@/lib/hybrid-net";
import { ytdlpBlob } from "@/lib/hybrid-ytdlp";

export type { HybridStep } from "@/lib/hybrid-net";

async function blobFromResponse(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  return assertMedia(await readBlob(response, onBytes), response.headers.get("content-type"));
}

function patchStep(steps: HybridStep[], id: string, patch: Partial<HybridStep>, emit?: StepHandler) {
  const step = steps.find((item) => item.id === id);
  if (!step) return;
  Object.assign(step, patch);
  emit?.(steps.map((item) => ({ ...item })));
}

function skipLosers(steps: HybridStep[], emit?: StepHandler) {
  for (const step of steps) {
    if (step.status === "pending" || step.status === "running") {
      step.status = "skip";
      step.detail = "another path won";
    }
  }
  emit?.(steps.map((item) => ({ ...item })));
}

async function runAttempt<T>(
  steps: HybridStep[],
  emit: StepHandler | undefined,
  id: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  patchStep(steps, id, { status: "running", detail: undefined }, emit);
  try {
    if (signal?.aborted) {
      patchStep(steps, id, { status: "skip", detail: "another path won" }, emit);
      return null;
    }
    const value = await withRetry(fn, {
      attempts: 2,
      baseMs: 400,
      maxMs: 2000,
      retryOn: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/timed out|timeout|aborted/i.test(msg)) return false;
        return isRetryable(err);
      },
      onRetry: (attempt, err, waitMs) => {
        const why = err instanceof Error ? err.message : "failed";
        patchStep(
          steps,
          id,
          { status: "running", detail: `retry ${attempt + 1}/3 in ${waitMs}ms · ${why}` },
          emit,
        );
      },
    });
    if (signal?.aborted) {
      patchStep(steps, id, { status: "skip", detail: "another path won" }, emit);
      return null;
    }
    patchStep(steps, id, { status: "ok", detail: "ok" }, emit);
    return value;
  } catch (err) {
    if (signal?.aborted) {
      patchStep(steps, id, { status: "skip", detail: "another path won" }, emit);
      return null;
    }
    patchStep(
      steps,
      id,
      { status: "fail", detail: err instanceof Error ? err.message : "Failed" },
      emit,
    );
    return null;
  }
}

function raceFirstBlob(
  steps: HybridStep[],
  emit: StepHandler | undefined,
  attempts: { id: string; run: (signal: AbortSignal) => Promise<Blob> }[],
  parent?: AbortSignal,
): Promise<Blob> {
  const abort = new AbortController();
  const detach = linkAbort(parent, abort);
  return new Promise<Blob>((resolve, reject) => {
    let open = attempts.length;
    let winner = false;
    if (abort.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    abort.signal.addEventListener(
      "abort",
      () => {
        if (!winner) reject(new Error("aborted"));
      },
      { once: true },
    );
    for (const attempt of attempts) {
      void runAttempt(steps, emit, attempt.id, () => attempt.run(abort.signal), abort.signal).then((blob) => {
        if (blob && !winner) {
          winner = true;
          abort.abort();
          skipLosers(steps, emit);
          resolve(blob);
          return;
        }
        open -= 1;
        if (open === 0 && !winner) {
          if (parent?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          const failed = steps
            .filter((step) => step.status === "fail")
            .map((step) => `${step.label}: ${step.detail ?? "failed"}`);
          reject(classifyDownloadError(failed.slice(0, 4).join(" · ") || "Every hybrid path failed.", failed));
        }
      });
    }
  }).finally(detach);
}

function saveBlob(
  blob: Blob,
  filename: string,
  pending?: PendingSave,
  cache?: { videoId: string; itag: number },
  signal?: AbortSignal,
) {
  return saveMediaBlob(blob, filename, pending, cache, signal);
}

const INITIAL_STEPS: HybridStep[] = [
  { id: "server", label: "Server + PO token", status: "pending" },
  { id: "botguard", label: "BotGuard / PO token", status: "pending" },
  { id: "bypass", label: "Velo unlock (nsig + dual POT + same-hop + HLS)", status: "pending" },
  { id: "ytdlp", label: "yt-dlp web_embedded over SOCKS", status: "pending" },
  { id: "relay", label: "CORS relays (cors.sh / allorigins / Velo)", status: "pending" },
];

export async function hybridFetchBlob(opts: {
  videoId: string;
  itag: number;
  audioItag?: number;
  fallbackUrl?: string;
  cookies?: string;
  signal?: AbortSignal;
  onProgress?: (label: string, percent: number) => void;
  onSteps?: StepHandler;
}): Promise<Blob> {
  const { videoId, itag, fallbackUrl, cookies, signal, onProgress, onSteps } = opts;
  const steps = INITIAL_STEPS.map((step) => ({ ...step }));
  onSteps?.(steps.slice());
  let lastPct = -1;
  const onBytes = (loaded: number, total: number) => {
    const pct = total > 0 ? Math.min(92, 40 + Math.round((loaded / total) * 50)) : 60;
    // Every network chunk lands here and each emit re-renders the page; only
    // report when the bar would actually move.
    if (pct === lastPct) return;
    lastPct = pct;
    onProgress?.("Downloading", pct);
  };

  onProgress?.("Racing download paths", 5);
  const builderFirst =
    isBuilderPreview() || (typeof window !== "undefined" && isSandboxHost(window.location.hostname));
  patchStep(steps, "server", { status: "skip", detail: "Save already tried the builder hop" }, onSteps);
  const potPromise = runAttempt(steps, onSteps, "botguard", async () => {
    const info = await withTimeout(mintPoToken({ data: { id: videoId } }), 25_000, "BotGuard", signal);
    if (!info?.token) throw new Error(info?.error || "No PO token.");
    return info;
  }, signal);
  const potInfo = await potPromise;
  const pot = potInfo?.token ?? null;
  if (potInfo?.method === "cold-start") {
    patchStep(
      steps,
      "botguard",
      { status: "ok", detail: potInfo.error ? `cold-start · ${potInfo.error}` : "cold-start fallback" },
      onSteps,
    );
  }

  onProgress?.("Racing same-hop bypass, yt-dlp, relays", 18);
  const muxPlan = isAudioItag(itag) || Boolean(opts.audioItag);
  const silentVideo = isVideoOnlyItag(itag) && !muxPlan;
  const muxLeg = isVideoOnlyItag(itag) && Boolean(opts.audioItag);
  const attempts: { id: string; run: (signal: AbortSignal) => Promise<Blob> }[] = [];
  if (!silentVideo) {
    attempts.push({
      id: "bypass",
      run: async (signal) => {
        const { fetchSameHopBlob } = await import("@/lib/bypass");
        return fetchSameHopBlob({
          videoId,
          itag,
          pot,
          signal,
          onProgress: (label, percent) => onProgress?.(label, percent),
        });
      },
    });
  } else {
    patchStep(steps, "bypass", { status: "skip", detail: "video-only — yt-dlp muxes audio" }, onSteps);
  }
  if (!muxLeg) {
    attempts.push({ id: "ytdlp", run: (signal) => ytdlpBlob(videoId, itag, cookies, pot, signal) });
  } else {
    patchStep(steps, "ytdlp", { status: "skip", detail: "caller muxes — exact itag, not 137+140/18" }, onSteps);
  }
  if (!silentVideo && !builderFirst) {
    attempts.push({
      id: "relay",
      run: async (signal) => {
        const media = await resolvePlayback({ data: { id: videoId, itag } });
        const urls = [media.directUrl, media.url, fallbackUrl].filter(
          (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index && !isImaUrl(value),
        );
        const errors: string[] = [];
        for (const url of urls) {
          try {
            return await blobFromResponse(await proxyFetch(stampClientPot(url, pot), { signal }), onBytes);
          } catch (err) {
            errors.push(err instanceof Error ? err.message : "relay failed");
          }
        }
        const bypass = await fetch(`/api/bypass?id=${encodeURIComponent(videoId)}&itag=${itag}`, {
          headers: downloadHeaders(),
          signal,
        });
        if (bypass.ok) return blobFromResponse(bypass, onBytes);
        throw new Error(errors[0] || "Relays blocked.");
      },
    });
  } else if (silentVideo) {
    patchStep(steps, "relay", { status: "skip", detail: "video-only — yt-dlp muxes audio" }, onSteps);
  } else {
    patchStep(steps, "relay", { status: "skip", detail: "skipped in Grok preview — CDN links navigate the iframe" }, onSteps);
  }
  return raceFirstBlob(steps, onSteps, attempts, signal);
}

export async function downloadViaHybrid(opts: {
  videoId: string;
  itag: number;
  audioItag?: number;
  filename: string;
  fallbackUrl?: string;
  cookies?: string;
  signal?: AbortSignal;
  pendingSave?: PendingSave;
  onProgress?: (label: string, percent: number) => void;
  onSteps?: StepHandler;
}): Promise<void> {
  const blob = await hybridFetchBlob(opts);
  if (opts.signal?.aborted) throw new Error("aborted");
  opts.onProgress?.("Saving file", 100);
  await saveBlob(blob, nameForBlob(opts.filename, blob), opts.pendingSave, { videoId: opts.videoId, itag: opts.itag }, opts.signal);
}

export { downloadViaHybrid as downloadViaBypass };