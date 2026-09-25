# 09 — Clean-install / new-contributor audit (prefix INST-)

Auditor: `qa`. Date: 2026-09-23. Audit only: nothing in the repo was changed. Every build ran in a scratch clone; no build ran in `C:\Users\PC\orca\velo`.

## Scope and method

I followed a new contributor's path exactly as the README describes it:

1. `git clone C:\Users\PC\orca\velo <scratchpad>\qa\clone` gives committed **HEAD `81cbd95`** only.
2. In the clone: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, then a dev server on **port 8095** (8080/8081 belong to another agent), then `browser-smoke.mjs` against it.
3. Applied the to-be-shipped working tree onto the clone: `git -C velo diff --binary > wt.patch`, `git apply`, and copied the 3 untracked source files. Re-ran test, typecheck, lint and build.
4. Linux: copied the working-tree state into Docker `node:22.18-bookworm` and ran `npm ci`, `npm test` (online and `--network none`), `tsc` and `npm run build`, plus `sh -n startup.sh`.
5. Real Postgres: Docker `postgres:16-alpine` on 127.0.0.1:55439, then ran `scripts/migrate.mjs` twice and booted the dev server with `DATABASE_URL` set.

Every process and container I started was stopped: the dev servers on 8095 and the `qa-velo-pg` container. Port 8095 was later taken by an unrelated agent's server (`orca-cutout`), which I did not touch.

Host: Windows 11 Pro 10.0.26200, Node v25.2.1, npm 11.6.2, Python 3.11.9 (`python3` resolves to `…\WindowsApps\python3`), yt-dlp 2026.06.09, ffmpeg (chocolatey), curl (mingw64), Docker 29.5.2. Playwright browsers were **already** installed under `%LOCALAPPDATA%\ms-playwright`, so a truly fresh machine was not simulated for Chromium.

### Results

| Step | State | Command | Duration | Result |
|---|---|---|---|---|
| clone | HEAD | `git clone` | <5 s | OK. The clone contains `.node_modules.lock` (empty, committed) and `startup.sh` (POSIX sh). No `.grok/`, no `.nvmrc`, no `engines`. |
| install | HEAD | `npm ci` | **22 s** | exit 0. 614 packages, `found 0 vulnerabilities`. **4× EBADENGINE** (jsdom 30.1.1, @asamuzakjp/css-color, @asamuzakjp/dom-selector, w3c-xmlserializer require `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`; current v25.2.1). Deprecated: `recharts@2.15.4`, `eslint@9.39.5`. Only install script in the tree: `fsevents` (optional, macOS). `ignore-scripts=false`, no `.npmrc`. |
| test | HEAD | `npm test` | **37 s** | exit 0. mjs 179/176/3 skipped; TS **514**/513/1 skipped |
| typecheck | HEAD | `npm run typecheck` | 7 s | exit 0 |
| build | HEAD | `npm run build` | **26 s** | exit 0. `.vercel/output` 68 MB (functions 34 MB, static 35 MB incl. a 32 MB `ffmpeg-core-*.wasm`). "Some chunks are larger than 500 kB" (mux-client 567 kB), 56× "module level directive may not be preserved". `db:migrate` → `[migrate] DATABASE_URL not set — skipping`. |
| dev | HEAD | `node scripts/with-app-env.mjs vite dev --host 127.0.0.1 --port 8095` | ready 3.1 s | Without `node_modules/.bin` on PATH it fails on Windows: `'vite' is not recognized…` (INST-04). With PATH set: `GET /` 200 (17 KB), `/api/health` 200 (`pglite`). |
| smoke | HEAD | `node scripts/browser-smoke.mjs http://127.0.0.1:8095/ screenshots/smoke.png` | 4 s | exit 0. Both viewports show content, no console errors. Brand note points to a non-existent `\workspace\.grok\…` path. |
| install + test | **working tree** | `npm test` | 32 s | exit 0. mjs 179/176/3; TS **535**/534/1 (+21 tests over HEAD) |
| gates | **working tree** | typecheck / lint / build | 10 s / 20 s / 7 s (warm) | all exit 0. Lint 189 warnings. |
| Linux | working tree | Docker node:22.18: `npm ci` / `npm test` / `tsc` / `npm run build` | ~60 s + 22 s | all exit 0. TS **535/535, 0 skipped**; 4× EBADENGINE on 22.18. `sh -n startup.sh` OK. |
| Linux offline | working tree | `docker run --network none … npm test` | — | exit 0, identical counts (hermetic) |
| Postgres | working tree | `DATABASE_URL=… node scripts/migrate.mjs` ×2 | <5 s | 5 applied, then "up to date". The dev server with `DATABASE_URL` set: `/api/health` → `source:"neon", ok:true`. |
| port override | working tree | `npm run dev -- --port 8095 --host 127.0.0.1` | — | The last flag wins (`vite dev --host 0.0.0.0 --port 8080 --port 8095 --host 127.0.0.1`). It failed only because an unrelated server had taken 8095 (`strictPort`). The override mechanism works. |

