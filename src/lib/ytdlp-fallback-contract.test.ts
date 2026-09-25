import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Given failed saved yt-dlp routes, When the download caller continues, Then a gated direct probe precedes the ungated direct fallback and no free route exists", async () => {
  const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
  const saved = source.indexOf("const savedOutcome");
  const probe = source.indexOf("directYtdlpOpen()", saved);
  const direct = source.indexOf("Direct is the final fallback", probe);
  assert.ok(saved >= 0 && probe > saved && direct > probe);
  // A failed probe must close the window, or blocked hosts pay it every save.
  assert.match(source, /markDirectYtdlpBlocked\(\)/);
  // Roadmap D7/M-14: no public SOCKS pool anywhere in the ladder.
  assert.doesNotMatch(source, /takeSocks|socks-pool/);
  // Formats and subtitles take the same gated direct hop after saved routes.
  const meta = await readFile(new URL("./ytdlp-meta.server.ts", import.meta.url), "utf8");
  assert.match(meta, /markDead: markDirectYtdlpBlocked/);
  assert.equal(meta.match(/runHops\(null, tryHop\)/g)?.length, 2);
  assert.doesNotMatch(meta, /takeSocks|socks-pool/);
  assert.match(source, /allowDirectFallback: false/);
  assert.equal(source.includes("savedRoutes.length === 0"), false);
});

test("Given cookie-bearing downloads, When saved direct and pool attempts are wired, Then only saved proxies receive trusted-proxy authority", async () => {
  const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
  assert.match(source, /attempt\(client, url, true\)/);
  assert.match(source, /cookiePath: proxy && !trustedProxy \? undefined : cookiePath/);
});
