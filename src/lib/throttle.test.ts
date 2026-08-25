import assert from "node:assert/strict";
import { test } from "node:test";
import { looksThrottled, THROTTLE_FLAGS, THROTTLE_QA } from "./throttle.ts";
import { isRetryable } from "./retry.ts";
import { ytdlpArgv } from "./ytdlp-auth.ts";

test("50 KB/s nsig cap is treated as throttle; 100K threshold is on the argv", () => {
  assert.equal(looksThrottled("WARNING: nsig extraction failed: You may experience throttling"), true);
  assert.equal(looksThrottled('WARNING: Error solving n challenge request using "node" provider: n result is invalid'), true);
  assert.equal(looksThrottled("download speed is below the throttled-rate"), true);
  assert.equal(looksThrottled("HTTP 403 Forbidden"), false);
  assert.equal(isRetryable(new Error("nsig extraction failed, throttling")), true);
  const argv = ytdlpArgv({ dir: "/tmp/x", id: "dQw4w9WgXcQ", itag: 137, client: "web_embedded" });
  assert.equal(argv[argv.indexOf("--throttled-rate") + 1], "100K");
  assert.equal(argv[argv.indexOf("--http-chunk-size") + 1], "10M");
  assert.equal(argv[argv.indexOf("--concurrent-fragments") + 1], "1");
  assert.ok(THROTTLE_FLAGS.includes("--extractor-retries"));
});

test("Q&A covers nsig, same-hop, and cookies-only-for-gated", () => {
  assert.equal(THROTTLE_QA.length, 3);
  assert.match(THROTTLE_QA[0]?.a ?? "", /100 KB\/s/);
  assert.match(THROTTLE_QA[1]?.a ?? "", /137\+140/);
  assert.match(THROTTLE_QA[2]?.a ?? "", /age-gated/);
});