### Platform support

| Platform | Status |
|---|---|
| Windows 11 + Node 25.2.1 | Tested. Install, test, typecheck, build and dev work (with EBADENGINE warnings). `startup.sh` is not runnable from cmd/PowerShell. |
| Linux (Debian bookworm, Node 22.18, Docker) | Tested: install, test (incl. the POSIX process-group test), typecheck, build, and `sh -n startup.sh`. Dev server and yt-dlp not run on Linux. |
| macOS | **NOT VERIFIED** (inspection only; `fsevents` is the only native optional dep) |

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| INST-01 | P1 | A fresh clone runs with sign-in ON through the committed shared preview OAuth client, contradicting docs and code comments | Both |
| INST-02 | P2 | Node version support is undocumented or wrong (README "v22.0.0+", no `engines`/`.nvmrc`; deps need ^22.22.2 / ^24.15 / ≥26; test runner needs ≥22.6) | OSS release |
| INST-03 | P2 | The state to be shipped is uncommitted: HEAD differs from the working tree by 27 modified + 3 untracked files (and CRLF in 15 of them) | Both |
| INST-04 | P2 | Dev server hard-coded to `0.0.0.0:8080` + `strictPort`; override undocumented; direct wrapper invocation breaks on Windows | OSS release |
| INST-05 | P2 | `npm run build` silently skips migrations without `DATABASE_URL`, and the app then runs on per-process in-memory PGLite | Website launch |
| INST-06 | P2 | External runtime dependencies and required env vars are not documented (python3/yt-dlp/ffmpeg/curl, Playwright browsers, DATABASE_URL, VELO_VAULT_KEY, BETTER_AUTH_SECRET) | OSS release |
| INST-07 | P3 | Grok-sandbox scaffolding confuses contributors: `startup.sh` (/tmp, 8080), AGENTS.md, `/workspace` paths, brand notes | OSS release |
| INST-08 | P3 | Deprecated dev/runtime deps at install (`eslint@9.39.5` EOL, `recharts@2`) | Neither |
| INST-09 | P3 | Build output is heavy (68 MB; a 32 MB wasm is static; 500 kB+ chunks) and noisy (56 directive warnings) | Neither |
| INST-10 | P3 | Dev server prints unhandled `Error: aborted … status 500` stack traces on every client abort | Neither |
| INST-11 | P3 | Stray committed `.node_modules.lock` | Neither |
| INST-12 | P3 | `/api/health` labels any Postgres as `"neon"` | Neither |

---

### INST-01 — A fresh clone runs with sign-in ON through the committed shared preview OAuth client, contradicting docs and code comments
- **Severity:** P1
- **Category:** Configuration defaults / auth
- **Blocks:** Both
- **Affected files:** `.gitignore` (`.grok/`), `scripts/with-app-env.mjs:28,55-60`, `src/lib/auth/client.ts:9`, `src/lib/auth/server.ts:23,73-80`, `src/lib/auth/preview.ts`
- **Description:** The auth flag is meant to come from `.grok/app-env.json`, which is gitignored, so it is absent in every clone. `readAppEnv` returns `{}` when the file is missing. `VITE_AUTH_ENABLED` is then undefined, and both sides treat anything other than `"false"` as ON:
  - client: `authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false"`
  - server: `authDisabled = env("VITE_AUTH_ENABLED") === "false"`

  The code comment in `server.ts:23` says "Off (`VITE_AUTH_ENABLED=false`, the shipped default)". The skipped test "the template ships auth off" (TEST-09) encodes the same belief. With `GROK_AUTH_CLIENT_ID/SECRET` unset, the server then falls back to the hard-coded shared "grok_preview" broker client (see 02/03 reports; secret not reproduced here).
