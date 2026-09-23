import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyDownloadError, shouldEscalateSave } from "./download-error.ts";

test("a byte count containing 403 is not a blocked transfer", () => {
  const truncated = classifyDownloadError(
    new Error("Download ended early — got 1403211 of 5000000 bytes. The connection dropped; try again."),
  );
  assert.equal(truncated.code, "unknown");
  const other = classifyDownloadError(
    new Error("Download ended early — got 1234567 of 5000000 bytes. The connection dropped; try again."),
  );
  assert.equal(other.code, "unknown");
});

test("a real 403 still classifies as blocked", () => {
  assert.equal(classifyDownloadError(new Error("HTTP 403 Forbidden")).code, "blocked");
  assert.equal(classifyDownloadError(new Error("relay: 403")).code, "blocked");
  assert.equal(classifyDownloadError(new Error("nope"), [], { status: 403 }).code, "blocked");
});

test("a lazy chunk that failed to load asks for a reload, never a quality fallback", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://velo.app/assets/bypass-CzaLb9do.js", // Chrome
    "error loading dynamically imported module: https://velo.app/assets/x.js", // Firefox
    "Importing a module script failed.", // Safari
  ]) {
    const err = classifyDownloadError(new Error(message));
    assert.equal(err.code, "reload", message);
    assert.match(err.message, /Reload the page/);
    assert.equal(shouldEscalateSave(new Error(message)), false);
  }
});
