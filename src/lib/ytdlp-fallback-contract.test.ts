import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Given failed saved yt-dlp routes, When the download caller continues, Then free routes precede the ungated direct fallback", async () => {
  const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
  const saved = source.indexOf("const savedOutcome");
  const free = source.indexOf("if (!loggedIn)", saved);
  const direct = source.indexOf("Direct is the final fallback", free);
  assert.ok(saved >= 0 && free > saved && direct > free);
  assert.match(source, /allowDirectFallback: false/);
  assert.equal(source.includes("savedRoutes.length === 0"), false);
});

test("Given cookie-bearing downloads, When saved direct and pool attempts are wired, Then only saved proxies receive trusted-proxy authority", async () => {
  const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
  assert.match(source, /attempt\(client, url, true\)/);
  assert.match(source, /attempt\(client, proxy\)/);
  assert.match(source, /cookiePath: proxy && !trustedProxy \? undefined : cookiePath/);
});
