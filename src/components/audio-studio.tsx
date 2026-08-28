import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes, type VideoPreset } from "@/lib/youtube";
import {
  AUDIO_PROFILES,
  estimateOutputBytes,
  getAudioProfile,
  LARGE_OUTPUT_BYTES,
  LOUDNESS_TARGETS,
  outputFilename,
  type AudioProfileId,
} from "@/lib/audio-profiles";
import { isEncoderSupported, preloadEncoder, type EncodeProgress } from "@/lib/audio-encoder";
import { beginBuilderSave, discardPendingSave, saveMediaBlob } from "@/lib/builder-save";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

type AudioStudioProps = {
  videoId: string;
  title: string;
  author: string;
  duration: number | null;
  audioPreset: VideoPreset | null;
};

type Phase =
  | { kind: "idle" }
  | { kind: "fetching"; percent: number; label: string }
  | { kind: "converting"; percent: number }
  | { kind: "done"; filename: string; size: number };

/**
 * Re-encode YouTube's audio in the browser: pick a delivery format and a
 * loudness target, and ffmpeg.wasm does the work locally — the audio never
 * goes to a third-party converter.
 */
export function AudioStudio({ videoId, title, author, duration, audioPreset }: AudioStudioProps) {
  // Derived here like SaveStage does — VideoPanel never carried the flag, so
  // the converter fetched anonymously even with a vault jar loaded.
  const { user } = useCurrentUserState();
  const signedIn = Boolean(user);
  const [profileId, setProfileId] = useState<AudioProfileId>("mp3_320");
  const [loudness, setLoudness] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const supported = isEncoderSupported();

  // Warm the 32 MB core while the user is still choosing, so the first
  // conversion doesn't pay the whole load.
  useEffect(() => {
    if (supported) void preloadEncoder();
    return () => abortRef.current?.abort();
  }, [supported]);

  const profile = getAudioProfile(profileId);
  const busy = phase.kind === "fetching" || phase.kind === "converting";
  const estimate = useMemo(
    () => estimateOutputBytes(profileId, duration, audioPreset?.size ?? null),
    [profileId, duration, audioPreset?.size],
  );
  const isLarge = estimate != null && estimate > LARGE_OUTPUT_BYTES;

  async function fetchCover(): Promise<Blob | null> {
    if (!profile.supportsCoverArt) return null;
    try {
      // Through the relay: i.ytimg.com sends no CORS headers of its own.
      const response = await fetch(
        `/api/relay?url=${encodeURIComponent(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)}`,
      );
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size > 0 ? blob : null;
    } catch {
      return null; // Cover art is a nicety — never fail the conversion for it.
    }
  }

  async function convert() {
    if (!audioPreset) {
      toast.error("No audio track available for this video.");
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    // Open the Save picker synchronously with the click. showSaveFilePicker
    // needs the user gesture, and awaiting the fetch/encode first (seconds to
    // minutes) consumes it — the picker would then reject and silently fall back
    // to <a download>, which is exactly the path that misfires in the framed
    // preview. encodeAudio derives result.filename from this same call.
    const outName = outputFilename(title, profile, audioPreset.ext);
    const pending = beginBuilderSave(outName);
    // The picker created the destination on confirm; release it unless this run
    // writes it, so a cancel or failure leaves no 0-byte file behind.
    let wrote = false;

    try {
      setPhase({ kind: "fetching", percent: 4, label: "Fetching audio" });

      // Reuse a copy already in this browser before hitting YouTube again.
      const { getCachedMedia } = await import("@/lib/media-cache");
      const cached = await getCachedMedia(videoId, audioPreset.itag).catch(() => null);
      let source: Blob;
      if (cached?.blob) {
        source = cached.blob;
        setPhase({ kind: "fetching", percent: 40, label: "Using the copy on this device" });
      } else {
        const { cookiesForDownload } = await import("@/lib/cookie-store");
        const { hybridFetchBlob } = await import("@/lib/hybrid-download");
        source = await hybridFetchBlob({
          videoId,
          itag: audioPreset.itag,
          cookies: cookiesForDownload(signedIn),
          signal: abort.signal,
          onProgress: (label, percent) => {
            if (abort.signal.aborted) return;
            setPhase({ kind: "fetching", percent, label });
          },
        });
      }
      if (abort.signal.aborted) return;

      const cover = await fetchCover();
      if (abort.signal.aborted) return;

      setPhase({ kind: "converting", percent: 0 });
      const { encodeAudio } = await import("@/lib/audio-encoder");
      const result = await encodeAudio({
        source,
        sourceExt: audioPreset.ext,
        profileId,
        loudnessLufs: loudness,
        title,
        cover,
        metadata: { title, artist: author, comment: `https://www.youtube.com/watch?v=${videoId}` },
        signal: abort.signal,
        onProgress: (progress: EncodeProgress) => {
          if (abort.signal.aborted) return;
          setPhase({ kind: "converting", percent: progress.percent });
        },
      });
      if (abort.signal.aborted) return;

      await saveMediaBlob(result.blob, result.filename, pending, { videoId, itag: audioPreset.itag }, abort.signal);
      wrote = true;
      setPhase({ kind: "done", filename: result.filename, size: result.blob.size });
      toast.success(`Saved ${result.filename}`);
    } catch (err) {
      if (abort.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "idle" });
      toast.error(err instanceof Error ? err.message : "Couldn’t convert that audio.");
    } finally {
      // Covers the three `abort.signal.aborted` early returns above too.
      if (!wrote) void discardPendingSave(pending);
    }
  }

  if (!supported) {
    return (
      <p className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs text-subtle">
        Audio conversion needs WebAssembly, which this browser doesn’t provide. The plain audio
        download above still works.
      </p>
    );
  }

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface/70 overflow-hidden" aria-label="Audio studio">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-elevated/50 px-3.5 py-2">
        <span className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wide text-muted">
          <AudioLines className="size-3.5 text-subtle" />
          Audio studio
        </span>
        <span className="font-mono text-[10px] text-subtle">converts on this device</span>
      </div>

      <div className="p-3.5 sm:p-4 space-y-4">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-subtle">Format</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AUDIO_PROFILES.map((option) => {
              const active = option.id === profileId;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setProfileId(option.id)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                      : "border-border bg-elevated/40 hover:border-border-strong hover:bg-elevated",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-fg">{option.label}</span>
                    {option.lossless ? (
                      <span className="rounded bg-elevated px-1 py-0.5 font-mono text-[9px] text-subtle">
                        lossless
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-subtle">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-subtle">Loudness</p>
          <div className="flex flex-wrap gap-1.5">
            {LOUDNESS_TARGETS.map((target) => {
              const active = target.lufs === loudness;
              const disabled = busy || !profile.canFilter;
              return (
                <button
                  key={String(target.lufs)}
                  type="button"
                  disabled={disabled}
                  title={target.description}
                  onClick={() => setLoudness(target.lufs)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                    active
                      ? "border-accent/40 bg-accent/15 text-accent"
                      : "border-border bg-elevated/60 text-muted hover:text-fg",
                  )}
                >
                  {target.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-subtle">
            {profile.canFilter
              ? LOUDNESS_TARGETS.find((t) => t.lufs === loudness)?.description
              : "The original keeps YouTube’s own levels — normalizing would mean re-encoding."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <p className="font-mono text-[11px] text-subtle">
            {outputFilename(title, profile, audioPreset?.ext ?? "m4a")}
            {estimate != null ? ` · ~${formatBytes(estimate)}` : ""}
          </p>
          <div className="flex items-center gap-2">
            {busy ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  abortRef.current?.abort();
                  setPhase({ kind: "idle" });
                }}
              >
                <X className="size-3.5 mr-1" />
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              className="h-9 px-3.5 text-xs font-semibold"
              disabled={busy || !audioPreset}
              onClick={() => void convert()}
            >
              {busy ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Download className="size-3.5 mr-1.5" />}
              {phase.kind === "fetching"
                ? `${phase.label}… ${phase.percent}%`
                : phase.kind === "converting"
                  ? `Converting… ${phase.percent}%`
                  : `Convert to ${profile.label}`}
            </Button>
          </div>
        </div>

        {isLarge && !busy ? (
          <p className="text-[11px] leading-relaxed text-warn">
            That’s roughly {formatBytes(estimate)} — a long recording in {profile.label} takes a
            while to convert and a lot of disk. {profile.lossless ? "MP3 320 is a fraction of the size." : ""}
          </p>
        ) : null}

        {busy ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[var(--motion-quick)]"
              style={{
                width: `${Math.max(4, phase.kind === "converting" ? phase.percent : phase.percent)}%`,
              }}
            />
          </div>
        ) : null}

        {phase.kind === "done" ? (
          <p className="flex items-center gap-2 text-[11px] text-success">
            <Check className="size-3.5" />
            Saved {phase.filename} · {formatBytes(phase.size)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
