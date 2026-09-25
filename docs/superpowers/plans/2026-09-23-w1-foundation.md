# W1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task names its **Executor** (`.claude/agents/velo-impl-*.md`) and is reviewed by `velo-reviewer` before the next task starts.

**Goal:** Give every later workstream a verified base: Node 24 pinned, a `node-server` build that `npm start` runs, a loopback dev server, lint that fails on any warning, a redacting server logger (C4), a black-box HTTP harness against the built server (C6), real media-parser tests, and hardened, SHA-pinned GitHub Actions with required-check drafts.

**Architecture:** Nitro switches from the `vercel` preset to `node-server` (`.output/server/index.mjs`), so CI and later the container (W5) build and run the same artifact. `tests/http/harness.mjs` spawns that artifact on an ephemeral port. CI has three workflow families:
- the required gate (`ci.yml`);
- a two-job auto-updater that never runs new package code next to a write credential;
- scanning (`codeql`, `dependency-review`, `scorecard`, Dependabot).

GitHub settings the agents cannot change are prepared as exact `gh api` commands for the owner.

**Tech Stack:** Node 24 LTS (`node:test`, `--experimental-strip-types`), Vite 8 + TanStack Start + Nitro `3.0.260610-beta` (`node-server` preset, srvx), ESLint 9 flat config + typescript-eslint, GitHub Actions, Postgres 16 (CI service), ffmpeg 7.x (one-off fixture generation only).

**Spec:** `docs/superpowers/plans/2026-09-23-00-roadmap.md` (decisions D1–D7, Global Constraints, Shared Contract C4/C6/C7) plus `audit/MASTER_FINDINGS.md`, `audit/05-github-security.md`, `audit/08-testing.md`, `audit/09-clean-install.md`, `audit/17-codebase-cleanliness.md`.

---

## Contract change requests

1. **C7 `test:e2e`: W8 adds it, not W1.** C7 lists `test:e2e` among the scripts "after W1". A `playwright test` script needs `@playwright/test` and a config, and both are W8's (roadmap: "Playwright e2e in tests/e2e (W8 sets up)"). A script that cannot run would make `npm run test:e2e` red on `main` for four workstreams. W1 adds every other C7 script. Proposed C7 wording: "… `test:http` (requires a prior build), `test:e2e` (**added by W8**), `format`."
2. **Global Constraint "no `console.*` in `src/**/*.server.ts` and `src/routes/**` after W1": two files are exempt until W2.**
   - Scope: `src/lib/auth/gate-session.server.ts` (16 calls) and `src/lib/auth/verify.server.ts` (1 call). Both are Grok-gate/auth files that W2 deletes or rewrites.
   - Why an exemption: migrating them in W1 would mean editing auth code that W2 removes a week later.
   - Where it lives: the exemption is two `ignores` lines in `eslint.config.mjs`, each marked `W2`.
   - W2 obligation: W2 must delete both lines, and its lint gate then enforces the rule on whatever replaces those files.
   - Every other server file, including the one existing call in `src/lib/ytdlp-meta.server.ts`, is under the rule from Task 5 on.
3. **C6, compatible clarification, not a rename.**
   - `startServer` always sets `HOST=127.0.0.1` and `PORT=0`.
   - It **deletes** `NITRO_PORT`/`NITRO_HOST` from the child env. Nitro reads `NITRO_PORT ?? PORT`, so even an empty `NITRO_PORT` beats `PORT`.
   - It defaults `DATABASE_URL` to `""` unless the test passes one, so a developer's real database is never touched.
   - Later workstreams that need a database pass `env: { DATABASE_URL: process.env.VELO_TEST_DATABASE_URL }`.

## Preconditions

- **W0 merged** (roadmap merge order W0 → W1). Code state this plan assumes after W0:
  - W0-T1 committed the working tree. The 189 lint warnings listed in Task 2A–2D are measured on exactly that tree.
  - `src/lib/auth/preview.ts` is gone. `src/lib/auth/server.ts` **throws at module load in production** unless `VITE_AUTH_ENABLED=false` or `GROK_AUTH_CLIENT_ID/SECRET` are set, so every production boot in this plan sets `VITE_AUTH_ENABLED=false`. W2 removes that flag.
  - `.github/workflows/auto-update.yml` is `workflow_dispatch`-only, `permissions: contents: read`, and has no create-pull-request step. Task 7 replaces the file.
  - `src/components/session-guide.tsx` no longer has `VELO_EXTENSION_ZIP` or the "Option 1 (Recommended)" blocks. W0 may already have removed the unused `Zap` import; Task 2C handles both cases.
  - `src/lib/sign-in-link*.ts` are deleted, `src/lib/rate-window.ts` exists, and `src/routes/login.tsx` lost the link UI. That may have left unused imports, which Task 2D handles.
  - `.vercel/output` and `.tanstack` are deleted locally, and `audit/` is committed.
- **Workspace.**
  - Work in the worktree `../velo-w1` on branch `hardening/w1-foundation`, created from `main` with `superpowers:using-git-worktrees`.
  - `.gitattributes` is `* text=auto eol=lf`, so files in a fresh worktree are **LF**. Every "Replace exactly" anchor below is LF text.
  - Run commands in **Git Bash** from the worktree root unless a step says PowerShell.
- **Ports.** Never use 8080 or 8081; another project uses 8080. This plan uses 8097 (dev smoke), 8123 (start smoke), 55432 (local Postgres) and OS-assigned ports (HTTP tests).
- **Tools.** Node ≥ 24.15 (the host has 25.2.1, which is fine: `>=24.15.0`), npm, `gh`. Docker is needed only for the optional local Postgres run in Task 4. ffmpeg 7.x with libx264 is needed only in Task 6; the host has `ffmpeg 7.1.1-essentials_build-www.gyan.dev`.

## Global Constraints

Copied from the roadmap; every task includes these.

- **Node:** `>=24.15.0` (`engines` in package.json, `.nvmrc` = `24`).
- **Untrusted JavaScript:** `new Function`, `eval` and `vm.runInThisContext` on remote code are forbidden, and a lint rule enforces it. Code fetched from YouTube/Google runs only through `runSandboxed` (C5, W4b).
- **Credentials:** YouTube cookies are never persisted server-side, never logged, never returned in a response.
- **Logging:** server code logs only through `log` from `src/lib/log.server.ts`, which redacts keys matching `/cookie|token|secret|authorization|password|sapisid|sid/i`. A lint rule bans `console.*` in `src/**/*.server.ts` and `src/routes/**` after W1 (exemption: Contract change request 2).
- **Tests:**
  - every P0/P1 fix lands with a regression test written first and seen failing;
  - never weaken, skip or delete a test to go green;
  - unit tests are `src/**/*.test.ts` (run by `npm test`), HTTP black-box tests are `tests/http/*.test.mjs` (run by `npm run test:http` against the built server).
- **Lint:** after W1-T3 every rule is `error`, and `npm run lint` must exit 0 with 0 warnings (`--max-warnings 0`).
- **Commits:**
  - Conventional Commits, one commit per task, on `hardening/w1-foundation`;
  - every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Windows + Linux:** every npm script works on both (no `/tmp`, `/dev/null` or `python3` literals in Node code). The container is Linux-only, and macOS is untested.
- **Copy rule:** user-facing text never promises what the code doesn't do, and security claims name the mechanism.
- **Owner-only actions** are marked **[OWNER]**; agents prepare the commands and stop.

## Review Focus

The five inputs most likely to bite, each pinned by a test in the owning task:

1. **A cookie jar logged as `[{ name: "SID", value }]`.** Key-based redaction alone would print the value. Expected: `value` is redacted when `name` looks like a credential. Test: Task 5, `redact replaces credential-looking keys…`.
2. **A developer shell with `NITRO_PORT`, `NITRO_HOST` or a real `DATABASE_URL` exported, running `npm run test:http`.** Expected: the server under test still binds `127.0.0.1:<ephemeral>` and never touches that database. Test: Task 4, `harness.test.mjs` "ambient … never reach the server".
3. **An HTTP test that fails, or a Windows run.** Expected: no orphaned server keeps a port or a Postgres connection. Test: Task 4, `stop() kills the server, frees the port and is idempotent`. CI runs `test:http` on Linux; the executor runs it on Windows and checks for orphans in Task 4 Step 6.
4. **A future workflow job that holds a `write` permission and runs `npm`/`node`/`pip`** (the npm-worm shape behind GH-03). Expected: CI fails. Test: Task 7, `workflow-policy.test.mjs` "a job holding a write permission runs no package code".
5. **A production boot with no database** (the state between W1 and W2, and any misconfigured deploy). Expected: `/api/health` answers 503 with a fixed detail and leaks no path, stack or driver text. Test: Task 4, `health.test.mjs` "leaks no path, stack or driver message".

---

## File Structure

| Path | Status | Responsibility | Task |
|---|---|---|---|
| `package.json` | modify (scripts, engines only) | C7 scripts, Node floor | 1, 3, 4 |
| `.nvmrc` | create | `24` | 1 |
| `.gitignore` | modify (+1 line) | ignore `.output/` | 1 |
| `vite.config.ts` | modify (server block, preset, delete `pgliteAssetsPlugin`) | loopback dev server, `node-server` build | 1 |
| `scripts/package-contract.test.mjs` | create | guards C7 scripts, engines, preset | 1, 3, 4 |
| `extension/popup.js`, `src/lib/{ytdlp-proc.server,hybrid-net,youtube-client.server,youtube.server}.ts` | modify | dead imports/vars | 2A |
| `src/components/{bulk-downloader,bulk-view,transcript-form,transcript-reader,transcript-sidebar}.tsx`, `src/routes/index.tsx` | modify | dead imports / unused destructured props | 2B |
| `src/components/{video-panel,mode-tabs,home-modes,session-guide}.tsx`, `src/lib/use-tools-badge.ts` | modify | component modules export only components; dead ingest bookmarklet | 2C |
| `src/routes/index.tsx`, `src/components/transcript-studio.tsx`, W0-touched files | modify | justified hook-deps disables; post-W0 residue | 2D |
| `eslint.config.mjs` | modify | all rules `error`, eval ban, server `no-console` | 3 |
| `src/lib/po-token.server.ts`, `src/lib/youtube-client.server.ts` | modify (+1 comment line each) | `W4b` eval allowlist | 3 |
| `tests/http/harness.mjs` | create | C6 `startServer` | 4 |
| `tests/http/{harness,health,api-guards}.test.mjs` | create | harness self-test, health, input-guard characterization | 4 |
| `src/lib/log.server.ts`, `src/lib/log.server.test.ts` | create | C4 logger + tests | 5 |
| `src/lib/ytdlp-meta.server.ts` | modify (1 call + import) | first `log` user | 5 |
| `src/lib/media-test-fixtures/{index.ts,h264-high40-1080p-hls.mpegts,h264-high40-1080p-dash.mp4}` | create | synthetic parser fixtures | 6 |
| `src/lib/{h264-syntax,nal-h264,mpeg-ts,iso-bmff}.test.ts` | modify | TEST-05: tests assert on fixtures | 6 |
| `src/lib/download-pool.server.test.ts` | modify | TEST-14 | 6 |
| `.gitattributes` | modify (+2 lines) | fixtures are binary | 6 |
| `.github/workflows/auto-update.yml` | replace | two-job hardened updater | 7 |
| `scripts/auto-update-plan.mjs`, `scripts/auto-update.mjs` | modify | `verifySteps` incl. build | 7 |
| `scripts/auto-update-verify.test.mjs`, `scripts/workflow-policy.test.mjs` | create | TEST-11; workflow policy | 7, 8, 9 |
| `.github/workflows/ci.yml` | create | required gate | 8 |
| `.github/dependabot.yml`, `.github/workflows/{codeql,dependency-review,scorecard}.yml`, `.github/CODEOWNERS` | create | scanning, ownership | 9 |

### The 189 lint warnings, by file and task

| File | Count | Rule(s) | Task |
|---|---|---|---|
| `src/lib/ytdlp-proc.server.ts` | 35 | no-unused-vars | 2A |
| `src/lib/hybrid-net.ts` | 12 | no-unused-vars | 2A |
| `src/lib/youtube-client.server.ts` | 3 | no-unused-vars | 2A |
| `src/lib/youtube.server.ts` | 1 | no-unused-vars | 2A |
| `extension/popup.js` | 1 | no-unused-vars | 2A |
| `src/components/bulk-downloader.tsx` | 31 | no-unused-vars | 2B |
| `src/components/bulk-view.tsx` | 9 | no-unused-vars | 2B |
| `src/components/transcript-form.tsx` | 29 | no-unused-vars | 2B |
| `src/components/transcript-reader.tsx` | 23 | no-unused-vars | 2B |
| `src/components/transcript-sidebar.tsx` | 31 | no-unused-vars | 2B |
| `src/routes/index.tsx` | 1 + 3 | no-unused-vars (`toast`) → 2B; exhaustive-deps ×3 → 2D | 2B, 2D |
| `src/components/video-panel.tsx` | 2 | only-export-components | 2C |
| `src/components/mode-tabs.tsx` | 1 | only-export-components | 2C |
| `src/components/session-guide.tsx` | 3 + 1 | no-unused-vars ×3, only-export-components ×1 | 2C |
| `src/components/transcript-studio.tsx` | 1 | exhaustive-deps | 2D |
| `src/components/ui/badge.tsx`, `ui/button.tsx` | 1 + 1 | only-export-components (shadcn `*Variants`) | 3 (config `allowExportNames`) |
| **Total** | **189** | 179 no-unused-vars, 6 only-export-components, 4 exhaustive-deps | |

---

### Task 1: Node pin, C7 build/start/dev scripts, `node-server` preset

**Executor:** velo-impl-opus-medium
**Covers:** INST-02 (engines, .nvmrc, CI node version), INST-04 (loopback dev and override), M-29, M-33 (Node pin part), OPS-09 (build no longer migrates, part)

**Files:**
- Create: `.nvmrc`, `scripts/package-contract.test.mjs`
- Modify: `package.json` (scripts `dev`, `build`, new `start`; new `engines`), `vite.config.ts` (server block, nitro preset, delete `pgliteAssetsPlugin`), `.gitignore`

**Interfaces:**
- Produces:
  - `npm run build` writes `.output/server/index.mjs` and nothing under `.vercel/`;
  - `npm start` is `node .output/server/index.mjs`. It listens on `NITRO_PORT ?? PORT` (default **3000**) and `NITRO_HOST || HOST`, whose default is **all interfaces**. W5 sets `HOST=0.0.0.0 PORT=8080` in the container;
  - `npm run dev` binds `VELO_DEV_HOST` (default `127.0.0.1`) : `VELO_DEV_PORT` (default `8080`) with `strictPort`.
- Behaviour change, stated on purpose: the production build **no longer carries PGLite's `.wasm/.data`** (the deleted `pgliteAssetsPlugin` copied them into `.vercel/output` only). A production server without `DATABASE_URL` reports `/api/health` 503 `database unreachable` and logs a PGLite `ENOENT`. That is the fail-closed direction. C1 makes `DATABASE_URL` required in production (W2).

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '"dev": "node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8080",' package.json
git grep -c -F '"build": "node scripts/with-app-env.mjs vite build && npm run db:migrate",' package.json
git grep -c -F 'function pgliteAssetsPlugin(): Plugin {' vite.config.ts
git grep -c -F 'preset: "vercel",' vite.config.ts
git grep -c -F 'host: "0.0.0.0",' vite.config.ts
```
Expected: each prints `1`. If any prints nothing, STOP and report.

- [ ] **Step 2: Write the failing contract test.** Create `scripts/package-contract.test.mjs`:
```js
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
```

- [ ] **Step 3: Run it and see it fail.** Run: `node --test scripts/package-contract.test.mjs`
Expected: `ℹ fail 4`. The first failure reads `Expected values to be strictly equal: undefined !== '>=24.15.0'`.

- [ ] **Step 4: Implement `package.json`, `.nvmrc`, `.gitignore`.**
  1. In `package.json` replace exactly
     `  "type": "module",`
     with
     ```
       "type": "module",
       "engines": {
         "node": ">=24.15.0"
       },
     ```
  2. Replace exactly `    "dev": "node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8080",` with `    "dev": "node scripts/with-app-env.mjs vite dev",`.
  3. Replace exactly `    "build": "node scripts/with-app-env.mjs vite build && npm run db:migrate",` with the two lines
     ```
         "build": "node scripts/with-app-env.mjs vite build",
         "start": "node .output/server/index.mjs",
     ```
  4. Create `.nvmrc` containing the single line `24` followed by a newline.
  5. In `.gitignore`, replace exactly `.vercel/\n.tanstack/` (the two consecutive lines under `# Build outputs`) with `.vercel/\n.output/\n.tanstack/`.

