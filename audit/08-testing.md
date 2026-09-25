# 08 — Testing audit (prefix TEST-)

Auditor: `qa` (QA + build engineer). Date: 2026-09-23. Audit only: no source, test or config was changed. Probe tests were written **only** in the scratchpad (`…\scratchpad\qa\probe*.test.ts`), never in the repo.

## Scope and method

- Ran the four requested gates in the main working tree (`C:\Users\PC\orca\velo`, Windows 11, Node v25.2.1, npm 11.6.2), recording exact commands, durations and counts.
- Read `scripts/run-ts-tests.mjs`, `scripts/check-auth-invariant.mjs`, `scripts/browser-smoke.mjs`, `scripts/browser-guard.mjs`, `scripts/with-app-env.mjs`, `scripts/migrate.mjs`, `.github/workflows/auto-update.yml` and all 80 `*.test.*` files (67 under `src/`, 13 under `scripts/`; 0 under `extension/` or `extensions/`).
- Coverage: `node --experimental-strip-types --test --experimental-test-coverage --test-reporter=lcov` over every `src/**/*.test.ts`, then compared the lcov file list against all 207 non-test `.ts/.tsx` files in `src/`.
- Re-ran the whole suite on Linux (Docker `node:22.18-bookworm`), once with networking and once with `--network none`, to check hermeticity and the POSIX-only test.
- Wrote probe tests (scratchpad only) for three gaps: cleanup of the yt-dlp tmp dir when a client cancels, `Content-Disposition` handling, and edge cases in the relay allow-list.

### How the tests run

`npm test` = `node --test "scripts/**/*.test.mjs" && node scripts/run-ts-tests.mjs`. The TS runner walks `src/` for `*.test.ts` files and spawns `node --experimental-strip-types --test <files…>`. Node strips the types and does no type-checking or transform (`scripts/run-ts-tests.mjs:47-50`). As a result:
- It needs Node ≥ 22.6, where `--experimental-strip-types` first appeared. The README claims "v22.0.0 or later" (see INST-02).
- Every file runs in its own process (the `node --test` default), so global mutation in one file cannot leak into another.
- There is no test framework, no mocking library, no coverage threshold and no E2E runner in the test script.

### Gate results (main working tree)

| Command | Duration | Result |
|---|---|---|
| `npm test` (part 1, `scripts/**/*.test.mjs`) | ~9 s | 179 tests: **176 pass, 0 fail, 3 skipped** |
| `npm test` (part 2, `src/**/*.test.ts`) | ~25 s | 535 tests / 51 suites: **534 pass, 0 fail, 1 skipped** |
| `npm test` total | **34 s**, exit 0 | 714 tests, 0 failures, 4 skipped |
| `npm run typecheck` (`tsc --noEmit`) | **8 s**, exit 0 | clean |
| `npm run lint` (`eslint .`) | **12 s**, exit 0 | **0 errors, 189 warnings** (179 no-unused-vars, 6 react-refresh, 4 exhaustive-deps) |
| `npm run check:auth` | **1 s**, **exit 2** | `[auth-invariant] could not read the dev server's resolved VITE_AUTH_ENABLED`. It needs a running dev server on the hard-coded `http://127.0.0.1:8080` that serves `/__app-env`. Port 8080 belongs to another agent and answered 404 on `/__app-env`, so the check could not observe anything. |

The four skipped tests:
- `scripts/with-app-env.test.mjs:68` and `:82`: skipped when `.grok/app-env.json` is missing.
- `scripts/check-auth-invariant.test.mjs:97`: same condition.
- `src/lib/proc-run.server.test.ts:23`: skipped on win32 ("process groups are POSIX").

No `.only` and no `todo` anywhere (`grep -rnE "\b(test|it|describe)\.(skip|only|todo)\b"` → none).

Other environments:
- **Linux (Docker node:22.18-bookworm):** 179/176/3 and **535/535/0**, including the process-group test. Exit 0.
- **Linux with `--network none`:** identical, so the suite is hermetic (positive).
- **Stability:** 5 full runs (Windows WT, Windows HEAD clone, Windows WT clone, Linux, Linux offline) with no failures and no flakes.

### Coverage (Windows, TS tests only)

The tool's own summary covers only the files the tests import: **84.09 % line / 78.52 % branch / 83.59 % funcs**. That number is misleading:
- Only **88 of 207** non-test source files under `src/` are loaded by any test. **119 are never loaded.**
- Of those 119, 43 are components and 76 are lib/routes files.
- The never-loaded files come to about **19,500 of 34,200 raw source lines (~57 %)**.

Never loaded:
- **All 10 `src/routes/api/*.ts` handlers**
- `src/routes/api/auth/$.ts`, `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/__root.tsx`
- `src/lib/vault.ts`, `src/lib/user-proxy.ts` (server fns), `src/lib/user-proxy.server.ts`, `src/lib/user-proxy-repository-db.server.ts`
- `src/lib/auth/middleware.ts`, `src/lib/auth/server.ts`, `src/lib/auth/verify.server.ts`, `src/lib/auth/preview.ts`, `src/lib/auth/popup.server.ts`
- `src/lib/operator-gate.server.ts`, `src/lib/tool-updates.server.ts`, `src/lib/tool-updates.ts`, `src/lib/session-isolation.ts`, `src/lib/db.ts`, `src/lib/resolve-video.ts`
- `src/lib/ytdlp.server.ts`, `src/lib/ytdlp-proc.server.ts`, `src/lib/ytdlp-python.server.ts`, `src/lib/ytdlp-meta.server.ts`
- `src/lib/youtube-stream.server.ts`, `src/lib/youtube-client.server.ts`, `src/lib/youtube-captions.server.ts`, `src/lib/po-token.server.ts`
- `src/lib/hybrid-download.ts`, `src/lib/bulk-process.ts`, `src/lib/download-client.ts`, `src/lib/mux-client.ts`, `src/lib/audio-encoder.ts`

