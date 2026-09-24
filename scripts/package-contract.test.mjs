// Contract checks for package.json scripts/engines and the server build preset
// (roadmap C7, D1). The real proof is `npm run build` + `npm start`; these stop
// a later edit from quietly undoing the contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json"));

test("Node floor is pinned to 24 LTS", () => {
  assert.equal(pkg.engines?.node, ">=24.15.0");
  assert.equal(read(".nvmrc").trim(), "24");
});

test("build only builds; migrations are a separate step", () => {
  assert.doesNotMatch(pkg.scripts.build, /migrat/);
  assert.equal(pkg.scripts["db:migrate"], "node scripts/migrate.mjs");
  assert.equal(pkg.scripts.start, "node .output/server/index.mjs");
});

test("dev takes host/port from vite.config.ts (loopback by default), not from flags", () => {
  assert.doesNotMatch(pkg.scripts.dev, /--host|--port|0\.0\.0\.0/);
  const vite = read("vite.config.ts");
  assert.match(vite, /host: process\.env\.VELO_DEV_HOST\?\.trim\(\) \|\| "127\.0\.0\.1"/);
  assert.match(vite, /port: Number\(process\.env\.VELO_DEV_PORT\) \|\| 8080/);
});

test("the server builds with Nitro's node-server preset; nothing targets Vercel output", () => {
  const vite = read("vite.config.ts");
  assert.match(vite, /preset: "node-server"/);
  assert.doesNotMatch(vite, /preset: "vercel"|\.vercel\/output|pgliteAssetsPlugin/);
});