- **Evidence:** In the clean clone's dev server: `curl http://127.0.0.1:8095/__app-env` → `{"BASE_URL":"/","MODE":"development","DEV":true,"PROD":false}` (no `VITE_AUTH_ENABLED`). The rendered page body starts `Skip to download Velo No session History Guide…`, i.e. the auth UI is active. `ls .grok` in the clone → `No such file or directory`.
- **Real-world consequence:** Every contributor and self-hoster silently runs federated sign-in against xAI's broker with a shared client credential. That credential is not theirs, may stop working at any time, and couples an OSS project to a third party's OAuth client. It also contradicts the documented default.
- **Recommended fix:** Default to OFF when unset (`=== "true"` to enable), or commit a non-secret `app-env.example.json` and have `with-app-env.mjs` fall back to it. Remove the preview-secret fallback (see the security reports). Document auth setup.
- **Verification procedure:** In a fresh clone, `npm run dev` → `/__app-env` shows `VITE_AUTH_ENABLED:"false"` (or auth UI absent), and grepping the server bundle finds no preview client fallback.
- **Status:** CONFIRMED

### INST-02 — Node version support is undocumented or wrong (README "v22.0.0+", no `engines`/`.nvmrc`; deps need ^22.22.2 / ^24.15 / ≥26; test runner needs ≥22.6)
- **Severity:** P2
- **Category:** Toolchain requirements
- **Blocks:** OSS release
- **Affected files:** `README.md:125` ("Node.js: v22.0.0 or later"), `package.json` (no `engines`), `scripts/run-ts-tests.mjs:47-50` (`--experimental-strip-types`), `.github/workflows/auto-update.yml:31` (`node-version: 22`); the build log says `[nitro:vercel] Using nodejs24.x runtime`
- **Description:** Four facts conflict:
  1. The README says Node 22.0.0+.
  2. `jsdom@30` and three transitive deps declare `^22.22.2 || ^24.15.0 || >=26.0.0`, and `npm ci` warns (EBADENGINE) on both 22.18.0 and 25.2.1.
  3. The TS test runner depends on `--experimental-strip-types`, which does not exist before Node 22.6.
  4. Vercel builds use Node 24 while CI uses 22 and this host uses 25 (an odd-numbered, non-LTS release).

  There is no `engines` field and no `.nvmrc`/`.node-version`, so nothing enforces a version.
- **Evidence:** `npm ci` → `npm warn EBADENGINE … package: 'jsdom@30.1.1', required: { node: '^22.22.2 || ^24.15.0 || >=26.0.0' }, current: { node: 'v25.2.1' }` (same on v22.18.0 in Docker). Tests still passed on both, so the warnings are not fatal today. Node < 22.6 was NOT run; the claim rests on Node's changelog for `--experimental-strip-types`.
- **Real-world consequence:** Contributors on 22.0–22.5 cannot run tests. Contributors on 22.6–22.22.1 or 25.x run an unsupported jsdom (transcript/HTML parsing) and may hit subtle breakage.
- **Recommended fix:** Add `"engines": { "node": ">=22.22.2 <23 || >=24.15.0" }` (or just `24.x` to match Vercel), add `.nvmrc` with `24`, update the README, and set CI `node-version` to match.
- **Verification procedure:** `npm ci` with `engine-strict=true` on the documented version produces no EBADENGINE.
- **Status:** CONFIRMED (Node < 22.6 behaviour NOT VERIFIED by execution)