Loaded but thin: `bypass.ts` 18 %, `bypass.server.ts` 23 %, `socks-pool.server.ts` 28 %, `auth/gate-session.server.ts` 47 %.

Loaded and well covered: `cookies.ts` 98 %, `har.ts` 94 %, `ytdlp-auth.ts` 98 %, `vault-crypto.ts` 98 %, `guest-limit.server.ts` 78 %, `download-pool.server.ts` 85 %, `user-proxy-repository.server.ts` 93 %, `iso-bmff.ts` 89 %, `cors-relays.ts` 81 %, `auth/gate-identity.server.ts` 89 %.

### Critical functionality → tests map

| Area | Tests that exist | Verdict |
|---|---|---|
| Authn: gate identity JWT (`x-grok-identity`) | `src/lib/auth/gate-identity.test.ts` (verify, fail-closed without GROK_PROJECT_ID) | Partial. The unit is well tested, but the sign-out cookie-expiry branch throws inside the test and nobody asserts on it (TEST-12). |
| Authn: Better Auth config, bearer plugin, dev-user fallback, preview-secret fallback | none (`auth/server.ts`, `verify.server.ts`, `middleware.ts`, `preview.ts` never loaded) | **Untested** (TEST-02) |
| Authz: operator gate for proxy management and live `npm/pip install` | `tool-versions.test.ts` (pure `operatorDecision`), `user-proxy-actions.test.ts` (injected fake gates) | **Glue untested.** The real `operatorGate` (DB email lookup, `getRequestIP` path) never runs (TEST-03). |
| Per-user isolation: cookie vault | `vault-crypto.test.ts` (envelope crypto only) | **Untested.** `vault.ts` server fns, `user_id` scoping and plaintext mode are never exercised (TEST-04). |
| Per-user isolation: proxies | `user-proxy-repository.server.test.ts` (PGLite: atomic reorder, key rotation, redaction) | Proxies are a global operator resource, not per-user. The repository is well tested; the server-fn layer is not. |
| Per-user isolation: history | `history-store.test.ts` (client localStorage store) | Client side only; no server history. |
| Session isolation | `session-isolation.test.ts` (18 lines: token-key parsing only) | `session-isolation.ts` itself is never loaded. |
| Quota and rate limiting | `guest-limit.test.ts` (14 tests: token bucket, sliding window, IP header trust, backstop, clock skew) | Good at the unit level. Route wiring (which routes charge, refunds on failure) is untested; the state is in memory per instance (not testable here). |
| Relay allow-list / SSRF | `cors-relays.test.ts` (2 tests), `ima.test.ts` | Partial. No test of `/api/relay` itself (manual redirects, the extra-redirect guard, token charging). Ports are not restricted (TEST-18). |
| Cookie / HAR parsing | `cookies.test.ts`, `har.test.ts`, `capture-auth-token.test.ts` | Good (94-98 %). |
| yt-dlp argv construction | `ytdlp-auth.test.ts` (491 lines), `ytdlp-formats`, `ytdlp-subs`, `ytdlp-meta-routing` | Good for the pure argv builder. The fallback/route order and "cookies only to trusted proxies" are asserted by **regex on source text** (TEST-06). |
| Cookie temp-file cleanup | none in repo | Untested. A scratchpad probe shows `mediaFileResponse` runs `onClose` once on client cancel (it works), but `ytdlp.server.ts` (which writes `cookies.txt`) never runs under test. |
| Download pipeline (hybrid, bulk, client) | `download-pool.server.test.ts`, `bulk-download.test.ts`, `parallel-stream.test.ts`, `hybrid-progress.test.ts` (untracked), `retry.test.ts` | Pool and progress math are tested. `hybrid-download.ts`, `bulk-process.ts`, `download-client.ts` and every route are not. |
| Mux / ISO-BMFF / MPEG-TS / H.264 | `iso-bmff`, `mpeg-ts`, `nal-h264`, `h264-syntax` tests | **Five tests pass with no assertions** because their fixtures in `/tmp` do not exist (TEST-05). |
| Migrations | `scripts/migration-plan.test.mjs`, `scripts/proxy-operations-migration.test.mjs`, PGLite apply in the repository test | `scripts/migrate.mjs` against real Postgres has no test. Verified manually against PG16 (TEST-15). |
| Restart / persistence with PGLite | none | No test asserts that production refuses in-memory PGLite (INST-05). |
| Concurrency: download pool | `download-pool.server.test.ts` ("yt-dlp slot caps inflight at MAX_YTDLP", eviction race) | Present. |
| Timeout / abort / retry / cancel | `proc-run.server.test.ts` (idle kill; process-group kill skipped on win32), `retry.test.ts`, `proxy-run-service.server.test.ts` (deadline), `download-error.test.ts` | Unit level only. Nothing tests the abort path end to end through a route. |
| Extension messaging (MV3) | **none** (0 test files in `extension/`, `extensions/`) | **Untested** (TEST-08) |
| UI flows | **none** (0 component tests; 43 component files never loaded) apart from `use-keyboard-shortcuts`, `proxy-confirmation-focus`, `contrast` | **Untested** (TEST-08) |
| E2E | `scripts/browser-smoke.mjs` (one GET of `/`, desktop + mobile) | Render smoke only (TEST-08) |
| CI | none runs tests on push/PR | **Missing** (TEST-01) |

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| TEST-01 | P1 | No CI runs test/typecheck/lint/build on push or PR | Both |
| TEST-02 | P1 | No test executes any HTTP route, server-fn auth middleware or Better Auth config (57 % of source never loaded) | Both |
| TEST-03 | P1 | The operator gate that guards live `npm`/`pip install` and proxy management is tested only through injected fakes | Both |
| TEST-04 | P1 | Per-user cookie-vault isolation and plaintext-fallback mode have zero tests | Both |
| TEST-05 | P2 | 5 media-parser tests silently pass with zero assertions (fixtures in `/tmp` that never exist) | OSS release |
| TEST-06 | P2 | Security routing properties "tested" by regex over source text | Both |
| TEST-07 | P2 | Lint cannot fail: every rule is `warn`; 189 warnings incl. 35 dead imports in `ytdlp-proc.server.ts` | OSS release |
| TEST-08 | P2 | No E2E, UI or extension tests; browser smoke only checks that `/` renders text | Both |
| TEST-09 | P2 | Skipped tests hide the auth-default contract; in every clone the reality is auth ON | OSS release |
| TEST-10 | P3 | `npm run check:auth` is unusable standalone (hard-coded 8080, Grok-sandbox endpoint) | OSS release |
| TEST-11 | P2 | The weekly auto-update gate omits `npm run build`, so it can open PRs with a broken build | OSS release |
| TEST-12 | P3 | gate-identity test swallows a thrown `setCookie` error; session-cookie expiry is never asserted | Neither |
| TEST-13 | P3 | Template leftovers under test (Grok connectors) and global TLS-disable in one test file | Neither |
| TEST-14 | P3 | `mediaFileResponse` test is tautological about the filename | Neither |
| TEST-15 | P3 | `scripts/migrate.mjs` has no automated test against real Postgres (manually verified OK) | OSS release |
| TEST-16 | P3 | Windows process-tree kill path is untested (test skipped on win32) | Neither |
| TEST-17 | P3 | Positive: suite is hermetic, fast and deterministic, which is a good base for CI (info) | Neither |
| TEST-18 | P3 | Relay allow-list tests do not cover ports; `isRelayTarget` accepts any port | Neither |