- [ ] **Step 5: Implement `vite.config.ts`.**
  1. Delete this whole block, including the blank line after it:
     ```ts
     function pgliteAssetsPlugin(): Plugin {
       return {
         name: "app-builder:pglite-assets",
         apply: "build",
         async closeBundle() {
           const pgliteDist = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
           const targetDir = join(
             process.cwd(),
             ".vercel/output/functions/__server.func/_libs",
           );
           try {
             const { copyFileSync, existsSync, readdirSync } = await import("node:fs");
             if (existsSync(pgliteDist) && existsSync(targetDir)) {
               for (const file of readdirSync(pgliteDist)) {
                 if (file.endsWith(".wasm") || file.endsWith(".data")) {
                   copyFileSync(join(pgliteDist, file), join(targetDir, file));
                 }
               }
             }
           } catch {
             /* ignore */
           }
         },
       };
     }
     ```
  2. Delete the line `    pgliteAssetsPlugin(),` in the `plugins` array.
  3. Replace exactly
     ```ts
     // `0.0.0.0:8080` is the live-preview contract — don't change host/port.
     // The dev server starts once `src/router.tsx` and `src/routes/` exist — see
     // AGENTS.md § "First scaffold".
     export default defineConfig(({ command, isPreview }) => ({
       server: {
         host: "0.0.0.0",
         port: 8080,
         strictPort: true,
       },
     ```
     with
     ```ts
     // Dev binds loopback by default; VELO_DEV_HOST / VELO_DEV_PORT override it
     // (e.g. VELO_DEV_HOST=0.0.0.0 to reach it from another device). strictPort: a
     // busy port fails loudly instead of silently moving the origin auth expects.
     export default defineConfig(({ command, isPreview }) => ({
       server: {
         host: process.env.VELO_DEV_HOST?.trim() || "127.0.0.1",
         port: Number(process.env.VELO_DEV_PORT) || 8080,
         strictPort: true,
       },
     ```
  4. Replace exactly
     ```ts
               nitro({
                 preset: "vercel",
     ```
     with
     ```ts
               nitro({
                 // `.output/server/index.mjs` (`npm start`). Listens on NITRO_PORT ?? PORT
                 // (default 3000) and NITRO_HOST || HOST (default: all interfaces).
                 preset: "node-server",
     ```
  Leave `pgliteBootstrapPlugin`, `authPopupPlugin`, `appEnvPlugin`, `grokPwaPlugin` and `serverDir: "./server"` untouched; W2 deletes the Grok ones. `readdirSync`/`join` stay imported because `hasGlobbedMigrations` uses them.

- [ ] **Step 6: Run the contract test.** Run: `node --test scripts/package-contract.test.mjs`
Expected: `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 7: Build and smoke the production server.** Run:
```bash
npm run build
node -p "require('./.output/nitro.json').preset"
node -e 'console.log(require("fs").existsSync(".vercel/output") ? "UNEXPECTED .vercel/output" : "no .vercel/output")'
node --input-type=module -e '
import { spawn } from "node:child_process";
const env = { ...process.env, NODE_ENV: "production", VITE_AUTH_ENABLED: "false", DATABASE_URL: "", HOST: "127.0.0.1", PORT: "8123" };
delete env.NITRO_PORT; delete env.NITRO_HOST;
const child = spawn(process.execPath, [".output/server/index.mjs"], { env, stdio: ["ignore", "inherit", "ignore"] });
let health;
for (let i = 0; i < 100 && !health; i++) {
  try { health = await fetch("http://127.0.0.1:8123/api/health"); } catch { await new Promise((r) => setTimeout(r, 100)); }
}
console.log("health", health?.status, (await health?.json())?.status);
console.log("home", (await fetch("http://127.0.0.1:8123/")).status);
child.kill();'
```
Expected:
- the build ends with `Generated .output/nitro.json`;
- then `node-server`, then `no .vercel/output`;
- then `➜ Listening on: http://127.0.0.1:8123/`, `health 503 degraded`, `home 200`.

If `health` is `undefined`, the server did not start: re-run with `stdio: "inherit"` to see why, fix, and repeat.

- [ ] **Step 8: Verify dev binds loopback on the override port.** PowerShell (Windows):
```powershell
$env:VELO_DEV_PORT = "8097"; $p = Start-Process cmd.exe -ArgumentList "/c","npm run dev" -PassThru -WindowStyle Hidden; Start-Sleep -Seconds 15; Get-NetTCPConnection -State Listen -LocalPort 8097 | Select-Object LocalAddress,LocalPort; taskkill /pid $p.Id /T /F | Out-Null; Remove-Item Env:VELO_DEV_PORT
```
Expected: exactly one row, `127.0.0.1  8097`, and no `0.0.0.0` or `::` row. On Linux, the equivalent: `VELO_DEV_PORT=8097 npm run dev & sleep 15; ss -ltn | grep 8097; kill %1` shows only `127.0.0.1:8097`.

- [ ] **Step 9: Full gate.** Run: `npm run typecheck && npm test`
Expected: typecheck clean and `npm test` 0 failures. The `scripts` part now has 4 more tests.

- [ ] **Step 10: Commit.**
```bash
git add package.json .nvmrc .gitignore vite.config.ts scripts/package-contract.test.mjs
git commit -m "build: pin Node 24, node-server preset, loopback dev server, build without migrations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2A: Lint cleanup — `src/lib` and the extension popup (52 warnings)

**Executor:** velo-impl-sonnet-high
**Covers:** CLEAN-06, TEST-07 (part), OSS-13 (part)

**Files:** Modify `src/lib/ytdlp-proc.server.ts`, `src/lib/hybrid-net.ts`, `src/lib/youtube-client.server.ts`, `src/lib/youtube.server.ts`, `extension/popup.js`. Only the exact edits below: every removed name is an import or variable ESLint reports as unused. A removal of a whole `import` line is safe because each of those modules is still imported elsewhere, and `package.json` `sideEffects` lists only `ipv4-bind.server.ts`, whose bare import stays.

- [ ] **Step 1: Verify anchors and the starting count.** Run:
```bash
git grep -c -F 'import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";' src/lib/ytdlp-proc.server.ts
git grep -c -F 'import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";' src/lib/hybrid-net.ts
git grep -c -F 'import { toFormat, uniqueFormats } from "@/lib/youtube-map.server";' src/lib/youtube-client.server.ts
git grep -c -F 'let promptTitle = "";' extension/popup.js
npx eslint src/lib/ytdlp-proc.server.ts src/lib/hybrid-net.ts src/lib/youtube-client.server.ts src/lib/youtube.server.ts extension/popup.js
```
Expected: `1` four times, then `✖ 52 problems (0 errors, 52 warnings)`. Any other result: STOP.

- [ ] **Step 2: `src/lib/ytdlp-proc.server.ts`.** Replace exactly:
```ts
import "@/lib/ipv4-bind.server";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRetry } from "@/lib/retry";
import {
  readCookieSession,
  socksClientsForItag,
  ytdlpArgv,
  ytdlpClients,
  ytdlpRunTimeoutMs,
  mapYtdlpExit,
  formatYtdlpFailure,
  isAudioItag,
  pythonBin,
  classifyPythonProbe,
  type PythonProbe,
  type YtdlpFailure,
} from "@/lib/ytdlp-auth";
import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";
import { ytdlpJsonToFormats, type YtDlpJsonFormat } from "@/lib/ytdlp-formats";
import type { VideoFormat } from "@/lib/youtube";
import {
  acquireYtdlpSlot,
  coalesceFile,
  looksLikeMediaFile,
  mediaFileResponse,
  muxCacheGet,
  muxCachePut,
  type FileHit,
} from "@/lib/download-pool.server";
```
with:
```ts
import "@/lib/ipv4-bind.server";
```

- [ ] **Step 3: `src/lib/hybrid-net.ts`.**
  1. Replace exactly
     ```ts
     import { classifyDownloadError, errorFromResponse } from "@/lib/download-error";
     import { withRetry, isRetryable } from "@/lib/retry";
     ```
     with
     ```ts
     import { withRetry } from "@/lib/retry";
     ```
  2. Delete exactly these five lines:
     ```ts
     import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";
     import { isBuilderPreview, isSandboxHost } from "@/lib/builder-env";
     import { saveMediaBlob, type PendingSave } from "@/lib/builder-save";
     import { nameForBlob } from "@/lib/media-name";
     import { isAudioItag, isVideoOnlyItag } from "@/lib/ytdlp-auth";
     ```

- [ ] **Step 4: `src/lib/youtube-client.server.ts`.** Delete exactly these two lines:
```ts
import type { VideoFormat } from "@/lib/youtube";
import { toFormat, uniqueFormats } from "@/lib/youtube-map.server";
```

- [ ] **Step 5: `src/lib/youtube.server.ts`.** Replace exactly
```ts
import type {
  CaptionTrack,
  ResolvedVideo,
```
with
```ts
import type {
  ResolvedVideo,
```

- [ ] **Step 6: `extension/popup.js`.** Delete exactly these five lines (the variable is assigned and never read; each `promptInstr = …` line next to them stays):
```js
      let promptTitle = "";
```
```js
        promptTitle = "EXECUTIVE SUMMARY";
```
```js
        promptTitle = "STUDY NOTES";
```
```js
        promptTitle = "Q&A & FAQ";
```
```js
        promptTitle = "CHAPTER TIMESTAMPS";
```

- [ ] **Step 7: Verify.** Run:
```bash
npx eslint src/lib/ytdlp-proc.server.ts src/lib/hybrid-net.ts src/lib/youtube-client.server.ts src/lib/youtube.server.ts extension/popup.js
npm run typecheck && npm test
```
Expected: ESLint prints nothing (0 problems), typecheck is clean, and `npm test` has 0 failures.

- [ ] **Step 8: Commit.**
```bash
git add src/lib/ytdlp-proc.server.ts src/lib/hybrid-net.ts src/lib/youtube-client.server.ts src/lib/youtube.server.ts extension/popup.js
git commit -m "refactor(lint): drop dead imports in src/lib and the extension popup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2B: Lint cleanup — bulk and transcript components (124 warnings)

**Executor:** velo-impl-sonnet-high
**Covers:** CLEAN-06, TEST-07 (part), OSS-13 (part)

**Files:** Modify `src/components/bulk-downloader.tsx`, `bulk-view.tsx`, `transcript-form.tsx`, `transcript-reader.tsx`, `transcript-sidebar.tsx`, `src/routes/index.tsx` (the `toast` import only). The transcript components destructure props they never use. Removing a name from the destructuring leaves the `TranscriptViewProps` type and every caller unchanged.

- [ ] **Step 1: Verify anchors and the starting count.** Run:
```bash
git grep -c -F '  importBatchJson,' src/components/bulk-downloader.tsx
git grep -c -F 'import { resolveBulkVideos, resolvePlaylist, resolveVideo } from "@/lib/resolve-video";' src/components/bulk-downloader.tsx
git grep -c -F '    translatedTo, readingMinutes,' src/components/transcript-form.tsx
git grep -c -F '    translatedTo, readingMinutes, stats,' src/components/transcript-reader.tsx
git grep -c -F '    translatedTo, readingMinutes, playingTime,' src/components/transcript-sidebar.tsx
npx eslint src/components/bulk-downloader.tsx src/components/bulk-view.tsx src/components/transcript-form.tsx src/components/transcript-reader.tsx src/components/transcript-sidebar.tsx src/routes/index.tsx
```
Expected: `1` five times, then `✖ 127 problems (0 errors, 127 warnings)`: 124 of them are this task's, plus 3 exhaustive-deps in `index.tsx` for Task 2D. Otherwise STOP.

- [ ] **Step 2: `src/components/bulk-downloader.tsx`.**
  1. Replace exactly
     ```tsx
     import {
       CheckCircle2,
       ChevronDown,
       Copy,
       Download,
       FileCode,
       FileText,
       ListPlus,
       Loader2,
       Pause,
       Play,
       RefreshCw,
       Sliders,
       Trash2,
       X,
       XCircle,
     } from "lucide-react";
     import { toast } from "sonner";
     import { Button } from "@/components/ui/button";
     import { Badge } from "@/components/ui/badge";
     import { cn } from "@/lib/utils";
     import {
     ```
     with
     ```tsx
     import { toast } from "sonner";
     import {
     ```
  2. Replace exactly
     ```tsx
       extractYoutubeLinks,
       importBatchJson,
       type BulkItem,
     ```
     with
     ```tsx
       extractYoutubeLinks,
       type BulkItem,
     ```
  3. Replace exactly
     ```tsx
     import { resolveBulkVideos, resolvePlaylist, resolveVideo } from "@/lib/resolve-video";
     import { downloadPresetFile, type DownloadProgress } from "@/lib/download-client";
     import { isUserAbort } from "@/lib/download-error";
     import { beginBuilderSave, discardPendingSave, type PendingSave } from "@/lib/builder-save";
     import { pickBestPreset, type VideoPreset } from "@/lib/youtube";
     import { BulkQueueItem } from "@/components/bulk-queue-item";
     import { BulkView } from "@/components/bulk-view";
     ```
     with
     ```tsx
     import { BulkView } from "@/components/bulk-view";
     ```

- [ ] **Step 3: `src/components/bulk-view.tsx`.**
  1. Replace exactly
     ```tsx
     import {
       CheckCircle2,
       ChevronDown,
       Copy,
       Download,
       FileCode,
       FileText,
       ListPlus,
       Loader2,
     ```
     with
     ```tsx
     import {
       ListPlus,
     ```
  2. Replace exactly
     ```tsx
       X,
       XCircle,
     } from "lucide-react";
     ```
     with
     ```tsx
       X,
     } from "lucide-react";
     ```
  3. Delete exactly the line `import { cn } from "@/lib/utils";`.

- [ ] **Step 4: `src/components/transcript-form.tsx`.** Replace exactly
```tsx
  const {
    urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
    selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
    handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
    copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
    seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
    activeCues, excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
    translatedTo, readingMinutes,
  } = props;
```
with
```tsx
  const {
    urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
    onOpenInDownloader, readingMinutes,
  } = props;
```

- [ ] **Step 5: `src/components/transcript-reader.tsx`.**
  1. Replace exactly
     ```tsx
     import { toast } from "sonner";
     import { Button } from "@/components/ui/button";
     import { cn } from "@/lib/utils";
     import { AI_PROMPT_TEMPLATES } from "@/lib/transcript";
     import { formatDuration } from "@/lib/youtube";
     import { NLE_EXPORT_OPTIONS
     ```
     with
     ```tsx
     import { Button } from "@/components/ui/button";
     import { cn } from "@/lib/utils";
     import { NLE_EXPORT_OPTIONS
     ```
  2. Replace exactly
     ```tsx
       const {
         urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
         selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
         handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
         copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
         seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
         excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
         translatedTo, readingMinutes, stats,
       } = props;
     ```
     with
     ```tsx
       const {
         searchQuery, setSearchQuery, copyFormattedTranscript, copiedFormat, downloadTranscriptFile,
         cues, deletedCueIds, toggleDeleteCue, restoreAllCues, seekTo, handleNleExport,
         loadingTranscript, filteredCues, fps, setFps, showNleMenu, setShowNleMenu, translatedTo, stats,
       } = props;
     ```

- [ ] **Step 6: `src/components/transcript-sidebar.tsx`.**
  1. Replace exactly
     ```tsx
     import { Check, Copy, Film, Languages, Sparkles } from "lucide-react";
     import { Button } from "@/components/ui/button";
     import { cn }
     ```
     with
     ```tsx
     import { Check, Copy, Languages, Sparkles } from "lucide-react";
     import { cn }
     ```
  2. Replace exactly
     ```tsx
       const {
         urlInput, setUrlInput, loadVideoTranscript, loading, samples, error, setError, video,
         selectedLanguage, handleLanguageChange, translationLanguages, canTranslate, translateTo,
         handleTranslateChange, selectedTrack, searchQuery, setSearchQuery, copyFormattedTranscript,
         copiedFormat, downloadTranscriptFile, cues, deletedCueIds, toggleDeleteCue, restoreAllCues,
         seekTo, handleNleExport, copyAiPrompt, copiedPromptId, loadingTranscript, filteredCues,
         activeCues, excludedCount, fps, setFps, showNleMenu, setShowNleMenu, onOpenInDownloader,
         translatedTo, readingMinutes, playingTime,
       } = props;
     ```
     with
     ```tsx
       const {
         video, selectedLanguage, handleLanguageChange, translationLanguages, canTranslate,
         translateTo, handleTranslateChange, selectedTrack, copyAiPrompt, copiedPromptId, playingTime,
       } = props;
     ```

- [ ] **Step 7: `src/routes/index.tsx`.** Replace exactly
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
```
with
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 8: Verify.** Run:
```bash
npx eslint src/components/bulk-downloader.tsx src/components/bulk-view.tsx src/components/transcript-form.tsx src/components/transcript-reader.tsx src/components/transcript-sidebar.tsx src/routes/index.tsx
npm run typecheck && npm test
```
Expected:
- ESLint shows exactly `✖ 3 problems (0 errors, 3 warnings)`, all `react-hooks/exhaustive-deps` in `src/routes/index.tsx` (Task 2D);
- typecheck is clean, which proves no removed name was still referenced;
- `npm test` has 0 failures.

- [ ] **Step 9: Commit.**
```bash
git add src/components/bulk-downloader.tsx src/components/bulk-view.tsx src/components/transcript-form.tsx src/components/transcript-reader.tsx src/components/transcript-sidebar.tsx src/routes/index.tsx
git commit -m "refactor(lint): drop dead imports and unused props in bulk and transcript components

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2C: Lint cleanup — component-only modules and the dead ingest bookmarklet (7 warnings)

**Executor:** velo-impl-sonnet-high
**Covers:** CLEAN-06, TEST-07 (part), OSS-13 (part)

**Files:** Modify `src/components/video-panel.tsx`, `src/components/mode-tabs.tsx`, `src/components/home-modes.tsx`, `src/lib/use-tools-badge.ts`, `src/components/session-guide.tsx`.

`react-refresh/only-export-components` flags non-component exports from `.tsx` component files. The fixes are:
- `getPresetAvailability`/`getResolutionBadge` are used only inside `video-panel.tsx`, so they stop being exported.
- `rememberToolsCheck`/`TOOLS_CACHE_KEY` move to `src/lib/use-tools-badge.ts`, their other user.
- `session-guide.tsx`'s "Open in Velo" ingest bookmarklet (`INGEST_BOOKMARKLET_CODE`, `getIngestBookmarkletCode`, `copiedIngestCode`, `ingestCode`, `copyIngestBookmarklet`) is never rendered, and nothing else references it (`git grep` in Step 1), so it is deleted.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -n "getPresetAvailability\|getResolutionBadge" -- src | grep -v "src/components/video-panel.tsx" ; echo "---"
git grep -n "INGEST_BOOKMARKLET_CODE\|getIngestBookmarkletCode\|copyIngestBookmarklet" -- src extension extensions scripts | grep -v "src/components/session-guide.tsx"; echo "---"
git grep -n "rememberToolsCheck\|TOOLS_CACHE_KEY" -- src
git grep -c -F 'export function getPresetAvailability(' src/components/video-panel.tsx
git grep -c -F 'export function getResolutionBadge(preset: VideoPreset) {' src/components/video-panel.tsx
git grep -c -F 'const [copiedIngestCode, setCopiedIngestCode] = useState(false);' src/components/session-guide.tsx
```
Expected:
- the first two greps print nothing before their `---`;
- the third lists only `src/components/mode-tabs.tsx`, `src/components/home-modes.tsx:3` and `src/lib/use-tools-badge.ts`;
- the three counts print `1`.

Anything else: STOP.

- [ ] **Step 2: `src/components/video-panel.tsx`.** Replace exactly `export function getPresetAvailability(` with `function getPresetAvailability(`, and `export function getResolutionBadge(preset: VideoPreset) {` with `function getResolutionBadge(preset: VideoPreset) {`. The `export type PresetAvailability` stays, because type exports are allowed.

- [ ] **Step 3: Move the tools-cache helpers.**
  1. In `src/components/mode-tabs.tsx` delete exactly this block, including the blank line after it:
     ```tsx
     export const TOOLS_CACHE_KEY = "velo-tools-checked";

     /** Six-hour cache behind the Tools tab's attention dot. */
     export function rememberToolsCheck(behind: boolean) {
       try {
         window.localStorage.setItem(TOOLS_CACHE_KEY, String(Date.now()));
         window.localStorage.setItem(`${TOOLS_CACHE_KEY}-behind`, behind ? "1" : "0");
       } catch {
         /* ignore */
       }
     }

     ```
  2. In `src/lib/use-tools-badge.ts` replace exactly
     ```ts
     import { useEffect, useState } from "react";
     import { rememberToolsCheck, TOOLS_CACHE_KEY } from "@/components/mode-tabs";
     import { checkToolUpdates } from "@/lib/tool-updates";
     import { anyBehind } from "@/lib/tool-versions";
     ```
     with
     ```ts
     import { useEffect, useState } from "react";
     import { checkToolUpdates } from "@/lib/tool-updates";
     import { anyBehind } from "@/lib/tool-versions";

     export const TOOLS_CACHE_KEY = "velo-tools-checked";

     /** Six-hour cache behind the Tools tab's attention dot. */
     export function rememberToolsCheck(behind: boolean) {
       try {
         window.localStorage.setItem(TOOLS_CACHE_KEY, String(Date.now()));
         window.localStorage.setItem(`${TOOLS_CACHE_KEY}-behind`, behind ? "1" : "0");
       } catch {
         /* ignore */
       }
     }
     ```
  3. In `src/components/home-modes.tsx` replace exactly `import { rememberToolsCheck } from "@/components/mode-tabs";` with `import { rememberToolsCheck } from "@/lib/use-tools-badge";`.

- [ ] **Step 4: `src/components/session-guide.tsx`.**
  1. If the file still contains the line `  Zap,`, replace exactly
     ```tsx
       Sparkles,
       Zap,
     } from "lucide-react";
     ```
     with
     ```tsx
       Sparkles,
     } from "lucide-react";
     ```
     If `Zap` is already gone (W0-T3 removed it), skip this edit.
  2. Delete exactly this block, including the blank line after it:
     ```tsx
     export const INGEST_BOOKMARKLET_CODE = `javascript:(function(){window.open('https://'+window.location.host+'/?v='+encodeURIComponent(window.location.href));})();`;

     export function getIngestBookmarkletCode(origin?: string): string {
       if (typeof window !== "undefined" && !origin && window.location?.origin) {
         origin = window.location.origin;
       }
       if (origin) {
         return `javascript:(function(){window.open('${origin}/?v='+encodeURIComponent(window.location.href));})();`;
       }
       return INGEST_BOOKMARKLET_CODE;
     }

     ```
  3. Replace exactly
     ```tsx
       const [copiedCode, setCopiedCode] = useState(false);
       const [copiedIngestCode, setCopiedIngestCode] = useState(false);

       const ingestCode = typeof window !== "undefined" ? getIngestBookmarkletCode() : INGEST_BOOKMARKLET_CODE;

       const copyBookmarklet
     ```
     with
     ```tsx
       const [copiedCode, setCopiedCode] = useState(false);

       const copyBookmarklet
     ```
  4. Delete exactly this block, including the blank line after it:
     ```tsx
       const copyIngestBookmarklet = async () => {
         try {
           await navigator.clipboard.writeText(ingestCode);
           setCopiedIngestCode(true);
           toast.success("'Open in Velo' bookmarklet code copied to clipboard");
           setTimeout(() => setCopiedIngestCode(false), 2500);
         } catch {
           toast.error("Could not copy bookmarklet code.");
         }
       };

     ```

- [ ] **Step 5: Verify.** Run:
```bash
npx eslint src/components/video-panel.tsx src/components/mode-tabs.tsx src/components/home-modes.tsx src/lib/use-tools-badge.ts src/components/session-guide.tsx
git grep -n "INGEST_BOOKMARKLET_CODE\|getIngestBookmarkletCode\|copiedIngestCode" -- src
npm run typecheck && npm test
```
Expected: ESLint prints nothing, the grep prints nothing, typecheck is clean and tests have 0 failures.

- [ ] **Step 6: Commit.**
```bash
git add src/components/video-panel.tsx src/components/mode-tabs.tsx src/components/home-modes.tsx src/lib/use-tools-badge.ts src/components/session-guide.tsx
git commit -m "refactor(lint): keep component modules component-only; delete dead ingest bookmarklet

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2D: Hook-dependency warnings and post-W0 lint residue

**Executor:** velo-impl-opus-medium
**Covers:** TEST-07 (exhaustive-deps part), OSS-13 (part)

**Files:** Modify `src/routes/index.tsx`, `src/components/transcript-studio.tsx`, plus only if Step 5 finds residue: `src/routes/login.tsx`, `src/components/session-guide.tsx`, `src/lib/auth/server.ts`, `src/routes/api/auth/$.ts`, `src/lib/rate-window.ts`.

**Why disables and not new code.** The audit called some of these stale-closure risks. On inspection none is:
- each effect calls a function from the same render that created the effect, and runs only when its listed deps change;
- adding `lookup`/`runDownload`/`loadVideoTranscript` (re-created every render) to the deps would re-run the mount-only URL parsing and the auto-download on every render, which is a real bug;
- `useEffectEvent` (React 19.3) is the idiomatic fix, but `eslint-plugin-react-hooks@5.2` has `isUseEffectEventIdentifier() { return false }` and still demands the dependency (verified). So it would need a disable anyway.

The honest fix is a one-line disable with the reason. Because `reportUnusedDisableDirectives: "error"` (Task 3), each comment fails lint the day it stops being needed, e.g. after W7 bumps the plugin to ≥ 6.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '    return () => abortRef.current?.abort();' src/routes/index.tsx
git grep -c -F '  }, [video, selected, downloading]);' src/routes/index.tsx
git grep -c -F '    void loadVideoTranscript(initialUrl);' src/components/transcript-studio.tsx
```
Expected: `1` each. Otherwise STOP.

- [ ] **Step 2: `src/routes/index.tsx`.**
  1. Replace exactly
     ```tsx
         if (saved && !urlRef.current) updateUrl(saved);
         return () => abortRef.current?.abort();
       }, []);
     ```
     with
     ```tsx
         if (saved && !urlRef.current) updateUrl(saved);
         // eslint-disable-next-line react-hooks/exhaustive-deps -- abortRef holds the AbortController in flight at unmount (not a DOM node); reading it late is the point
         return () => abortRef.current?.abort();
         // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: reads the URL once; lookup is this render's closure, so it is never stale here
       }, []);
     ```
  2. Replace exactly
     ```tsx
         void runDownload(video, selected);
       }, [video, selected, downloading]);
     ```
     with
     ```tsx
         void runDownload(video, selected);
         // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on these three only; runDownload is the closure of the render that changed them
       }, [video, selected, downloading]);
     ```

- [ ] **Step 3: `src/components/transcript-studio.tsx`.** Replace exactly
```tsx
    void loadVideoTranscript(initialUrl);
  }, [initialUrl]);