### INST-03 — The state to be shipped is uncommitted: HEAD differs from the working tree by 27 modified + 3 untracked files (and CRLF in 15 of them)
- **Severity:** P2
- **Category:** Release hygiene
- **Blocks:** Both
- **Affected files:** 27 files under `src/components/*` and `src/lib/*` (`git diff --stat`: `27 files changed, 503 insertions(+), 227 deletions(-)`), plus untracked `src/lib/transfer-progress.ts`, `src/lib/hybrid-progress.test.ts`, `src/lib/tracking-accuracy.test.ts`
- **Description:** A clone gets HEAD `81cbd95`, not what has been tested locally. Both states pass every gate: HEAD 514 TS tests, working tree 535. But the working tree adds a new module (`transfer-progress.ts`) that modified files import, so a partial commit (modified files without the untracked ones) would break typecheck and build. `git diff` also warns that 15 working-tree files have CRLF line endings. `.gitattributes` (`* text=auto eol=lf`) normalizes them on commit, so this is only noise, but it shows an editor misconfiguration.
- **Evidence:** In the clone after `git apply wt.patch` plus copying the untracked files: `npm test` → `ℹ tests 535 … ℹ pass 534 … ℹ skipped 1`; typecheck, lint and build exit 0. At HEAD: `ℹ tests 514 … pass 513`. `git diff` prints `warning: in the working copy of 'src/components/app-header.tsx', CRLF will be replaced by LF…` (15 files).
- **Real-world consequence:** Tagging or deploying from HEAD ships a different product from the one audited and tested. The risk is a half-commit.
- **Recommended fix:** Commit the working tree, including all 3 untracked files, as one reviewed commit. Then have CI (TEST-01) verify the exact commit that gets tagged.
- **Verification procedure:** `git status --porcelain` is empty at the release tag, and CI is green on that SHA.
- **Status:** CONFIRMED

### INST-04 — Dev server hard-coded to `0.0.0.0:8080` + `strictPort`; override undocumented; direct wrapper invocation breaks on Windows
- **Severity:** P2
- **Category:** Developer experience / local exposure
- **Blocks:** OSS release
- **Affected files:** `package.json:12` (`vite dev --host 0.0.0.0 --port 8080`), `vite.config.ts:178-191` (`port: 8080, strictPort: true`, preview `8081`), `scripts/with-app-env.mjs:114-120`
- **Description:**
  - **Port 8080 is fixed.** The config comment says "don't change host/port". With `strictPort`, a busy 8080 makes `npm run dev` exit instead of picking another port. `npm run dev -- --port N --host 127.0.0.1` does work because the last CLI flag wins, but nothing documents it.
  - **LAN exposure.** The default `--host 0.0.0.0` exposes the dev server to the whole LAN, including dev-only middleware (`/__app-env`, the `/auth/popup` handler), the Tools tab, and the `npm`/`pip` installer that is operator-gated by socket IP when auth is off.
  - **Windows breakage.** Running the wrapper directly (`node scripts/with-app-env.mjs vite dev …`), as the scripts' own docs suggest, fails on Windows unless `node_modules/.bin` is on PATH.
- **Evidence:**
  - Direct run: `'vite' is not recognized as an internal or external command`.
  - With the flag override: `> node scripts/with-app-env.mjs vite dev --host 0.0.0.0 --port 8080 --port 8095 --host 127.0.0.1` → `Error: Port 8095 is already in use`. Vite honoured 8095; the port had been taken by an unrelated process in the meantime.
- **Real-world consequence:** Contributors with anything on 8080 are blocked. On a shared network (cafés, offices), the dev instance is reachable by others.
- **Recommended fix:** Default to `--host 127.0.0.1`, and read the port from `PORT` with 8080 as the fallback. Drop `strictPort` outside the Grok sandbox, and document the override in the README.
- **Verification procedure:** `PORT=3000 npm run dev` serves on 127.0.0.1:3000 only (`Get-NetTCPConnection -LocalPort 3000` shows LocalAddress 127.0.0.1).
- **Status:** CONFIRMED

