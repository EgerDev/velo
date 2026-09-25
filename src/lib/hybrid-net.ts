import { downloadHeaders } from "@/lib/guest-id";
import { localRelayUrl } from "@/lib/cors-relays";
import { isImaUrl } from "@/lib/ima";
import { linkAbort } from "@/lib/abort-link";
import { readBodyToBlob } from "@/lib/read-body";

export type HybridStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "ok" | "fail" | "skip";
  detail?: string;
};

export type StepHandler = (steps: HybridStep[]) => void;

export async function readBlob(
  response: Response,
  onBytes?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const { blob, loaded, total } = await readBodyToBlob(response, onBytes);
  if (total > 0 && loaded < total) {
    throw new Error(
      `Download ended early — got ${loaded} of ${total} bytes. The connection dropped; try again.`,
    );
  }
  return blob;
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

/**
 * Fetch a YouTube / googlevideo URL through this app's own `/api/relay`. The
 * 20 s timer only guards the headers: the caller drains the body after this
 * returns, so the parent signal stays linked past that point. AbortSignal.any
 * does that without a listener to clean up; without it (older Safari/Firefox)
 * linkAbort's listener stays on the parent for a handed-off response.
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const mode = fetchMode(url);
  const controller = new AbortController();
  const parent = init?.signal ?? undefined;
  const viaAny = parent && typeof AbortSignal.any === "function";
  const signal = viaAny ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const detach = viaAny ? () => {} : linkAbort(parent, controller);
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  let handedOff = false;
  try {
    const response = await fetch(localRelayUrl(url), {
      redirect: "error",
      ...init,
      headers: downloadHeaders(init?.headers),
      signal,
    });
    const blocked = mode === "media" && isBlockPage(response);
    if (response.ok && !blocked) {
      handedOff = true;
      return response;
    }
    void response.body?.cancel();
    throw new Error(`Velo relay ${response.status}${blocked ? " block-page" : ""}`);
  } finally {
    window.clearTimeout(timer);
    if (!handedOff) detach();
  }
}