```
with
```tsx
    void loadVideoTranscript(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per initialUrl (bootedRef guards); loadVideoTranscript is this render's closure
  }, [initialUrl]);
```

- [ ] **Step 4: Verify the four are gone.** Run: `npx eslint src/routes/index.tsx src/components/transcript-studio.tsx`
Expected: no output.

- [ ] **Step 5: Whole-repo residue check.** Run: `npx eslint .`
Expected: exactly `✖ 2 problems (0 errors, 2 warnings)`: `src/components/ui/badge.tsx` and `src/components/ui/button.tsx`, both `react-refresh/only-export-components`. Task 3 handles them in config.

Any other warning must be in a file W0 touched (`src/routes/login.tsx`, `src/components/session-guide.tsx`, `src/lib/auth/server.ts`, `src/routes/api/auth/$.ts`, `src/lib/rate-window.ts`):
- if it is `@typescript-eslint/no-unused-vars` on an import or a local variable, remove that name, or the whole import line if it becomes empty, and re-run;
- if it is anything else, or in any other file, STOP and report it with the full ESLint output.

List every residue edit you made in the commit body.

- [ ] **Step 6: Full gate.** Run: `npm run typecheck && npm test`
Expected: clean, 0 failures.

- [ ] **Step 7: Commit.** If Step 5 found no residue, drop the second paragraph of the message.
```bash
git add -A src
git commit -m "refactor(lint): document mount-once effects; clear post-W0 lint residue

Residue from W0: <file: names removed>, or none.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Lint → errors, in-process eval ban, server `no-console`

**Executor:** velo-impl-sonnet-high
**Covers:** TEST-07, OSS-13, CLEAN-06 (gate), Global Constraint "Untrusted JavaScript" (lint part), Global Constraint "Logging" (lint part)

**Files:** Modify `eslint.config.mjs` (full replacement below), `package.json` (`lint` script), `src/lib/po-token.server.ts` (+1 comment line), `src/lib/youtube-client.server.ts` (+1 comment line), `scripts/package-contract.test.mjs` (append 1 test).

**Interfaces:**
- Produces:
  - `npm run lint` = `eslint . --max-warnings 0`;
  - every rule is `error`;
  - `no-restricted-syntax` bans `new Function`, `Function()`, `eval()`, `x.eval()`, `runInThisContext()`;
  - `no-console` applies to `src/**/*.server.ts` and `src/routes/**` except the three `ignores`: two for W2 (Contract change request 2), and `ytdlp-meta.server.ts`, which Task 5 removes;
  - `reportUnusedDisableDirectives: "error"`.
- The two existing in-process evaluations get `// eslint-disable-next-line no-restricted-syntax -- W4b …`. **W4b deletes both lines together with the code.** The unused-directive check fails lint if a comment outlives its code.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '    "lint": "eslint .",' package.json
git grep -c -F '    const vm = new Function(' src/lib/po-token.server.ts
git grep -c -F 'Platform.shim.eval = (data) => new Function(data.output)();' src/lib/youtube-client.server.ts
git grep -n -E "new Function|\beval\(|runInThisContext" -- src scripts extension extensions server tests | grep -v "\.test\."
```
Expected: `1`, `1`, `1`, then exactly two lines: `src/lib/po-token.server.ts:<n>:    const vm = new Function(` and `src/lib/youtube-client.server.ts:<n>:Platform.shim.eval = …`. Any other occurrence: STOP and report it; it belongs to W4b's inventory.

- [ ] **Step 2: Write the failing test.** Append to the end of `scripts/package-contract.test.mjs`:
```js

test("lint fails on any warning", () => {
  assert.equal(pkg.scripts.lint, "eslint . --max-warnings 0");
});
```
Run: `node --test scripts/package-contract.test.mjs`
Expected: `ℹ fail 1`, with `'eslint .' !== 'eslint . --max-warnings 0'`.

- [ ] **Step 3: Replace `eslint.config.mjs` entirely with:**
```js
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Remote code (YouTube player JS, the BotGuard interpreter) may only run through
 * `runSandboxed` (src/lib/sandbox/run-sandboxed.server.ts, W4b). These are the
 * in-process escape hatches it replaces.
 */
const UNTRUSTED_EVAL_MESSAGE =
  "Do not evaluate code in-process. Remote code runs only through runSandboxed (src/lib/sandbox/run-sandboxed.server.ts).";
const noInProcessEval = [
  { selector: "NewExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
  { selector: "CallExpression[callee.property.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
];

/** Flat ESLint config. Every rule is an error; `npm run lint` runs with --max-warnings 0. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      // Tooling scratch dirs, not source. `.remember/tmp` holds bare timestamps
      // under a .ts name, which fails the parse and turns `npm run lint` red —
      // and `update:deps` uses lint as a gate, so it would roll back every
      // upgrade for a reason that has nothing to do with the upgrade.
      ".remember/**",
      ".grok/**",
      ".pi/**",
      ".tanstack/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node, ...globals.webextensions },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true, allowExportNames: ["badgeVariants", "buttonVariants"] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": ["error", ...noInProcessEval],
    },
  },
  {
    // Server code logs through `log` (src/lib/log.server.ts), which redacts secrets.
    files: ["src/**/*.server.ts", "src/routes/**"],
    ignores: [
      // W2 deletes/rewrites these two Grok-gate auth files; remove both lines then.
      "src/lib/auth/gate-session.server.ts",
      "src/lib/auth/verify.server.ts",
      // W1-T5 moves its one console.warn to `log` and deletes this line.
      "src/lib/ytdlp-meta.server.ts",
    ],
    rules: { "no-console": "error" },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
```

- [ ] **Step 4: Update `package.json` and allowlist the two W4b sites.**
  1. `package.json`: replace exactly `    "lint": "eslint .",` with `    "lint": "eslint . --max-warnings 0",`.
  2. `src/lib/po-token.server.ts`: replace exactly
     ```ts
       const { webPoSignalOutput, botguardResponse } = await withBgWindow(async () => {
         const vm = new Function(
     ```
     with
     ```ts
       const { webPoSignalOutput, botguardResponse } = await withBgWindow(async () => {
         // eslint-disable-next-line no-restricted-syntax -- W4b moves BotGuard into runSandboxed (C5) and deletes this line
         const vm = new Function(
     ```
  3. `src/lib/youtube-client.server.ts`: replace exactly
     ```ts
     Platform.shim.eval = (data) => new Function(data.output)();
     ```
     with
     ```ts
     // eslint-disable-next-line no-restricted-syntax -- W4b moves player JS into runSandboxed (C5) and deletes this line
     Platform.shim.eval = (data) => new Function(data.output)();
     ```

- [ ] **Step 5: Verify lint is green and every rule is an error.** Run:
```bash
npm run lint; echo "lint exit=$?"
npx eslint --print-config src/routes/index.tsx | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).rules;const warn=Object.entries(r).filter(([,v])=>[1,"warn"].includes(Array.isArray(v)?v[0]:v)).map(([k])=>k);console.log(warn.length?"WARN RULES: "+warn.join(","):"no warn-level rules")})'
node --test scripts/package-contract.test.mjs
```
Expected: `lint exit=0` with no problems, then `no warn-level rules`, then `ℹ pass 5`.

- [ ] **Step 6: Prove the new rules bite.** Nothing is written to disk. Run:
```bash
printf 'export function f() {\n  console.log(1);\n  new Function("a")();\n  eval("1");\n  globalThis.eval("2");\n  Function("b");\n}\n' | npx eslint --stdin --stdin-filename src/lib/probe.server.ts; echo "exit=$?"
printf 'export function f() {\n  console.log(1);\n}\n' | npx eslint --stdin --stdin-filename src/components/probe.ts; echo "exit=$?"
```
Expected:
- the first command gives `✖ 5 problems (5 errors, 0 warnings)`: 1 `no-console` and 4 `no-restricted-syntax` with the message `Do not evaluate code in-process…`, then `exit=1`;
- the second gives `exit=0`, because client code may use `console`.

- [ ] **Step 7: Full gate.** Run: `npm run typecheck && npm test`
Expected: clean, 0 failures.

- [ ] **Step 8: Commit.**
```bash
git add eslint.config.mjs package.json src/lib/po-token.server.ts src/lib/youtube-client.server.ts scripts/package-contract.test.mjs
git commit -m "ci(lint): make every rule an error, ban in-process eval and server console

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: HTTP black-box harness (C6) and first built-server tests

**Executor:** velo-impl-opus-high (spawns and kills server process trees)
**Covers:** TEST-08 (harness part), TEST-17 (the suite stays hermetic: offline, ephemeral ports), Review Focus 2, 3, 5; characterization groundwork for W2/W4a (see Hand-off)

**Files:**
- Create: `tests/http/harness.mjs`, `tests/http/harness.test.mjs`, `tests/http/health.test.mjs`, `tests/http/api-guards.test.mjs`
- Modify: `package.json` (add `test:http`), `scripts/package-contract.test.mjs` (append 1 test)

**Interfaces:**
- Produces (C6, exact):
```js
export async function startServer({ env = {} } = {}): Promise<{ baseUrl: string; stop(): Promise<void>; logs(): string }>;
```
- `baseUrl` has no trailing slash (`http://127.0.0.1:54321`).
- The child env is `{...process.env, DATABASE_URL: "", ...env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: "0"}`, minus `NITRO_PORT`/`NITRO_HOST`.
- Readiness means `GET /api/health` answered with any status within 30 s. Otherwise the promise rejects with the server log.
- `stop()` is idempotent. It uses `taskkill /T /F` on Windows, and on POSIX it signals the process group with SIGTERM, then SIGKILL after 5 s.
- Tests pass `VITE_AUTH_ENABLED: "false"` (W0 fail-closed auth; W2 removes it). A Postgres-backed test uses `VELO_TEST_DATABASE_URL`: it is skipped locally when unset, and **runs and fails in CI when unset** (`process.env.CI`).
- `npm run test:http` = `node --test "tests/http/*.test.mjs"` and requires a prior `npm run build`.

- [ ] **Step 1: Verify anchors.** Run: `git grep -c -F '    "test": "node --test \"scripts/**/*.test.mjs\" && node scripts/run-ts-tests.mjs",' package.json`
Expected: `1`. Also `ls tests/http 2>/dev/null` prints nothing. Otherwise STOP.

- [ ] **Step 2: Write the failing tests.** Create `tests/http/harness.test.mjs`:
```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };

test("ambient NITRO_PORT/NITRO_HOST/DATABASE_URL never reach the server under test", async () => {
  const keys = ["NITRO_PORT", "NITRO_HOST", "DATABASE_URL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NITRO_PORT = "1";
  process.env.NITRO_HOST = "0.0.0.0";
  process.env.DATABASE_URL = "postgres://must-not-be-used@127.0.0.1:1/none";
  try {
    const server = await startServer({ env: BASE_ENV });
    try {
      assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(server.baseUrl).port, "1");
      const body = await (await fetch(`${server.baseUrl}/api/health`)).json();
      assert.equal(body.checks.database.source, "pglite");
    } finally {
      await server.stop();
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("stop() kills the server, frees the port and is idempotent", async () => {
  const server = await startServer({ env: BASE_ENV });
  assert.match(server.logs(), /Listening on:/);
  await server.stop();
  await server.stop();
  await assert.rejects(fetch(`${server.baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) }));
});
```
Create `tests/http/health.test.mjs`:
```js
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };
const DB_URL = process.env.VELO_TEST_DATABASE_URL ?? "";