### INST-05 — `npm run build` silently skips migrations without `DATABASE_URL`, and the app then runs on per-process in-memory PGLite
- **Severity:** P2
- **Category:** Deploy safety / persistence
- **Blocks:** Website launch
- **Affected files:** `package.json:13`, `scripts/migrate.mjs:21-27`, `src/lib/db.ts:117-121`, `src/routes/api/health.ts`
- **Description:** The build always succeeds without `DATABASE_URL` (`[migrate] DATABASE_URL not set — skipping`, exit 0). At runtime `db.ts` then creates "one in-memory instance per process". On Vercel that means every function instance (and every cold start) gets a fresh empty database: users, sessions, the cookie vault and saved proxies all vanish without warning, and different instances see different data. `/api/health` reports `ok:true` with `source:"pglite"`. No production guard exists; nothing warns or fails the build when the build target is `vercel`.
- **Evidence:** Clean-clone build log tail: `[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).` (exit 0). Dev health: `{"status":"ok",…,"checks":{"database":{"source":"pglite","ok":true,"latencyMs":1}}}`. `db.ts:117`: "One in-memory instance per process".
- **Real-world consequence:** A misconfigured production deploy looks healthy while silently losing all user data. It also skews the per-instance quota and auth state.
- **Recommended fix:** When `VERCEL_ENV=production` (or `NODE_ENV=production` at runtime) and there is no `DATABASE_URL`, fail the build (`migrate.mjs` exit 1) and refuse PGLite at runtime. Make `/api/health` return 503 when it detects PGLite in production.
- **Verification procedure:** `VERCEL_ENV=production npm run build` without `DATABASE_URL` exits non-zero.
- **Status:** CONFIRMED (behaviour on actual Vercel NOT VERIFIED)

### INST-06 — External runtime dependencies and required env vars are not documented (python3/yt-dlp/ffmpeg/curl, Playwright browsers, DATABASE_URL, VELO_VAULT_KEY, BETTER_AUTH_SECRET)
- **Severity:** P2
- **Category:** Documentation / undocumented assumptions
- **Blocks:** OSS release
- **Affected files:** `README.md:122-175`, `src/lib/ytdlp-auth.ts:896-901` (default `python3`), `src/lib/socks-pool.server.ts:127` (spawns `curl`), `scripts/browser-smoke.mjs:4` (Playwright Chromium)
- **Description:** What the README covers and what it leaves out:
  - **Documented:** Python, yt-dlp and ffmpeg, as "optional", with a good venv / `VELO_PYTHON` section.
  - **`curl`:** the server spawns it for the SOCKS pool, but the README never mentions it.
  - **Playwright browsers:** the README tells contributors to run `node scripts/browser-smoke.mjs` but never mentions `npx playwright install chromium`. This machine already had the browsers; a fresh one fails. That failure is NOT VERIFIED here, but it is standard Playwright behaviour.
  - **Server environment variables:** none appear in the README (`grep -niE "DATABASE_URL|VELO_VAULT_KEY|BETTER_AUTH_SECRET|playwright install|postgres" README.md` → nothing). That covers `DATABASE_URL`, `VELO_VAULT_KEY` (without it cookies are stored in plaintext, per the brief), `BETTER_AUTH_SECRET`, `VELO_ADMIN_EMAILS`, `VELO_ALLOW_TOOL_INSTALL`, `TRUST_CLOUDFLARE` and `GROK_AUTH_*`. There is no `.env.example`, and `.gitignore` excludes `.env*`.
  - **`python3` on Windows:** it often resolves to the Microsoft Store stub (`…\WindowsApps\python3`). Here it happened to be a real 3.11.9. The code's own error message suggests setting `VELO_PYTHON`.
  - **`README.md:125-168`:** says `npm install` where CI uses `npm ci`, and says to open `http://localhost:8080`, which clashes with INST-04.
- **Evidence:** Tool probe on this host found `python3`, `python`, `py`, `yt-dlp`, `ffmpeg` and `curl` present, and `psql` missing. README greps as above.
- **Real-world consequence:** Self-hosters deploy without a vault key (plaintext Google cookies) or without a DB (INST-05). The smoke test fails for contributors. yt-dlp silently falls back to the weaker path.
- **Recommended fix:** Add a "Configuration" table to the README and an `.env.example` with placeholder values only. List `curl` and Playwright installation.
- **Verification procedure:** A fresh VM that follows only the README reaches a working download with an encrypted vault.
- **Status:** CONFIRMED (fresh-machine Playwright failure NOT VERIFIED)

