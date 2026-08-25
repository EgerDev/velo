import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";
import { withRetry, isRetryable } from "@/lib/retry";
import { downloadHeaders } from "@/lib/guest-id";
import { localRelayUrl, publicRelayUrls, relayHost } from "@/lib/cors-relays";
import { unlockStreamUrl } from "@/lib/stream-unlock";
import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";
import { isBuilderPreview, isSandboxHost } from "@/lib/builder-env";
import { saveMediaBlob, type PendingSave } from "@/lib/builder-save";
import { isAudioItag, isVideoOnlyItag } from "@/lib/ytdlp-auth";
import { isImaUrl } from "@/lib/ima";

export type HybridStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "ok" | "fail" | "skip";
  detail?: string;
};

type StepHandler = (steps: HybridStep[]) => void;

function stampClientPot(url: string, pot: string | null | undefined): string {
  return unlockStreamUrl(url, { pot, stripAlr: true }).url;
}

function abortAfter(ms: number, parent?: AbortSignal): { signal: AbortSignal; disarm: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  const disarm = () => window.clearTimeout(timer);
  const onParent = () => {
    disarm();
    controller.abort();
  };
  if (parent?.aborted) {
    disarm();
    controller.abort();
  } else {
    parent?.addEventListener("abort", onParent, { once: true });
  }
  return { signal: controller.signal, disarm };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${label} aborted`));
      return;
    }
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new Error(`${label} aborted`));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onBytes?.(loaded, total);
    }
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

function assertMedia(blob: Blob, type: string | null): Blob {
  const mime = type ?? blob.type;
  if (mime.includes("text/html") || mime.includes("application/json") || mime.includes("text/plain")) {
    throw new Error("Got a block page instead of media.");
  }
  if (blob.size < 2048) throw new Error("Empty stream.");
  return blob;
}

function isBlockPage(response: Response): boolean {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("application/json") || type.includes("text/plain");
}

function fetchMode(url: string): "media" | "any" {
  try {
    const parsed = new URL(url);
    if (isImaUrl(url)) return "any";
    return /(^|\.)googlevideo\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/videoplayback")
      ? "media"
      : "any";
  } catch {
    return "any";
  }
}

async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const targets = publicRelayUrls(url);
  const mode = fetchMode(url);
  try {
    return await withRetry(
      () =>
        new Promise<Response>((resolve, reject) => {
          const errors: string[] = [];
          const controllers: AbortController[] = [];
          let open = targets.length;
          let settled = false;
          if (!targets.length) {
            reject(new Error("No relays configured."));
            return;
          }
          const parent = init?.signal;
          if (parent?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          const failOne = (detail: string) => {
            if (settled) return;
            if (detail) errors.push(detail);
            open -= 1;
            if (open <= 0) reject(new Error(errors.join(" · ") || "Relays missed."));
          };
          for (const target of targets) {
            const controller = new AbortController();
            controllers.push(controller);
            const host = relayHost(target);
            const signal =
              parent && typeof AbortSignal.any === "function"
                ? AbortSignal.any([controller.signal, parent])
                : controller.signal;
            if (parent && typeof AbortSignal.any !== "function") {
              parent.addEventListener("abort", () => controller.abort(), { once: true });
            }
            const timer = window.setTimeout(() => controller.abort(), 18_000);
            void fetch(target, { redirect: "manual", ...init, signal })
              .then((response) => {
                window.clearTimeout(timer);
                if (settled) {
                  void response.body?.cancel();
                  return;
                }
                if (response.status >= 300 && response.status < 400) {
                  void response.body?.cancel();
                  failOne(`${host} redirected off-origin`);
                  return;
                }
                if (!response.ok || (mode === "media" && isBlockPage(response))) {
                  void response.body?.cancel();
                  failOne(
                    `${host} ${response.status}${mode === "media" && isBlockPage(response) ? " block-page" : ""}`,
                  );
                  return;
                }
                settled = true;
                for (const other of controllers) {
                  if (other !== controller) other.abort();
                }
                resolve(response);
              })
              .catch((err) => {
                window.clearTimeout(timer);
                if (settled) return;
                if (parent?.aborted) {
                  settled = true;
                  reject(new Error("aborted"));
                  return;
                }
                const message = err instanceof Error ? err.message : "failed";
                if (/abort/i.test(message)) failOne(`${host} timed out`);
                else failOne(`${host}: ${message}`);
              });
          }
        }),
      { attempts: 2, baseMs: 400, maxMs: 1600 },
    );
  } catch (err) {
    if (method === "GET" && !init?.signal?.aborted) {
      const hung = abortAfter(20_000, init?.signal ?? undefined);
      const local = await fetch(localRelayUrl(url), {
        redirect: "error",
        ...init,
        headers: downloadHeaders(init?.headers),
        signal: hung.signal,
      });
      hung.disarm();
      if (local.ok && !(mode === "media" && isBlockPage(local))) return local;
      void local.body?.cancel();
    }
    throw err;
  }
}

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

async function ytdlpBlob(
  videoId: string,
  itag: number,
  cookies?: string,
  pot?: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const headers = downloadHeaders({ "content-type": "application/json" });
  const hung = abortAfter(180_000, signal);
  const response = await fetch("/api/ytdlp", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: videoId, itag, cookies: cookies || "", pot: pot || "" }),
    signal: hung.signal,
  });
  hung.disarm();
  if (!response.ok) throw await errorFromResponse(response, "yt-dlp");
  return blobFromResponse(response);
}

function raceFirstBlob(
  steps: HybridStep[],
  emit: StepHandler | undefined,
  attempts: { id: string; run: (signal: AbortSignal) => Promise<Blob> }[],
  parent?: AbortSignal,
): Promise<Blob> {
  const abort = new AbortController();
  if (parent) {
    if (parent.aborted) abort.abort();
    else parent.addEventListener("abort", () => abort.abort(), { once: true });
  }
  return new Promise((resolve, reject) => {
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
  });
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
  const onBytes = (loaded: number, total: number) => {
    const pct = total > 0 ? Math.min(92, 40 + Math.round((loaded / total) * 50)) : 60;
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
  await saveBlob(blob, opts.filename, opts.pendingSave, { videoId: opts.videoId, itag: opts.itag }, opts.signal);
}

export { downloadViaHybrid as downloadViaBypass };