describe("GET /api/health without a database", () => {
  let server;
  before(async () => {
    server = await startServer({ env: BASE_ENV });
  });
  after(() => server?.stop());

  test("answers 503 degraded with a fixed detail and no-store", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    const body = await res.json();
    assert.equal(body.status, "degraded");
    assert.equal(body.checks.database.ok, false);
    assert.equal(body.checks.database.detail, "database unreachable");
  });

  test("leaks no path, stack or driver message", async () => {
    const text = await (await fetch(`${server.baseUrl}/api/health?deep=1`)).text();
    assert.doesNotMatch(text, /ENOENT|\.output|node_modules|[A-Za-z]:\\|\bat \w+ \(|postgres:\/\//i);
  });
});

describe("GET /api/health against a migrated Postgres", () => {
  // Runs everywhere VELO_TEST_DATABASE_URL is set; CI always sets it (ci.yml `verify` job).
  const skip = !DB_URL && !process.env.CI ? "set VELO_TEST_DATABASE_URL to a migrated Postgres" : false;
  let server;
  before(async () => {
    if (skip) return;
    assert.ok(DB_URL, "VELO_TEST_DATABASE_URL must be set in CI");
    server = await startServer({ env: { ...BASE_ENV, DATABASE_URL: DB_URL } });
  });
  after(() => server?.stop());

  test("deep check is 200 ok and never echoes the connection string", { skip }, async () => {
    const res = await fetch(`${server.baseUrl}/api/health?deep=1`);
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text);
    assert.equal(body.status, "ok");
    assert.equal(body.checks.database.ok, true);
    assert.doesNotMatch(text, new RegExp(new URL(DB_URL).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
```
Create `tests/http/api-guards.test.mjs`:
```js
// Characterization tests: guards that already hold on the built server. Each
// request is rejected before any upstream fetch, so these run offline. They
// assert status codes only; W4a moves the bodies to `apiError` (contract C2).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./harness.mjs";

// W2 removes the Grok auth flag; until then production boot needs it off.
const BASE_ENV = { VITE_AUTH_ENABLED: "false" };

describe("API input guards", () => {
  let server;
  before(async () => {
    server = await startServer({ env: BASE_ENV });
  });
  after(() => server?.stop());

  const get = (path) => fetch(`${server.baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
  const postJson = (path, body) =>
    fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

  for (const target of [
    "http://127.0.0.1:8080/",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.example/",
    "https://www.youtube.com.evil.example/",
    "https://www.youtube.com@evil.example/",
    "http://www.youtube.com/",
    "file:///etc/passwd",
    "",
  ]) {
    test(`relay refuses a non-allow-listed target: ${JSON.stringify(target)}`, async () => {
      const res = await get(`/api/relay?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 400);
    });
  }

  test("download without id/itag is 400", async () => {
    assert.equal((await get("/api/download")).status, 400);
  });

  test("captions without id/lang is 400", async () => {
    assert.equal((await get("/api/captions")).status, 400);
  });

  test("bypass without id/itag is 400", async () => {
    assert.equal((await get("/api/bypass")).status, 400);
  });

  test("ytdlp rejects malformed JSON with 400", async () => {
    assert.equal((await postJson("/api/ytdlp", "{not json")).status, 400);
  });

  test("ytdlp rejects a bad video id with 400", async () => {
    const res = await postJson("/api/ytdlp", JSON.stringify({ id: "../../etc/passwd", itag: 18 }));
    assert.equal(res.status, 400);
  });

  test("unlock rejects a body without a stream URL with 400", async () => {
    assert.equal((await postJson("/api/unlock", JSON.stringify({}))).status, 400);
  });

  test("builder allows POST only", async () => {
    const res = await get("/api/builder");
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });
});
```
Append to `scripts/package-contract.test.mjs`:
```js

test("test:http runs the black-box suite against the built server", () => {
  assert.equal(pkg.scripts["test:http"], 'node --test "tests/http/*.test.mjs"');
});
```

- [ ] **Step 3: Run them and see them fail.** Run: `node --test "tests/http/*.test.mjs"; node --test scripts/package-contract.test.mjs`
Expected:
- the HTTP files fail with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/tests/http/harness.mjs'`;
- the contract test fails with `undefined !== 'node --test "tests/http/*.test.mjs"'`.

- [ ] **Step 4: Implement the harness.** Create `tests/http/harness.mjs`:
```js
// HTTP black-box test harness (roadmap contract C6).
//
// startServer() runs the BUILT server (`node .output/server/index.mjs`, from
// `npm run build`) as a child process with NODE_ENV=production on an ephemeral
// loopback port, waits until GET /api/health answers (any status), and returns
// its base URL. Nitro's node-server preset reads `NITRO_PORT ?? PORT` and
// `NITRO_HOST || HOST`; with PORT=0 the OS picks a free port and the server
// prints "Listening on: http://127.0.0.1:<port>/".
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY = fileURLToPath(new URL("../../.output/server/index.mjs", import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const LISTEN_LINE = /Listening on:\s*(http:\/\/[^\s/]+)/;
// eslint-disable-next-line no-control-regex -- strips ANSI colour codes from server output
const ANSI = /\u001b\[[0-9;]*m/g;
const isWindows = process.platform === "win32";

/**
 * @param {{ env?: Record<string, string> }} [options]
 * @returns {Promise<{ baseUrl: string; stop(): Promise<void>; logs(): string }>}
 */
export async function startServer({ env = {} } = {}) {
  if (!existsSync(ENTRY)) {
    throw new Error(`${ENTRY} is missing. Run \`npm run build\` before \`npm run test:http\`.`);
  }
  const childEnv = {
    ...process.env,
    // An ambient DATABASE_URL must never leak into a test; tests pass their own.
    DATABASE_URL: "",
    ...env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
  };
  // NITRO_PORT wins over PORT even when empty (`??`), so it must be absent.
  delete childEnv.NITRO_PORT;
  delete childEnv.NITRO_HOST;

  const child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    // Own process group on POSIX, so stop() can signal the whole tree.
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });

  let output = "";
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve(undefined);
    });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const kill = (signal) => {
    try {
      if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
  };

  async function stop() {
    if (exited) return;
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 5_000);
    await exit;
    clearTimeout(timer);
  }

  const logs = () => output.replace(ANSI, "");
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let baseUrl = "";
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited before it was ready:\n${logs()}`);
    baseUrl ||= logs().match(LISTEN_LINE)?.[1] ?? "";
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
        return { baseUrl, stop, logs };
      } catch {
        /* not accepting yet */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop();
  throw new Error(`server not ready within ${READY_TIMEOUT_MS}ms:\n${logs()}`);
}
```
In `package.json` replace exactly
```
    "test": "node --test \"scripts/**/*.test.mjs\" && node scripts/run-ts-tests.mjs",
```
with
```
    "test": "node --test \"scripts/**/*.test.mjs\" && node scripts/run-ts-tests.mjs",
    "test:http": "node --test \"tests/http/*.test.mjs\"",
```

- [ ] **Step 5: Build and run.** Run: `npm run build && npm run test:http && node --test scripts/package-contract.test.mjs`
Expected:
- `test:http` reports `ℹ tests 20`, `ℹ pass 19`, `ℹ fail 0`, `ℹ skipped 1`. The Postgres test is skipped locally, with reason `set VELO_TEST_DATABASE_URL to a migrated Postgres`;
- the contract test reports `ℹ pass 6`;
- the server log contains `[db] PGLite bootstrap failed: Error: ENOENT … pglite.data`. That is expected (see Task 1) and never appears in a response body.

- [ ] **Step 6: Run the Postgres leg locally and check for orphans.** Requires Docker. Run:
```bash
docker run -d --rm --name velo-w1-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=velo -p 127.0.0.1:55432:5432 postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
until docker exec velo-w1-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
DATABASE_URL=postgres://postgres@127.0.0.1:55432/velo npm run db:migrate
VELO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/velo npm run test:http
docker stop velo-w1-pg
```
Expected:
- the migration prints `[migrate] applied 0001_auth.sql` … `done — 5 migration(s) applied.`;
- `test:http` reports `ℹ pass 20`, `ℹ skipped 0`.

Then on Windows run `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like "*.output*index.mjs*"` (PowerShell), or on Linux `pgrep -af ".output/server/index.mjs"`. Expected: no process started from this worktree. Without Docker, say so in the task report; CI runs this leg.

- [ ] **Step 7: Lint and full gate.** Run: `npm run lint && npm run typecheck && npm test`
Expected: all clean. The tests in `tests/http/` are not part of `npm test`.

- [ ] **Step 8: Commit.**
```bash
git add tests/http package.json scripts/package-contract.test.mjs
git commit -m "test(http): add built-server harness and first black-box tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Redacting structured server logger (C4)

**Executor:** velo-impl-opus-high (credential redaction)
**Covers:** Global Constraint "Logging" (C4), Review Focus 1; groundwork for INST-10 (W4a uses `log.debug` for client aborts)

**Files:**
- Create: `src/lib/log.server.ts`, `src/lib/log.server.test.ts`
- Modify: `src/lib/ytdlp-meta.server.ts` (1 call + 1 import), `eslint.config.mjs` (delete 2 lines)

**Interfaces:**
- Produces (C4, exact):
```ts
export type LogFields = Record<string, unknown>;
export const log: {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields & { err?: unknown }): void;
};
export function redact(fields: LogFields): LogFields;
```
- Output: one JSON line per event, `{ts, level, event, ...fields}`. `debug`/`info` go to stdout and `warn`/`error` to stderr. The reserved keys `ts`/`level`/`event` cannot be overridden by fields.
- `LOG_LEVEL` (`debug|info|warn|error`, case-insensitive, default `info`) is read from `process.env` on every call. W2 may route it through `serverEnv()` without changing the signature.
- Redaction covers:
  - any key at any depth matching `/cookie|token|secret|authorization|password|sapisid|sid/i`;
  - `value` in any object whose `name` matches the same pattern (cookie-jar entries).
- Errors become `{name, message, stack}`, bigints become strings, cycles become `"[Circular]"`, and nesting past depth 6 becomes `"[Truncated]"`.
- Known ceiling (documented in the header): values are not scanned, so a secret inside a free-text string such as an error message is not redacted. W3 keeps cookies out of messages.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F 'console.warn(`[ytdlp] -J output exceeded ${JSON_STDOUT_MAX} bytes for ${id}`);' src/lib/ytdlp-meta.server.ts
git grep -c -F 'import { attemptYtdlpMetadataLadder } from "@/lib/ytdlp-meta-routing";' src/lib/ytdlp-meta.server.ts
git grep -c -F '      "src/lib/ytdlp-meta.server.ts",' eslint.config.mjs
ls src/lib/log.server.ts 2>/dev/null
```
Expected: `1`, `1`, `1`, and no output from `ls`. Otherwise STOP.

- [ ] **Step 2: Write the failing test.** Create `src/lib/log.server.test.ts`:
```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { redact } from "./log.server.ts";

const R = "[REDACTED]";

/** Run `body` in a fresh Node process with `log` imported, and capture both streams. */
function runLog(body: string, env: Record<string, string> = {}) {
  const url = new URL("./log.server.ts", import.meta.url).href;
  const script = `const { log } = await import(${JSON.stringify(url)});\n${body}`;
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
    { encoding: "utf8", env: { ...process.env, LOG_LEVEL: "", ...env } },
  );
  assert.equal(child.status, 0, child.stderr);
  const lines = (text: string) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stdout: lines(child.stdout), stderr: lines(child.stderr) };
}

test("redact replaces credential-looking keys at any depth and keeps the rest", () => {
  const out = redact({
    videoId: "dQw4w9WgXcQ",
    cookie: "SID=abc; HSID=def",
    headers: { Authorization: "Bearer x", accept: "*/*" },
    jar: [
      { name: "__Secure-3PAPISID", value: "z" },
      { name: "PREF", value: "f6=1" },
    ],
    nested: { deeper: { refreshToken: "t", clientSecret: "s", PASSWORD: "p", status: 200 } },
  });
  assert.deepEqual(out, {
    videoId: "dQw4w9WgXcQ",
    cookie: R,
    headers: { Authorization: R, accept: "*/*" },
    jar: [
      { name: "__Secure-3PAPISID", value: R },
      { name: "PREF", value: "f6=1" },
    ],
    nested: { deeper: { refreshToken: R, clientSecret: R, PASSWORD: R, status: 200 } },
  });
});

test("redact serializes errors and bigints, and survives cycles", () => {
  const err = new TypeError("boom");
  const shared = { n: 1 };
  const loop: Record<string, unknown> = { name: "loop" };
  loop.self = loop;
  const out = redact({ err, big: 10n, a: shared, b: shared, loop });
  assert.deepEqual(out.err, { name: "TypeError", message: "boom", stack: err.stack });
  assert.equal(out.big, "10");
  assert.deepEqual(out.a, { n: 1 });
  assert.deepEqual(out.b, { n: 1 }, "a repeated (non-circular) object is not a cycle");
  assert.deepEqual(out.loop, { name: "loop", self: "[Circular]" });
});

test("redact leaves the input untouched", () => {
  const input = { token: "keep-me-in-the-caller" };
  redact(input);
  assert.equal(input.token, "keep-me-in-the-caller");
});

test("info writes one JSON line to stdout; ts/level/event come first and cannot be overridden", () => {
  const { stdout, stderr } = runLog(
    `log.info("download.start", { id: "abc", level: "spoofed", cookie: "SID=1" });`,
  );
  assert.equal(stderr.length, 0);
  assert.equal(stdout.length, 1);
  const line = stdout[0]!;
  assert.deepEqual(Object.keys(line).slice(0, 3), ["ts", "level", "event"]);
  assert.equal(line.level, "info");
  assert.equal(line.event, "download.start");
  assert.equal(line.id, "abc");
  assert.equal(line.cookie, R);
  assert.ok(!Number.isNaN(Date.parse(String(line.ts))));
});

test("warn and error go to stderr, and error serializes err", () => {
  const { stdout, stderr } = runLog(
    `log.warn("ytdlp.slow", { ms: 5 }); log.error("ytdlp.failed", { err: new Error("exit 1") });`,
  );
  assert.equal(stdout.length, 0);
  assert.deepEqual(
    stderr.map((l) => l.level),
    ["warn", "error"],
  );
  const err = stderr[1]!.err as Record<string, unknown>;
  assert.equal(err.name, "Error");
  assert.equal(err.message, "exit 1");
  assert.match(String(err.stack), /exit 1/);
});

test("LOG_LEVEL sets the threshold; the default drops debug", () => {
  const all = `log.debug("d"); log.info("i"); log.warn("w"); log.error("e");`;
  const events = (r: ReturnType<typeof runLog>) => [...r.stdout, ...r.stderr].map((l) => l.event);
  assert.deepEqual(events(runLog(all)), ["i", "w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "debug" })), ["d", "i", "w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "WARN" })), ["w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "nonsense" })), ["i", "w", "e"]);
});
```

- [ ] **Step 3: Run it and see it fail.** Run: `node --experimental-strip-types --test src/lib/log.server.test.ts`
Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/lib/log.server.ts'`.

- [ ] **Step 4: Implement.** Create `src/lib/log.server.ts`:
```ts
/**
 * Structured server logger (roadmap contract C4). Server code logs only through
 * `log`; a lint rule bans `console.*` in `src/**\/*.server.ts` and `src/routes/**`.
 *
 * One JSON line per event, `{ts, level, event, ...fields}`: debug/info go to
 * stdout, warn/error to stderr. Before anything is written, every key that looks
 * like a credential is replaced with "[REDACTED]" at any depth, and Errors are
 * reduced to `{name, message, stack}`. Log lines are server-side only — never
 * return them, or a field from them, in a response.
 *
 * `LOG_LEVEL` (debug | info | warn | error, default info) sets the threshold.
 *
 * ponytail: redaction is by key (and by a cookie entry's `name`); values are not
 * scanned, so a secret inside a free-text message is not caught. Keep secrets out
 * of messages; add value patterns here only if a real leak shows up.
 */
export type LogFields = Record<string, unknown>;

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /cookie|token|secret|authorization|password|sapisid|sid/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function threshold(): number {
  const wanted = process.env.LOG_LEVEL?.trim().toLowerCase() as Level | undefined;
  return (wanted && LEVELS[wanted]) || LEVELS.info;
}

