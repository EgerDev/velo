import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Roadmap D7/C5 (W4b): no BotGuard minting, server-side deciphering, same-hop
// bypass or third-party egress. Each task of W4b adds the assertions for the
// code it deletes; they fail if any of it comes back.
const here = (path: string) => new URL(path, import.meta.url);
const source = (path: string) => readFileSync(here(path), "utf8");

test("the browser download ladder mints no PO token and takes no same-hop, unlock or public-relay leg", () => {
  assert.equal(existsSync(here("./bypass.ts")), false);
  for (const file of ["./hybrid-download.ts", "./builder-download.ts", "./hybrid-net.ts", "./hybrid-ytdlp.ts"]) {
    assert.doesNotMatch(
      source(file),
      /mintPoToken|fetchSameHopBlob|\/api\/bypass|\/api\/unlock|stampClientPot|publicRelayUrls|\bpot\b/,
      file,
    );
  }
});

test("no PO-token minter remains, and no route or yt-dlp call carries a PO token", () => {
  assert.equal(existsSync(here("./po-token.server.ts")), false);
  const files = [
    "./resolve-video.ts",
    "./youtube-client.server.ts",
    "./youtube-stream.server.ts",
    "./ytdlp.server.ts",
    "./ytdlp-meta.server.ts",
    "./ytdlp-auth.ts",
    "./builder.server.ts",
    "../routes/api/builder.ts",
    "../routes/api/ytdlp.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(
      source(file),
      /po-token\.server|mintPoToken|mintDualPoTokens|mintContentPoToken|poTokenArgs|fetch_pot=never|po_token: /,
      file,
    );
  }
  for (const file of ["./builder.server.ts", "../routes/api/builder.ts", "../routes/api/ytdlp.ts", "./ytdlp.server.ts"]) {
    assert.doesNotMatch(source(file), /\bpot\??:/, file);
  }
});

test("the unlock and same-hop bypass routes and their server helpers are gone", () => {
  for (const file of ["../routes/api/unlock.ts", "../routes/api/bypass.ts", "./bypass.server.ts", "./bypass-parse.ts"]) {
    assert.equal(existsSync(here(file)), false, file);
  }
  assert.doesNotMatch(source("../routes/api/download.ts"), /streamSameHop|bypass/);
  assert.doesNotMatch(source("./resolve-video.ts"), /decipherCipher|decipherRawFormat/);
  assert.doesNotMatch(source("./youtube-stream.server.ts"), /unlockPlaybackUrl/);
});
