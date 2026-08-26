import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_PROFILES,
  buildAudioArgs,
  estimateOutputBytes,
  getAudioProfile,
  isLoudnessTarget,
  LOUDNESS_TARGETS,
  loudnormFilter,
  outputExt,
  outputFilename,
  safeAudioStem,
} from "./audio-profiles.ts";

/** Value that follows a flag in an argv, e.g. argAfter(args, "-c:a"). */
function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("profile catalog", () => {
  it("exposes unique ids and resolves them", () => {
    const ids = AUDIO_PROFILES.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(getAudioProfile("flac").lossless, true);
    assert.equal(getAudioProfile("mp3_320").lossless, false);
  });

  it("throws on an unknown profile rather than silently defaulting", () => {
    // @ts-expect-error deliberately invalid id
    assert.throws(() => getAudioProfile("mp3_9999"), TypeError);
  });

  it("marks only the copy profile as unfilterable", () => {
    for (const profile of AUDIO_PROFILES) {
      assert.equal(profile.canFilter, profile.id !== "copy", `canFilter wrong for ${profile.id}`);
    }
  });
});

describe("loudness targets", () => {
  it("offers off plus the delivery standards", () => {
    assert.deepEqual(
      LOUDNESS_TARGETS.map((t) => t.lufs),
      [null, -14, -16, -23],
    );
    assert.ok(isLoudnessTarget(-14));
    assert.ok(isLoudnessTarget(null));
    assert.ok(!isLoudnessTarget(-9));
  });

  it("builds a loudnorm filter with true-peak headroom", () => {
    assert.equal(loudnormFilter(-14), "loudnorm=I=-14:TP=-1.5:LRA=11");
  });
});

describe("buildAudioArgs", () => {
  const base = { inputName: "in.m4a", outputName: "out.mp3" } as const;

  it("builds an MP3 320 conversion with input, codec and output", () => {
    const args = buildAudioArgs({ profileId: "mp3_320", ...base });
    assert.deepEqual(args.slice(0, 2), ["-i", "in.m4a"]);
    assert.equal(argAfter(args, "-c:a"), "libmp3lame");
    assert.equal(argAfter(args, "-b:a"), "320k");
    assert.equal(args[args.length - 1], "out.mp3");
    assert.ok(args.includes("-y"), "must overwrite, the FS is reused across runs");
  });

  it("applies a loudness filter when the profile re-encodes", () => {
    const args = buildAudioArgs({ profileId: "mp3_320", ...base, loudnessLufs: -16 });
    assert.equal(argAfter(args, "-af"), "loudnorm=I=-16:TP=-1.5:LRA=11");
  });

  it("drops loudness for a stream copy — a copy cannot be filtered", () => {
    const args = buildAudioArgs({
      profileId: "copy",
      inputName: "in.m4a",
      outputName: "out.m4a",
      loudnessLufs: -14,
    });
    assert.ok(!args.includes("-af"), "copy must not carry a filter");
    assert.equal(argAfter(args, "-c:a"), "copy");
  });

  it("rejects a loudness target that is not one of the offered standards", () => {
    assert.throws(() => buildAudioArgs({ profileId: "mp3_320", ...base, loudnessLufs: -7 }), TypeError);
  });

  it("maps cover art for containers that carry it", () => {
    const args = buildAudioArgs({ profileId: "mp3_320", ...base, coverName: "cover.jpg" });
    assert.deepEqual(args.slice(0, 4), ["-i", "in.m4a", "-i", "cover.jpg"]);
    assert.ok(args.includes("-map") && args.includes("1:v"));
    assert.equal(argAfter(args, "-disposition:v"), "attached_pic");
  });

  it("ignores cover art for containers that do not (wav, opus)", () => {
    for (const id of ["wav24", "opus_192"] as const) {
      const args = buildAudioArgs({
        profileId: id,
        inputName: "in.m4a",
        outputName: `out.${id === "wav24" ? "wav" : "opus"}`,
        coverName: "cover.jpg",
      });
      assert.ok(!args.includes("cover.jpg"), `${id} must not map cover art`);
      assert.ok(args.includes("-vn"), `${id} should drop video streams`);
    }
  });

  it("writes metadata tags only for the fields provided", () => {
    const args = buildAudioArgs({
      profileId: "mp3_320",
      ...base,
      metadata: { title: "Ep 1", artist: "Some Channel", comment: null },
    });
    assert.ok(args.includes("title=Ep 1"));
    assert.ok(args.includes("artist=Some Channel"));
    assert.ok(!args.some((a) => a.startsWith("comment=")));
  });

  it("forces ID3v2.3 for mp3 output so Windows reads the tags", () => {
    assert.equal(argAfter(buildAudioArgs({ profileId: "mp3_320", ...base }), "-id3v2_version"), "3");
    const flac = buildAudioArgs({ profileId: "flac", inputName: "in.m4a", outputName: "out.flac" });
    assert.ok(!flac.includes("-id3v2_version"));
  });

  it("requires input and output names", () => {
    assert.throws(() => buildAudioArgs({ profileId: "flac", inputName: "", outputName: "o.flac" }), TypeError);
  });
});

describe("output naming", () => {
  it("uses the profile extension, and the source extension for copy", () => {
    assert.equal(outputExt(getAudioProfile("flac"), "m4a"), "flac");
    assert.equal(outputExt(getAudioProfile("copy"), "webm"), "webm");
    assert.equal(outputExt(getAudioProfile("copy"), ".M4A"), "m4a");
    // Nonsense source extension falls back rather than producing a broken name.
    assert.equal(outputExt(getAudioProfile("copy"), "not an ext"), "m4a");
  });

  it("sanitizes titles into filesystem-safe stems", () => {
    assert.equal(safeAudioStem("My Show: Ep #1 / Part 2"), "My_Show_Ep_#1_Part_2");
    assert.equal(safeAudioStem("日本語タイトル"), "日本語タイトル");
    assert.equal(safeAudioStem("Мой подкаст"), "Мой_подкаст");
    assert.equal(safeAudioStem("   "), "audio");
    assert.equal(outputFilename("My Show", getAudioProfile("mp3_320"), "m4a"), "My_Show.mp3");
  });
});

describe("estimateOutputBytes", () => {
  it("scales with duration for fixed-rate profiles", () => {
    const tenMin = 600;
    assert.equal(estimateOutputBytes("mp3_320", tenMin), 600 * 40_000);
    assert.ok((estimateOutputBytes("wav24", tenMin) ?? 0) > (estimateOutputBytes("flac", tenMin) ?? 0));
  });

  it("returns null rather than zero when the duration is unknown", () => {
    assert.equal(estimateOutputBytes("mp3_320", null), null);
    assert.equal(estimateOutputBytes("mp3_320", 0), null);
  });

  it("falls back to the source size for a stream copy", () => {
    assert.equal(estimateOutputBytes("copy", 600, 5_000_000), 5_000_000);
    assert.equal(estimateOutputBytes("copy", 600, null), null);
  });
});
