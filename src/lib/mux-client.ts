import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from "mediabunny";

export async function muxVideoAudio(
  video: Blob,
  audio: Blob,
  ext: "mp4" | "webm",
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw new Error("aborted");
  const videoInput = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
  const audioInput = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({
    format:
      ext === "webm"
        ? new WebMOutputFormat()
        : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  try {
    const videoConv = await Conversion.init({
      input: videoInput,
      output,
      composable: true,
      audio: { discard: true },
    });
    const audioConv = await Conversion.init({
      input: audioInput,
      output,
      composable: true,
      video: { discard: true },
    });

    if (!videoConv.utilizedTracks.length) {
      throw new Error("Couldn’t read the 1080p video track. Try another quality.");
    }
    if (!audioConv.utilizedTracks.length) {
      throw new Error("Couldn’t read the audio track to pair with this video.");
    }

    videoConv.onProgress = (progress) => onProgress?.(progress);

    // A canceled download otherwise runs the whole remux to completion in the
    // background, holding the full in-memory output and stacking with the next
    // download's work.
    const onAbort = () => {
      void videoConv.cancel();
      void audioConv.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await output.start();
      await Promise.all([videoConv.execute(), audioConv.execute()]);
      await output.finalize();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }

  if (signal?.aborted) throw new Error("aborted");
  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Combining video and audio produced an empty file.");
  }

  return new Blob([new Uint8Array(buffer)], { type: ext === "webm" ? "video/webm" : "video/mp4" });
}