---

### TEST-01 — No CI runs test/typecheck/lint/build on push or PR
- **Severity:** P1
- **Category:** CI / quality gates
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml:13-50` (the only workflow)
- **Description:** The only workflow is a weekly cron/`workflow_dispatch` dependency updater. Nothing runs `npm test`, `npm run typecheck`, `npm run lint` or `npm run build` on `push` or `pull_request`. Outside contributions and direct pushes to `main` are never verified. The working tree also holds 27 uncommitted modified files and 3 untracked ones (INST-03) that no gate has seen in CI.
- **Evidence:** `ls .github/workflows` → `auto-update.yml`. Its triggers are `on: schedule: - cron: "0 6 * * 1"` and `workflow_dispatch:`. There is no `pull_request` or `push` trigger.
- **Real-world consequence:** Regressions, including security regressions in the auth, quota and relay code, merge unnoticed. External PRs cannot be trusted without local re-runs.
- **Recommended fix:** Add a `ci.yml` on `pull_request` + `push: main`:
  - `npm ci`, `npm run typecheck`, `npm test`, `npm run lint -- --max-warnings=0` (after TEST-07), `npm run build`.
  - Matrix over Node 22.22.x and 24.x on ubuntu-latest, plus windows-latest.
  - `permissions: contents: read`, actions pinned by SHA.
  - A Postgres service container for `DATABASE_URL=… node scripts/migrate.mjs` (TEST-15).
- **Verification procedure:** Open a PR with a deliberately failing test. The check must go red and block the merge (branch protection).
- **Status:** CONFIRMED

### TEST-02 — No test executes any HTTP route, server-fn auth middleware or Better Auth config (57 % of source never loaded)
- **Severity:** P1
- **Category:** Coverage / security regression tests
- **Blocks:** Both
- **Affected files:**
  - `src/routes/api/{builder,bypass,captions,download,feed,health,relay,unlock,ytdlp}.ts`, `src/routes/api/auth/$.ts`
  - `src/lib/auth/{server,middleware,verify.server,preview,popup.server,pglite-dialect}.ts`
  - `src/lib/db.ts`, `src/lib/resolve-video.ts`, `src/lib/sign-in-link.ts`
  - `src/lib/ytdlp.server.ts`, `src/lib/ytdlp-proc.server.ts`
  - `src/lib/youtube-stream.server.ts`, `src/lib/youtube-client.server.ts`, `src/lib/po-token.server.ts`
- **Description:** The suite is almost entirely pure-function unit tests. With lcov coverage, only 88 of 207 source files are ever imported. Never imported:
  - every API route handler;
  - the `authMiddleware` that every server function relies on;
  - the Better Auth instance (including the committed preview-secret fallback and the dev-user fallback);
  - the DB bootstrap;
  - the yt-dlp and InnerTube server paths.

  Nothing tests authn/authz, route-level quota charging, the relay's redirect guard, or handling of the `x-grok-identity` header at the route level. The reported "84 % line coverage" counts only the files the tests happen to import.
- **Evidence:** `node --experimental-strip-types --test --experimental-test-coverage --test-reporter=lcov … src/**/*.test.ts` → `all files | 84.09 | 78.52 | 83.59`. My comparison script (`scratchpad/qa/cov.mjs`) prints `files loaded by tests (non-test): 88 of 207`, `never loaded: 119 (components: 43)`, and the list above. The never-loaded files total 10,357 (lib/routes) + 9,181 (components) = 19,538 raw lines out of 34,234.
- **Real-world consequence:** Several things can regress with a green suite:
  - an unauthenticated server function;
  - a route that forgets to charge quota;
  - a relay redirect that escapes the allow-list;
  - auth silently falling back to the shared preview client.

  None of the security hardening in commit `1efd948` ("harden every endpoint") has a route-level regression test.
- **Recommended fix:** Add route-level tests that build a `Request` and call the exported handler (or a Nitro/H3 test app) with PGLite:
  - unauthenticated → 401/403 for each server fn and route;
  - user A cannot read user B's vault;
  - guest quota exhaustion → 429 on `/api/download`, `/api/relay` (googlevideo) and `/api/builder`;
  - relay redirect to a non-allow-listed host → refused;
  - auth config with `GROK_AUTH_CLIENT_*` unset in production → fails closed.

  Add a coverage threshold over *all* files (`--test-coverage-include='src/**'`, `--test-coverage-lines=…`).
- **Verification procedure:** Re-run the lcov comparison. Every `src/routes/api/*.ts` and `src/lib/auth/{middleware,server}.ts` must appear in lcov with >70 % lines. Mutation check: delete `.middleware([authMiddleware])` from one server fn and confirm a test fails.
- **Status:** CONFIRMED

### TEST-03 — The operator gate that guards live `npm`/`pip install` and proxy management is tested only through injected fakes
- **Severity:** P1
- **Category:** Authorization tests / mocks-only tests
- **Blocks:** Both
- **Affected files:**
  - `src/lib/user-proxy-actions.test.ts:21-47`
  - `src/lib/user-proxy.ts:46-50,75-83,170-180`
  - `src/lib/operator-gate.server.ts` (never loaded)
  - `src/lib/tool-updates.server.ts` (never loaded)
  - `src/lib/tool-updates.ts` (never loaded)
- **Description:** "Given guest and nonoperator contexts, … Then the gate denies before any database operation" passes its own `gate = async () => { throw … }` into `proxyActionHandlers`. It proves only that each handler calls whatever gate it receives. The real server functions pass `gate: async () => undefined` for `listUserProxies` and `listProxyOperations` (`user-proxy.ts:75`, `:170`) and gate inside `run` instead, so the test's guarantee does not hold for them. The real `operatorGate()` never runs under test. It covers:
  - the DB email lookup with the `emailVerified` check;
  - the `authConfigured=false` → socket-IP path;
  - `VELO_ALLOW_TOOL_INSTALL`.

  The tool-install server functions (which run `npm install` / `pip install` on the live server) have no test at all. Only the pure `operatorDecision` in `tool-versions.test.ts` is covered.
- **Evidence:** Quote from `user-proxy-actions.test.ts:40`: `const gate = async () => { throw new ProxyActionError("forbidden", "Not allowed."); };`. Quote from `user-proxy.ts:75`: `proxyActionHandlers.listUserProxies({ userId: context.userId, gate: async () => undefined, run: async () => { … proxyManagementGate(context.userId) …`. The lcov never-loaded list includes `operator-gate.server.ts`, `tool-updates.server.ts` and `tool-updates.ts`.
- **Real-world consequence:** A regression in the email/allow-list lookup, or in the auth-off IP path (e.g. trusting a forwarded header), would pass CI and give a remote user an RCE-class capability (package installs on the server).
- **Recommended fix:** Test `operatorGate`/`proxyManagementGate` against PGLite with seeded users (verified vs unverified email, allow-listed vs not, auth off with a loopback vs non-loopback socket IP, and spoofed `x-forwarded-for`). Invoke the actual `createServerFn` handlers for tool install as a guest and as a non-operator and assert they are refused before any `spawn`.
- **Verification procedure:** Mutation: make `operatorDecision` return `allowed: true` when `email` is null. At least one test must fail.
- **Status:** CONFIRMED

### TEST-04 — Per-user cookie-vault isolation and plaintext-fallback mode have zero tests
- **Severity:** P1
- **Category:** Data isolation / security regression tests
- **Blocks:** Both
- **Affected files:** `src/lib/vault.ts` (never loaded), `migrations/0002_youtube_vault.sql:2` (`user_id text primary key`), `src/lib/vault-crypto.test.ts`
- **Description:** The vault stores users' Google/YouTube session cookies (SID/SAPISID). Only the AES-GCM envelope is tested (`vault-crypto.test.ts`, 98 %). Nothing covers:
  - that the vault server functions read and write strictly by the verified `context.userId`;
  - that user B cannot read user A's row;
  - what happens with `VELO_VAULT_KEY` unset (the brief notes plaintext storage with a warning only).
- **Evidence:** The lcov never-loaded list includes `src/lib/vault.ts`. `grep -c "userId\|user_id" src/lib/vault.ts` → 6 references, none exercised.
- **Real-world consequence:** A cross-tenant leak of Google session cookies is an account-takeover-grade incident, and nothing in the suite would catch a regression.
- **Recommended fix:** PGLite-backed tests: two users save different cookies, and each reads back only their own. A server fn called with no session is refused. A production-shaped env without `VELO_VAULT_KEY` must refuse to store (or the test pins the intended behaviour).
- **Verification procedure:** Mutation: drop the `where user_id = …` clause in `vault.ts`. A test must fail.
- **Status:** CONFIRMED

### TEST-05 — 5 media-parser tests silently pass with zero assertions (fixtures in `/tmp` that never exist)
- **Severity:** P2
- **Category:** Vacuous tests
- **Blocks:** OSS release
- **Affected files:**
  - `src/lib/h264-syntax.test.ts:8-14,37-43`
  - `src/lib/nal-h264.test.ts:13-19,34-40`
  - `src/lib/mpeg-ts.test.ts:48-55` (fully vacuous), `src/lib/mpeg-ts.test.ts:8-18` (stops after 2 trivial asserts)
  - `src/lib/iso-bmff.test.ts:62-67` (falls back to a synthetic buffer, OK)
- **Description:** These tests `readFileSync("/tmp/dash137.bin")` or `"/tmp/hls-ts.bin"` and `return;` in the `catch`. The fixtures are not in the repo, nothing generates them, and `grep` finds the names only in these four test files. So the tests never assert anything anywhere: Windows, Linux Docker, or a clean clone. They still report ✔:
  - "H.264 SPS is High 4.0 1920×1080…"
  - "HLS GOP: IDR I, then P and B slices"
  - "HLS TS Annex-B: AUD SPS PPS SEI IDR, High@4.0"
  - "DASH CMAF: avcC High@4.0…"
  - "DASH sidx: 38 fragments, 213.04s…"
- **Evidence:** `ls /tmp/dash137.bin /tmp/hls-ts.bin C:/tmp/dash137.bin` → `No such file or directory` (all three). Code quote (`h264-syntax.test.ts:10-14`): `try { dash = new Uint8Array(readFileSync("/tmp/dash137.bin")); } catch { return; }`.
- **Real-world consequence:** The SPS/slice parsing, Annex-B splitting and sidx planning behind 4K muxing look tested but are not. Test counts overstate coverage by at least 5.
- **Recommended fix:** Commit small trimmed fixtures (a few KB, or synthetic ones like `syntheticDashHead()` in iso-bmff) under `src/lib/__fixtures__/`, or use `t.skip("fixture missing")` so they show as skipped instead of passing.
- **Verification procedure:** Run with `--test-reporter=spec`. These tests must show assertions (or "skipped"). Mutation: break `parseSps` width decoding, and a test must fail.
- **Status:** CONFIRMED

### TEST-06 — Security routing properties "tested" by regex over source text
- **Severity:** P2
- **Category:** Implementation-detail tests
- **Blocks:** Both
- **Affected files:**
  - `src/lib/ytdlp-fallback-contract.test.ts:5-28`
  - `src/lib/ytdlp-meta-routing.test.ts:38-45`
  - `scripts/browser-smoke-verdict.test.mjs:375,404`
  - `scripts/grok-pwa-plugin.test.mjs:487-497`
- **Description:** The rule "Only saved proxies receive trusted-proxy authority" (i.e. user cookies are never sent through free public SOCKS proxies) is checked with:
  - `assert.match(source, /cookiePath: proxy && !trustedProxy \? undefined : cookiePath/)`;
  - `indexOf` ordering of string literals such as `"Direct is the final fallback"` (a comment) in `ytdlp.server.ts`.

  A rename or reformat breaks these tests without any behaviour change. Worse, a behavioural regression elsewhere (e.g. `trustedProxy` computed wrongly, or a second call site) passes. `ytdlp.server.ts` itself is never executed by any test.
- **Evidence:** Quotes from `ytdlp-fallback-contract.test.ts:6-11,23-27`, shown above. lcov: `ytdlp.server.ts` never loaded.
- **Real-world consequence:** The most privacy-critical property of the download path (session cookies must not transit anonymous free proxies) has no behavioural test.
- **Recommended fix:** Refactor `muxOne` so that spawn and proxy selection are injectable. Then assert, with a fake runner, the argv of each attempt when cookies are present: `--cookies` appears only for the direct attempt or a saved/trusted proxy, and never with a free-pool proxy.
- **Verification procedure:** Mutation: in `ytdlp.server.ts:178` change `proxy && !trustedProxy ? undefined : cookiePath` to `cookiePath`. A behavioural test must fail. Today it does not fail as long as the regex text is left in a comment.
- **Status:** CONFIRMED

### TEST-07 — Lint cannot fail: every rule is `warn`; 189 warnings incl. 35 dead imports in `ytdlp-proc.server.ts`
- **Severity:** P2
- **Category:** Static analysis gate
- **Blocks:** OSS release
- **Affected files:** `eslint.config.mjs:40-48`, `src/lib/ytdlp-proc.server.ts:3-31`, `src/components/{transcript-sidebar,bulk-downloader,transcript-form,transcript-reader}.tsx`, `src/lib/hybrid-net.ts`
- **Description:** `no-unused-vars`, `react-refresh` and the react-hooks rules are all `warn`, and no `--max-warnings` is set. `npm run lint` exits 0 with 189 warnings. `scripts/auto-update.mjs:178-180` uses lint as a "gate", so it only catches parse errors. `ytdlp-proc.server.ts` imports 35 unused symbols (`ytdlpArgv`, `takeSocks`, `muxCachePut`, …), a sign of a half-finished refactor. Some `exhaustive-deps` warnings in `src/routes/index.tsx:83-105` are real stale-closure risks.
- **Evidence:** `npm run lint` → `✖ 189 problems (0 errors, 189 warnings)`, exit 0, 12 s. Per-file counts: ytdlp-proc.server.ts 35, transcript-sidebar 31, bulk-downloader 31, transcript-form 29, transcript-reader 23, hybrid-net 12.
- **Real-world consequence:** Dead code ships, hook bugs get through, and the "verified" auto-update PRs are weaker than advertised.
- **Recommended fix:** Remove the dead imports, then run `eslint . --max-warnings=0` in CI, or promote `no-unused-vars` and `react-hooks/exhaustive-deps` to `error`.
- **Verification procedure:** `npm run lint -- --max-warnings=0` exits 0.
- **Status:** CONFIRMED

### TEST-08 — No E2E, UI or extension tests; browser smoke only checks that `/` renders text
- **Severity:** P2
- **Category:** E2E / UI / extension coverage
- **Blocks:** Both
- **Affected files:** `scripts/browser-smoke.mjs:98-140`, `extension/`, `extensions/velo-session/`, `src/components/**` (0 tests)
- **Description:** `browser-smoke.mjs` does one `page.goto(url, {waitUntil:"domcontentloaded"})` per viewport (1280×800, 390×844). It records body-text length, console/page errors, horizontal overflow and a screenshot. It does not click, paste a URL, start a download, sign in, open the vault or Tools tab, or wait for hydration. On my run the desktop title was still `"Loading http://127.0.0.1:8095/"`, i.e. captured before hydration, and the verdict was still ok. Both MV3 extensions (messaging between popup, service worker and page, session capture) have no tests. No component is ever rendered in a test.
- **Evidence:**
  - `find extension extensions -name "*.test.*" | wc -l` → 0; `find src/components -name "*.test.*" | wc -l` → 0.
  - Smoke run in the clean clone (`node scripts/browser-smoke.mjs http://127.0.0.1:8095/ screenshots/smoke.png`): exit 0, 4 s, `"title": "Loading http://127.0.0.1:8095/"`, `consoleErrors: []`.
  - It also printed a `BRAND NOTE` pointing to `\workspace\.grok\skills\og\SKILL.md`, a Grok-sandbox path that does not exist.
- **Real-world consequence:** The core user journeys (paste → formats → download → mux, transcript fetch, bulk queue, sign-in, extension handoff) can break with every gate green.
- **Recommended fix:** Add Playwright E2E against a dev or preview server with network stubbed via `page.route` (fixture InnerTube/player responses): home → paste URL → format list → download starts, and transcript tab. Add extension tests with Playwright's `launchPersistentContext` + `--load-extension`, or unit-test message handlers with a `chrome.*` stub.
- **Verification procedure:** CI job runs `npx playwright test`. Break the format-list rendering and the job fails.
- **Status:** CONFIRMED

### TEST-09 — Skipped tests hide the auth-default contract; in every clone the reality is auth ON
- **Severity:** P2
- **Category:** Skipped tests / environment-dependent tests
- **Blocks:** OSS release
- **Affected files:** `scripts/with-app-env.test.mjs:62-70,82`, `scripts/check-auth-invariant.test.mjs:93-104`, `src/lib/auth/client.ts:9`, `src/lib/auth/server.ts:23,75`, `.gitignore` (`.grok/`)
- **Description:** "the template ships auth off" and "the build side resolves the template's shipped app-env" skip whenever `.grok/app-env.json` is missing. The comment admits the file is absent in a plain clone, because `.grok/` is gitignored. So nothing that runs outside the Grok sandbox ever checks the property. It is false in practice: without the file `VITE_AUTH_ENABLED` is undefined, `authEnabled = … !== "false"` → **true**, and the server falls back to the committed preview broker client (see INST-01).
- **Evidence:** `npm test` → `ℹ skipped 3` in the `.mjs` part. In the clean clone, dev `/__app-env` returned `{"BASE_URL":"/","MODE":"development","DEV":true,"PROD":false}` (no `VITE_AUTH_ENABLED`), and the page showed "No session" (auth UI active).
- **Real-world consequence:** Docs and tests claim "auth off by default", but contributors and self-hosters actually run with auth on through a third party's shared OAuth client.
- **Recommended fix:** Make the default explicit in committed config (e.g. `VITE_AUTH_ENABLED` defaults to `"false"` when unset, or commit a non-secret `app-env.example.json`). Replace the skips with a test of the resolved default for an empty env.
- **Verification procedure:** In a fresh clone, `npm test` reports 0 skipped for these, and `curl /__app-env` shows the intended value.
- **Status:** CONFIRMED

### TEST-10 — `npm run check:auth` is unusable standalone (hard-coded 8080, Grok-sandbox endpoint)
- **Severity:** P3
- **Category:** Tooling
- **Blocks:** OSS release
- **Affected files:** `scripts/check-auth-invariant.mjs:27` (`DEFAULT_DEV_URL = "http://127.0.0.1:8080"`), `scripts/app-env-plugin.mjs`
- **Description:** The check needs a running `npm run dev` on 8080 that serves `/__app-env`. With no server, or anything else on 8080, it exits 2 ("could not observe"). It guards a Grok-sandbox invariant, not a product property.
- **Evidence:** `npm run check:auth` → `[auth-invariant] could not read the dev server's resolved VITE_AUTH_ENABLED`, exit 2, 1 s. (Port 8080 was held by another process that returns 404 for `/__app-env`.)
- **Real-world consequence:** It cannot run in CI without extra orchestration, and it confuses contributors.
- **Recommended fix:** Accept a URL argument or env var and document it, or drop it together with the Grok scaffolding.
- **Verification procedure:** `npm run check:auth -- http://127.0.0.1:<port>` exits 0 against a dev server.
- **Status:** CONFIRMED

### TEST-11 — The weekly auto-update gate omits `npm run build`, so it can open PRs with a broken build
- **Severity:** P2
- **Category:** CI / dependency updates
- **Blocks:** OSS release
- **Affected files:** `scripts/auto-update.mjs:173-180`, `.github/workflows/auto-update.yml:40-50`
- **Description:** The updater verifies each bump with `typecheck` + `test` + `lint` (and lint cannot fail, TEST-07). Many of the tracked deps (vite, nitro beta, @tanstack/react-start, rolldown) break the build, not the unit tests, and the build is never run. The PR body still claims "Every package here was installed and then verified".
- **Evidence:** `grep -n '"typecheck"\|"lint"\|"build"' scripts/auto-update.mjs` shows `["typecheck", ["run", "typecheck"]]` … `["lint", ["run", "lint"]]` and no build step.
- **Real-world consequence:** Green auto-update PRs that break the Vercel deploy.
- **Recommended fix:** Add `npm run build` (with a DATABASE_URL-less build) to the verification list, and ideally a smoke of the built output.
- **Verification procedure:** Pin a vite version known to break the build. The updater must roll it back.
- **Status:** CONFIRMED

### TEST-12 — gate-identity test swallows a thrown `setCookie` error; session-cookie expiry is never asserted
- **Severity:** P3
- **Category:** Tests that pass over errors
- **Blocks:** Neither
- **Affected files:** `src/lib/auth/gate-identity.test.ts:369`, `src/lib/auth/gate-session.server.ts:112,165-166`
- **Description:** During the gate-identity suite, `signOutUnverifiedSession` → `expireSessionDataCookie` calls TanStack `setCookie` outside a request context. It throws `No StartEvent found in AsyncLocalStorage`, the code logs it, and the test passes. The "expire the stale session_data cookie" behaviour is therefore never verified. `gate-session.server.ts` sits at 47 % line coverage.
- **Evidence:** Test log: `[gate-identity] TanStack setCookie (expire session_data) failed Error: No StartEvent found in AsyncLocalStorage … at expireSessionDataCookie (…gate-session.server.ts:112:5) … at async TestContext.<anonymous> (…gate-identity.test.ts:369:23)` (twice).
- **Real-world consequence:** A stale, unverified session cookie might not be cleared in production, and the tests would not notice.
- **Recommended fix:** Inject the cookie setter, or run the handler inside a TanStack/H3 request context, and assert the `Set-Cookie: session_data=; Max-Age=0` header.
- **Verification procedure:** The test log has no "failed Error", and there is an assertion on the header.
- **Status:** CONFIRMED

### TEST-13 — Template leftovers under test (Grok connectors) and global TLS-disable in one test file
- **Severity:** P3
- **Category:** Test hygiene
- **Blocks:** Neither
- **Affected files:** `src/lib/app-data/app-data.test.ts` (Grok connectors / GoogleDrive `callTool`, `GROK_CONNECTORS_URL`), `src/lib/ipv4-bind.test.ts:89-98`
- **Description:** `app-data.test.ts` tests Grok App Builder connector plumbing that is unrelated to the product. `ipv4-bind.test.ts` sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` for its local TLS server and restores it afterwards. This is safe today only because `node --test` isolates each file in its own process, and it prints a Node security warning in every run.
- **Evidence:** Test output: `(node:55276) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure…`
- **Real-world consequence:** Noise, plus a trap if someone later runs tests with `--test-isolation=none`.
- **Recommended fix:** Delete the template connector code and tests if unused. Pass a CA or `rejectUnauthorized:false` to the specific agent instead of the global env var.
- **Verification procedure:** The test output no longer contains the TLS warning.
- **Status:** CONFIRMED

### TEST-14 — `mediaFileResponse` test is tautological about the filename
- **Severity:** P3
- **Category:** Weak assertion
- **Blocks:** Neither
- **Affected files:** `src/lib/download-pool.server.test.ts:103-121`, `src/lib/download-pool.server.ts:269`
- **Description:** Production hard-codes `filename="media.${ext}"`. The test only uses fixtures named `media.mkv`, `media.mp4` and so on, and asserts `filename="${filename}"`, so it passes whether or not the real name is kept. My probe with `"My Video [abc].mkv"` got `Content-Disposition: attachment; filename="media.mkv"`. That may be intended (the client names the save), but the test cannot tell.
- **Evidence:** Probe output: `[probe] Content-Disposition for 'My Video [abc].mkv' = attachment; filename="media.mkv"`.
- **Real-world consequence:** Low. The test gives false confidence about header construction and filename sanitisation.
- **Recommended fix:** Use a non-`media` fixture name and assert the intended behaviour explicitly.
- **Verification procedure:** The test fails if the header format changes.
- **Status:** CONFIRMED

### TEST-15 — `scripts/migrate.mjs` has no automated test against real Postgres (manually verified OK)
- **Severity:** P3
- **Category:** Migration tests
- **Blocks:** OSS release
- **Affected files:** `scripts/migrate.mjs`, `scripts/migration-plan.test.mjs`, `migrations/0001-0005*.sql`
- **Description:** Only the planning function (`pendingMigrations`) and a PGLite application of 0004/0005 are tested. The real `pg` path (transactions, the `_migrations` table, concurrent-deploy `23505` handling) is not. I ran it manually against Postgres 16 and it worked and was idempotent. A dev server then booted against that DB and `/api/health` reported ok.
- **Evidence:**
  - Setup: `docker run … -p 127.0.0.1:55439:5432 postgres:16-alpine`, `DATABASE_URL=postgres://postgres:***@127.0.0.1:55439/postgres node scripts/migrate.mjs`.
  - First run: `[migrate] applied 0001_auth.sql … 0005_proxy_operations.sql`, `done — 5 migration(s) applied.`, exit 0.
  - Second run: `[migrate] up to date.`, exit 0.
  - `\dt` shows 11 tables. `/api/health` returned `{"database":{"source":"neon","ok":true}}`. The label says "neon" for plain Postgres; see INST-12.
- **Real-world consequence:** A future migration using syntax PGLite accepts and Postgres rejects (or the reverse) would only fail at Vercel deploy time.
- **Recommended fix:** A CI job with a `postgres:16` service that runs `migrate.mjs` twice, applies the migrations to PGLite too, and diffs the schemas.
- **Verification procedure:** The CI job is green and fails on a deliberately broken migration.
- **Status:** CONFIRMED (manual pass); automated test missing

### TEST-16 — Windows process-tree kill path is untested (test skipped on win32)
- **Severity:** P3
- **Category:** Platform coverage / abort behaviour
- **Blocks:** Neither
- **Affected files:** `src/lib/proc-run.server.test.ts:23`, `src/lib/proc-run.server.ts:8-28,48`
- **Description:** `killTree` uses `process.kill(-pid)` (POSIX process group) and falls back to killing only the parent. On Windows the group test is skipped. My scratchpad probe with a Node grandchild found no survivor, but that is likely libuv's job object, which does not apply to a Python yt-dlp that spawns ffmpeg via `subprocess`. Also, `detached: true` on Windows gives each child its own console.
- **Evidence:** Probe `probe-killtree.test.ts`: `[probe] grandchild 62656 alive after stall kill: false`. On Linux Docker, the repo test `ok 165 - a stall kill takes the whole process group` passed.
- **Real-world consequence:** On Windows self-hosts, a stalled or aborted download may leave orphaned ffmpeg or yt-dlp processes and temp files, including `cookies.txt` dirs. NOT VERIFIED with real yt-dlp.
- **Recommended fix:** On win32 use `taskkill /pid <pid> /T /F`, and add a win32 test with a non-Node grandchild.
- **Verification procedure:** On Windows, stall a real `python -m yt_dlp` download and confirm that no `ffmpeg.exe` or `python.exe` survives.
- **Status:** NOT VERIFIED (for the Python/ffmpeg case)

### TEST-17 — Positive: suite is hermetic, fast and deterministic, which is a good base for CI (info)
- **Severity:** P3
- **Category:** Info
- **Blocks:** Neither
- **Affected files:** whole suite
- **Description:** 714 tests run in ~35 s. They pass identically on Windows and on Linux with `--network none`, with no flakes across 5 runs. Timing-sensitive tests (idle kill, deadlines) held up. Adding CI (TEST-01) is therefore cheap.
- **Evidence:** In the offline Linux Docker run, `# pass 535  # fail 0  # skipped 0`, exit 0.
- **Real-world consequence:** None. This is an enabler.
- **Recommended fix:** None beyond TEST-01.
- **Verification procedure:** n/a
- **Status:** CONFIRMED

### TEST-18 — Relay allow-list tests do not cover ports; `isRelayTarget` accepts any port
- **Severity:** P3
- **Category:** SSRF guard tests
- **Blocks:** Neither
- **Affected files:** `src/lib/cors-relays.ts:26-38`, `src/lib/cors-relays.test.ts`
- **Description:** The host allow-list is solid. It rejects suffix tricks, userinfo `@`, fragments, trailing dots and IDN look-alikes (probe results below). It never checks `url.port`, and the tests never try non-443 ports. The targets are still YouTube/Google hosts, so exploitability is low, but the relay can be pointed at arbitrary ports on those hosts.
- **Evidence:** Probe output:
  - `isRelayTarget "https://www.youtube.com:8443/" => true`
  - `"https://r1---sn-x.googlevideo.com:22/videoplayback" => true media: true`
  - `"https://www.youtube.com@evil.example/" => false`
  - `"https://www.youtube.com.evil.example/" => false`
  - `"https://WWW.YOUTUBE.COM./watch" => false`
- **Real-world consequence:** Minor. Unexpected upstream ports, and possible quota or relay abuse edge cases.
- **Recommended fix:** Require `url.port === ""` and add cases to the test.
- **Verification procedure:** The new tests fail on the current code and pass after the fix.
- **Status:** CONFIRMED

## Not verified / out of scope

- Real YouTube download, mux or transcript flows (no live traffic was generated). The yt-dlp end-to-end cookie temp-file lifetime is not verified; the cancel-path cleanup callback was probed and works.
- Route-level behaviour of quota and relay under a real server (other auditors cover the code; I only mapped the missing tests).
- macOS: not run.
- Coverage of the `scripts/*.test.mjs` part (not instrumented; those files are Grok template tooling).
- Mutation testing: suggested as a verification step only; not executed.