function clean(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  ancestors.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => clean(item, depth + 1, ancestors));
  } else {
    const record = value as LogFields;
    const fields: LogFields = {};
    // A cookie-jar entry ({ name: "SID", value }) hides its secret in `value`.
    const namedSecret = typeof record.name === "string" && SECRET_KEY.test(record.name);
    for (const [key, inner] of Object.entries(record)) {
      const secret = SECRET_KEY.test(key) || (namedSecret && key === "value");
      fields[key] = secret ? REDACTED : clean(inner, depth + 1, ancestors);
    }
    out = fields;
  }
  // Only ancestors count as cycles; the same object twice side by side is fine.
  ancestors.delete(value);
  return out;
}

/** Replace credential-looking keys (any depth) with "[REDACTED]". Exported for tests. */
export function redact(fields: LogFields): LogFields {
  return clean(fields, 0, new WeakSet()) as LogFields;
}

function write(level: Level, event: string, fields?: LogFields): void {
  if (LEVELS[level] < threshold()) return;
  const line: LogFields = { ts: new Date().toISOString(), level, event };
  if (fields) {
    for (const [key, value] of Object.entries(redact(fields))) {
      if (!(key in line)) line[key] = value; // ts/level/event cannot be overridden
    }
  }
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

export const log: {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields & { err?: unknown }): void;
} = {
  debug: (event, fields) => write("debug", event, fields),
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};
```

- [ ] **Step 5: Run the test.** Run: `node --experimental-strip-types --test src/lib/log.server.test.ts`
Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 6: Put `ytdlp-meta.server.ts` under the lint rule and see it fail.** In `eslint.config.mjs` delete exactly these two lines:
```js
      // W1-T5 moves its one console.warn to `log` and deletes this line.
      "src/lib/ytdlp-meta.server.ts",
```
Run: `npx eslint src/lib/ytdlp-meta.server.ts`
Expected: `error  Unexpected console statement  no-console`, 1 problem.

- [ ] **Step 7: Migrate the call.** In `src/lib/ytdlp-meta.server.ts`:
  1. Replace exactly `import { attemptYtdlpMetadataLadder } from "@/lib/ytdlp-meta-routing";` with the two lines
     ```ts
     import { attemptYtdlpMetadataLadder } from "@/lib/ytdlp-meta-routing";
     import { log } from "@/lib/log.server";
     ```
  2. Replace exactly
     ```ts
                 console.warn(`[ytdlp] -J output exceeded ${JSON_STDOUT_MAX} bytes for ${id}`);
     ```
     with
     ```ts
                 log.warn("ytdlp.json_output_truncated", { videoId: id, maxBytes: JSON_STDOUT_MAX });
     ```

- [ ] **Step 8: Verify.** Run: `npm run lint && npm run typecheck && npm test`
Expected: lint exits 0 and typecheck is clean. `npm test` has 0 failures, including `ytdlp-meta-routing.test.ts` and `ytdlp-fallback-contract.test.ts`, which read this file's source.

- [ ] **Step 9: Commit.**
```bash
git add src/lib/log.server.ts src/lib/log.server.test.ts src/lib/ytdlp-meta.server.ts eslint.config.mjs
git commit -m "feat(log): add redacting structured server logger

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Real fixtures for the vacuous media-parser tests; non-tautological filename test

**Executor:** velo-impl-opus-medium
**Covers:** TEST-05, TEST-14

**Files:**
- Create: `src/lib/media-test-fixtures/index.ts`, `src/lib/media-test-fixtures/h264-high40-1080p-hls.mpegts` (~27 KB), `src/lib/media-test-fixtures/h264-high40-1080p-dash.mp4` (~42 KB)
- Modify: `src/lib/h264-syntax.test.ts`, `src/lib/nal-h264.test.ts`, `src/lib/mpeg-ts.test.ts`, `src/lib/iso-bmff.test.ts`, `src/lib/download-pool.server.test.ts`, `.gitattributes`

**Why these fixtures.** The old fixtures (`/tmp/dash137.bin`, `/tmp/hls-ts.bin`) were bytes of a YouTube video: they never existed in the repo, and they could not be committed anyway (third-party content). The new fixtures are synthetic: ffmpeg `testsrc2` encoded by x264, with every setting that matters pinned (`-threads 1`, `b-adapt=0`, `scenecut=0`, `-bitexact`):
- High@4.0 1920×1080 with frame cropping, which exercises SPS width/height decoding;
- AUD/SPS/PPS/SEI/IDR, a fixed I/P/B pattern, PMT PID 4095 and an AAC PID;
- a `dash`-brand fMP4 with one global `sidx` and 4 fragments.

The expected values were cross-checked with `ffmpeg -bsf:v trace_headers` (decode-order `slice_type` 7 5 6 6 5 6 6 5 6 6 5 6, which is `IPBBPBBPBBPB`; `log2_max_frame_num` 4; `profile_idc` 100; `level_idc` 40).

The tests assert **structure** (codec, sizes, slice pattern, fragment count, box arithmetic), never byte offsets, so a fixture regenerated by another ffmpeg build still passes. The PCR PID is 256 (ffmpeg puts the PCR on the video PID, where YouTube uses 8191), and the test says so.

- [ ] **Step 1: Verify anchors and tools.** Run:
```bash
git grep -n -F '/tmp/' -- src/lib/h264-syntax.test.ts src/lib/nal-h264.test.ts src/lib/mpeg-ts.test.ts src/lib/iso-bmff.test.ts
git grep -c -F '["media.mkv", "video/x-matroska"],' src/lib/download-pool.server.test.ts
ffmpeg -hide_banner -version | head -1
ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libx264
```
Expected:
- exactly 7 `/tmp/` lines: 2 in `h264-syntax`, 2 in `nal-h264`, 2 in `mpeg-ts` and 1 in `iso-bmff`. If the count differs, STOP;
- then `1`;
- then an `ffmpeg version 7.` line;
- then `1`.

Without ffmpeg/libx264: STOP and ask the orchestrator. The fixtures must come from this generator, never from a downloaded video.

- [ ] **Step 2: Write the fixture loader and rewrite the tests (they fail: fixtures absent).** Create `src/lib/media-test-fixtures/index.ts`:
```ts
import { readFileSync } from "node:fs";

/**
 * Committed media fixtures for the parser tests (TEST-05). Both files are
 * synthetic: ffmpeg's `testsrc2` pattern encoded with x264, so they carry no
 * third-party content. Regenerate from the repo root with ffmpeg 7.x:
 *
 *   ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
 *     -t 0.48 -c:v libx264 -threads 1 -preset veryfast -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 \
 *     -bf 2 -g 12 -x264-params "aud=1:scenecut=0:b-adapt=0" -c:a aac -b:a 32k -f mpegts \
 *     -mpegts_pmt_start_pid 4095 -mpegts_start_pid 256 -muxdelay 0 -bitexact \
 *     src/lib/media-test-fixtures/h264-high40-1080p-hls.mpegts
 *
 *   ffmpeg -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -t 0.8 -an -c:v libx264 -threads 1 -preset veryfast \
 *     -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 -bf 2 -g 5 -keyint_min 5 \
 *     -x264-params "scenecut=0:b-adapt=0" -f mp4 -brand dash -movflags +dash+global_sidx -bitexact \
 *     src/lib/media-test-fixtures/h264-high40-1080p-dash.mp4
 *
 * The tests assert structure (codec, profile, level, size, slice pattern,
 * fragment count, box arithmetic), never byte offsets, so a regenerated file
 * from another ffmpeg build still passes.
 */
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url)));

/** MPEG-TS: PAT → PMT 4095 → H.264 (PID 256, High@4.0 1920×1080, AUD on) + AAC (PID 257); 12 frames IPBB…. */
export const hlsTsFixture = (): Uint8Array => read("h264-high40-1080p-hls.mpegts");

/** Fragmented MP4, brand `dash`: ftyp, moov, one global sidx, then 4 moof+mdat fragments of 5 frames (0.8 s at 12800/s). */
export const dashCmafFixture = (): Uint8Array => read("h264-high40-1080p-dash.mp4");
```
Then apply these edits.

**`src/lib/h264-syntax.test.ts`**
1. Replace exactly
   ```ts
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import { test } from "node:test";
   import { parseAvcC, splitAnnexB, splitAvccSample } from "./nal-h264.ts";
   import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
   import { parseHvcC, parseSliceHeader, parseSps, youtubeHevcNote } from "./h264-syntax.ts";

   test("H.264 SPS is High 4.0 1920×1080; IDR slice is I frame_num 0", () => {
     let dash: Uint8Array;
     try {
       dash = new Uint8Array(readFileSync("/tmp/dash137.bin"));
     } catch {
       return;
     }
     const avcC = parseAvcC(dash);
     assert.ok(avcC?.sps[0]);
     const sps = parseSps(avcC!.sps[0]!);
     assert.ok(sps);
     assert.equal(sps!.profile, 100);
     assert.equal(sps!.level, 40);
     assert.equal(sps!.width, 1920);
     assert.equal(sps!.height, 1080);
     assert.equal(sps!.log2MaxFrameNum, 4);
     const sample = dash.subarray(2902, 2902 + 631);
     const idr = splitAvccSample(sample).find((nal) => nal.type === 5);
   ```
   with
   ```ts
   import assert from "node:assert/strict";
   import { test } from "node:test";
   import { parseAvcC, parseTrunDataOffset, splitAnnexB, splitAvccSample } from "./nal-h264.ts";
   import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
   import { dashSegmentPlan } from "./iso-bmff.ts";
   import { parseHvcC, parseSliceHeader, parseSps, youtubeHevcNote } from "./h264-syntax.ts";
   import { dashCmafFixture, hlsTsFixture } from "./media-test-fixtures/index.ts";

   test("H.264 SPS is High 4.0 1920×1080; IDR slice is I frame_num 0", () => {
     const dash = dashCmafFixture();
     const avcC = parseAvcC(dash);
     assert.ok(avcC?.sps[0]);
     const sps = parseSps(avcC!.sps[0]!);
     assert.ok(sps);
     assert.equal(sps!.profile, 100);
     assert.equal(sps!.level, 40);
     assert.equal(sps!.width, 1920);
     assert.equal(sps!.height, 1080);
     assert.equal(sps!.log2MaxFrameNum, 4);
     const moof = dashSegmentPlan(dash).boxes.find((box) => box.type === "moof");
     assert.ok(moof);
     const trun = parseTrunDataOffset(dash, moof!.offset);
     assert.ok(trun?.sample0Size);
     const start = moof!.offset + trun!.dataOffset;
     const sample = dash.subarray(start, start + trun!.sample0Size!);
     const idr = splitAvccSample(sample).find((nal) => nal.type === 5);
   ```
2. Replace exactly
   ```ts
   test("HLS GOP: IDR I, then P and B slices", () => {
     let ts: Uint8Array;
     try {
       ts = new Uint8Array(readFileSync("/tmp/hls-ts.bin"));
     } catch {
       return;
     }
     const pid = scanMpegTs(ts).streams.find((s) => s.codec === "h264")?.pid ?? 256;
     const nals = splitAnnexB(extractPesPayloads(ts, pid));
     const spsNal = nals.find((nal) => nal.type === 7);
     const pes = extractPesPayloads(ts, pid);
     const sps = spsNal ? parseSps(pes.subarray(spsNal.offset, spsNal.offset + spsNal.length)) : null;
     assert.equal(sps?.width, 1920);
     const coded = nals.filter((nal) => nal.type === 1 || nal.type === 5).slice(0, 8);
     const slices = coded.map(
       (nal) =>
         parseSliceHeader(pes.subarray(nal.offset, nal.offset + nal.length), sps!.log2MaxFrameNum)
           ?.slice,
     );
     assert.equal(slices[0], "I");
     assert.ok(slices.includes("P"));
     assert.ok(slices.includes("B"));
   });
   ```
   with
   ```ts
   test("HLS GOP: IDR I, then P and B slices", () => {
     const ts = hlsTsFixture();
     const pid = scanMpegTs(ts).streams.find((s) => s.codec === "h264")?.pid;
     assert.equal(pid, 256);
     const pes = extractPesPayloads(ts, pid!);
     const nals = splitAnnexB(pes);
     const spsNal = nals.find((nal) => nal.type === 7);
     assert.ok(spsNal);
     const sps = parseSps(pes.subarray(spsNal!.offset, spsNal!.offset + spsNal!.length));
     assert.equal(sps?.width, 1920);
     assert.equal(sps?.height, 1080);
     const coded = nals.filter((nal) => nal.type === 1 || nal.type === 5);
     const slices = coded.map(
       (nal) =>
         parseSliceHeader(pes.subarray(nal.offset, nal.offset + nal.length), sps!.log2MaxFrameNum)
           ?.slice,
     );
     // Decode order of the fixture's 12 frames (-bf 2, b-adapt=0), cross-checked
     // with `ffmpeg -bsf:v trace_headers` (slice_type 7 5 6 6 5 6 6 5 6 6 5 6).
     assert.equal(slices.join(""), "IPBBPBBPBBPB");
   });
   ```

**`src/lib/nal-h264.test.ts`**: replace everything from the first line through the end of the test `"DASH CMAF: avcC High@4.0, first sample SEI+IDR via trun"`. That is the whole current file. The replacement:
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nalType,
  parseAvcC,
  parseTrunDataOffset,
  splitAnnexB,
  splitAvccSample,
} from "./nal-h264.ts";
import { extractPesPayloads, scanMpegTs } from "./mpeg-ts.ts";
import { dashSegmentPlan } from "./iso-bmff.ts";
import { dashCmafFixture, hlsTsFixture } from "./media-test-fixtures/index.ts";

test("HLS TS Annex-B: AUD SPS PPS SEI IDR, High@4.0", () => {
  const data = hlsTsFixture();
  const scan = scanMpegTs(data);
  const videoPid = scan.streams.find((s) => s.codec === "h264")?.pid;
  assert.equal(videoPid, 256);
  const pes = extractPesPayloads(data, videoPid!);
  const nals = splitAnnexB(pes).filter((nal) => nal.length > 0);
  assert.ok(nals.length > 5);
  assert.deepEqual(
    nals.slice(0, 5).map((nal) => nal.name),
    ["AUD", "SPS", "PPS", "SEI", "IDR"],
  );
  // Every frame of the fixture starts with an access-unit delimiter (x264 aud=1).
  assert.equal(nals.filter((nal) => nal.name === "AUD").length, 12);
  const sps = nals.find((nal) => nal.type === 7);
  assert.ok(sps);
  assert.equal(pes[sps!.offset + 1], 100);
  assert.equal(pes[sps!.offset + 3], 40);
});

