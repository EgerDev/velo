# 17 — Codebase cleanliness audit (auditor: arch)

## Scope and method

Scope: the working tree of `C:\Users\PC\orca\velo` (2026-09-23), all tracked files plus the three
untracked ones; `node_modules` only to check dependency relationships.

Method (all read-only):
1. **Import-graph reachability** — a script (auditor scratchpad `arch/reach.mjs`) walks static and
   dynamic `import`/`export … from`/`import()` from every route entry (`src/router.tsx`,
   `src/routeTree.gen.ts`, `src/routes/**`, `server/middleware/grok-pwa.ts`) resolving `@/` and
   relative specifiers, and lists `src/` files never reached.
2. **Dead-export scan** — script `arch/deadexports.mjs`: for every `export const|function|class|type`
   in non-test `src/` files, count references in other non-test files; `self=1` = not even used in
   its own file.
3. **Dependency usage** — grep of every `package.json` dependency as an import specifier (incl. CSS
   `@import`) across `src`, `server`, `scripts`, `vite.config.ts`, `eslint.config.mjs`, plus
   `package-lock.json` reverse-dependency lookup for build-only packages.
4. `npx eslint . -f json` (read-only, output to scratchpad): **0 errors, 189 warnings — 179
   `@typescript-eslint/no-unused-vars`, 6 `react-refresh/only-export-components`, 4
   `react-hooks/exhaustive-deps`**.
5. `git ls-files --eol`, `diff -r`, `unzip -l` for duplicates and line endings.

Items are called "unused" only when the grep/graph evidence shows no production reference.

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| CLEAN-01 | P2 | 32 declared dependencies (30 runtime, 2 dev) are never imported (20 of 21 Radix packages, recharts, date-fns, react-day-picker, vaul, react-table, react-resizable-panels, react-query, react-hook-form, …) | OSS release |
| CLEAN-02 | P2 | Grok App Builder template leftovers throughout the repo | Both |
| CLEAN-03 | P2 | Three copies of the `velo-session` extension, a hand-made zip, and a publicly served unreferenced unpacked copy | OSS release |
| CLEAN-04 | P2 | `operatorGate` implemented twice | OSS release |
| CLEAN-05 | P2 | Unreachable modules (≈1 300 lines) and test-only modules/exports (75 exports, ≈300 lines of research tables) | OSS release |
| CLEAN-06 | P2 | 179 unused-variable warnings; `ytdlp-proc.server.ts` carries 30 dead imports and a wrong header | OSS release |
| CLEAN-07 | P2 | Endpoints and exported aliases with no caller | Both |
| CLEAN-08 | P3 | Duplicate small implementations and two transcript UIs | Neither |
| CLEAN-09 | P3 | Obsolete / orphan scripts (incl. a module whose tests test code that never runs) | OSS release |
| CLEAN-10 | P3 | Byte-identical duplicate migration `migrations/auth/0001_auth.sql` | Neither |
| CLEAN-11 | P3 | Env vars that only feed dead or template code | Neither |
| CLEAN-12 | P3 | Hard-coded localhost / sandbox paths, including localhost in production `trustedOrigins` | Both |
| CLEAN-13 | P3 | Developer-/tool-specific config (`.remember`, `.pi`, `.node_modules.lock`, package name) | OSS release |
| CLEAN-14 | P3 | CRLF/LF churn in the working tree | OSS release |
| CLEAN-15 | P3 | Template placeholder text and example code in comments | OSS release |
| CLEAN-16 | P3 | `console.log` and dead variables in the shipped extension | Neither |
| CLEAN-17 | P3 | Dead feature flags and no-op functions | Neither |
| CLEAN-18 | P3 | `extension/` is unshipped, unversioned and self-described as "official Google Chrome Extension" | OSS release |

---

