import {
  buildAudioArgs,
  getAudioProfile,
  outputFilename,
  type AudioMetadata,
  type AudioProfileId,
} from "@/lib/audio-profiles";

/**
 * ffmpeg.wasm runtime for the audio profiles.
 *
 * The core is ~32 MB, so it is imported lazily — nothing here is pulled into
 * the main bundle until someone actually converts a file. The core files are
 * served from this origin (bundled through Vite) rather than a CDN, so the
 * conversion works offline and needs no third-party script.
 *
 * @ffmpeg/ffmpeg always spawns a *module* worker, which has no importScripts,
 * so the ESM core build is the one that can be loaded.
 */

export type EncodeStage = "loading" | "encoding";

export type EncodeProgress = {
  stage: EncodeStage;
  /** 0-100. During "loading" this is indeterminate and reported as 0. */
  percent: number;
};

export type EncodeAudioOptions = {
  source: Blob;
  /** Container of `source`, e.g. "m4a" or "webm" — decides the copy-profile output. */
  sourceExt: string;
  profileId: AudioProfileId;
  loudnessLufs?: number | null;
  title: string;
  metadata?: AudioMetadata;
  /** Optional cover image; ignored for containers that can't carry one. */
  cover?: Blob | null;
  onProgress?: (progress: EncodeProgress) => void;
  signal?: AbortSignal;
};

export type EncodedAudio = {
  blob: Blob;
  filename: string;
};

type FFmpegInstance = {
  loaded: boolean;
  load: (config: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  on: (event: string, handler: (payload: { progress?: number; message?: string }) => void) => void;
  off: (event: string, handler: (payload: { progress?: number; message?: string }) => void) => void;
  writeFile: (name: string, data: Uint8Array) => Promise<boolean>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<boolean>;
  exec: (args: string[], timeout?: number, opts?: { signal?: AbortSignal }) => Promise<number>;
  terminate: () => void;
};

let instancePromise: Promise<FFmpegInstance> | null = null;
/** One core, one exec at a time — serialize so two conversions can't interleave. */
let queue: Promise<unknown> = Promise.resolve();
let lastLog = "";

export function isEncoderSupported(): boolean {
  return typeof WebAssembly === "object" && typeof Worker === "function";
}

async function loadFFmpeg(onProgress?: (progress: EncodeProgress) => void): Promise<FFmpegInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      onProgress?.({ stage: "loading", percent: 0 });
      const [{ FFmpeg }, coreURL, wasmURL] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/core?url").then((m) => m.default as string),
        import("@ffmpeg/core/wasm?url").then((m) => m.default as string),
      ]);
      const ffmpeg = new FFmpeg() as unknown as FFmpegInstance;
      // Keep the last line of ffmpeg's own output: when exec() fails its exit
      // code alone says nothing about why.
      ffmpeg.on("log", ({ message }) => {
        if (message) lastLog = message;
      });
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((err) => {
      // A failed load must not poison every later attempt.
      instancePromise = null;
      throw err instanceof Error ? err : new Error("Could not start the audio converter.");
    });
  }
  return instancePromise;
}

/** Warm the core up (e.g. when a converter panel opens) so the first run is quick. */
export async function preloadEncoder(): Promise<void> {
  if (!isEncoderSupported()) return;
  try {
    await loadFFmpeg();
  } catch {
    // Preloading is best-effort; the real error surfaces on the actual run.
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
}

export async function encodeAudio(options: EncodeAudioOptions): Promise<EncodedAudio> {
  if (!isEncoderSupported()) {
    throw new Error("This browser can’t run the audio converter (WebAssembly unavailable).");
  }
  const profile = getAudioProfile(options.profileId);
  const filename = outputFilename(options.title, profile, options.sourceExt);

  const run = async (): Promise<EncodedAudio> => {
    throwIfAborted(options.signal);
    const ffmpeg = await loadFFmpeg(options.onProgress);
    throwIfAborted(options.signal);

    // Unique names: the wasm FS persists between runs in one session.
    const stamp = Math.random().toString(36).slice(2, 10);
    const inputName = `in_${stamp}.${(options.sourceExt || "m4a").replace(/^\./, "")}`;
    const outputName = `out_${stamp}.${filename.split(".").pop()}`;
    const coverName = options.cover ? `cover_${stamp}.jpg` : null;
    const written: string[] = [];

    const handleProgress = ({ progress }: { progress?: number }) => {
      if (typeof progress !== "number" || !Number.isFinite(progress)) return;
      // ffmpeg reports 0..1 but can overshoot slightly at the tail.
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      options.onProgress?.({ stage: "encoding", percent });
    };
    ffmpeg.on("progress", handleProgress);

    try {
      options.onProgress?.({ stage: "encoding", percent: 0 });
      await ffmpeg.writeFile(inputName, new Uint8Array(await options.source.arrayBuffer()));
      written.push(inputName);
      if (coverName && options.cover) {
        await ffmpeg.writeFile(coverName, new Uint8Array(await options.cover.arrayBuffer()));
        written.push(coverName);
      }
      throwIfAborted(options.signal);

      const args = buildAudioArgs({
        profileId: options.profileId,
        inputName,
        outputName,
        loudnessLufs: options.loudnessLufs ?? null,
        coverName,
        metadata: options.metadata,
      });

      lastLog = "";
      let code: number;
      try {
        code = await ffmpeg.exec(args, -1, { signal: options.signal });
      } catch (err) {
        if (options.signal?.aborted) {
          // An aborted exec only rejects this promise — the worker keeps
          // computing. Kill the core so the next conversion isn't silently
          // queued behind a run the user already cancelled.
          releaseEncoder();
          throw new DOMException("Conversion cancelled", "AbortError");
        }
        throw err;
      }
      if (code !== 0) {
        throw new Error(lastLog ? `Conversion failed: ${lastLog}` : "Conversion failed.");
      }
      written.push(outputName);

      const data = await ffmpeg.readFile(outputName);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (!bytes.length) throw new Error("Conversion produced an empty file.");
      options.onProgress?.({ stage: "encoding", percent: 100 });
      // The copy profile keeps the source container, so its blob type must
      // follow the actual output extension rather than the profile's default.
      const outExt = filename.split(".").pop()?.toLowerCase();
      const mime =
        profile.ext === null
          ? outExt === "webm"
            ? "audio/webm"
            : outExt === "opus"
              ? "audio/opus"
              : profile.mime
          : profile.mime;
      return {
        blob: new Blob([bytes as BlobPart], { type: mime }),
        filename,
      };
    } finally {
      // The core is a session-long singleton: leaving the listener behind
      // would retain this run's source Blob forever and bleed its progress
      // events into every later conversion.
      ffmpeg.off("progress", handleProgress);
      for (const name of written) {
        await ffmpeg.deleteFile(name).catch(() => undefined);
      }
    }
  };

  // Chain onto the queue, and keep the chain alive even when a run rejects.
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Drop the core and free its memory — worth doing when a session is done converting. */
export function releaseEncoder(): void {
  const pending = instancePromise;
  instancePromise = null;
  void pending
    ?.then((ffmpeg) => ffmpeg.terminate())
    .catch(() => undefined);
}
