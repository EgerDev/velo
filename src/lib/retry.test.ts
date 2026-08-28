import assert from "node:assert/strict";
import { test } from "node:test";
import { isRetryable, withRetry } from "./retry.ts";
import { DownloadError } from "./download-error.ts";

test("does not retry 403 / sign-in / 429 / 503, does retry timeouts", () => {
  assert.equal(isRetryable(new Error("HTTP 403 Forbidden")), false);
  assert.equal(isRetryable(new Error("Sign in to confirm you’re not a bot")), false);
  assert.equal(isRetryable(new Error("Relay 429")), false);
  assert.equal(isRetryable(new Error("Builder 503")), false);
  assert.equal(isRetryable(new Error("Lots of people are saving right now.")), false);
  assert.equal(isRetryable(new Error("Guest download cap reached (about 12 files every 10 minutes)")), false);
  assert.equal(isRetryable(new DownloadError("too many", "rate")), false);
  assert.equal(isRetryable(new DownloadError("queued", "queue")), false);
  assert.equal(isRetryable(new Error("Server timed out after 20s")), true);
  assert.equal(isRetryable(new Error("nsig extraction failed: throttling")), true);
  assert.equal(isRetryable(new Error("aborted")), false);
});

test("status codes match on word boundaries, not inside byte counts", () => {
  // Truncation errors embed raw byte counts; "1403211" is not a 403.
  assert.equal(
    isRetryable(new Error("Download ended early — got 1403211 of 5000000 bytes. The connection dropped; try again.")),
    false,
  );
  // ...and "1502000" is not a 502 either — an otherwise identical message is not retried.
  assert.equal(
    isRetryable(new Error("Download ended early — got 1502000 of 5000000 bytes. The connection dropped; try again.")),
    false,
  );
  assert.equal(isRetryable(new Error("Download ended early — got 1234567 of 5000000 bytes.")), false);
  assert.equal(isRetryable(new Error("relay 502 Bad Gateway")), true);
  assert.equal(isRetryable(new Error("cloudflare 522")), true);
  assert.equal(isRetryable(new Error("HTTP 403")), false);
  assert.equal(isRetryable(new Error("got 429")), false);
});

test("retries then succeeds", async () => {
  let n = 0;
  const waits: number[] = [];
  const value = await withRetry(
    async () => {
      n += 1;
      if (n < 3) throw new Error("timed out");
      return "ok";
    },
    {
      attempts: 3,
      baseMs: 10,
      maxMs: 20,
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.equal(value, "ok");
  assert.equal(n, 3);
  assert.equal(waits.length, 2);
});

test("stops immediately on non-retryable errors", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          n += 1;
          throw new Error("HTTP 403 Forbidden");
        },
        { attempts: 4, wait: async () => undefined },
      ),
    /403/,
  );
  assert.equal(n, 1);
});