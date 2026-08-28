import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeSubLang } from "./ytdlp-subs.ts";

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
