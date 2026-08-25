import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDER_FALLBACK_STEPS, FFMPEG_MUX_ARGS, formatFallbackChain } from "./fallback-path.ts";
import { ytdlpArgv, ytdlpFormatSelector } from "./ytdlp-auth.ts";

test("ffmpeg mux is copy-remux, not a transcode", () => {
  assert.deepEqual([...FFMPEG_MUX_ARGS.slice(0, 2)], ["-c", "copy"]);
  assert.ok(FFMPEG_MUX_ARGS.includes("+faststart"));
});

test("yt-dlp -f uses + to mux and / to fall through", () => {
  const selector = ytdlpFormatSelector(137);
  assert.equal(selector, "137+140/137+251/96");
  assert.deepEqual(formatFallbackChain(137), ["137+140", "137+251", "96"]);
  const argv = ytdlpArgv({ dir: "/tmp/x", id: "dQw4w9WgXcQ", itag: 137, client: "web_embedded" });
  assert.equal(argv[argv.indexOf("-f") + 1], selector);
  assert.equal(argv[argv.indexOf("--merge-output-format") + 1], "mp4/mkv");
});

test("fallback order is bind → hop mux → HLS → 360", () => {
  assert.equal(BUILDER_FALLBACK_STEPS[0].includes("innertube"), true);
  assert.equal(BUILDER_FALLBACK_STEPS[1].includes("137+140"), true);
  assert.ok(BUILDER_FALLBACK_STEPS.some((step) => step.includes("96")));
  assert.equal(BUILDER_FALLBACK_STEPS.at(-1)?.includes("18"), true);
  assert.deepEqual(formatFallbackChain(18), ["18"]);
});