test("DASH CMAF: avcC High@4.0, first sample SEI+IDR via trun", () => {
  const data = dashCmafFixture();
  const avcC = parseAvcC(data);
  assert.ok(avcC);
  assert.equal(avcC!.profile, 100);
  assert.equal(avcC!.level, 40);
  assert.equal(avcC!.lengthSize, 4);
  assert.equal(nalType(avcC!.sps[0]![0]!), 7);
  assert.equal(nalType(avcC!.pps[0]![0]!), 8);
  const moof = dashSegmentPlan(data).boxes.find((box) => box.type === "moof");
  assert.ok(moof);
  const trun = parseTrunDataOffset(data, moof!.offset);
  assert.ok(trun);
  // default-base-is-moof: the first sample sits right after the moof box and
  // the 8-byte mdat header.
  assert.equal(trun!.dataOffset, moof!.size + 8);
  assert.ok(trun!.sample0Size);
  const start = moof!.offset + trun!.dataOffset;
  const sample = data.subarray(start, start + trun!.sample0Size!);
  const nals = splitAvccSample(sample, avcC!.lengthSize);
  assert.deepEqual(
    nals.map((nal) => nal.name),
    ["SEI", "IDR"],
  );
  // The length-prefixed NALs tile the whole sample, with nothing left over.
  assert.equal(
    nals.reduce((sum, nal) => sum + avcC!.lengthSize + nal.length, 0),
    trun!.sample0Size,
  );
});
```
Before replacing, confirm the current file contains nothing after that second test: `grep -c '^test(' src/lib/nal-h264.test.ts` must print `2`. Otherwise STOP.

**`src/lib/mpeg-ts.test.ts`**
1. Replace exactly
   ```ts
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import { test } from "node:test";
   import { containerKind, parseTsPacket, scanMpegTs, TS_PACKET, TS_SYNC } from "./mpeg-ts.ts";
   import { dashHlsSliceEnd, dashSegmentPlan, hlsContainer, sidxDurationSec } from "./iso-bmff.ts";
   import { parseHls } from "./stream-unlock.ts";

   test("PAT/PMT: program 1 → PMT 4095 → AAC 257 + H.264 256", () => {
     let data: Uint8Array;
     try {
       data = new Uint8Array(readFileSync("/tmp/hls-ts.bin"));
     } catch {
       data = Uint8Array.of(TS_SYNC, 0x40, 0x00, 0x10, ...Array(184).fill(0xff));
     }
     const first = parseTsPacket(data, 0);
     assert.ok(first);
     assert.equal(data[0], TS_SYNC);
     if (data.length < TS_PACKET * 2) return;
     const scan = scanMpegTs(data);
     assert.equal(scan.syncErrors, 0);
     assert.equal(scan.transportStreamId, 1);
     assert.equal(scan.programNumber, 1);
     assert.equal(scan.pmtPid, 4095);
     assert.equal(scan.pcrPid, 8191);
   ```
   with
   ```ts
   import assert from "node:assert/strict";
   import { test } from "node:test";
   import { containerKind, parseTsPacket, scanMpegTs, TS_PACKET, TS_SYNC } from "./mpeg-ts.ts";
   import { dashHlsSliceEnd, dashSegmentPlan, hlsContainer, sidxDurationSec } from "./iso-bmff.ts";
   import { parseHls } from "./stream-unlock.ts";
   import { dashCmafFixture, hlsTsFixture } from "./media-test-fixtures/index.ts";

   test("PAT/PMT: program 1 → PMT 4095 → AAC 257 + H.264 256", () => {
     const data = hlsTsFixture();
     assert.equal(data.length % TS_PACKET, 0);
     const first = parseTsPacket(data, 0);
     assert.ok(first);
     assert.equal(data[0], TS_SYNC);
     const scan = scanMpegTs(data);
     assert.equal(scan.packets, data.length / TS_PACKET);
     assert.equal(scan.syncErrors, 0);
     assert.equal(scan.transportStreamId, 1);
     assert.equal(scan.programNumber, 1);
     assert.equal(scan.pmtPid, 4095);
     // ffmpeg carries the PCR on the video PID (YouTube's own segments use 8191).
     assert.equal(scan.pcrPid, 256);
   ```
2. Replace exactly the whole test that starts `test("DASH sidx: 38 fragments, 213.04s, first HLS slice 0-1342317", () => {` and ends with `  assert.equal(Number(sidxDurationSec(sidx!).toFixed(2)), 213.04);\n});` with:
   ```ts
   test("DASH sidx: 4 fragments, 0.8s, refs tile every moof+mdat pair", () => {
     const data = dashCmafFixture();
     const { boxes, sidx } = dashSegmentPlan(data);
     assert.deepEqual(
       boxes.map((b) => b.type).slice(0, 4),
       ["ftyp", "moov", "sidx", "moof"],
     );
     assert.ok(sidx);
     assert.equal(sidx!.timescale, 12800);
     assert.equal(sidx!.refs.length, 4);
     // Each reference spans exactly one moof+mdat pair, back to back.
     const moofs = boxes.filter((b) => b.type === "moof");
     assert.equal(moofs.length, 4);
     sidx!.refs.forEach((ref, i) => {
       const mdat = boxes[boxes.indexOf(moofs[i]!) + 1]!;
       assert.equal(mdat.type, "mdat");
       assert.equal(ref.start, moofs[i]!.offset);
       assert.equal(ref.size, moofs[i]!.size + mdat.size);
       assert.equal(ref.end, ref.start + ref.size - 1);
     });
     assert.equal(dashHlsSliceEnd(sidx!), sidx!.refs[0]!.end);
     assert.equal(dashHlsSliceEnd(sidx!, 4), null);
     assert.equal(Number(sidxDurationSec(sidx!).toFixed(2)), 0.8);
   });
   ```

**`src/lib/iso-bmff.test.ts`**
1. Replace exactly
   ```ts
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import { test } from "node:test";
   ```
   with
   ```ts
   import assert from "node:assert/strict";
   import { test } from "node:test";
   import { dashCmafFixture } from "./media-test-fixtures/index.ts";
   ```
2. Replace exactly
   ```ts
   test("itag 137 opens as ftypdash + sidx (dash.js SegmentBase)", () => {
     let data: Uint8Array = syntheticDashHead();
     try {
       data = new Uint8Array(readFileSync("/tmp/dash137.bin"));
     } catch {
       /* synthetic layout still exercises the parser */
     }
     assert.equal(looksLikeFragment(data), "fmp4");
     const { boxes, sidx } = dashSegmentPlan(data);
     assert.equal(boxes[0]?.type, "ftyp");
     assert.ok(boxes.some((box) => box.type === "sidx"));
     assert.ok(sidx);
     assert.ok((sidx?.refs.length ?? 0) >= 1);
     const first = sidx!.refs[0]!;
     assert.ok(first.end >= first.start);
     assert.ok(first.size > 0);
   });
   ```
   with
   ```ts
   test("itag 137 opens as ftypdash + sidx (dash.js SegmentBase)", () => {
     for (const [label, data, refs] of [
       ["synthetic head", syntheticDashHead(), 1],
       ["encoded fixture", dashCmafFixture(), 4],
     ] as const) {
       assert.equal(looksLikeFragment(data), "fmp4", label);
       const { boxes, sidx } = dashSegmentPlan(data);
       assert.equal(boxes[0]?.type, "ftyp", label);
       assert.ok(boxes.some((box) => box.type === "sidx"), label);
       assert.ok(sidx, label);
       assert.equal(sidx!.refs.length, refs, label);
       const first = sidx!.refs[0]!;
       assert.ok(first.end >= first.start, label);
       assert.ok(first.size > 0, label);
     }
   });
   ```

- [ ] **Step 3: Run and see them fail.** Run: `node --experimental-strip-types --test src/lib/h264-syntax.test.ts src/lib/nal-h264.test.ts src/lib/mpeg-ts.test.ts src/lib/iso-bmff.test.ts`
Expected: 6 failures, each `Error: ENOENT: no such file or directory, open '…media-test-fixtures\h264-high40-1080p-…'`.

- [ ] **Step 4: Generate the fixtures.** Run from the worktree root, exactly as in the loader's header:
```bash
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 0.48 -c:v libx264 -threads 1 -preset veryfast -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 -bf 2 -g 12 -x264-params "aud=1:scenecut=0:b-adapt=0" -c:a aac -b:a 32k -f mpegts -mpegts_pmt_start_pid 4095 -mpegts_start_pid 256 -muxdelay 0 -bitexact src/lib/media-test-fixtures/h264-high40-1080p-hls.mpegts
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=25" -t 0.8 -an -c:v libx264 -threads 1 -preset veryfast -profile:v high -level:v 4.0 -pix_fmt yuv420p -crf 51 -bf 2 -g 5 -keyint_min 5 -x264-params "scenecut=0:b-adapt=0" -f mp4 -brand dash -movflags +dash+global_sidx -bitexact src/lib/media-test-fixtures/h264-high40-1080p-dash.mp4
ls -l src/lib/media-test-fixtures/
ffmpeg -hide_banner -i src/lib/media-test-fixtures/h264-high40-1080p-hls.mpegts -map 0:v -c copy -bsf:v trace_headers -f null - 2>&1 | grep -E " slice_type " | awk '{print $NF}' | tr '\n' ' '; echo
```
Expected:
- the `.mpegts` is ~27 KB and the `.mp4` ~42 KB (exact bytes may differ between ffmpeg builds; the tests do not depend on them);
- the last line prints `7 5 6 6 5 6 6 5 6 6 5 6`.

- [ ] **Step 5: Mark the fixtures binary.** Append to `.gitattributes`:
```
# Committed media fixtures (TEST-05): never normalise line endings.
*.mpegts binary
*.mp4 binary
```

- [ ] **Step 6: Run the parser tests.** Run: `node --experimental-strip-types --test --test-reporter=spec src/lib/h264-syntax.test.ts src/lib/nal-h264.test.ts src/lib/mpeg-ts.test.ts src/lib/iso-bmff.test.ts`
Expected: `ℹ tests 17`, `ℹ pass 17`, `ℹ fail 0`, `ℹ skipped 0`.

- [ ] **Step 7: Mutation check (TEST-05's own verification).**
  1. In `src/lib/h264-syntax.ts`, change the width computation inside `parseSps` so the result is off by 16. For example, add `+ 16` to the expression assigned to the returned `width`.
  2. Re-run Step 6. Expected: at least 2 failures (`1936 !== 1920`).
  3. Revert with `git checkout -- src/lib/h264-syntax.ts`, then confirm `git diff --stat src/lib/h264-syntax.ts` prints nothing.

- [ ] **Step 8: TEST-14.**
  1. Anchor: `git grep -c -F 'test("mediaFileResponse tells the client the real container", async (t: TestContext) => {' src/lib/download-pool.server.test.ts` must print `1`.
  2. Replace that whole test, which ends with `    await res.body?.cancel();\n  }\n});`, with:
     ```ts
     test("mediaFileResponse tells the client the real container, never the on-disk name", async (t: TestContext) => {
       const dir = await mkdtemp(join(tmpdir(), "velo-pool-mime-"));
       t.after(() => rm(dir, { recursive: true, force: true }));
       // On-disk names carry user-influenced text (titles, quotes, CR/LF). The header
       // must only ever say media.<ext>: the client names the save, and nothing a
       // user controls reaches Content-Disposition.
       const cases: [string, string, string][] = [
         ["My Video [abc].mkv", "video/x-matroska", "mkv"],
         ['quote" and\r\nX-Injected: 1.mp4', "video/mp4", "mp4"],
         ["clip.webm", "video/webm", "webm"],
         ["Song – Artist.m4a", "audio/mp4", "m4a"],
         ["track.mp3", "audio/mpeg", "mp3"],
       ];
       for (const [filename, mime, ext] of cases) {
         const path = join(dir, `case-${ext}.${ext}`);
         await writeFile(path, fakeMedia());
         const res = mediaFileResponse(path, filename, "test", "anon", 4096);
         assert.equal(res.headers.get("Content-Type"), mime, filename);
         assert.equal(res.headers.get("Content-Disposition"), `attachment; filename="media.${ext}"`, filename);
         await res.body?.cancel();
       }
     });
     ```
  3. Run: `node --experimental-strip-types --test src/lib/download-pool.server.test.ts`
     Expected: all pass. This is a characterization of intended behaviour, so it passes on current code.
  4. Mutation: in `src/lib/download-pool.server.ts`, change `` `attachment; filename="media.${ext}"` `` to `` `attachment; filename="${filename}"` ``. Re-run and expect a failure on `My Video [abc].mkv`. Revert with `git checkout -- src/lib/download-pool.server.ts`.

- [ ] **Step 9: Full gate.** Run: `npm run lint && npm run typecheck && npm test && grep -rn "/tmp/" src/lib/h264-syntax.test.ts src/lib/nal-h264.test.ts src/lib/mpeg-ts.test.ts src/lib/iso-bmff.test.ts`
Expected: lint, typecheck and tests all green, and the final grep prints nothing.

- [ ] **Step 10: Commit.**
```bash
git add src/lib/media-test-fixtures src/lib/h264-syntax.test.ts src/lib/nal-h264.test.ts src/lib/mpeg-ts.test.ts src/lib/iso-bmff.test.ts src/lib/download-pool.server.test.ts .gitattributes
git commit -m "test: give media-parser tests real fixtures; pin media filename header

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Harden `auto-update` (untrusted update job and trusted PR job; verify with build)

**Executor:** velo-impl-opus-high (CI token scope, supply chain)
**Covers:** GH-03, GH-05, GH-07 (CI part: no unpinned pip in workflows), GH-10 (auto-update), TEST-11, SUP-08 (auto-update part), M-19 (part), Review Focus 4

**Files:**
- Replace: `.github/workflows/auto-update.yml`
- Modify: `scripts/auto-update-plan.mjs` (append `verifySteps`), `scripts/auto-update.mjs` (use it)
- Create: `scripts/auto-update-verify.test.mjs`, `scripts/workflow-policy.test.mjs`

**Interfaces:**
- Produces:
  - `verifySteps({ skipTests?: boolean }): Array<[label: string, npmArgv: string[]]>`, which returns typecheck, test (unless skipped), lint, build;
  - `scripts/workflow-policy.test.mjs`, which Tasks 8 and 9 append to.
- **Design.**
  - Dependabot (Task 9) owns every npm package except the five extraction libraries. Those stay with this job because its rollback verifier exists for them. The `--only=` list here and the Dependabot `ignore` list must match; a test in Task 9 enforces it.
  - yt-dlp is out: no pip in any workflow until W5 adds hashed `requirements.txt` plus a Dependabot pip entry.
  - `open-pr` is skipped until **[OWNER]** creates the GitHub App (Task 10) and sets `vars.DEPS_BOT_CLIENT_ID`. `create-github-app-token@v3.2.0` deprecates `app-id` in favour of `client-id` (checked in its `action.yml` at the pinned SHA).
  - Failures of the scheduled run open an issue (GH-05).

**Pinned SHAs.** Each was re-verified on 2026-09-23 with `gh api repos/<o>/<r>/git/ref/tags/<tag>`, and annotated tags were dereferenced with `git/tags/<sha>` and `git ls-remote … ^{}`:

| Action | Tag | Commit |
|---|---|---|
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7.0.0 | 820762786026740c76f36085b0efc47a31fe5020 |
| actions/upload-artifact | v7.0.1 | 043fb46d1a93c77aae656e7c1c64a875d1fc6a0a |
| actions/download-artifact | v8.0.1 | 3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c |
| actions/create-github-app-token | v3.2.0 | bcd2ba49218906704ab6c1aa796996da409d3eb1 |
| peter-evans/create-pull-request | v8.1.1 | 5f6978faf089d4d20b00c7766989d076bb2fc7f1 |
| step-security/harden-runner | v2.21.1 | e14015d583714f6e62063499dc959a02595150a1 |
| actions/dependency-review-action | v5.0.0 | a1d282b36b6f3519aa1f3fc636f609c47dddb294 |
| github/codeql-action | v4.38.1 | 1c5b675653bb5c22dbe9b12b556ec555138e09fd (tag object c23de5a8…) |
| ossf/scorecard-action | v2.4.4 | 2d1146689b8cda280b9bc96326124645441f03bc (tag object 55891bbd…) |

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '    ["lint", ["run", "lint"]],' scripts/auto-update.mjs
git grep -c -F '  ytdlpNeedsUpdate,' scripts/auto-update.mjs
git grep -c -F ' * unverified. Every install is followed by `typecheck` + `test` + `lint`, and' scripts/auto-update.mjs
ls .github/workflows
```
Expected: `1`, `1`, `1`, then only `auto-update.yml`. Otherwise STOP.

- [ ] **Step 2: Write the failing tests.** Create `scripts/auto-update-verify.test.mjs`:
```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifySteps } from "./auto-update-plan.mjs";

test("every update is verified with typecheck, test, lint and build, in that order", () => {
  assert.deepEqual(verifySteps(), [
    ["typecheck", ["run", "typecheck"]],
    ["test", ["run", "test"]],
    ["lint", ["run", "lint"]],
    ["build", ["run", "build"]],
  ]);
});

test("--skip-tests drops only the test step; build still runs", () => {
  assert.deepEqual(
    verifySteps({ skipTests: true }).map(([label]) => label),
    ["typecheck", "lint", "build"],
  );
});
```
Create `scripts/workflow-policy.test.mjs`:
```js
// Policy checks over .github/workflows/*.yml (GH-03, GH-06, GH-10, SUP-08).
// Text checks on purpose: these are rules about the YAML itself, and a plain
// read keeps the test free of a YAML dependency.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), "utf8").replace(/\r\n/g, "\n") }));

/** Split a workflow into its jobs: { id, text } for each two-space-indented key under `jobs:`. */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  return body
    .split(/^(?= {2}[a-z0-9_-]+:\s*$)/m)
    .filter((chunk) => /^ {2}[a-z0-9_-]+:/.test(chunk))
    .map((chunk) => ({ id: chunk.match(/^ {2}([a-z0-9_-]+):/)[1], text: chunk }));
}

