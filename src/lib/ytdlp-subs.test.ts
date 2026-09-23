import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeSubLang, subLangsArg } from "./ytdlp-subs.ts";

test("sanitizeSubLang keeps codes and drops flags/commas", () => {
  assert.equal(sanitizeSubLang("en"), "en");
  assert.equal(sanitizeSubLang("zh-Hans"), "zh-Hans");
  assert.equal(sanitizeSubLang("en-US"), "en-US");
  assert.equal(sanitizeSubLang("  zh-Hans  "), "zh-Hans");
  assert.equal(sanitizeSubLang("en,all"), "en");
  assert.equal(sanitizeSubLang("fr,all"), "en");
  assert.equal(sanitizeSubLang("--write-subs"), "en");
  assert.equal(sanitizeSubLang(""), "en");
  assert.equal(sanitizeSubLang("!!!"), "en");
});

test("subLangsArg asks for the translation under both of yt-dlp's names", () => {
  // Manual English track → yt-dlp lists "es-en"; auto-captions → plain "es".
  assert.equal(subLangsArg("en", "es"), "es,es-en");
  assert.equal(subLangsArg("en"), "en");
  // A hostile code is sanitized per part, never passed through with its comma.
  assert.equal(subLangsArg("en", "es,--exec=x"), "en,en-en");
});