### INST-07 — Grok-sandbox scaffolding confuses contributors: `startup.sh` (/tmp, 8080), AGENTS.md, `/workspace` paths, brand notes
- **Severity:** P3
- **Category:** Repo hygiene / portability
- **Blocks:** OSS release
- **Affected files:** `startup.sh`, `AGENTS.md`, `scripts/brand-check.mjs:29` (`workspaceRoot = "/workspace"`), `scripts/browser-smoke-verdict.mjs:38` (default `/workspace/screenshots/…`), `scripts/preview-thumbnail.mjs:12-14` (`/tmp`), `scripts/check-auth-invariant.mjs`
- **Description:**
  - **`startup.sh`:** `#!/bin/sh` that curls `127.0.0.1:8080` and runs `npm run dev >>/tmp/app-startup.log`. It is valid POSIX (LF endings, guarded by `.gitattributes`; `sh -n` passes in Docker) but cannot run from cmd or PowerShell, and it is meaningless outside the Grok sandbox.
  - **Smoke script:** `browser-smoke.mjs` maps `/workspace/…` onto the cwd, and it prints a "BRAND NOTE" telling the user to follow `\workspace\.grok\skills\og\SKILL.md`, which does not exist.
  - **`AGENTS.md`:** reads as instructions to an AI builder ("You are Grok Build…"), not to contributors.
- **Evidence:** Smoke output: `BRAND NOTE: no custom public/og.jpg — the platform will serve the og.grok.me placeholder… finish the brand-asset pass per \workspace\.grok\skills\og\SKILL.md.`
- **Real-world consequence:** Contributor confusion and noise, and it signals template leftovers to reviewers.
- **Recommended fix:** Remove the Grok-only scripts and files (or move them under `tools/grok/`), and replace them with a CONTRIBUTING.md.
- **Verification procedure:** `grep -rn "/workspace\|grok" scripts/` returns only intentional hits.
- **Status:** CONFIRMED

### INST-08 — Deprecated dev/runtime deps at install (`eslint@9.39.5` EOL, `recharts@2`)
- **Severity:** P3
- **Category:** Dependencies
- **Blocks:** Neither
- **Affected files:** `package.json:79,98`, `package-lock.json`
- **Description:** `npm ci` warns:
  - `recharts@2.15.4: 1.x and 2.x branches are no longer active`
  - `eslint@9.39.5: This version is no longer supported`

  `npm audit` reports 0 vulnerabilities. The only package with an install script is the optional `fsevents` (install-script risk is minimal).
- **Evidence:** `npm ci` log: `npm warn deprecated recharts@2.15.4 …`, `npm warn deprecated eslint@9.39.5 …`, `added 614 packages … found 0 vulnerabilities`. `grep -c '"hasInstallScript": true' package-lock.json` → 1 (`node_modules/vite/node_modules/fsevents`).
- **Real-world consequence:** Low. Future security fixes will not reach these lines.
- **Recommended fix:** Plan upgrades to recharts 3 and ESLint 10 (majors, so manual).
- **Verification procedure:** `npm ci` prints no deprecation warnings.
- **Status:** CONFIRMED

