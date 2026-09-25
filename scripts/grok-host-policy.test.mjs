// Roadmap Global Constraint (Egress): after W2 no host containing "grok" — nor
// the platform's staging domain — appears in src/, server/, scripts/,
// packages/ or public/. Keep literal hosts out of this file too: the samples
// below are assembled at runtime.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./project-root.mjs";

const ROOTS = ["src", "server", "scripts", "packages", "public"];
const TLD = "(?:com|me|net|org|io|ai|dev|app|co)";
const FORBIDDEN = [
  new RegExp(`[a-z0-9-]*grok[a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}\\b`, "i"),
  new RegExp(`app-builder-testing\\.${TLD}\\b`, "i"),
];

function forbiddenHost(text) {
  for (const pattern of FORBIDDEN) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

test("the host patterns catch the platform's hosts and nothing Velo uses", () => {
  const g = "grok";
  const staging = ["app", "builder", "testing"].join("-");
  for (const host of [`${g}.com`, `auth.${g}.me`, `abc.${g}-sandbox.com`, `app-builder.${g}.com`, `gate.${staging}.com`]) {
    assert.ok(forbiddenHost(`fetch("https://${host}/x")`), host);
  }
  for (const text of ["www.youtube.com", "accounts.google.com", `"${g}-google" provider id`, `${g}-auth.session_token`, "ChatGPT / Claude / Grok"]) {
    assert.equal(forbiddenHost(text), null, text);
  }
});

test("no platform host in src/, server/, scripts/, packages/ or public/", () => {
  const hits = [];
  for (const root of ROOTS) {
    const dir = join(projectRoot(), root);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true })) {
      const file = join(dir, String(entry));
      if (!statSync(file).isFile()) continue;
      const host = forbiddenHost(readFileSync(file, "utf8"));
      if (host) hits.push(`${join(root, String(entry))}: ${host}`);
    }
  }
  assert.deepEqual(hits, []);
});
