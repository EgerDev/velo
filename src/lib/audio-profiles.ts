/**
 * Audio encode profiles — the browser-side counterpart to yt-final's
 * `--audio-codec` / `--audio-bitrate` / `--loudnorm` flags.
 *
 * Pure argument-building only: no ffmpeg instance, no DOM, no I/O, so the whole
 * decision surface is unit-testable. `audio-encoder.ts` runs these args through
 * ffmpeg.wasm.
 */

export type AudioProfileId =
  | "mp3_320"
  | "mp3_v0"
  | "m4a_256"
  | "opus_192"
  | "flac"
  | "wav24"
  | "copy";

export type AudioProfile = {
  id: AudioProfileId;
  label: string;
  /** One line on what this is for — shown under the label. */
  description: string;
  /** Output container/extension, or null when it follows the source (copy). */
  ext: string | null;
  mime: string;
  /** ffmpeg codec/bitrate args, excluding filters, metadata and I/O. */
  codecArgs: string[];
  lossless: boolean;
  /** Re-encoding profiles can carry a loudness filter; a stream copy cannot. */
  canFilter: boolean;
  supportsCoverArt: boolean;
  /** Rough bytes-per-second of output, for size estimates. null = follows source. */
  approxBytesPerSec: number | null;
};

export const AUDIO_PROFILES: AudioProfile[] = [
  {
    id: "mp3_320",
    label: "MP3 320",
    description: "Constant 320 kbps — plays on anything",
    ext: "mp3",
    mime: "audio/mpeg",
    codecArgs: ["-c:a", "libmp3lame", "-b:a", "320k"],
    lossless: false,
    canFilter: true,
    supportsCoverArt: true,
    approxBytesPerSec: 40_000,
  },
  {
    id: "mp3_v0",
    label: "MP3 V0",
    description: "Variable ~245 kbps — transparent, smaller files",
    ext: "mp3",
    mime: "audio/mpeg",
    codecArgs: ["-c:a", "libmp3lame", "-q:a", "0"],
    lossless: false,
    canFilter: true,
    supportsCoverArt: true,
    approxBytesPerSec: 30_600,
  },
  {
    id: "m4a_256",
    label: "AAC 256",
    description: "256 kbps M4A — Apple and mobile native",
    ext: "m4a",
    mime: "audio/mp4",
    codecArgs: ["-c:a", "aac", "-b:a", "256k"],
    lossless: false,
    canFilter: true,
    supportsCoverArt: true,
    approxBytesPerSec: 32_000,
  },
  {
    id: "opus_192",
    label: "Opus 192",
    description: "192 kbps Opus — best quality per byte",
    ext: "opus",
    mime: "audio/opus",
    codecArgs: ["-c:a", "libopus", "-b:a", "192k"],
    lossless: false,
    canFilter: true,
    supportsCoverArt: false,
    approxBytesPerSec: 24_000,
  },
  {
    id: "flac",
    label: "FLAC",
    description: "Lossless compression — archival",
    ext: "flac",
    mime: "audio/flac",
    codecArgs: ["-c:a", "flac", "-compression_level", "5"],
    lossless: true,
    canFilter: true,
    supportsCoverArt: true,
    // ~50% of 16-bit stereo PCM.
    approxBytesPerSec: 88_200,
  },
  {
    id: "wav24",
    label: "WAV 24-bit",
    description: "Uncompressed PCM — hand to an editor or DAW",
    ext: "wav",
    mime: "audio/wav",
    codecArgs: ["-c:a", "pcm_s24le"],
    lossless: true,
    canFilter: true,
    supportsCoverArt: false,
    // 48 kHz × 3 bytes × 2 channels.
    approxBytesPerSec: 288_000,
  },
  {
    id: "copy",
    label: "Original",
    description: "No re-encode — YouTube's own audio, untouched",
    ext: null,
    mime: "audio/mp4",
    codecArgs: ["-c:a", "copy"],
    lossless: true,
    canFilter: false,
    supportsCoverArt: false,
    approxBytesPerSec: null,
  },
];

export function getAudioProfile(id: AudioProfileId): AudioProfile {
  const profile = AUDIO_PROFILES.find((p) => p.id === id);
  if (!profile) throw new TypeError(`Unknown audio profile: ${id}`);
  return profile;
}

export type LoudnessTarget = {
  /** Integrated loudness in LUFS, or null for "leave levels alone". */
  lufs: number | null;
  label: string;
  description: string;
};

