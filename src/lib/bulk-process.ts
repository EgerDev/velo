import { resolveVideo } from "@/lib/resolve-video";
import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
import { isUserAbort } from "@/lib/download-error";
import { beginBuilderSave, discardPendingSave } from "@/lib/builder-save";
import { pickBestPreset, type VideoPreset } from "@/lib/youtube";
import type { BulkItem } from "@/lib/bulk-download";

export async function processBulkItem(opts: {
  item: BulkItem;
  signedIn?: boolean;
  signal?: AbortSignal;
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
}) {
  const { item, mutate } = opts;
  let pendingSave: ReturnType<typeof beginBuilderSave> | undefined;
  let wrote = false;
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
    await downloadPresetFile({
      videoId: item.id,
      title: title || item.id,
      preset: presetObj,
      signedIn: opts.signedIn,
      pendingSave,
      signal: opts.signal,
      onProgress: (prog: DownloadProgress) => {
        mutate((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, progress: Math.max(10, Math.min(95, prog.percent)) } : i)),
        );
      },
    });
    wrote = true;
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