for (const { name, text } of workflows) {
  test(`${name}: every action is pinned to a full commit SHA with a version comment`, () => {
    const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length > 0);
    for (const [, ref, rest] of uses) {
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${ref}`);
      assert.match(rest, /#\s*v\d+\.\d+\.\d+/, `${name}: ${ref} needs a "# vX.Y.Z" comment`);
    }
  });

  test(`${name}: default token has no permissions; jobs opt in`, () => {
    assert.match(text, /^permissions: \{\}$/m);
  });

  test(`${name}: checkout never persists the token`, () => {
    const checkouts = text.match(/uses: actions\/checkout@/g)?.length ?? 0;
    const hardened = text.match(/persist-credentials: false/g)?.length ?? 0;
    assert.equal(hardened, checkouts);
  });

  test(`${name}: every job has a timeout and a pinned runner image`, () => {
    for (const job of jobs(text)) {
      assert.match(job.text, /^ {4}timeout-minutes: \d+$/m, `${name}/${job.id}`);
    }
    assert.doesNotMatch(text, /-latest\b/);
  });

  test(`${name}: a job holding a write permission runs no package code`, () => {
    for (const job of jobs(text)) {
      if (!/:\s*write\b/.test(job.text)) continue;
      assert.doesNotMatch(job.text, /\b(npm|npx|pip|pip3|node)\s/, `${name}/${job.id}`);
    }
  });

  test(`${name}: no unpinned pip install`, () => {
    for (const [line] of text.matchAll(/^.*pip3? install.*$/gm)) {
      assert.match(line, /--require-hashes/, `${name}: ${line.trim()}`);
    }
  });
}
```

- [ ] **Step 3: Run them and see them fail.** Run: `node --test scripts/auto-update-verify.test.mjs scripts/workflow-policy.test.mjs`
Expected:
- `auto-update-verify.test.mjs` fails with `SyntaxError: The requested module './auto-update-plan.mjs' does not provide an export named 'verifySteps'`;
- `workflow-policy.test.mjs` fails on the W0-state `auto-update.yml`: not pinned (`actions/checkout@v4`), no `permissions: {}`, no `persist-credentials: false`, no `timeout-minutes`/`ubuntu-latest`, and the unpinned `pip install`.

- [ ] **Step 4: Implement `verifySteps`.**
  1. Append to the end of `scripts/auto-update-plan.mjs`:
     ```js

     /**
      * The gates an update must pass, in order, as `npm` argv. `build` runs last:
      * it is the slowest and the only one that catches bundler/runtime breakage
      * (vite, nitro, @tanstack/react-start) that typecheck and tests miss.
      * @param {{ skipTests?: boolean }} [options]
      * @returns {Array<[string, string[]]>}
      */
     export function verifySteps({ skipTests = false } = {}) {
       return [
         ["typecheck", ["run", "typecheck"]],
         ...(skipTests ? [] : [/** @type {[string, string[]]} */ (["test", ["run", "test"]])]),
         ["lint", ["run", "lint"]],
         ["build", ["run", "build"]],
       ];
     }
     ```
  2. In `scripts/auto-update.mjs` replace exactly
     ```js
       lockstepGroups,
       ytdlpNeedsUpdate,
     } from "./auto-update-plan.mjs";
     ```
     with
     ```js
       lockstepGroups,
       verifySteps,
       ytdlpNeedsUpdate,
     } from "./auto-update-plan.mjs";
     ```
  3. Replace exactly
     ```js
     /**
      * Typecheck, test and lint the tree as it stands.
      * @returns {Promise<{ ok: boolean, failed?: string, output?: string }>}
      */
     async function verify() {
       const steps = [
         ["typecheck", ["run", "typecheck"]],
         ...(options.skipTests ? [] : [["test", ["run", "test"]]]),
         ["lint", ["run", "lint"]],
       ];
       for (const [label, argv] of steps) {
     ```
     with
     ```js
     /**
      * Typecheck, test, lint and build the tree as it stands.
      * @returns {Promise<{ ok: boolean, failed?: string, output?: string }>}
      */
     async function verify() {
       for (const [label, argv] of verifySteps({ skipTests: options.skipTests })) {
     ```
  4. Replace exactly ` * unverified. Every install is followed by `typecheck` + `test` + `lint`, and` with ` * unverified. Every install is followed by `typecheck` + `test` + `lint` + `build`, and`.

- [ ] **Step 5: Replace `.github/workflows/auto-update.yml` entirely with:**
```yaml
# Weekly refresh of the extraction libraries that track the YouTube player
# (youtubei.js, bgutils-js, jsdom, undici, socks-proxy-agent). Everything else
# is Dependabot's (.github/dependabot.yml); yt-dlp moves to Dependabot pip once
# requirements.txt exists (W5).
#
# Two jobs, so new third-party code never runs next to a write credential:
#   update  - read-only token, no persisted git credentials, no lifecycle
#             scripts. Installs the new versions, verifies them with
#             typecheck + test + lint + build (rolling back anything that
#             fails), and uploads a patch of package.json + package-lock.json.
#   open-pr - runs no package code. Rejects a patch that touches any other
#             path, then opens the PR with a GitHub App token so ci.yml runs
#             on it. Skipped until the owner configures the App.
name: auto-update

on:
  schedule:
    - cron: "0 6 * * 1" # Mondays, 06:00 UTC
  workflow_dispatch:

permissions: {}

concurrency:
  group: auto-update
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    permissions:
      contents: read
    outputs:
      changed: ${{ steps.diff.outputs.changed }}
    steps:
      - uses: step-security/harden-runner@e14015d583714f6e62063499dc959a02595150a1 # v2.21.1
        with:
          egress-policy: audit
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - name: update the extraction family (3-day release cooldown, no install scripts)
        env:
          npm_config_ignore_scripts: "true"
        run: |
          export NPM_CONFIG_BEFORE="$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)"
          npm run update:deps -- --skip-ytdlp --only=youtubei.js,bgutils-js,jsdom,undici,socks-proxy-agent
      - id: diff
        run: |
          git diff --binary -- package.json package-lock.json > manifests.patch
          if [ -s manifests.patch ]; then echo "changed=true" >> "$GITHUB_OUTPUT"; else echo "changed=false" >> "$GITHUB_OUTPUT"; fi
      - if: steps.diff.outputs.changed == 'true'
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: manifests-patch
          path: manifests.patch
          retention-days: 3

  open-pr:
    needs: update
    if: needs.update.outputs.changed == 'true' && vars.DEPS_BOT_CLIENT_ID != ''
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read # the App token below does the writing
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: manifests-patch
      - name: the patch may only touch package.json and package-lock.json
        run: |
          set -euo pipefail
          files="$(git apply --numstat manifests.patch | awk '{print $3}' | sort -u)"
          echo "$files"
          if echo "$files" | grep -vxE 'package\.json|package-lock\.json'; then
            echo "::error::patch touches files other than package.json/package-lock.json"
            exit 1
          fi
          git apply manifests.patch
          rm manifests.patch
      - id: app-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          client-id: ${{ vars.DEPS_BOT_CLIENT_ID }}
          private-key: ${{ secrets.DEPS_BOT_PRIVATE_KEY }}
      - uses: peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1 # v8.1.1
        with:
          token: ${{ steps.app-token.outputs.token }}
          branch: auto-update/dependencies
          title: "chore(deps): weekly extraction-library update"
          commit-message: "chore(deps): weekly extraction-library update"
          add-paths: |
            package.json
            package-lock.json
          delete-branch: true
          body: |
            Automated by `.github/workflows/auto-update.yml` (3-day release cooldown).
            Each version was installed without lifecycle scripts in a read-only job and kept
            only if typecheck + test + lint + build passed; `ci` re-verifies this PR.

  report-failure:
    needs: [update, open-pr]
    if: failure() && github.event_name == 'schedule'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      issues: write
    steps:
      - env:
          GH_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          gh issue create -R "$GITHUB_REPOSITORY" \
            --title "auto-update failed ($(date -u +%F))" \
            --body "Scheduled run failed: $RUN_URL"
```

- [ ] **Step 6: Run the tests and a local dry run.** Run:
```bash
node --test scripts/auto-update-verify.test.mjs scripts/workflow-policy.test.mjs scripts/auto-update-plan.test.mjs
node -e 'require("yaml").parse(require("fs").readFileSync(".github/workflows/auto-update.yml","utf8")); console.log("yaml ok")'
npm run update:deps -- --dry-run --skip-ytdlp --only=youtubei.js,bgutils-js,jsdom,undici,socks-proxy-agent
```
Expected:
- all tests pass;
- `yaml ok` prints; `yaml` is a transitive dependency and is used here only as a one-off check, never imported by repo code;
- the dry run prints `Velo dependency update (dry run)` followed by either `everything is current` or a plan. It changes nothing: `git status --short package.json package-lock.json` prints nothing.

- [ ] **Step 7: Full gate.** Run: `npm run lint && npm run typecheck && npm test`
Expected: green.

- [ ] **Step 8: Commit.**
```bash
git add .github/workflows/auto-update.yml scripts/auto-update-plan.mjs scripts/auto-update.mjs scripts/auto-update-verify.test.mjs scripts/workflow-policy.test.mjs
git commit -m "ci(auto-update): split untrusted update from PR creation; verify with build

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Required CI workflow

**Executor:** velo-impl-sonnet-high
**Covers:** GH-04, TEST-01, OPS-09, ARCH-22 (CI part), SUP-08 (CI part: `npm ci --ignore-scripts`, `npm audit signatures`), GH-06 (pins), GH-10 (concurrency, timeouts, pinned runner images), TEST-15 (migrations against Postgres 16, twice), TEST-17 (suite on Linux + Windows), INST-02 (CI uses `.nvmrc`), M-19 (part)

**Files:** Create `.github/workflows/ci.yml`. Modify `scripts/workflow-policy.test.mjs` (append 1 test).

**Interfaces:**
- Produces check names used by the ruleset (Task 10): `unit (ubuntu-24.04)`, `unit (windows-2025)`, `verify`.
- `verify` provides a Postgres 16.15 service at `postgres://postgres@127.0.0.1:5432/velo` with trust auth, CI only, so there is no secret-like literal. It exposes the URL to `test:http` as `VELO_TEST_DATABASE_URL`.
- W8 later appends an `e2e` job to this file (Hand-off).

- [ ] **Step 1: Verify anchors.** Run: `ls .github/workflows` and `git grep -c -F 'for (const { name, text } of workflows) {' scripts/workflow-policy.test.mjs`
Expected: `auto-update.yml` only, then `1`. Otherwise STOP.

- [ ] **Step 2: Write the failing test.** Append to the end of `scripts/workflow-policy.test.mjs`:
```js

test("ci.yml exists and gates unit tests on Linux and Windows plus the verify job", () => {
  const ci = workflows.find((w) => w.name === "ci.yml");
  assert.ok(ci, "ci.yml is missing");
  assert.match(ci.text, /os: \[ubuntu-24\.04, windows-2025\]/);
  for (const step of ["npm run typecheck", "npm run lint", "npm run build", "npm run test:http", "npm audit signatures"]) {
    assert.ok(ci.text.includes(step), step);
  }
});
```
Run: `node --test scripts/workflow-policy.test.mjs`
Expected: 1 failure, `ci.yml is missing`.

- [ ] **Step 3: Create `.github/workflows/ci.yml`:**
```yaml
# Required checks for every PR and every push to main.
#   unit (ubuntu-24.04), unit (windows-2025): npm test on both OSes
#   verify: typecheck, lint, build, migrations against Postgres 16, HTTP tests
# Read-only token, no persisted credentials, no lifecycle scripts, pinned actions.
name: ci

on:
  push:
    branches: [main]
  pull_request:
  merge_group:

permissions: {}

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  unit:
    name: unit (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, windows-2025]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      # --ignore-scripts: nothing here needs a lifecycle script, and a
      # compromised dependency's install script must not run in CI.
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm test

  verify:
    name: verify
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    services:
      postgres:
        image: postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
        env:
          POSTGRES_DB: velo
          POSTGRES_HOST_AUTH_METHOD: trust
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 12
    env:
      CI_DATABASE_URL: postgres://postgres@127.0.0.1:5432/velo
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm audit signatures
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - name: migrations apply to Postgres 16 and re-run as a no-op
        env:
          DATABASE_URL: ${{ env.CI_DATABASE_URL }}
        run: |
          npm run db:migrate
          npm run db:migrate | tee migrate-second.log
          grep -q "up to date" migrate-second.log
      - name: HTTP tests against the built server
        env:
          VELO_TEST_DATABASE_URL: ${{ env.CI_DATABASE_URL }}
        run: npm run test:http
```
The Postgres digest `sha256:721873c3…` is the multi-arch index of `postgres:16.15-alpine`, which is also `16-alpine`. It was resolved from `registry-1.docker.io` on 2026-09-23. Dependabot's `docker` ecosystem does not watch service images; W5 owns image pinning policy (Hand-off).

- [ ] **Step 4: Run the tests.** Run: `node --test scripts/workflow-policy.test.mjs && node -e 'require("yaml").parse(require("fs").readFileSync(".github/workflows/ci.yml","utf8")); console.log("yaml ok")'`
Expected: all pass, then `yaml ok`.

- [ ] **Step 5: Reproduce the `verify` job locally** (Docker; skip if unavailable and say so):
```bash
npm ci --ignore-scripts --no-audit --no-fund && npm audit signatures && npm run typecheck && npm run lint && npm run build
docker run -d --rm --name velo-w1-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=velo -p 127.0.0.1:55432:5432 postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
until docker exec velo-w1-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
DATABASE_URL=postgres://postgres@127.0.0.1:55432/velo npm run db:migrate
DATABASE_URL=postgres://postgres@127.0.0.1:55432/velo npm run db:migrate
VELO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/velo CI=true npm run test:http
docker stop velo-w1-pg
```
Expected:
- `npm audit signatures` prints `… packages have verified registry signatures`, exit 0;
- the second migrate prints `[migrate] up to date.`;
- `test:http` passes with `ℹ skipped 0`.

- [ ] **Step 6: Commit.**
```bash
git add .github/workflows/ci.yml scripts/workflow-policy.test.mjs
git commit -m "ci: add required CI workflow with pinned actions and Postgres-backed HTTP tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Dependabot, CodeQL, dependency review, Scorecard, CODEOWNERS

**Executor:** velo-impl-sonnet-high
**Covers:** GH-08 (files), GH-09, GH-12 (Scorecard part), GH-06 (Dependabot keeps pins current), M-19 (part)

**Files:** Create `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `.github/workflows/dependency-review.yml`, `.github/workflows/scorecard.yml`, `.github/CODEOWNERS`. Modify `scripts/workflow-policy.test.mjs` (append 1 test).

**Interfaces:**
- Produces check names `analyze (javascript-typescript)`, `analyze (actions)`, `dependency-review` (for the ruleset).
- Dependabot has `npm` and `github-actions`, and **not `pip`**: W5 adds it together with `requirements.txt`.
- Dependabot also applies `ignore` to security updates. The extraction family is covered weekly by `auto-update.yml` instead.

- [ ] **Step 1: Verify anchors.** Run: `ls .github .github/workflows`
Expected: `.github` holds only `workflows`, and `workflows` holds `auto-update.yml` and `ci.yml`. Otherwise STOP.

- [ ] **Step 2: Write the failing test.** Append to the end of `scripts/workflow-policy.test.mjs`:
```js

test("scanning workflows, Dependabot and CODEOWNERS are in place and agree with auto-update", () => {
  for (const name of ["codeql.yml", "dependency-review.yml", "scorecard.yml"]) {
    assert.ok(workflows.some((w) => w.name === name), `${name} is missing`);
  }
  const dependabot = readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  // auto-update.yml owns exactly the packages Dependabot ignores, so no package has two updaters.
  const auto = workflows.find((w) => w.name === "auto-update.yml").text;
  for (const pkg of auto.match(/--only=([\w.,@/-]+)/)[1].split(",")) {
    assert.match(dependabot, new RegExp(`dependency-name: ${pkg.replace(/\./g, "\\.")}(\\s|$)`), pkg);
  }
  const owners = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8");
  assert.match(owners, /^\/\.github\/\s+@EgerDev$/m);
});
```
Run: `node --test scripts/workflow-policy.test.mjs`
Expected: 1 failure, `codeql.yml is missing`.

- [ ] **Step 3: Create `.github/dependabot.yml`:**
```yaml
# Dependency updates. The extraction family (youtubei.js, bgutils-js, jsdom,
# undici, socks-proxy-agent) is refreshed weekly by auto-update.yml with a
# rollback verifier, so it is ignored here. Dependabot also honours these
# ignores for security updates: auto-update covers them within a week.
# pip (yt-dlp) is added by W5 together with requirements.txt.
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "06:00"
      timezone: Etc/UTC
    cooldown:
      default-days: 3
      semver-major-days: 14
    open-pull-requests-limit: 10
    groups:
      tanstack:
        patterns: ["@tanstack/*"]
      radix:
        patterns: ["@radix-ui/*"]
      dev-tooling:
        dependency-type: development
        update-types: [minor, patch]
    ignore:
      - dependency-name: youtubei.js
      - dependency-name: bgutils-js
      - dependency-name: jsdom
      - dependency-name: undici
      - dependency-name: socks-proxy-agent
      - dependency-name: nitro # exact-pinned beta; W4a owns the upgrade
      - dependency-name: jose # exact-pinned on purpose
      - dependency-name: nf3 # pinned through package.json overrides

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 3
    groups:
      actions:
        patterns: ["*"]
```

- [ ] **Step 4: Create `.github/workflows/codeql.yml`:**
```yaml
name: codeql

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "17 4 * * 3"

permissions: {}

jobs:
  analyze:
    name: analyze (${{ matrix.language }})
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      security-events: write
      actions: read
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, actions]
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: github/codeql-action/init@1c5b675653bb5c22dbe9b12b556ec555138e09fd # v4.38.1
        with:
          languages: ${{ matrix.language }}
          build-mode: none
          queries: security-extended
      - uses: github/codeql-action/analyze@1c5b675653bb5c22dbe9b12b556ec555138e09fd # v4.38.1
        with:
          category: /language:${{ matrix.language }}
```

- [ ] **Step 5: Create `.github/workflows/dependency-review.yml`:**
```yaml
name: dependency-review

on: pull_request

permissions: {}

jobs:
  dependency-review:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write # summary comment on failure
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          fail-on-severity: moderate
          comment-summary-in-pr: on-failure
          # The license policy is a legal decision (W9); GPL @ffmpeg/core is in the tree today (W7).
          deny-licenses: AGPL-3.0-only, AGPL-3.0-or-later
```

- [ ] **Step 6: Create `.github/workflows/scorecard.yml`:**
```yaml
name: scorecard

on:
  branch_protection_rule:
  schedule:
    - cron: "30 5 * * 2"
  push:
    branches: [main]

permissions: {}

jobs:
  analysis:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: read
      actions: read
      security-events: write
      id-token: write # publish_results
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc # v2.4.4
        with:
          results_file: results.sarif
          results_format: sarif
          publish_results: true
      - uses: github/codeql-action/upload-sarif@1c5b675653bb5c22dbe9b12b556ec555138e09fd # v4.38.1
        with:
          sarif_file: results.sarif
```

- [ ] **Step 7: Create `.github/CODEOWNERS`:**
```
# Review is required from the owner on everything (enforced by the main ruleset
# once require_code_owner_review is on). The explicit lines keep the
# security-critical paths owned even if the catch-all is narrowed later.
*                                   @EgerDev
/.github/                           @EgerDev
/package.json                       @EgerDev
/package-lock.json                  @EgerDev
/eslint.config.mjs                  @EgerDev
/vite.config.ts                     @EgerDev
/migrations/                        @EgerDev
/scripts/auto-update*.mjs           @EgerDev
/scripts/migrate.mjs                @EgerDev
/src/lib/auth/                      @EgerDev
/src/lib/http/                      @EgerDev
/src/lib/sandbox/                   @EgerDev
/src/lib/log.server.ts              @EgerDev
/src/lib/env.server.ts              @EgerDev
/src/lib/guest-limit.server.ts      @EgerDev
/src/lib/operator-gate.server.ts    @EgerDev
/src/lib/vault*                     @EgerDev
/src/routes/api/                    @EgerDev
/extension/                         @EgerDev
/extensions/                        @EgerDev
/packages/extension/                @EgerDev
```

- [ ] **Step 8: Verify.** Run:
```bash
node --test scripts/workflow-policy.test.mjs
node -e 'const y=require("yaml"),fs=require("fs");for(const f of ["dependabot.yml","workflows/codeql.yml","workflows/dependency-review.yml","workflows/scorecard.yml"])y.parse(fs.readFileSync(".github/"+f,"utf8"));console.log("yaml ok")'
grep -nE 'uses: [^@]+@(v[0-9]|main|master)' .github/workflows/*.yml || echo "all pinned"
npm run lint && npm test
```
Expected: all policy tests pass, `yaml ok`, `all pinned`, and lint and tests are green.

- [ ] **Step 9: Commit.**
```bash
git add .github scripts/workflow-policy.test.mjs
git commit -m "ci: add Dependabot, CodeQL, dependency review, Scorecard and CODEOWNERS

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: [OWNER] Repository settings, rulesets, deps bot, commit signing

**Executor:** repository owner (agents do not run these; they hand this text over)
**Covers:** GH-02, GH-06 (Actions settings), GH-08 (security settings), GH-11, M-19 (settings part), GH-05 (App token)

Run these after W1's PR has run CI **once**, so the check names exist, and before merging anything else. Every command is idempotent or states how to update in place.

- [ ] **Step 1 (GH-06): Actions policy.**
```bash
gh api -X PUT repos/EgerDev/velo/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api -X PUT repos/EgerDev/velo/actions/permissions/selected-actions --input - <<'EOF'
{ "github_owned_allowed": true, "verified_allowed": false,
  "patterns_allowed": ["peter-evans/create-pull-request@*", "ossf/scorecard-action@*", "step-security/harden-runner@*"] }
EOF
gh api -X PUT repos/EgerDev/velo/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```
Verify: `gh api repos/EgerDev/velo/actions/permissions` → `"allowed_actions":"selected"`, `"sha_pinning_required":true`.

- [ ] **Step 2 (GH-08): Security features and repo hygiene.**
```bash
gh api -X PUT repos/EgerDev/velo/vulnerability-alerts
gh api -X PUT repos/EgerDev/velo/automated-security-fixes
gh api -X PUT repos/EgerDev/velo/private-vulnerability-reporting
gh api -X PATCH repos/EgerDev/velo --input - <<'EOF'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "secret_scanning_non_provider_patterns": { "status": "enabled" },
    "secret_scanning_validity_checks": { "status": "enabled" } },
  "delete_branch_on_merge": true, "has_wiki": false,
  "allow_merge_commit": false, "allow_squash_merge": true, "allow_rebase_merge": true }
EOF
```
Verify: `gh api repos/EgerDev/velo/private-vulnerability-reporting` → `{"enabled":true}`, and `gh api repos/EgerDev/velo --jq .security_and_analysis` shows every entry `enabled`.

- [ ] **Step 3 (GH-02): Rulesets.**
  - First list the existing rulesets: `gh api repos/EgerDev/velo/rulesets --jq '.[] | "\(.id) \(.name)"'`.
  - If W0-T6 created a ruleset for `main`, update it with `-X PUT repos/EgerDev/velo/rulesets/<id>` instead of `-X POST repos/EgerDev/velo/rulesets`, using the same body.
  - The approval count is **0** because you are the only maintainer and GitHub never lets an author approve their own PR. Required status checks, a PR for every change, no force-push/deletion and linear history still apply to everyone, including admins, with no bypass.
  - When a second maintainer joins, raise the count to `1` and set `require_code_owner_review: true`.
  - `integration_id: 15368` (GitHub Actions) stops another app from posting a fake green status under the same name.
```bash
gh api -X POST repos/EgerDev/velo/rulesets --input - <<'EOF'
{ "name": "protect-main", "target": "branch", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false, "require_last_push_approval": false,
        "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "verify", "integration_id": 15368 },
          { "context": "unit (ubuntu-24.04)", "integration_id": 15368 },
          { "context": "unit (windows-2025)", "integration_id": 15368 },
          { "context": "analyze (javascript-typescript)", "integration_id": 15368 },
          { "context": "analyze (actions)", "integration_id": 15368 },
          { "context": "dependency-review", "integration_id": 15368 } ] } } ],
  "bypass_actors": [] }
