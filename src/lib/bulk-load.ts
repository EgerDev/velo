import { toast } from "sonner";
import {
  createBulkItems,
  importBatchJson,
  type BulkItem,
  type BulkQualityPreset,
} from "@/lib/bulk-download";
import { resolveBulkVideos, resolvePlaylist } from "@/lib/resolve-video";
import { pickBestPreset } from "@/lib/youtube";

export async function resolveBulkMetadata(
  itemsToResolve: BulkItem[],
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void,
) {
  const ids = itemsToResolve.map((i) => i.id);
  if (!ids.length) return;
  mutate((prev) => prev.map((item) => (ids.includes(item.id) ? { ...item, status: "resolving" } : item)));
  try {
    const results = await resolveBulkVideos({ data: { ids } });
    mutate((prev) =>
      prev.map((item) => {
        const match = results.find((r) => r.id === item.id);
        if (!match) return item;
        const nextStatus = item.status === "resolving" || item.status === "pending" ? "ready" : item.status;
        if (match.ok && match.video) {
          const v = match.video;
          const targetPreset =
            v.presets.find((p) => p.id === item.preset || (item.preset === "audio" && p.kind === "audio")) ??
            pickBestPreset(v.presets);
          return {
            ...item,
            title: v.title,
            author: v.author,
            duration: v.duration,
            durationFormatted: v.duration
              ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, "0")}`
              : null,
            thumbnail: v.thumbnail,
            status: nextStatus,
            selectedItag: targetPreset?.itag ?? 137,
            selectedAudioItag: targetPreset?.audioItag ?? null,
            sizeFormatted: targetPreset?.size ? `${(targetPreset.size / (1024 * 1024)).toFixed(1)} MB` : null,
            filename: `${v.title}.${targetPreset?.ext || "mp4"}`,
          };
        }
        return { ...item, status: nextStatus, error: match.error ?? null };
      }),
    );
  } catch {
    mutate((prev) => prev.map((item) => (ids.includes(item.id) ? { ...item, status: "ready" } : item)));
  }
}

export async function loadBulkLinks(opts: {
  inputText: string;
  items: BulkItem[];
  globalPreset: BulkQualityPreset;
  expandPlaylists: boolean;
  extracted: { totalUnique: number; playlistIds: string[]; videoIds: string[] };
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
  setInputText: (v: string) => void;
}) {
  if (/^\s*[[{]/.test(opts.inputText)) {
    const { items: imported, error } = importBatchJson(opts.inputText, opts.globalPreset);
    if (error) {
      toast.error(error);
      return;
    }
    const existing = new Set(opts.items.map((i) => i.id));
    const fresh = imported.filter((item) => !existing.has(item.id));
    if (!fresh.length) {
      toast.info("Every video in that manifest is already queued.");
      return;
    }
    opts.mutate((prev) => [...prev, ...fresh]);
    opts.setInputText("");
    toast.success(`Imported ${fresh.length} video(s) from the manifest.`);
    void resolveBulkMetadata(fresh, opts.mutate);
    return;
  }
  if (!opts.extracted.totalUnique && !opts.extracted.playlistIds.length) {
    toast.error("No valid YouTube video or playlist links found in the text.");
    return;
  }
  const newVideoIds = [...opts.extracted.videoIds];
  if (opts.extracted.playlistIds.length > 0 && opts.expandPlaylists) {
    toast.info(`Expanding ${opts.extracted.playlistIds.length} playlist(s)...`);
    const settled = await Promise.allSettled(
      opts.extracted.playlistIds.map((plId) =>
        resolvePlaylist({ data: { url: `https://www.youtube.com/playlist?list=${plId}` } }),
      ),
    );
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") {
        for (const item of res.value.items) {
          if (!newVideoIds.includes(item.id)) newVideoIds.push(item.id);
        }
      } else {
        toast.warning(`Could not expand playlist: ${opts.extracted.playlistIds[i]}`);
      }
    });
  }
  if (!newVideoIds.length) {
    toast.error("No video items could be extracted.");
    return;
  }
  const existingIds = new Set(opts.items.map((i) => i.id));
  const uniqueNewIds = newVideoIds.filter((id) => !existingIds.has(id));
  if (!uniqueNewIds.length) {
    toast.info("All entered links are already in the queue.");
    return;
  }
  const newItems = createBulkItems(uniqueNewIds, opts.globalPreset);
  opts.mutate((prev) => [...prev, ...newItems]);
  opts.setInputText("");
  toast.success(`Added ${newItems.length} video(s) to the download queue.`);
  void resolveBulkMetadata(newItems, opts.mutate);
}
