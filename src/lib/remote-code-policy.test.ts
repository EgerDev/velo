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
