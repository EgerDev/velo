import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("the server downloads and runs no YouTube player script", () => {
  for (const file of ["./nsig.ts", "./stream-unlock.ts", "./parallel-stream.ts"]) {
    assert.equal(existsSync(here(file)), false, file);
  }
  const client = source("./youtube-client.server.ts");
  assert.doesNotMatch(client, /Platform|shim\.eval|new Function|retrieve_player: true/);
  assert.equal(client.match(/retrieve_player: false,/g)?.length, 2);
  assert.doesNotMatch(source("./youtube-stream.server.ts"), /session\.player|nsig|decipherRawFormat|rn=/);
});

test("no module in src/ imports node:vm", () => {
  const vm = /\bfrom\s*["'](node:)?vm["']|import\(\s*["'](node:)?vm["']\s*\)|require\(\s*["'](node:)?vm["']\s*\)|getBuiltinModule\(\s*["'](node:)?vm["']/;
  const root = here("../");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) =>
    /\.(ts|tsx|js|mjs)$/.test(name),
  );
  assert.ok(files.length > 100, "walked src/");
  for (const name of files) {
    assert.doesNotMatch(readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8"), vm, name);
  }
});

test("nothing patches process-wide DNS or the global fetch dispatcher", () => {
  assert.equal(existsSync(here("./ipv4-bind.server.ts")), false);
  const root = here("../");
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith("remote-code-policy.test.ts")) continue;
    const text = readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(text, /ipv4-bind|setGlobalDispatcher|dns\.lookup\s*=|setDefaultAutoSelectFamily/, name);
  }
  assert.doesNotMatch(source("../../package.json"), /sideEffects/);
});

test("no source file names a free proxy list, a public CORS relay or the BotGuard library", () => {
  const banned = /proxifly|free-proxy-list|corsfix|allorigins|bgutils/i;
  const repo = here("../../");
  const self = "remote-code-policy.test.ts";
  let scanned = 0;
  for (const dir of ["src", "scripts", "server", "public", "packages"]) {
    const base = new URL(`${dir}/`, repo);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base, { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx|js|mjs|cjs|json|html|css)$/.test(name) || name.endsWith(self)) continue;
      scanned += 1;
      assert.doesNotMatch(readFileSync(new URL(name.replaceAll("\\", "/"), base), "utf8"), banned, `${dir}/${name}`);
    }
  }
  for (const file of ["package.json", "vite.config.ts"]) {
    scanned += 1;
    assert.doesNotMatch(readFileSync(new URL(file, repo), "utf8"), banned, file);
  }
  assert.ok(scanned > 100, "walked the source tree");
  assert.equal(existsSync(here("./socks-pool.server.ts")), false);
});

test("yt-dlp never downloads its challenge solver, and its children get no server secrets", () => {
  for (const file of ["./ytdlp-auth.ts", "./ytdlp-meta.server.ts"]) {
    assert.doesNotMatch(source(file), /remote-components|ejs:github/, file);
  }
  for (const file of ["./proc-run.server.ts", "./ytdlp-proc.server.ts"]) {
    assert.match(source(file), /env: childEnv\(\)/, file);
  }
});

test("yt-dlp gets no TLS impersonation and nothing pip-installs curl_cffi at run time (D7)", () => {
  for (const file of ["./ytdlp-auth.ts", "./ytdlp-meta.server.ts", "./ytdlp.server.ts", "./ytdlp-python.server.ts"]) {
    assert.doesNotMatch(source(file), /--impersonate|ytdlpImpersonateArgs|ensureImpersonate|optionalModule/, file);
  }
  assert.doesNotMatch(source("./ytdlp-python.server.ts"), /"pip"/);
});