/** Targets match the platforms people actually deliver to (yt-final: -14 web, -16 podcast). */
export const LOUDNESS_TARGETS: LoudnessTarget[] = [
  { lufs: null, label: "Off", description: "Keep the original levels" },
  { lufs: -14, label: "-14 LUFS", description: "Streaming and web (YouTube, Spotify)" },
  { lufs: -16, label: "-16 LUFS", description: "Podcast and spoken word" },
  { lufs: -23, label: "-23 LUFS", description: "Broadcast (EBU R128)" },
];

export function isLoudnessTarget(lufs: number | null): boolean {
  return LOUDNESS_TARGETS.some((target) => target.lufs === lufs);
}

/**
 * Single-pass `loudnorm`. A two-pass measure-then-apply is more exact, but it
 * doubles the decode over a wasm build, and for a whole track the dynamic pass
 * lands within a fraction of a LU — not worth the wait in a browser.
 * `-1.5 dBTP` true peak leaves headroom for lossy codecs to overshoot.
 */
export function loudnormFilter(lufs: number): string {
  return `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
}

export function safeAudioStem(title: string): string {
  return (
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "audio"
  );
}

/** Extension for a profile's output; `copy` keeps the source container. */
export function outputExt(profile: AudioProfile, sourceExt: string): string {
  if (profile.ext) return profile.ext;
  const clean = (sourceExt || "").replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(clean) ? clean : "m4a";
}

export function outputFilename(title: string, profile: AudioProfile, sourceExt: string): string {
  return `${safeAudioStem(title)}.${outputExt(profile, sourceExt)}`;
}

export type AudioMetadata = {
  title?: string | null;
  artist?: string | null;
  /** Free-form; lands in the comment tag. */
  comment?: string | null;
};

export type BuildAudioArgsOptions = {
  profileId: AudioProfileId;
  inputName: string;
  outputName: string;
  /** Integrated-loudness target, or null to skip normalization. */
  loudnessLufs?: number | null;
  /** Filename of a cover image already written into the ffmpeg FS. */
  coverName?: string | null;
  metadata?: AudioMetadata;
};

/**
 * Build the ffmpeg argv for one audio conversion.
 *
 * Two rules are load-bearing and enforced here rather than at the call site:
 * a stream copy cannot be filtered (so a loudness target is dropped for
 * `copy`), and cover art is only mapped for containers that carry it.
 */
export function buildAudioArgs(options: BuildAudioArgsOptions): string[] {
  const profile = getAudioProfile(options.profileId);
  const { inputName, outputName } = options;
  if (!inputName || !outputName) throw new TypeError("buildAudioArgs needs input and output names");

  const lufs = options.loudnessLufs ?? null;
  if (lufs != null && !isLoudnessTarget(lufs)) {
    throw new TypeError(`Unsupported loudness target: ${lufs}`);
  }
  // A filter graph forces a decode/encode; `-c:a copy` cannot honour one.
  const applyLoudness = lufs != null && profile.canFilter;
  const withCover = Boolean(options.coverName) && profile.supportsCoverArt;

  const args = ["-i", inputName];
  if (withCover) args.push("-i", options.coverName as string);

  if (withCover) {
    // Explicit mapping, else ffmpeg picks one "best" stream and drops the art.
    args.push("-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic");
  } else {
    args.push("-map", "0:a", "-vn");
  }

  if (applyLoudness) args.push("-af", loudnormFilter(lufs as number));
  args.push(...profile.codecArgs);

  const meta = options.metadata ?? {};
  for (const [key, value] of [
    ["title", meta.title],
    ["artist", meta.artist],
    ["comment", meta.comment],
  ] as const) {
    if (value) args.push("-metadata", `${key}=${value}`);
  }

  // ID3v2.3 is the version Windows Explorer and older players actually read.
  if (outputName.toLowerCase().endsWith(".mp3")) args.push("-id3v2_version", "3");

  args.push("-y", outputName);
  return args;
}

/**
 * Rough output size for a duration, so the UI can warn before someone converts
 * a three-hour podcast to 24-bit WAV. Returns null when unknowable (copy, or no
 * duration) — a null must never be rendered as "0 bytes".
 */
export function estimateOutputBytes(
  profileId: AudioProfileId,
  durationSec: number | null | undefined,
  sourceBytes?: number | null,
): number | null {
  const profile = getAudioProfile(profileId);
  if (profile.approxBytesPerSec == null) return sourceBytes ?? null;
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  return Math.round(durationSec * profile.approxBytesPerSec);
}

/** Profiles whose output would exceed this are worth a heads-up in the UI. */
export const LARGE_OUTPUT_BYTES = 500 * 1024 * 1024;