### INST-09 — Build output is heavy (68 MB; a 32 MB wasm is static; 500 kB+ chunks) and noisy (56 directive warnings)
- **Severity:** P3
- **Category:** Build
- **Blocks:** Neither
- **Affected files:** `vite.config.ts`, `@ffmpeg/core` usage (`src/lib/audio-encoder.ts`)
- **Description:** `.vercel/output` is 68 MB: `static/assets/ffmpeg-core-*.wasm` 32.2 MB, `mux-client-*.js` 567 kB, `index-*.js` 378 kB. Vite warns that some chunks exceed 500 kB, and it prints 56 "module level directive may not be preserved" warnings. These warnings bury real ones.
- **Evidence:** `ls -S .vercel/output/static/assets | head` → `32232419 ffmpeg-core-CgUfceKH.wasm`, `567451 mux-client-8t42H2Pm.js`; `du -sh .vercel/output` → `68M`.
- **Real-world consequence:** Slow first audio encode for users (the wasm is downloaded on demand; not measured). Noisy logs for contributors.
- **Recommended fix:** Lazy-load the ffmpeg core from a CDN or a separate route. Silence the known directive warnings with `onwarn` filtering so that real warnings stand out.
- **Verification procedure:** The build log has <5 warnings, and the initial JS is below the budget.
- **Status:** CONFIRMED

### INST-10 — Dev server prints unhandled `Error: aborted … status 500` stack traces on every client abort
- **Severity:** P3
- **Category:** Error handling / logs
- **Blocks:** Neither
- **Affected files:** SSR request handling (origin not isolated; seen in the Vite/Nitro dev pipeline)
- **Description:** When a client disconnects mid-request (e.g. my `curl -m 2` readiness probes during startup), the server logs a full `Error: aborted … code: 'ECONNRESET' … status: 500 … unhandled: true` stack. Client aborts are normal events (download cancel, navigation) and should not surface as unhandled 500s.
- **Evidence:** `clone-dev.log`: `Error: aborted at abortIncoming (node:_http_server:847:17) … cause: … code: 'ECONNRESET' … status: 500, … unhandled: true` (repeated).
- **Real-world consequence:** Log noise that can hide real errors. If the same path runs in production, error monitoring gets flooded (NOT VERIFIED in the production build).
- **Recommended fix:** Treat `ECONNRESET`/`aborted` on request bodies as a debug-level event in the server entry or middleware.
- **Verification procedure:** Abort 10 requests with `curl -m 0.1`; the log shows no stack traces.
- **Status:** CONFIRMED (dev); production NOT VERIFIED

### INST-11 — Stray committed `.node_modules.lock`
- **Severity:** P3
- **Category:** Repo hygiene
- **Blocks:** Neither
- **Affected files:** `.node_modules.lock` (committed in `5a40709`, empty)
- **Description:** This empty file is sandbox or tool residue. It does nothing and is not ignored.
- **Evidence:** `git log --oneline -- .node_modules.lock` → `5a40709 feat: initial commit…`; `cat` prints nothing.
- **Real-world consequence:** Cosmetic.
- **Recommended fix:** `git rm .node_modules.lock` and add it to `.gitignore`.
- **Verification procedure:** The file is absent at the release tag.
- **Status:** CONFIRMED

### INST-12 — `/api/health` labels any Postgres as `"neon"`
- **Severity:** P3
- **Category:** Observability
- **Blocks:** Neither
- **Affected files:** `src/routes/api/health.ts`, `src/lib/db.ts`
- **Description:** Against a vanilla `postgres:16-alpine`, the health check reports `source:"neon"`. This is a template assumption (the Grok platform provisions Neon).
- **Evidence:** `{"status":"ok","uptimeSec":2,…,"checks":{"database":{"source":"neon","ok":true,"latencyMs":2}}}` with `DATABASE_URL=postgres://postgres:***@127.0.0.1:55439/postgres`.
- **Real-world consequence:** Misleading for self-hosters and operators.
- **Recommended fix:** Report `"postgres"`.
- **Verification procedure:** The health output shows `postgres` against plain PG.
- **Status:** CONFIRMED

## Not verified / out of scope

- macOS: not run.
- A machine without Playwright browsers, Python, ffmpeg or curl was not simulated. Everything was pre-installed on this host.
- `startup.sh` was not executed: it would start `npm run dev` on 8080, which another agent owns. Only its syntax was checked (`sh -n`, Linux).
- `npm run preview` (port 8081, owned by another agent) and a production-build smoke test were not run.
- Real yt-dlp or YouTube downloads in the clean clone (no live traffic).
- Behaviour on actual Vercel (INST-05 is inferred from code and logs).
- Node < 22.6 was not executed (INST-02).
