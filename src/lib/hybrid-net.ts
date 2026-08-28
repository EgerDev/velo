import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";
import { withRetry, isRetryable } from "@/lib/retry";
import { downloadHeaders } from "@/lib/guest-id";
import { localRelayUrl, publicRelayUrls, relayHost } from "@/lib/cors-relays";
import { unlockStreamUrl } from "@/lib/stream-unlock";
import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";
import { isBuilderPreview, isSandboxHost } from "@/lib/builder-env";
import { saveMediaBlob, type PendingSave } from "@/lib/builder-save";
import { nameForBlob } from "@/lib/media-name";
import { isAudioItag, isVideoOnlyItag } from "@/lib/ytdlp-auth";
import { isImaUrl } from "@/lib/ima";
import { linkAbort } from "@/lib/abort-link";

export type HybridStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "ok" | "fail" | "skip";
  detail?: string;
};

export type StepHandler = (steps: HybridStep[]) => void;

export function stampClientPot(url: string, pot: string | null | undefined): string {
  return unlockStreamUrl(url, { pot, stripAlr: true }).url;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${label} aborted`));
      return;
    }
    const timer = window.setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
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

export async function readBlob(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  if (!response.body) return response.blob();
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
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
    // A rejected read (relay drop, mid-transfer abort) would otherwise leave the
    // body locked and the socket held. `builder-download.ts` already does this.
    reader.releaseLock();
  }
  // A stream cut short still ends with `done`, so without this a truncated
  // transfer was saved as a complete file — the container header parses and the
  // size check passes, and the user is told it succeeded.
  if (total > 0 && loaded < total) {
    throw new Error(
      `Download ended early — got ${loaded} of ${total} bytes. The connection dropped; try again.`,
    );
  }
  // Blob copies its parts itself; a contiguous intermediate Uint8Array would
  // double peak memory (~2x the file) for nothing. `builder-download.ts` already does this.
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export function assertMedia(blob: Blob, type: string | null): Blob {
  const mime = type ?? blob.type;
  if (mime.includes("text/html") || mime.includes("application/json") || mime.includes("text/plain")) {
    throw new Error("Got a block page instead of media.");
  }
  if (blob.size < 2048) throw new Error("Empty stream.");
  return blob;
}

export function isBlockPage(response: Response): boolean {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("application/json") || type.includes("text/plain");
}

export function fetchMode(url: string): "media" | "any" {
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

export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
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
            // Detached when this attempt loses. The winner's listener stays on:
            // the caller drains its body afterwards, and Pause / Clear queue
            // must still reach it (same as the local-relay fallback below).
            const onAbort = () => controller.abort();
            if (parent && typeof AbortSignal.any !== "function") {
              parent.addEventListener("abort", onAbort, { once: true });
            }
            const timer = window.setTimeout(() => controller.abort(), 18_000);
            void fetch(target, { redirect: "manual", ...init, signal })
              .then((response) => {
                window.clearTimeout(timer);
                if (settled) {
                  parent?.removeEventListener("abort", onAbort);
                  void response.body?.cancel();
                  return;
                }
                if (response.status >= 300 && response.status < 400) {
                  parent?.removeEventListener("abort", onAbort);
                  void response.body?.cancel();
                  failOne(`${host} redirected off-origin`);
                  return;
                }
                if (!response.ok || (mode === "media" && isBlockPage(response))) {
                  parent?.removeEventListener("abort", onAbort);
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
                parent?.removeEventListener("abort", onAbort);
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
      // The 20 s timer only guards the headers. The caller drains the body
      // after this returns, so the parent has to stay linked past that point:
      // AbortSignal.any does it without a listener to clean up; without it
      // (older Safari/Firefox) linkAbort's listener is left on the parent for
      // a handed-off response — it only retains this controller, and detaching
      // it at the headers is what made the body uncancellable.
      const controller = new AbortController();
      const parent = init?.signal ?? undefined;
      const viaAny = parent && typeof AbortSignal.any === "function";
      const signal = viaAny ? AbortSignal.any([parent, controller.signal]) : controller.signal;
      const detach = viaAny ? () => {} : linkAbort(parent, controller);
      const timer = window.setTimeout(() => controller.abort(), 20_000);
      let handedOff = false;
      try {
        const local = await fetch(localRelayUrl(url), {
          redirect: "error",
          ...init,
          headers: downloadHeaders(init?.headers),
          signal,
        });
        if (local.ok && !(mode === "media" && isBlockPage(local))) {
          handedOff = true;
          return local;
        }
        void local.body?.cancel();
      } finally {
        window.clearTimeout(timer);
        if (!handedOff) detach();
      }
    }
    throw err;
  }
}