### CLEAN-01 — 32 declared dependencies are never imported
- **Severity:** P2
- **Category:** Unused dependencies
- **Blocks:** OSS release
- **Affected files:** `package.json:25-107`
- **Description:** No import specifier in `src`, `server`, `scripts`, `vite.config.ts` or CSS references:
  - runtime: `@ffmpeg/util`, `@hookform/resolvers`, `@radix-ui/react-accordion`, `-alert-dialog`, `-avatar`, `-checkbox`, `-collapsible`, `-dialog`, `-dropdown-menu`, `-label`, `-popover`, `-progress`, `-radio-group`, `-scroll-area`, `-select`, `-separator`, `-slider`, `-switch`, `-tabs`, `-toggle`, `-toggle-group`, `-tooltip` (only `@radix-ui/react-slot` is used, `src/components/ui/button.tsx`), `@tanstack/react-query`, `@tanstack/react-table`, `date-fns` (20 MB on disk), `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `recharts` (5.2 MB), `vaul`.
  - dev: `react-scan`, `eslint-plugin-prettier` (config uses only `eslint-config-prettier`).
  - Confirmed **used** (the brief asked): `kysely` (`auth/pglite-dialect.ts`), `undici` (`proxy-fetch.server.ts`, `proxy-transport.server.ts`, `ipv4-bind.server.ts` via `require`), `socks-proxy-agent` (`proxy-transport.server.ts`), `cmdk` (`command-palette.tsx`), `@tanstack/react-virtual` (`virtual-rows.tsx`), `jose`, `jsdom`, `mediabunny`, `@ffmpeg/ffmpeg`, `@ffmpeg/core`. `@tanstack/router-plugin`, `lightningcss` and `react-dom` are needed transitively (`package-lock.json`: required by `@tanstack/start-plugin-core`, `vite`/`@tailwindcss/node`, Radix/React runtime).
- **Evidence:** per-package grep loop output, e.g. `recharts files=0`, `date-fns files=0`, `@radix-ui/react-dialog files=0`, `@tanstack/react-query files=0`; lock lookup `@tanstack/react-query <- (root only)`, `@ffmpeg/util <- (root only)`.
- **Real-world consequence:** Larger install, more supply-chain and `npm audit` surface, the weekly updater bumps and "verifies" packages nothing uses; contributors assume a shadcn/Radix design system that isn't there.
- **Recommended fix:** `npm uninstall` the list above; re-run typecheck/build.
- **Verification procedure:** `for p in recharts date-fns vaul …; do grep -rlE "['\"]$p(/|['\"])" src server scripts vite.config.ts; done` → empty; then `npm run build`.
- **Status:** CONFIRMED

### CLEAN-02 — Grok App Builder template leftovers
- **Severity:** P2
- **Category:** Template leftovers
- **Blocks:** Both
- **Affected files:** `AGENTS.md` (18 KB of instructions addressed to "Grok Build" in a `/workspace` sandbox, referencing `.grok/skills`/`.grok/references` that do not exist), `startup.sh`, `.node_modules.lock` (empty), `scripts/grok-pwa-plugin.mjs`, `scripts/grok-pwa-shared.mjs`, `scripts/grok-pwa-shared.d.mts`, `scripts/install-page.html`, `scripts/brand-check.mjs`, `scripts/check-auth-invariant.mjs`, `scripts/with-app-env.mjs` (`.grok/app-env.json`), `scripts/preview-thumbnail.mjs`, `scripts/browser-smoke*.mjs` (`/workspace` paths), `server/middleware/grok-pwa.ts`, `server/virtual-grok-og-identity.d.ts`, `public/__grok/**` (incl. `logo-grok.svg`), `src/lib/og/site.json`, `src/lib/auth/{preview,popup.server,gate-identity.server,gate-session.server,oauth-popup,email-password}.ts`, `src/lib/preview-host-bridge.ts`, `src/components/preview-host-bridge.tsx`, `src/lib/preview-embedder-origin.ts`, `src/lib/builder-env.ts`, `src/lib/app-data/**`, `src/lib/multiplayer/**`, `vite.config.ts` (`app-builder:*` plugins, "AGENTS.md § First scaffold" comment), `eslint.config.mjs:8` ("app-builder template"), `package.json` name `app-builder-workspace`, cookie names `__Host-grok-auth.*`
- **Description:** Beyond the functional issues in `audit/01-architecture.md` (ARCH-05/06/16), these files exist only to operate inside xAI's sandbox/hosting and carry its branding and instructions. `AGENTS.md` even forbids removing the "Created with Grok" injector.
- **Evidence:** `git ls-files | grep -iE "grok|app-builder"`; `ls .grok` → absent; `.node_modules.lock` is 0 bytes and referenced nowhere.
- **Real-world consequence:** An OSS release ships another vendor's agent contract and branding, confusing contributors and possibly creating trademark issues (REQUIRES LEGAL REVIEW).
- **Recommended fix:** Remove or replace each item; keep only what Velo needs (e.g. a neutral error component, standard auth config) and a neutral `CONTRIBUTING.md` instead of `AGENTS.md`.
- **Verification procedure:** `git grep -il "grok" | wc -l` before/after.
- **Status:** CONFIRMED

### CLEAN-03 — Three copies of the `velo-session` extension
- **Severity:** P2
- **Category:** Duplicate artifacts
- **Blocks:** OSS release
- **Affected files:** `extensions/velo-session/**`, `public/extensions/velo-session/**`, `public/extensions/velo-session.zip`, `src/components/session-guide.tsx:19`
- **Description:** The source folder, an unpacked copy under `public/`, and a committed zip. The unpacked copy is identical to the source (`diff -r` → IDENTICAL) and is served publicly (`.vercel/output/static/extensions/velo-session/`) but referenced by nothing; the zip is identical modulo line endings (`diff -r --strip-trailing-cr` → same). No script builds the zip; it was last updated by hand in `fbf0867`.
- **Evidence:** `diff -r extensions/velo-session public/extensions/velo-session && echo IDENTICAL` → `IDENTICAL`; `grep -rn "velo-session" src scripts package.json` → only the zip URL in `session-guide.tsx`.
- **Real-world consequence:** Fixes to the extension silently fail to reach users unless someone re-zips by hand; reviewers must audit three copies.
- **Recommended fix:** Keep `extensions/velo-session/` as the only source; generate the zip in the build (or a release workflow) and delete `public/extensions/velo-session/`.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-04 — `operatorGate` implemented twice
- **Severity:** P2
- **Category:** Duplicate implementation (security-relevant)
- **Blocks:** OSS release
- **Affected files:** `src/lib/tool-updates.ts:32-61`, `src/lib/operator-gate.server.ts:15-42`
- **Description:** The Tools-tab install gate has its own inline copy of the operator decision instead of using `operator-gate.server.ts` (which the proxy console uses). Logic is currently equivalent (verified email ∈ `VELO_ADMIN_EMAILS`, or loopback + `VELO_ALLOW_TOOL_INSTALL=1` when auth is off).
- **Evidence:** both call `operatorDecision({ authConfigured, email, allowlist: process.env.VELO_ADMIN_EMAILS, clientIp, allowLocalInstall: process.env.VELO_ALLOW_TOOL_INSTALL === "1" })`.
- **Real-world consequence:** A future fix to one gate (the one guarding `npm install` on the server) can miss the other.
- **Recommended fix:** `tool-updates.ts` should `await import("@/lib/operator-gate.server")` and call `operatorGate(userId)`.
- **Verification procedure:** `grep -n "operatorDecision(" src/lib/*.ts`.
- **Status:** CONFIRMED

### CLEAN-05 — Unreachable modules and test-only code
- **Severity:** P2
- **Category:** Dead code
- **Blocks:** OSS release
- **Affected files:**
  - Unreachable from every entry point (reachability script): `src/lib/multiplayer/index.ts`, `p2p.ts` (618 lines; needs `/api/rtc`, which never existed), `src/lib/app-data/{client.server,index,login,server-only,types}.ts` (446 lines; Grok connectors), `src/components/ui/separator.tsx`.
  - Test-only modules (imported only by their `*.test.ts`): `src/lib/fallback-path.ts`, `src/lib/h264-syntax.ts`, `src/lib/nal-h264.ts`, `src/lib/contrast.ts` (palette guard — acceptable if intended).
  - 75 exports referenced by nothing, not even their own file (`self=1` in the dead-export scan), e.g. in `src/lib/ytdlp-auth.ts`: `YTDLP_CLIENT_EXTRACT`, `YTDLP_PLAYER_CLIENTS`, `YOUTUBE_ALT_APIS`, `PO_TOKEN_STEPS`, `YTDLP_EXTRACTOR_LAYERS`, `YTDLP_EXTRACTOR_ARGS`, `YTDLP_WORKING_EXAMPLE`, `ytdlpWorkingCommand`, `SOCKS_CLIENTS`, `BEST_1080_SELECTOR` (≈300 lines of research notes kept as code); `src/lib/nsig.ts` `NSIG_EXPLAIN`/`BOTGUARD_EXPLAIN`/`INNERTUBE_DECIPHER`/`YTDLP_COMPARE`; `src/lib/ima.ts` `IMA_EXPLAIN`; `src/lib/throttle.ts` `THROTTLE_QA`; `src/lib/po-token.server.ts` `stampPoToken`; `src/lib/user-proxy.server.ts` `activeUserProxy`, `invalidateProxyCache`; `src/lib/download-pool.server.ts` `wipeMuxCache`, `ytdlpSlotSnapshot`; `src/lib/iso-bmff.ts` `dashSegmentPlan` …
- **Evidence:** reachability output ("UNREACHABLE (non-test) src files: … src\lib\multiplayer\p2p.ts … src\lib\app-data\client.server.ts …"); dead-export scan (75 lines `self=1`); `git log --all --format=%h -- 'src/routes/api/rtc*'` → empty.
- **Real-world consequence:** ≈1 300 lines of unreachable code plus hundreds of lines of prose-as-constants inflate review and audit cost and suggest features (P2P rooms, Google Drive connectors) that don't exist.
- **Recommended fix:** Delete unreachable modules; move research tables/explanations to `docs/`; delete test-only exports with their assertions or mark the module as a test fixture.
- **Verification procedure:** Re-run the two scripts; `npm run typecheck && npm test` after deletion.
- **Status:** CONFIRMED

### CLEAN-06 — 179 unused-variable warnings; `ytdlp-proc.server.ts` dead imports and wrong header
- **Severity:** P2
- **Category:** Dead code / lint debt
- **Blocks:** OSS release
- **Affected files:** `src/lib/ytdlp-proc.server.ts:1-31` (30 unused imports: fs/promises helpers, `withRetry`, the whole `ytdlp-auth` set, socks pool, `download-pool` API; header comment describes a SOCKS caption fetcher that lives in `ytdlp-meta.server.ts`), `src/components/bulk-downloader.tsx:3-41` (30 unused imports), `src/components/bulk-view.tsx:2-20`, `src/components/transcript-form.tsx:10-15`, `transcript-reader.tsx:3-19`, `transcript-sidebar.tsx:1-16` (≈70 destructured-but-unused props), `src/lib/hybrid-net.ts:1-10` (13 unused imports), `src/lib/youtube-client.server.ts:3-4`, `src/lib/youtube.server.ts:2`, `src/components/session-guide.tsx:13,63,78`, `src/routes/index.tsx:3`, `extension/popup.js:422`
- **Description:** Leftovers from file splits: modules keep the import list of the file they were carved from. `package.json` `lint` passes only because unused vars are warnings.
- **Evidence:** `npx eslint . -f json` → `{ e: 0, w: 189, byRule: { '@typescript-eslint/no-unused-vars': 179, … } }`.
- **Real-world consequence:** Misleading headers and imports hide real dependencies (e.g. `ytdlp-proc.server.ts` appears to depend on the SOCKS pool and cache but does not); larger client chunks where tree-shaking can't prove purity.
- **Recommended fix:** `eslint --fix`-assisted cleanup; make `no-unused-vars` an error in CI.
- **Verification procedure:** `npx eslint . --max-warnings=0`.
- **Status:** CONFIRMED

### CLEAN-07 — Endpoints and exported aliases with no caller
- **Severity:** P2
- **Category:** Unreachable endpoints
- **Blocks:** Both
- **Affected files:** `src/routes/api/download.ts` (no client/extension caller), `src/lib/user-proxy.ts:72-83` `listUserProxies`, `:112-153` `testUserProxy`, `src/lib/hybrid-download.ts:307` `export { downloadViaHybrid as downloadViaBypass }`
- **Description:** `GET /api/download` is a public, unauthenticated media proxy the UI no longer calls; `listUserProxies`/`testUserProxy` are RPC endpoints superseded by `listProxyOperations`/`testProxyValidation`. The `downloadViaBypass` alias is imported nowhere.
- **Evidence:** `grep -rn "/api/download" src extension extensions | grep -v src/routes/api` → no caller; `listUserProxies: src/lib/proxy-action-contracts.ts src/lib/user-proxy.ts` only.
- **Real-world consequence:** Live attack surface without product value.
- **Recommended fix:** Remove them (or document them as public API and test them).
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-08 — Duplicate small implementations and two transcript UIs
- **Severity:** P3
- **Category:** Duplicate implementations
- **Blocks:** Neither
- **Affected files:** `isBlock` in `bypass.server.ts:24` and `youtube-stream.server.ts:87` (different rules: the latter does not treat `text/plain` as a block page), `isMediaResponse` `builder.server.ts:7`, `isBlockPage` `bypass.ts:55` and `hybrid-net.ts:81`, `assertMedia` `builder-download.ts:23` and `hybrid-net.ts:72`, `appendParam` `bypass-parse.ts:142` and `youtube-stream.server.ts:61`, `TMP_PREFIX` `ytdlp-python.server.ts:7` and `ytdlp-meta.server.ts:20`, cookie parsing `auth/popup.server.ts:201` vs `guest-limit.server.ts:146`, `env()` helpers in `auth/server.ts:68` and `gate-identity.server.ts:24`, client `hopFetch` (`bypass.ts`) vs server `hop` (`bypass.server.ts`) ("keep the two in sync" comments), two cookie extractors in `extension/background.js:292` and `extensions/velo-session/background.js:75`; transcript UI twice: `components/transcript-viewer.tsx` (669 lines) and `transcript-studio.tsx`→`transcript-view.tsx`→`transcript-{form,reader,sidebar}.tsx`
- **Description:** Copy-paste variants that have already drifted (the `isBlock` pair).
- **Evidence:** `grep -rn "function isBlock\|function isBlockPage\|function assertMedia\|function appendParam\|TMP_PREFIX =" src`.
- **Real-world consequence:** Inconsistent block-page detection between paths; double maintenance.
- **Recommended fix:** One `media-response.ts` helper module; one transcript component tree.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-09 — Obsolete / orphan scripts
- **Severity:** P3
- **Category:** Obsolete scripts
- **Blocks:** OSS release
- **Affected files:** `scripts/sign-out-plan.mjs` (+ `.test.mjs`), `scripts/preview-thumbnail.mjs`, `scripts/build-extension-icons.mjs`, `scripts/brand-check.mjs` (reads `/workspace/.grok/skills/og/SKILL.md`), `scripts/check-auth-invariant.mjs` (+ test), `startup.sh`
- **Description:** `sign-out-plan.mjs` states it is "The sign-out sequence used by `src/lib/auth/client.ts`" but `client.ts` has its own `signOut()` and imports nothing from it — its 248-line test suite verifies code that never runs. `preview-thumbnail.mjs` and `build-extension-icons.mjs` are referenced by no script, workflow or doc. `brand-check`, `check-auth-invariant`, `startup.sh` only make sense in the Grok sandbox.
- **Evidence:** `grep -rl "sign-out-plan" src` → none; `preview-thumbnail <-` (no referrers); `build-extension-icons <-` (no referrers).
- **Real-world consequence:** False confidence from tests; clutter.
- **Recommended fix:** Wire `sign-out-plan` into `client.ts` or delete both files; delete or document the others.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-10 — Duplicate migration
- **Severity:** P3
- **Category:** Duplicate file
- **Blocks:** Neither
- **Affected files:** `migrations/auth/0001_auth.sql`, `migrations/0001_auth.sql`
- **Description:** Byte-identical; the `auth/` copy is the template's opt-in source and is never applied (appliers don't recurse).
- **Evidence:** `diff migrations/0001_auth.sql migrations/auth/0001_auth.sql && echo SAME` → `SAME`.
- **Real-world consequence:** Someone edits the wrong copy.
- **Recommended fix:** Delete `migrations/auth/`.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-11 — Env vars that only feed dead or template code
- **Severity:** P3
- **Category:** Unused env vars
- **Blocks:** Neither
- **Affected files:** `src/lib/multiplayer/p2p.ts` (`VITE_STUN_URLS`), `src/lib/app-data/client.server.ts` (`GROK_CONNECTORS_URL`, `GROK_CONNECTOR_ACCESS_TOKEN`), `scripts/grok-pwa-shared.mjs` (`VITE_PROJECT_ID`, `VITE_OG_SERVICE_URL`, `X_CREATOR`, `X_CREATOR_ID`, `VITE_PUBLIC_HOSTNAME`)
- **Description:** Read only by unreachable modules or by the Grok PWA/OG injector.
- **Evidence:** env inventory (`grep -rnoE "process\.env…|import\.meta\.env…"`), see `docs/architecture.md` §6.
- **Real-world consequence:** Noise in the configuration surface.
- **Recommended fix:** Remove with the modules (CLEAN-02/05).
- **Verification procedure:** re-run the env grep.
- **Status:** CONFIRMED

### CLEAN-12 — Hard-coded localhost / sandbox paths
- **Severity:** P3
- **Category:** Hard-coded hosts/paths
- **Blocks:** Both
- **Affected files:** `src/lib/auth/server.ts:101-126` (`http://localhost:8080`, `127.0.0.1:8080`, `[::1]:8080` are **always** in `trustedOrigins`, also when `BETTER_AUTH_URL` is set; fallback baseURL `http://localhost:8080`), `vite.config.ts:117` (`localhost:8080` default host), `extension/background.js:4`, `extension/content.js:107,114`, `extension/popup.js:7,199`, `extension/options.js:17,38` (`http://127.0.0.1:8080`), `startup.sh:4,7` (`127.0.0.1:8080`, `/tmp/app-startup.log`), `scripts/browser-smoke-verdict.mjs:37-38` (`/workspace/screenshots/…`), `scripts/browser-smoke.mjs:30-41`, `scripts/brand-check.mjs:29`
- **Description:** Dev ports and Grok sandbox paths are baked into production auth config, the extension defaults and the QA tooling.
- **Evidence:** `const trustedOrigins: string[] = explicitBaseURL ? [explicitBaseURL, ...LOCAL_DEV_ORIGINS] : …` (`auth/server.ts:118-119`).
- **Real-world consequence:** Production accepts credentialed auth POSTs from any page served on the user's own `localhost:8080`; the extension opens a dead localhost URL for users who never configure it; README-documented smoke command does not work outside `/workspace`/cwd.
- **Recommended fix:** Add loopback origins only when `NODE_ENV !== "production"`; derive extension default from the release origin; parameterise script paths.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-13 — Developer-/tool-specific configuration
- **Severity:** P3
- **Category:** Developer-specific config
- **Blocks:** OSS release
- **Affected files:** `eslint.config.mjs:15-25` (ignores `.remember/**`, `.pi/**`, `.grok/**` — local AI-tool scratch dirs), `.gitignore:7,23` (`.vercel` listed twice; `.grok/`, `attachments/`, `artifacts/`), `.node_modules.lock` (empty, tracked), `package.json:2` (`"name": "app-builder-workspace"`), untracked local dirs `.tanstack/tmp`, `screenshots/`, `.vercel/output` (correctly ignored)
- **Description:** Configuration that exists for the author's tools rather than the project.
- **Evidence:** file contents as cited; `git ls-files .node_modules.lock` → tracked, 0 bytes.
- **Real-world consequence:** Confusing to contributors; wrong package name in any published artifact.
- **Recommended fix:** Rename the package (`velo`), drop tool-specific ignores and the empty lock file, dedupe `.gitignore`.
- **Verification procedure:** inspect files.
- **Status:** CONFIRMED

### CLEAN-14 — CRLF/LF churn in the working tree
- **Severity:** P3
- **Category:** Line endings
- **Blocks:** OSS release
- **Affected files:** `.gitattributes` (`* text=auto eol=lf`, added in HEAD `81cbd95`), 279 working-tree files
- **Description:** The index is LF everywhere, but with `core.autocrlf=true` 279 working-tree files are CRLF (`git ls-files --eol` → `279 i/lf w/crlf`, `76 i/lf w/lf`); 15 of the modified files are mixed, producing "CRLF will be replaced by LF" on every git operation. `git diff --stat` shows 503/227 lines vs 477/201 with `--ignore-cr-at-eol`, i.e. ~26 lines of the pending diff are pure line-ending noise.
- **Evidence:** as cited.
- **Real-world consequence:** Noisy diffs/PRs; `startup.sh` would break with CRLF on Linux (the reason `.gitattributes` was added).
- **Recommended fix:** `git add --renormalize .` in a dedicated commit; contributors set `core.autocrlf=input` or rely on `.gitattributes`.
- **Verification procedure:** `git ls-files --eol | awk '{print $1,$2}' | sort | uniq -c`.
- **Status:** CONFIRMED

### CLEAN-15 — Template placeholder text and example code
- **Severity:** P3
- **Category:** Placeholder text
- **Blocks:** OSS release
- **Affected files:** `src/lib/auth/use-current-user.ts:21-27` (`"Dev User"`, `dev@example.com`), `src/lib/auth/gate-session.server.ts:263-266` (`@viewer.grok.invalid`, `"Grok user"`), `src/lib/auth/middleware.ts:10-19` and `src/lib/db.ts:25-27` (`todos` examples), `src/lib/auth/server.ts:4-5`, `email-password.ts:4-8`, `migrations/0001_auth.sql:14-17`, `gates.tsx:48-50` (references to "the auth skill", "neon skill", "design-ui skill"), `src/lib/auth/provider.tsx:9-13` ("passthrough today")
- **Description:** Instructional text for the template's AI agent and demo examples remain in shipped code.
- **Evidence:** as cited.
- **Real-world consequence:** Misleading documentation-in-code (e.g. "email/password off by default" while it is on — see ARCH-05).
- **Recommended fix:** Rewrite comments for Velo; remove skill references.
- **Verification procedure:** `git grep -n "skill"` in `src/`.
- **Status:** CONFIRMED

### CLEAN-16 — `console.log` and dead variables in the shipped extension
- **Severity:** P3
- **Category:** Debug output
- **Blocks:** Neither
- **Affected files:** `extension/background.js:11,360` (`console.log`; `notifyUser` only logs — "Try notification or fallback to console" but no notification API is used), `extension/popup.js:422` (`promptTitle` unused)
- **Description:** The only `console.log` calls in the product are in `extension/`; `src/` uses `console.error/warn` for server diagnostics only.
- **Evidence:** `grep -rnE "console\.(log|debug|info)" src server extension extensions` → the two lines above.
- **Real-world consequence:** Minor; the `NOTIFY` message type silently does nothing user-visible.
- **Recommended fix:** Remove or implement with `chrome.notifications`.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-17 — Dead feature flags and no-op functions
- **Severity:** P3
- **Category:** Dead feature flags
- **Blocks:** Neither
- **Affected files:** `src/lib/auth/email-password.ts:10` (`emailAndPasswordEnabled = true` constant presented as a toggle), `src/lib/ytdlp-auth.ts:185-187` (`ytdlpUserAgentArgs` always `[]`), `:65-66` (`BEST_1080_SELECTOR` alias of `WORKING_1080_SELECTOR`, unused), `:194-199` (`YTDLP_DEPRECATED_HEADERS`, test-only), `src/lib/user-proxy.ts:306` (`startProxyValidationRun` alias of `runAllProxyValidations`), `src/lib/auth/provider.tsx` (`AuthProvider` only mounts a toaster)
- **Description:** Flags that can't be flipped at runtime and functions retained as extension points without users.
- **Evidence:** as cited.
- **Real-world consequence:** Readers think behaviour is configurable when it is not.
- **Recommended fix:** Replace with env-driven config where a switch is wanted (ARCH-05), delete the rest.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

### CLEAN-18 — `extension/` is unshipped and unversioned
- **Severity:** P3
- **Category:** Unfinished component / branding
- **Blocks:** OSS release
- **Affected files:** `extension/manifest.json:4` (`"version": "1.0.0"`), `extension/README.md:1-3` ("The official **Google Chrome Extension** for Velo"), `scripts/build-extension-icons.mjs`
- **Description:** The larger extension has no packaging step, is not linked from the app, has not had a version bump across the commits that changed it, and its README uses "official Google Chrome Extension" wording (REQUIRES LEGAL REVIEW for trademark use).
- **Evidence:** `grep -rn "extension/" src` → no link to `extension/`; `git log --oneline -- extension | wc -l` shows multiple changes with the manifest still at 1.0.0.
- **Real-world consequence:** Users can only side-load it from source; unclear support status.
- **Recommended fix:** Either package/version it alongside `velo-session` or move it out of the release.
- **Verification procedure:** as in Evidence.
- **Status:** CONFIRMED

---

## Not verified / out of scope

- Whether any of the "unused" Radix/shadcn packages are required by a planned but unmerged branch was not checked (only this working tree).
- Bundle-size impact of CLEAN-01/05 was not measured (a rebuild was not performed by this auditor to avoid interfering with the UX agent's build/preview).
- Test-suite pass/fail after the suggested deletions was not executed.
- The reachability script is regex-based; string-built dynamic imports would be missed (none were found by `grep -rn "import(\`" src`).
