import { resolveVideo } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
import { isUserAbort } from "@/lib/download-error";
import { beginBuilderSave, discardPendingSave } from "@/lib/builder-save";
import { pickBestPreset, type VideoPreset } from "@/lib/youtube";
import type { BulkItem } from "@/lib/bulk-download";
import { useHistoryStore } from "@/lib/history-store";

export async function processBulkItem(opts: {
  item: BulkItem;
  signedIn?: boolean;
  signal?: AbortSignal;
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
}) {
  const { item, mutate } = opts;
  let pendingSave: ReturnType<typeof beginBuilderSave> | undefined;
  let wrote = false;
  let lastPct = -1;
  try {
    let title = item.title;
    let targetPresetItag = item.selectedItag ?? 137;
    let targetAudioItag: number | null | undefined = item.selectedAudioItag;
    let ext = item.filename?.split(".").pop() || "mp4";
    let isAudio = item.preset === "audio";
    if (!title || item.selectedItag == null) {
      const v = await resolveVideo({ data: { url: item.url } });
      title = v.title;
      const targetPreset =
        v.presets.find((p) => p.id === item.preset || (item.preset === "audio" && p.kind === "audio")) ??
        pickBestPreset(v.presets);
      targetPresetItag = targetPreset?.itag ?? 137;
      targetAudioItag = targetPreset?.audioItag;
      ext = targetPreset?.ext ?? "mp4";
      isAudio = targetPreset?.kind === "audio";
    }
    const filename = `${title || `video-${item.id}`}.${ext}`;
    pendingSave = beginBuilderSave(filename);
    const presetObj: VideoPreset = {
      id: `bulk-${targetPresetItag}`,
      itag: targetPresetItag,
      audioItag: targetAudioItag ?? undefined,
      kind: isAudio ? "audio" : "video",
      title: item.preset,
      hint: ext,
      ext,
      codec: null,
      size: null,
      height: null,
      hasAudio: isAudio || Boolean(targetAudioItag),
      availability: isAudio ? "ready" : targetAudioItag ? "muxed" : "ready",
      streamType: targetAudioItag ? "dash-mux" : "direct",
      recommended: true,
    };
    const saved = await downloadPresetFile({
      videoId: item.id,
      title: title || item.id,
      preset: presetObj,
      signedIn: opts.signedIn,
      pendingSave,
      signal: opts.signal,
      onProgress: (prog: DownloadProgress) => {
        // Progress events fire per network chunk; cloning the item array per
        // tick is O(queue) × O(chunks). Whole percents are all the bar shows.
        const pct = Math.max(10, Math.min(95, Math.round(prog.percent)));
        if (pct === lastPct) return;
        lastPct = pct;
        mutate((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, progress: pct } : i)),
        );
      },
    });
    wrote = true;
    // Bulk saves belong in History too: the panel promises "saved files land
    // here", and a 20-video batch used to leave it empty. Same shape as a
    // single save (home-actions).
    useHistoryStore.getState().record({
      id: item.id,
      title: title || item.id,
      author: item.author ?? "",
      thumbnail: item.thumbnail ?? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      duration: item.duration,
      url: item.url,
      lastItag: saved.itag,
      lastPreset: saved.title,
      lastExt: saved.ext,
    });
    mutate((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "completed", progress: 100, filename, error: null } : i)),
    );
  } catch (err) {
    if (!wrote) void discardPendingSave(pendingSave);
    if (isUserAbort(err, opts.signal)) {
      mutate((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "ready", progress: 0 } : i)));
      return;
    }
    const errMsg = err instanceof Error ? err.message : "Download failed.";
    mutate((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, status: "failed", error: errMsg, retryCount: i.retryCount + 1 } : i,
      ),
    );
  }
}