EOF
gh api -X POST repos/EgerDev/velo/rulesets --input - <<'EOF'
{ "name": "protect-release-tags", "target": "tag", "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ],
  "bypass_actors": [] }
EOF
```
Verify:
- `gh api repos/EgerDev/velo/rulesets --jq '.[].name'` lists both rulesets;
- in a throwaway clone, `git push --force origin HEAD~1:main` is rejected with `GH013`;
- a PR with a deliberate `tsc` error shows `verify` red and cannot merge.

- [ ] **Step 4 (GH-05): Deps bot App for `auto-update.yml`'s `open-pr` job.**
  1. Create the App: GitHub → Settings → Developer settings → GitHub Apps → New.
     - Name: `velo-deps-bot`. Homepage: `https://github.com/EgerDev/velo`. Webhook: off.
     - Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**, Metadata: Read.
     - "Only on this account".
  2. Create the App, **Generate a private key**, and note the **Client ID**.
  3. Install the App on **EgerDev/velo only**.
  4. Store the credentials, then delete the local `.pem`:
```bash
gh variable set DEPS_BOT_CLIENT_ID -R EgerDev/velo --body "<Client ID>"
gh secret set DEPS_BOT_PRIVATE_KEY -R EgerDev/velo < ./velo-deps-bot.<date>.private-key.pem
```
Verify: `gh workflow run auto-update.yml -R EgerDev/velo && gh run watch -R EgerDev/velo` is green. When a newer extraction library exists, PR `auto-update/dependencies` opens with the `ci` checks attached. Without it, `open-pr` stays skipped by design.

- [ ] **Step 5 (GH-11): Commit and tag signing.**
  - From now on: a noreply author email, SSH-signed commits and **signed annotated release tags**. History is not rewritten.
  - Agent worktrees inherit this global config, so load the key into ssh-agent before resuming agent work, or commits will prompt or fail.
```bash
git config --global user.email "285544328+EgerDev@users.noreply.github.com"
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title "velo signing"
```
  - Once your next commit shows **Verified** on GitHub, add `{ "type": "required_signatures" }` to `protect-main`: PUT the Step 3 body with that rule appended. Squash and rebase merges made on GitHub are signed by GitHub, so the rule does not block PR merges.
  - Verify: `git log --show-signature -1` shows a good signature, and after W7's first release, `git tag -v v0.1.0` passes.

---

## Audit coverage

| Audit ID | Resolution |
|---|---|
| GH-02 | Task 10 Step 3 (rulesets, prepared); required check names produced by Tasks 8–9 |
| GH-03 | Task 7 (read-only update job, `persist-credentials: false`, no lifecycle scripts, App-token PR job that runs no package code, policy test) |
| GH-04 | Task 8 (`ci.yml`), Task 10 Step 3 (required) |
| GH-05 | Task 7 (App token path, failure issue, correct PR body), Task 10 Step 4 |
| GH-06 | Tasks 7–9 (all SHAs re-verified 2026-09-23; policy test forbids tags), Task 9 (Dependabot `github-actions`), Task 10 Step 1 (allowlist + SHA pinning required) |
| GH-07 | Task 7 (no pip in workflows; policy test bans unpinned `pip install`). Pinning yt-dlp with hashes: **DEFERRED — W5** (`requirements.txt`, image install) |
| GH-08 | Task 9 (Dependabot, CodeQL, dependency review), Task 10 Step 2 (alerts, security updates, PVR, non-provider patterns, validity checks). `SECURITY.md`: **Hand-off W7** (OSS-05) |
| GH-09 | Task 9 (CODEOWNERS); `require_code_owner_review` enabled when a second maintainer exists (Task 10 Step 3 note) |
| GH-10 | Tasks 7–9 (`timeout-minutes`, `concurrency`, `ubuntu-24.04`/`windows-2025`, harden-runner audit on the untrusted job; policy test) |
| GH-11 | Task 10 Step 5 (signing setup, tag signing, `required_signatures`); policy text for CONTRIBUTING/RELEASING: **Hand-off W7** |
| GH-12 | Task 9 (Scorecard). Attestations, SBOM, checksums, signed image: **DEFERRED — W7** release pipeline (SHAs verified for it in Hand-off) |
| TEST-01 | Task 8 |
| TEST-05 | Task 6 |
| TEST-07 | Tasks 2A, 2B, 2C, 2D, 3 |
| TEST-08 | Task 4 (harness). E2E: **DEFERRED — W8**. Extension tests: **DEFERRED — W6** |
| TEST-10 | **DEFERRED — W2**: `check:auth` guards a Grok-sandbox invariant (`/__app-env`), and W2 deletes the script, its test and the app-env plugin with the Grok scaffolding. W1 does not wire it into CI |
| TEST-11 | Task 7 (`verifySteps` incl. `build`, test) |
| TEST-12 | **DEFERRED — W2**: the code under test (`gate-identity`/`gate-session`) is Grok gate code that W2 deletes; its replacement lands with its own tests |
| TEST-13 | **DEFERRED — W2** (Grok connectors `app-data.test.ts` deleted with the template) and **W4b** (`ipv4-bind.test.ts` global `NODE_TLS_REJECT_UNAUTHORIZED` goes when W4b removes the ipv4 global patch) |
| TEST-14 | Task 6 Step 8 |
| TEST-15 | Task 8 (`verify`: migrate twice against Postgres 16.15). The PGLite-vs-Postgres schema diff is not added (YAGNI; add it if a dialect drift ever ships) |
| TEST-16 | **DEFERRED — W4a**: needs a `killTree` change (`taskkill /T` on win32, subprocess code). W1's `unit (windows-2025)` job then runs the un-skipped test |
| TEST-17 | Task 8 (hermetic suite on Linux + Windows); Task 4 (offline, ephemeral-port HTTP tests) |
| TEST-18 | **DEFERRED — W4a** (fix: `isRelayTarget` requires `url.port === ""`). W4a adds `https://www.youtube.com:8443/` to `tests/http/api-guards.test.mjs` and a unit case |
| OPS-09 | Task 8 (+ Task 1: build no longer migrates) |
| SUP-08 | Task 7 (split jobs, pins, `npm_config_ignore_scripts`), Task 8 (`npm ci --ignore-scripts`, `npm audit signatures`) |
| INST-02 | Task 1 (engines, `.nvmrc`), Task 8 (CI uses `.nvmrc`). README "v22.0.0" text: **Hand-off W7** |
| INST-04 | Task 1 (127.0.0.1 default, `VELO_DEV_HOST`/`VELO_DEV_PORT`). Direct wrapper invocation on Windows: **DEFERRED — W2** (deletes `scripts/with-app-env.mjs`). README: **Hand-off W7** |
| INST-10 | **DEFERRED — W4a**: reproduced on the node-server build. Aborted client requests to `/api/download` and `/api/relay` log `Error: aborted … status: 500 … unhandled: true` (6 per 3 aborts; `/` and `/api/health` log nothing). Fix in W4a's error mapping, logging aborts with `log.debug` (C4, Task 5) |
| OSS-13 | Tasks 2A–2D, 3 (0 warnings, `--max-warnings 0`; better than the audit's ratchet) |
| CLEAN-06 | Tasks 2A–2C (all 179 `no-unused-vars`) |
| ARCH-22 | Task 8 (CI). yt-dlp pin: **DEFERRED — W5** |
| REL-10 | **DEFERRED — W7**: under D1 the deployed artifact is the CI-built, attested image (W7 records its digest; W5 deploys by digest), so cross-host rebuild equality is not on the trust path. W7 records `.output` hashes in the release |
| M-19 | Tasks 7, 8, 9, 10 |
| M-29 | Task 1 |
| M-33 | Task 1 (Node pin). Package name: **Hand-off W7**. POSIX-only paths: owned by each file's workstream under the Global Constraint (W4a for server subprocess code) |

## Hand-off

- **W2:**
  - delete the two `W2` `ignores` in `eslint.config.mjs` (`gate-session.server.ts`, `verify.server.ts`);
  - remove `VITE_AUTH_ENABLED: "false"` from `BASE_ENV` in `tests/http/*.test.mjs`;
  - once `loadServerEnv()` requires `DATABASE_URL` in production:
    - flip `health.test.mjs`'s "without a database" block to assert that `startServer` rejects with the `EnvError` exit (spec change, not a weakening);
    - make `api-guards`/`harness` pass `DATABASE_URL: process.env.VELO_TEST_DATABASE_URL` (CI already provides it);
  - delete `check:auth`, `scripts/check-auth-invariant.mjs` and its test (TEST-10), the gate-identity code and tests (TEST-12), the connector tests (TEST-13), and `scripts/with-app-env.mjs` (`dev`/`build` become `vite dev`/`vite build`; INST-04);
  - delete `startup.sh`, which starts `npm run dev` expecting `0.0.0.0`;
  - C1's dev default `VELO_PUBLIC_ORIGIN` must follow `VELO_DEV_PORT` (`http://localhost:${VELO_DEV_PORT ?? 8080}`), or dev on another port fails Better Auth origin checks.
- **W4b:** delete both `eslint-disable-next-line no-restricted-syntax -- W4b …` lines together with the `new Function` code (`po-token.server.ts`, `youtube-client.server.ts`). `reportUnusedDisableDirectives` fails lint if one survives. The sandbox child may use `vm.createContext` and `new vm.Script` (not banned), but never `new Function`/`eval`.
- **W4a:**
  - failing-first HTTP tests on the harness for `/%` → 400 (today the built server throws `URIError: URI malformed` and never answers), cross-site POST → 403, CSP/security headers, and `apiError` bodies;
  - TEST-16 (`killTree` on win32), TEST-18 (relay port), INST-10 (abort logging);
  - remove `nitro` from Dependabot `ignore` after the Nitro upgrade.
- **W5:**
  - the container sets `HOST=0.0.0.0` and `PORT=8080` (node-server defaults to all interfaces on **3000**) and runs `npm start`;
  - add `requirements.txt` with hashes and a `pip` entry in `.github/dependabot.yml` (with `cooldown: default-days: 1`), then delete the pip branch of `scripts/auto-update.mjs` (GH-07);
  - pin the container base image by digest, as W1 did for the CI Postgres service.
- **W6:** `extension/` got a one-variable lint fix in Task 2A and goes away in W6. CODEOWNERS already lists `/packages/extension/`.
- **W7:**
  - README (Node ≥ 24.15 via `.nvmrc`, `npm ci`, `VELO_DEV_HOST`/`VELO_DEV_PORT`, `npm start` with `PORT`/`HOST`);
  - `docs/architecture.md` §2/§5 (node-server preset, no `pgliteAssetsPlugin`, CI), `SECURITY.md`, package rename, bump `@types/node` to `^24`;
  - CONTRIBUTING/RELEASING signing policy. Suggested text: "Release tags `v*` are SSH-signed annotated tags created by the maintainer and protected by the `protect-release-tags` ruleset. `main` only receives squash or rebase merges of reviewed PRs with green `ci`, `codeql` and `dependency-review`. Contributors are encouraged, not required, to sign commits.";
  - release workflow with `actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2` and `anchore/sbom-action@3ad7283483fc7af8ff2b4ea19663c2d5ca935e26 # v0.24.2` (both re-verified 2026-09-23), checksums and signed image (GH-12, REL-10).
- **W8:** add the `test:e2e` script (Contract change request 1) and an `e2e` job to `.github/workflows/ci.yml`, keeping `permissions: {}`, pinned actions, `persist-credentials: false` and `timeout-minutes`. `scripts/workflow-policy.test.mjs` enforces those.
- **Files W1 touches outside its ownership list** (all minimal, listed so the reviewer can diff them):
  - `.gitignore` (+`.output/`) and `.gitattributes` (+2 binary lines);
  - `scripts/auto-update.mjs` and `scripts/auto-update-plan.mjs` (TEST-11);
  - `src/lib/ytdlp-meta.server.ts` (1 log call + import);
  - `src/lib/po-token.server.ts` and `src/lib/youtube-client.server.ts` (+1 comment each);
  - the lint-fix files in Tasks 2A–2D;
  - the TEST-05/TEST-14 test files.

## Self-review

1. **Spec coverage.** Every item in the W1 brief maps to a task:
   - engines/`.nvmrc`/C7 scripts/preset/`pgliteAssetsPlugin`/PORT-HOST → T1;
   - C6 harness + first smoke → T4;
   - C4 + `redact` + tests → T5;
   - all rules `error`, scoped `no-console` (decision: scope plus 2 W2 exemptions plus 1 migrated call, listed exactly), eval ban with the two `W4b` disables listed exactly → T3;
   - 189 warnings with per-file lists → T2A–T2D;
   - TEST-05 with real, asserting fixtures → T6;
   - CI, auto-update, Dependabot, CodeQL, dependency review, Scorecard, CODEOWNERS with re-verified SHAs → T7–T9;
   - ruleset/settings as `[OWNER]` → T10;
   - characterization tests only where they pass today → T4, T6 Step 8, with failing ones handed off.

   Every owned audit ID appears in the coverage table.
2. **Placeholder scan.** No TBD/TODO/"similar to". The one `<…>` placeholders are owner-supplied values (App Client ID, key file name, ruleset id) and the residue list in T2D's commit body, which is filled from Step 5's output.
3. **Type consistency.**
   - `startServer({ env }) → { baseUrl, stop, logs }` matches C6;
   - `log`/`redact`/`LogFields` match C4 exactly;
   - `verifySteps({ skipTests })` is defined in T7 and used only there;
   - the fixture loader names `hlsTsFixture`/`dashCmafFixture` are consistent across the four test files;
   - the check names in T10 match the job names in T8/T9.
4. **Review Focus.** Each of the five lines has a test in its owning task (T5, T4 ×3, T7). Line 3 is exercised on Windows by the executor (T4 Step 6) and on Linux by CI.
5. **Verified by experiment** (scratch copy, 2026-09-23):
   - the node-server build serves `/` 200 and `/api/health` 503 without a DB and 200 with PG16;
   - the harness and all 20 HTTP tests pass; the policy, contract and log tests pass;
   - the rewritten parser tests pass against the generated fixtures;
   - after all lint edits, `eslint . --max-warnings 0` and `tsc` are clean and `npm test` passes (212 + 541 tests, 0 failures);
   - `npm audit signatures` passes;
   - dev on `VELO_DEV_PORT=8097` listens on `127.0.0.1` only.
