import { isBuilderPreview, safeDownloadName } from "@/lib/builder-env";
import { blobIsMedia, putCachedMedia } from "@/lib/media-cache";

type WritableSink = {
  write: (data: Blob) => Promise<void> | void;
  close: () => Promise<void> | void;
  abort?: () => Promise<void> | void;
};

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<WritableSink> }>;
};

export type PendingSave = Promise<WritableSink | null>;

/**
 * Must run in the same tick as the click. Grok’s preview iframe drops the
 * user-gesture if we `await` a download first, then the Save picker is blocked
 * and `<a download>` may navigate the iframe instead of saving.
 */
export function beginBuilderSave(filename: string): PendingSave {
  if (typeof window === "undefined") return Promise.resolve(null);
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (typeof picker !== "function") return Promise.resolve(null);
  const name = safeDownloadName(filename);
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : ".mp4";
  return picker
    .call(window, {
      suggestedName: name,
      types: [{ description: "Media", accept: { "application/octet-stream": [ext] } }],
    })
    .then((handle) => handle.createWritable())
    .catch(() => null);
}

export async function writePendingSave(
  pending: PendingSave | undefined,
  blob: Blob,
): Promise<boolean> {
  if (!pending) return false;
  const writable = await pending;
  if (!writable) return false;
  try {
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    try {
      if (typeof writable.abort === "function") {
        await writable.abort();
      } else {
        await writable.close();
      }
    } catch {
      /* already closed or aborted */
    }
    return false;
  }
}

/**
 * Save without navigating the Grok preview. Prefer the picker opened at click;
 * otherwise blob + `<a download target="_blank">` so a blocked download attr
 * opens a tab instead of replacing the app.
 */
export async function saveMediaBlob(
  blob: Blob,
  filename: string,
  pending?: PendingSave,
  cache?: { videoId: string; itag: number },
  signal?: AbortSignal,
): Promise<"picker" | "download" | "tab"> {
  if (signal?.aborted) throw new Error("aborted");
  if (!(await blobIsMedia(blob))) {
    throw new Error("Got a block page instead of media.");
  }
  if (signal?.aborted) throw new Error("aborted");
  const name = safeDownloadName(filename);
  if (cache) {
    void putCachedMedia({ ...cache, filename: name, blob }).catch(() => undefined);
  }
  if (await writePendingSave(pending, blob)) return "picker";
  if (signal?.aborted) throw new Error("aborted");

  const href = URL.createObjectURL(blob);
  const framed = window.parent !== window;
  const preview = framed || isBuilderPreview();
  try {
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.rel = "noopener";
    link.referrerPolicy = "no-referrer";
    if (!preview) link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (preview) {
      try {
        window.open(href, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked — download attr already ran */
      }
      return "tab";
    }
    return "download";
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}
