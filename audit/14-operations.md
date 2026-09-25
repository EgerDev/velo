# 14 — Operations / SRE Readiness Audit (prefix OPS-)

Auditor: **privops** (privacy engineer + SRE). Date: 2026-09-23. Target: working tree of `C:\Users\PC\orca\velo` (HEAD `81cbd95` + uncommitted changes), deploy target Vercel via Nitro `preset: "vercel"`.

## Scope & method

The question for this audit: if real users arrive on Vercel tomorrow, can we **detect** and **recover** from each failure class? I read `routes/api/health.ts`, `lib/db.ts`, `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `vite.config.ts`, `.github/workflows/auto-update.yml`, `startup.sh`, `vault-crypto.ts`, the subprocess layer (`proc-run.server.ts`, `ytdlp-proc.server.ts`, `ytdlp.server.ts`, `ytdlp-python.server.ts`, `socks-pool.server.ts`, `tool-updates.server.ts`), `download-pool.server.ts`, `po-token.server.ts`, `guest-limit.server.ts`, and every `console.*` call. I inspected the **local** build artifact `.vercel/output/` (gitignored, so it may be stale relative to the tree) for bundled binaries and function config. I made no deploys, called no Vercel APIs, and started no servers.

## Summary table

| ID | Sev | Title | Blocks |
|---|---|---|---|
| OPS-01 | P0 | No way to see an outage: no error monitoring, no alerting, no server-side logging of download/extraction failures. `/api/health` checks only the DB and nothing watches it | Website launch |
| OPS-02 | P0 | No incident-response or credential-compromise runbook for a service that holds users' Google sessions. DB and vault key sit in the same Vercel env, and there is no mass-revoke or notify mechanism | Website launch |
| OPS-03 | P1 | The "most reliable path" (python/yt-dlp, curl, ffmpeg) is not in the Vercel bundle and fails silently in production | Website launch |
| OPS-04 | P1 | Workload vs Vercel limits: no `maxDuration`, an 8-min ladder, multi-GB streams through one function, a 400 MB disk cache against a 512 MB `/tmp` | Website launch |
| OPS-05 | P1 | Deploy-time migrations run in `npm run build` against `DATABASE_URL` (preview builds too). No down migrations, rollback does not revert schema, no documented backup/PITR | Both |
| OPS-06 | P1 | A missing `DATABASE_URL` silently puts production on per-instance in-memory PGLite, and `/api/health` still reports `200 ok` | Website launch |
| OPS-07 | P1 | Rotating the cookie vault key is impossible: no `VELO_VAULT_KEY_PREVIOUS` for cookies (proxy secrets have it). Rotation bricks every vault, and the client hides the error | Both |
| OPS-08 | P1 | Denial of wallet and IP bans: quotas are per-instance in-memory, all bytes are proxied through Vercel egress, YouTube blocks datacenter IPs, and the app depends on free third-party infrastructure with no SLA | Website launch |
| OPS-09 | P2 | No CI gate: tests/typecheck/lint/build never run on push or PR. The only workflow is a write-scoped weekly auto-updater | Both |
| OPS-10 | P2 | The live npm/pip installer targets an immutable, per-instance serverless filesystem and hands all secrets to package lifecycle scripts | Both |
| OPS-11 | P2 | In-memory per-instance state (slots, rate limits, SOCKS pool, "direct blocked" bit, jsdom bound to `globalThis`) behaves inconsistently under Fluid / multi-instance | Website launch |
| OPS-12 | P2 | DB connection handling: two default `pg` Pools per instance, no connection/statement timeouts, no Fluid pool attach | Website launch |
| OPS-13 | P2 | Logging hygiene: unstructured `console.*`, no request IDs, raw error objects, one session-token leak (PRIV-11), no retention/drain config | Both |
| OPS-14 | P3 | Runtime code/config pulled from mutable upstreams (`--remote-components ejs:github`, proxifly `@main`, grok.com script) with no pinning or fallback visibility | Both |
| OPS-15 | P3 | `startup.sh` / AGENTS.md sandbox contract ships in the product repo. `startup.sh` logs to `/tmp` with no rotation | OSS release |

---

## Failure-mode matrix (detect / recover)

| Failure | Detect today? | Recover today? | Evidence |
|---|---|---|---|
| App crash / 5xx | Only Vercel's built-in dashboard, if someone looks. No alert | Vercel restarts instances; manual rollback | No error-reporting SDK (grep for sentry/datadog etc. is empty) |
| DB down | `/api/health` → 503, **but nothing polls it** | Neon-side only | `grep -rn "api/health"` hits only its own file |
| DB misconfigured (unset) | **No.** Health says `ok`, `source: "pglite"` | Data silently lost per instance | OPS-06 |
| YouTube breaks extraction (most likely outage) | **No.** Failures go back to the client as JSON and are never logged | Weekly auto-update PR (human merge) | OPS-01 |
| Free SOCKS list / jsDelivr down | No (silent `catch {}`) | Falls back to direct | `socks-pool.server.ts:117-119` |
| CORS relays down | No | Next relay / next path | `bypass.ts:364-372` |
| Grok auth broker down | No | None. Sign-in impossible | `server.ts:131-137` static endpoints |
| grok.com script down | No | Page still works (`defer`) | `grok-pwa-shared.mjs:238` |
| High error rate / latency | No metrics | — | No metrics code anywhere |
| Memory/CPU exhaustion | Vercel OOM kill only | Instance recycle | OPS-04 / OPS-11 |
| Disk (`/tmp`) exhaustion | No | 10-min cache TTL, 30-min sweeper | `download-pool.server.ts:15-18`, `ytdlp-python.server.ts:22-47` |
| Runaway subprocess | Idle timeouts + process-group kill on abort (good) | `killTree` | `proc-run.server.ts:36-99`, `ytdlp-proc.server.ts:64-90` |
| YouTube cookies expire | Per user, manually ("Test connection") | User re-imports | `vault.ts:57-142` |
| Vault key rotation | — | **Impossible without data loss** | OPS-07 |
| TLS certificate expiry | Vercel-managed (custom domain: NOT VERIFIED) | Vercel auto-renew | — |
| Failed deployment | Vercel build fails, previous deploy stays live | Instant Rollback | — |
| Bad migration | Build fails **after** partial files may have committed | **None** (no down migrations) | OPS-05 |
| Accidental data deletion | No audit trail for vault; proxy events only | Neon PITR if the plan has it (NOT VERIFIED) | OPS-05 |
| Credential compromise | No | No runbook | OPS-02 |

---

## Findings

### OPS-01 — No way to see an outage: no error monitoring, no alerting, no server-side logging of download/extraction failures. `/api/health` checks only the DB and nothing watches it
- **Severity:** P0
- **Category:** Observability
- **Blocks:** Website launch
- **Affected files:** `src/routes/api/health.ts:9,37-83`; `src/routes/api/ytdlp.ts:45-57`; `src/routes/api/builder.ts`; `src/routes/api/download.ts`; `src/routes/api/relay.ts`; `src/lib/ytdlp.server.ts:292-309`
- **Description:** Extraction breaking is this product's most likely outage: YouTube changes the player, bot walls, or blocks IPs. When it happens, every route turns the error into `Response.json({ error }, { status: 502 })` and **writes nothing to logs**. `grep -rn "console\." src/routes` returns nothing. The whole server has 25 `console.*` calls, and none sit on the download/extraction path apart from one `-J` size warning. `/api/health` checks only a DB `select 1` (plus `?deep=1` checks for the `verification` table). It does not probe YouTube or InnerTube, the PO-token minter, Python or yt-dlp, or the SOCKS pool. Its comment mentions "the /status page", which does not exist (routes are `/`, `/login`, `/api/*`). Nothing references `/api/health`: no Vercel cron, no uptime config, no docs. There is no error-reporting SDK and no metrics.
- **Evidence:**
  ```
  $ grep -rn "api/health\|/status" src scripts vite.config.ts README.md | grep -v routeTree
  src/routes/api/health.ts:9: * This gives a monitor (or the /status page) one cheap URL to watch.
  src/routes/api/health.ts:62:export const Route = createFileRoute("/api/health")({
  $ grep -rnoiE "sentry|datadog|posthog|@vercel/analytics|speed-insights|opentelemetry" src package.json   → (none)
  ```
- **Real-world consequence:** The first sign of an outage is users complaining on social media. The operator cannot tell "YouTube changed nsig" from "our IP is banned" from "Python is missing" without reproducing it by hand.
- **Recommended fix:**
  1. Log one structured line per failed save: `{route, videoId-hash, itag, path, failureKind, yt-dlp exit code, durationMs}`, never cookies.
  2. Add `/api/health?deep=1` stages: InnerTube `getBasicInfo` on one fixed public video (cached 5 min), PO-token mint, `requirePython()`, SOCKS pool size. Report each stage and let only DB failure turn the status to 503.
  3. Wire an external uptime monitor to `/api/health` and `/api/health?deep=1`, plus an error tracker (Sentry, or a Vercel log drain with alert rules on `failureKind` rate).
  4. Remove the dead `/status` reference.
- **Verification procedure:** Force a failure (block `youtube.com` in the function's network). Within 5 minutes an alert fires, and logs show the structured failure line.
- **Status:** CONFIRMED

### OPS-02 — No incident-response or credential-compromise runbook for a service that holds users' Google sessions. DB and vault key sit in the same Vercel env, and there is no mass-revoke or notify mechanism
- **Severity:** P0
- **Category:** Incident response
- **Blocks:** Website launch
- **Affected files:** repo-wide (no `docs/`, no SECURITY.md); `src/lib/vault-crypto.ts:47-60`; `src/lib/vault.ts`
- **Description:** If `DATABASE_URL` and `VELO_VAULT_KEY` leak (for example, one Vercel team-member compromise, since both are ordinary project env vars), the attacker has every user's Google session. The app cannot revoke those sessions, because only Google can, when each user signs out of all devices. There is no user contact channel apart from the account email, no notification tooling, no documented kill switch (turning off the vault feature), and no breach runbook. REQUIRES LEGAL REVIEW: GDPR Art. 33/34 breach-notification timelines (72 h) apply once personal data is involved.
- **Evidence:** `ls docs` is empty. There is no SECURITY.md, and README has no ops section.
- **Real-world consequence:** A slow, improvised response during the worst possible incident.
- **Recommended fix:** Adopt the runbooks below, add a `VELO_VAULT_DISABLED=1` kill switch (vault functions throw, `/api/ytdlp` ignores cookies), and prepare a user-notification template that tells users to sign out of all Google sessions.
- **Verification procedure:** Tabletop the "credential compromise" runbook end to end. Setting the kill switch disables vault reads within one deploy.
- **Status:** CONFIRMED

### OPS-03 — The "most reliable path" (python/yt-dlp, curl, ffmpeg) is not in the Vercel bundle and fails silently in production
- **Severity:** P1
- **Category:** Deployment correctness
- **Blocks:** Website launch
- **Affected files:** `src/lib/ytdlp-auth.ts:900-902` (`pythonBin()` → `"python3"`); `src/lib/ytdlp.server.ts:127`; `src/lib/socks-pool.server.ts:124-146` (`spawn("curl", …)`); `README.md:136-139`
- **Description:** yt-dlp runs as `python3 -m yt_dlp`, ffmpeg is needed to merge 137+140, and the SOCKS pool probes hops with the `curl` binary. The Vercel output function is a Node 24 bundle with no Python, yt-dlp, curl or ffmpeg binaries. If `curl` is missing, every probe resolves `false` (`child.on("error") → resolve(false)`), so the SOCKS pool is **always empty, with no log**. If Python is missing, `requirePython()` fails fast with a message the user sees, but the operator sees nothing (OPS-01). README calls this "1080p muxing over SOCKS, the most reliable path".
- **Evidence:**
  ```
  $ du -sh .vercel/output/functions/__server.func            → 34M
  $ find .vercel/output/functions/__server.func -maxdepth 3 \( -iname "*yt*dlp*" -o -iname "python*" -o -iname "ffmpeg*" -o -iname "curl*" \)
  …/_libs/ffmpeg__ffmpeg.mjs  …/_ssr/ffmpeg-core-*.mjs  …/_ssr/ytdlp-auth-*.mjs  …/_ssr/ytdlp.server-*.mjs   (JS chunks only; no binaries)
  $ cat .vercel/output/functions/__server.func/.vc-config.json → {"handler":"index.mjs","launcherType":"Nodejs",…,"runtime":"nodejs24.x"}
  ```
- **Real-world consequence:** In production, 1080p+ and signed-in saves silently degrade to the InnerTube/browser paths, or fail. Capacity planning done against a sandbox with yt-dlp installed does not describe production.
- **Recommended fix:** Decide the production architecture explicitly. Either (a) run the yt-dlp worker on a container host (Fly, Render, a VM) behind a queue and keep Vercel for UI/API, or (b) drop yt-dlp claims for the Vercel build. Replace the `curl` probe with a Node `SocksProxyAgent` probe, which is already a dependency (`proxy-transport.server.ts:143`). Expose `python`/`ffmpeg`/`curl` availability in `/api/health?deep=1`.
- **Verification procedure:** On a Vercel preview, `/api/health?deep=1` reports `python: missing` (or present, if a worker exists). A 1080p signed-in save either works or shows a clear "not available on this deployment" message.
- **Status:** CONFIRMED (bundle contents). Runtime binary absence on Vercel: NOT VERIFIED live. Standard Vercel Node runtimes do not document python3/curl/ffmpeg availability.

### OPS-04 — Workload vs Vercel limits: no `maxDuration`, an 8-min ladder, multi-GB streams through one function, a 400 MB disk cache against a 512 MB `/tmp`
- **Severity:** P1
- **Category:** Capacity / platform limits
- **Blocks:** Website launch
- **Affected files:** `vite.config.ts:207-215` (no `vercel.functions` config); `.vercel/output/functions/__server.func/.vc-config.json` (no `maxDuration`, no `memory`); `src/lib/ytdlp.server.ts:115-116` (`LADDER_BUDGET_MS = 8 * 60_000`); `src/lib/download-pool.server.ts:12-18`; `src/lib/ytdlp-auth.ts:92-100`
- **Description:** Every route, including every media byte, is served by a single `__server` function. No `maxDuration` is configured, so the platform default applies (Fluid compute default is 300 s; the ceiling depends on plan, NOT VERIFIED for this project). That is shorter than the 8-minute ladder budget and shorter than a slow 4K transfer: the code comment notes "a 689 MB 4K file took up to 178s", and that was the fast case. The mux cache allows 400 MB in `tmpdir()`, while Vercel functions get 512 MB of `/tmp`. Add in-flight yt-dlp temp dirs (up to `MAX_YTDLP = 4` concurrent), and one 4K job can hit `ENOSPC` next to a full cache. Request bodies are capped at 4.5 MB on Vercel. Cookie bodies are ≤400 KB and HARs are parsed client-side, so that limit is fine.
- **Evidence:** `.vc-config.json` shown in OPS-03. `download-pool.server.ts:18` `const CACHE_MAX_BYTES = 400 * 1024 * 1024;`
- **Real-world consequence:** Large downloads cut off mid-stream with a truncated file, and 504s on the fallback ladder. Billing grows with function duration × memory for every streamed byte.
- **Recommended fix:** Set an explicit `maxDuration` and memory through Nitro's `vercel` options, sized to the plan. Cap the ladder budget below it. Cap the cache at ≤150 MB, or turn it off on Vercel. Better still, redirect clients to a worker, or stream from googlevideo straight to the browser wherever possible.
- **Verification procedure:** A 4K save of a 20-minute video on a preview deploy either completes or fails with a clear duration error. `df /tmp` stays under 80 % during 4 concurrent saves.
- **Status:** CONFIRMED (config). Actual limits for this plan: NOT VERIFIED.

### OPS-05 — Deploy-time migrations run in `npm run build` against `DATABASE_URL` (preview builds too). No down migrations, rollback does not revert schema, no documented backup/PITR
- **Severity:** P1
- **Category:** Change management / data safety
- **Blocks:** Both
- **Affected files:** `package.json` (`"build": "… vite build && npm run db:migrate"`); `scripts/migrate.mjs:5-7,21-27,45-92`; `migrations/0005_proxy_operations.sql`
- **Description:** Every `npm run build` with `DATABASE_URL` in the environment applies pending migrations. On Vercel that includes **every preview deployment of every branch or PR** whenever the variable is exposed to the Preview environment. Unreviewed schema from a feature branch can reach the production DB before merge. Migrations apply *before* the new deployment is promoted, so during the build the old code runs against the new schema. Vercel Instant Rollback reverts code, not schema. There are no down migrations and no guidance on writing backward-compatible (expand/contract) changes. `0005` is a non-trivial `ALTER` plus backfill plus new constraints. The migrator takes no lock (by design, see its comment) and relies on `_migrations_pkey` conflicts. Backups and PITR are undocumented.
- **Evidence:** `migrate.mjs:5-6` "Runs during `npm run build` — on every Vercel deploy — applying pending files in ../migrations to DATABASE_URL."
- **Real-world consequence:** A branch preview can alter prod tables. A bad migration cannot be rolled back except by hand-written SQL, and possibly not without data loss.
- **Recommended fix:** Scope `DATABASE_URL` to Production only, and give previews a Neon branch DB (Neon's Vercel integration does this). Or run migrations in a separate, gated CI job. Require expand/contract migrations, write a reverse script for each migration under `migrations/down/`, and document a Neon PITR window (confirm the plan's retention) plus a restore drill.
- **Verification procedure:** In Vercel env settings, `DATABASE_URL` is scoped to Production (NOT VERIFIED here). A test PR with a dummy migration does not appear in prod `_migrations`.
- **Status:** CONFIRMED (code). Env scoping and backups: NOT VERIFIED.

### OPS-06 — A missing `DATABASE_URL` silently puts production on per-instance in-memory PGLite, and `/api/health` still reports `200 ok`
- **Severity:** P1
- **Category:** Configuration safety
- **Blocks:** Website launch
- **Affected files:** `src/lib/db.ts:8-19,115-140`; `src/lib/auth/server.ts:144-146`; `src/routes/api/health.ts:67-75`; `vite.config.ts:55-77` (copies PGLite wasm into the Vercel function)
- **Description:** With no `DATABASE_URL` (or a blank one), the app, Better Auth included, runs on an **in-memory** PGLite per process. Auth still defaults on through the preview broker client. Users, sessions and vaults exist only on the instance that created them and vanish when it recycles. Users are "randomly signed out", and a vault saved on instance A is missing on instance B. `/api/health` returns `status: "ok"`, HTTP 200, `source: "pglite"`, so a monitor stays green. The build deliberately ships PGLite's wasm into the Vercel function.
- **Evidence:** `db.ts:19` `export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";` `health.ts:68` `const healthy = db.ok;` (no source check).
- **Real-world consequence:** A silent, total data-durability failure that looks healthy.
- **Recommended fix:** In production (`VERCEL_ENV === "production"` or `NODE_ENV === "production"`), refuse to start on PGLite, or have health return 503 when `dbSource === "pglite"`. Add a startup assertion listing the required env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `VELO_VAULT_KEY`, `GROK_AUTH_CLIENT_*`).
- **Verification procedure:** Deploy a preview without `DATABASE_URL`. `/api/health` must return 503 (or the function must fail at boot).
- **Status:** CONFIRMED

### OPS-07 — Rotating the cookie vault key is impossible: no `VELO_VAULT_KEY_PREVIOUS` for cookies (proxy secrets have it). Rotation bricks every vault, and the client hides the error
- **Severity:** P1
- **Category:** Key management
- **Blocks:** Both
- **Affected files:** `src/lib/vault-crypto.ts:47-51,82-95,150-159,175-189`; `src/lib/user-proxy-repository.server.ts:140-160`; `src/components/cookie-import.tsx:102-107`
- **Description:** `decryptCookies` tries only the current `VELO_VAULT_KEY` and throws otherwise. `decryptSecret` (proxy creds) falls back to `VELO_VAULT_KEY_PREVIOUS`, and the proxy repository re-encrypts rows that decrypted with the previous key. So after rotation, proxies survive but **every cookie vault row throws**. The client swallows the error: `loadVault().then(…).catch(() => undefined)`, so users just appear to have "no session". There are two more traps. (1) The proxy key silently derives from `BETTER_AUTH_SECRET` when `VELO_VAULT_KEY` is unset. Rotating the auth secret after a compromise, or *adding* `VELO_VAULT_KEY` later, changes the proxy key, so every proxy credential is undecryptable unless the old value goes into `VELO_VAULT_KEY_PREVIOUS`. (2) `encryptOAuthTokens` uses `BETTER_AUTH_SECRET`, so rotating it also invalidates the stored OAuth access and refresh tokens, and every session.
- **Evidence:** `vault-crypto.ts:150-159` (no previous-key branch) vs `:175-189` (previous-key branch).
- **Real-world consequence:** The operator cannot rotate the most important key after an incident without wiping every user's saved session.
- **Recommended fix:** Give cookies the same fallback: `decryptCookies` tries current, then previous, and `loadVault`/`validateVaultSession` re-encrypt with the current key when previous succeeded. Add `npm run vault:reencrypt`. Make the proxy key independent of `BETTER_AUTH_SECRET` (require `VELO_VAULT_KEY` in production). Surface decrypt failures to the user ("saved session can't be read, re-import") and to logs.
- **Verification procedure:** Unit test: encrypt with K1, set `VELO_VAULT_KEY=K2`, `VELO_VAULT_KEY_PREVIOUS=K1`, then `decryptCookies` succeeds and the row is rewritten under K2.
- **Status:** CONFIRMED

### OPS-08 — Denial of wallet and IP bans: quotas are per-instance in-memory, all bytes are proxied through Vercel egress, YouTube blocks datacenter IPs, and the app depends on free third-party infrastructure with no SLA
- **Severity:** P1
- **Category:** Cost / availability
- **Blocks:** Website launch
- **Affected files:** `src/lib/guest-limit.server.ts:32-45,358-411`; `src/lib/download-pool.server.ts:12-14`; `src/lib/ytdlp-python.server.ts:9-21`; `src/lib/cors-relays.ts:12-24`; `src/lib/socks-pool.server.ts:20`
- **Description:** Guest quotas (about 12 files per 10 min) and the per-IP backstop live in process memory. On Vercel each instance has its own Maps, and under load there are many instances, so the effective limit is quota × instances and resets on every cold start. Every `/api/download`, `/api/builder`, `/api/relay` media byte transits the function, so Vercel bills function GB-seconds plus data transfer for it. A scripted guest can stream 4K files continuously. The code itself records that datacenter origins get blocked ("a datacenter origin gets 403", `ytdlp-python.server.ts:11`). Vercel's shared AWS egress IPs will draw the same YouTube bot walls and 403s, which is why the app leans on anonymous SOCKS (proxifly list via jsDelivr `@main`) and on free CORS relays (corsfix, allorigins). None of them has an SLA, a rate-limit contract or monitoring, and a busy public site will likely exhaust or get banned from the free relays.
- **Evidence:** `guest-limit.server.ts:39-42` (module-level Maps). `download-pool.server.ts:12` `MAX_YTDLP = 4` (per instance, not global).
- **Real-world consequence:** A surprise bill, degraded service for everyone once YouTube flags the egress, and outages when free relays throttle.
- **Recommended fix:** Move quotas to a shared store (Upstash/Redis, or a Postgres table with `ON CONFLICT` counters). Put Vercel Firewall rate limits on `/api/download|builder|relay|ytdlp`. Set a Vercel spend cap with alerts. Where possible, stream googlevideo bytes straight to the browser. Contract a proxy provider and relay, or remove those paths. Track egress bytes per route.
- **Verification procedure:** Load-test from one IP across 10 parallel connections and confirm the aggregate cap holds across instances. A spend alert is configured (NOT VERIFIED).
- **Status:** CONFIRMED (code). Billing/plan: NOT VERIFIED.

### OPS-09 — No CI gate: tests/typecheck/lint/build never run on push or PR. The only workflow is a write-scoped weekly auto-updater
- **Severity:** P2
- **Category:** Release engineering
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml`
- **Description:** The only workflow runs weekly (and on `workflow_dispatch`) with `contents: write` and `pull-requests: write`, installs `yt-dlp` unpinned from PyPI, runs `npm ci` and the updater, and opens a PR. No workflow runs `npm test`, `typecheck`, `lint` or `build` on push or PR, so Vercel builds, and therefore **migrations** (OPS-05), run on unverified commits. Actions are pinned to tags, not SHAs. Branch protection: NOT VERIFIED.
- **Evidence:** `ls .github/workflows` shows only `auto-update.yml` (contents quoted in the audit notes; no `on: pull_request`).
- **Real-world consequence:** A broken main deploys straight to users and can run migrations.
- **Recommended fix:** Add `ci.yml` on `pull_request` and `push` that runs `npm ci && npm run typecheck && npm run lint && npm test && npm run build` (the build without `DATABASE_URL`, so migrations skip). Require it through branch protection. Pin actions by SHA. Pin the yt-dlp version in the updater.
- **Verification procedure:** A PR with a failing test shows a red required check and cannot merge.
- **Status:** CONFIRMED

### OPS-10 — The live npm/pip installer targets an immutable, per-instance serverless filesystem and hands all secrets to package lifecycle scripts
- **Severity:** P2
- **Category:** Operability / security-adjacent
- **Blocks:** Both
- **Affected files:** `src/lib/tool-updates.server.ts:90,135-160,176-270`
- **Description:** The Tools tab runs `npm install` / `pip install --upgrade` with `cwd: process.cwd()` and `env: { ...process.env, … }`. On Vercel the function root is read-only, so installs fail (`EROFS`/`EACCES`). Even where they succeed (`/tmp`, a container), the result affects one instance and disappears on the next cold start or deploy. The UI then shows versions that differ from instance to instance. Passing the full environment gives `DATABASE_URL`, `BETTER_AUTH_SECRET`, `VELO_VAULT_KEY` and the OAuth secret to every npm/pip install script.
- **Evidence:** `tool-updates.server.ts:137-141` `spawn(command, args, { cwd: process.cwd(), stdio: [...], env: { ...process.env, CI: "1", … } })`.
- **Real-world consequence:** The feature does not work on the target platform, and it exposes secrets wherever it does work.
- **Recommended fix:** Disable the installer when `process.env.VERCEL` is set, and treat dependency updates as a deploy. If it has to stay for self-hosting, pass an allow-listed env (PATH, HOME) only.
- **Verification procedure:** On a Vercel preview, the Tools tab shows "updates are applied by redeploying". The `spawn` env has no secret keys.
- **Status:** CONFIRMED (code). Vercel FS behaviour: NOT VERIFIED live.

### OPS-11 — In-memory per-instance state (slots, rate limits, SOCKS pool, "direct blocked" bit, jsdom bound to `globalThis`) behaves inconsistently under Fluid / multi-instance
- **Severity:** P2
- **Category:** Architecture / reliability
- **Blocks:** Website launch
- **Affected files:** `src/lib/download-pool.server.ts:26-27`; `src/lib/ytdlp-python.server.ts:16-21`; `src/lib/socks-pool.server.ts:22-23`; `src/lib/po-token.server.ts:210-224,317`; `src/lib/youtube-client.server.ts:39-41,78-81`
- **Description:** The concurrency slots, the mux cache, the 15-minute "direct is blocked" bit, SOCKS good/dead lists (in `/tmp`), and the Innertube client/playable caches are all per process. The PO-token minter binds a JSDOM window onto `globalThis` for BotGuard ("Sequential: both mints share one JSDOM + globalThis bind"). Under Fluid compute one instance serves many concurrent requests, so any other code that touches `window`/`document` globals during a mint is exposed. Operators cannot see any of this state.
- **Evidence:** Lines cited above.
- **Real-world consequence:** Unpredictable latency and capacity, "works on retry" behaviour, and hard-to-reproduce BotGuard failures.
- **Recommended fix:** Document which state is intentionally local. Expose `ytdlpSlotSnapshot()`, pool size and minter age in deep health. Run the minter in a `worker_thread` or `vm` context instead of global binding.
- **Verification procedure:** `/api/health?deep=1` shows the slots, pool and minter fields. A concurrency test of 20 mints shows no global leakage.
- **Status:** CONFIRMED (code). Runtime impact: NOT VERIFIED.

### OPS-12 — DB connection handling: two default `pg` Pools per instance, no connection/statement timeouts, no Fluid pool attach
- **Severity:** P2
- **Category:** Database reliability
- **Blocks:** Website launch
- **Affected files:** `src/lib/db.ts:96`; `src/lib/auth/server.ts:147`
- **Description:** `new Pool({ connectionString })` appears twice (app data and Better Auth), so each warm instance can hold up to 2 × 10 connections. There is no `connectionTimeoutMillis` (default: wait forever), no `idleTimeoutMillis` tuning, no `statement_timeout`, and no `attachDatabasePool` for Vercel Fluid to close idle clients before suspension. Health wraps its own queries in a 3 s race, but real requests do not.
- **Evidence:** `db.ts:96` `const pool = new Pool({ connectionString: databaseUrl });`
- **Real-world consequence:** Neon connection exhaustion under burst, and functions that hang (billed) on a stalled DB.
- **Recommended fix:** Share one Pool. Set `max`, `connectionTimeoutMillis: 5000`, `idleTimeoutMillis`, and `options: '-c statement_timeout=10000'`. Use Neon's pooled (`-pooler`) endpoint. Call `attachDatabasePool(pool)` from `@vercel/functions`.
- **Verification procedure:** Kill the Neon endpoint. Requests fail within about 5 s instead of hanging to `maxDuration`.
- **Status:** CONFIRMED

### OPS-13 — Logging hygiene: unstructured `console.*`, no request IDs, raw error objects, one session-token leak (PRIV-11), no retention/drain config
- **Severity:** P2
- **Category:** Observability / privacy
- **Blocks:** Both
- **Affected files:** `src/lib/auth/gate-session.server.ts:52-321`; `src/lib/db.ts:102,242`; `src/lib/auth/server.ts:154`; `src/lib/auth/verify.server.ts:22`
- **Description:** All 25 server log calls are free-text `console.error/warn`. Several dump whole error objects (`console.error("[db] idle client error", err)`), and one dumps a Set-Cookie prefix that contains the raw session token (`gate-session.server.ts:60`, see PRIV-11). There is no correlation ID, no level policy, no redaction helper, and no log drain or retention configuration in the repo. On the positive side, `/api/health` deliberately returns fixed strings, and yt-dlp stderr gets proxy-authority redaction (`ytdlp-auth.ts:769-777`).
- **Evidence:** `grep -rn "console\.\(log\|info\|warn\|error\|debug\)" src server` returns 25 hits, listed in the audit notes.
- **Real-world consequence:** Logs are hard to search during incidents, and they can leak sensitive values.
- **Recommended fix:** One tiny logger (`log(level, event, fields)`, which prints JSON) with a redaction allow-list. Add `x-vercel-id` as the request ID. Fix PRIV-11. Document retention and drains.
- **Verification procedure:** Grepping logs for `session_token=` or `SAPISID` returns nothing. Every error line has `event` and `reqId`.
- **Status:** CONFIRMED

### OPS-14 — Runtime code/config pulled from mutable upstreams (`--remote-components ejs:github`, proxifly `@main`, grok.com script) with no pinning or fallback visibility
- **Severity:** P3
- **Category:** Supply chain / availability
- **Blocks:** Both
- **Affected files:** `src/lib/ytdlp-auth.ts:546`; `src/lib/ytdlp-meta.server.ts:121,227`; `src/lib/socks-pool.server.ts:20`; `scripts/grok-pwa-shared.mjs:203`
- **Description:** yt-dlp downloads its EJS solver from GitHub at run time. The proxy list is read from a moving `@main` branch through jsDelivr. The branding script is loaded live from grok.com. None of them is pinned or health-checked, and failures are swallowed.
- **Evidence:** Lines cited above.
- **Real-world consequence:** An upstream change or outage breaks production with no deploy on our side and no signal.
- **Recommended fix:** Vendor or pin the yt-dlp EJS components (`yt-dlp-ejs` pip package at a fixed version). Pin the list to a commit, or drop it. Remove or self-host the script (PRIV-05).
- **Verification procedure:** With outbound GitHub blocked, deep health still reports extraction OK.
- **Status:** CONFIRMED

### OPS-15 — `startup.sh` / AGENTS.md sandbox contract ships in the product repo. `startup.sh` logs to `/tmp` with no rotation
- **Severity:** P3
- **Category:** Repo hygiene
- **Blocks:** OSS release
- **Affected files:** `startup.sh`; `AGENTS.md`
- **Description:** `startup.sh` runs `npm run dev` (a Vite dev server bound to 0.0.0.0) as the "restart contract". It appends to `/tmp/app-startup.log` with no rotation. Anyone who self-hosts from this script runs a dev server in production.
- **Evidence:** `startup.sh`: `npm run dev >>/tmp/app-startup.log 2>&1 &`
- **Real-world consequence:** Self-hosters copy a dev-mode deployment, and the log grows without limit.
- **Recommended fix:** Move sandbox artifacts out of the OSS tree, or label them clearly. Document a production start (`npm run build && node .output/server/index.mjs`, or the equivalent).
- **Verification procedure:** README has a "Production deployment" section. `startup.sh` is gone or marked sandbox-only.
- **Status:** CONFIRMED

---

## Runbook skeletons

Fill in owners, contacts and exact dashboard links before launch. Every step that depends on Vercel or Neon plan features is marked (verify).

### RB-1 — Outage: "downloads are failing"
1. **Triage (≤5 min).**
   - `curl -s https://<prod>/api/health?deep=1 | jq`. Check DB (and the extraction stages once OPS-01 lands).
   - Vercel → Observability → error rate by route (`/api/download`, `/api/builder`, `/api/ytdlp`, `/api/relay`).
   - Classify the failure. **DB**: go to RB-5. **YouTube extraction**: step 2. **Platform (Vercel)**: status.vercel.com. **Auth broker**: step 4.
2. **YouTube extraction broken** (most likely).
   - Reproduce against one public video. Check the yt-dlp and youtubei.js upstream issue trackers for a player change.
   - Run the `auto-update` workflow (`workflow_dispatch`), review the PR, merge, and deploy.
   - If the IP is blocked (403/bot wall on every path): switch egress to a configured operator proxy (Tools → proxies), or throttle guest traffic with a Vercel Firewall rule on `/api/*download*`.
3. **Free infrastructure down** (SOCKS list, CORS relays): expect degraded service only. Post a status note. Do not add untrusted relays in a hurry.
4. **Auth broker (`auth.grok.me`) down:** sign-in is unavailable and existing sessions keep working (sessions are local). Post a status note. No action is possible in the app.
5. **Communicate:** status page or banner within 15 min, then updates every 30 min.
6. **Close:** postmortem with a timeline, detection gap, and the fix.

### RB-2 — Key rotation (`VELO_VAULT_KEY`, `BETTER_AUTH_SECRET`)
*Precondition: OPS-07 fixed (cookie previous-key support and a re-encrypt script). Until then, rotating `VELO_VAULT_KEY` **destroys every saved vault**.*
1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never paste it into chat or tickets.
2. In Vercel env (Production): set `VELO_VAULT_KEY_PREVIOUS` = the current value, and `VELO_VAULT_KEY` = the new value. Redeploy.
3. Run `npm run vault:reencrypt` (to be written) against prod. Proxy rows re-encrypt on their next read (`user-proxy-repository.server.ts:154-160`).
4. Verify: `select count(*) from youtube_vault where cookies like 'v1:gcm:%'` = the total row count. Spot-check that one user's "Test connection" works. Check `velo_proxy` last_error_code for `credential_undecryptable`.
5. Remove `VELO_VAULT_KEY_PREVIOUS` and redeploy.
6. `BETTER_AUTH_SECRET` rotation: every session is invalidated, and encrypted OAuth tokens become unreadable. If the proxy key still derives from it, set `VELO_VAULT_KEY_PREVIOUS` to the **old auth secret** first. Schedule a maintenance window, and expect all users to have to sign in again.

### RB-3 — Credential compromise (DB dump, env leak, team-account takeover)
1. **Contain (≤1 h).** Set the kill switch `VELO_VAULT_DISABLED=1` (to be built) and redeploy. Revoke the leaked Vercel/Neon/GitHub tokens. Rotate the Neon role password and update `DATABASE_URL`.
2. **Destroy the stolen value.** If `VELO_VAULT_KEY` or the DB may be exposed, **delete all vault rows** (`delete from youtube_vault;`) after taking a forensic snapshot to restricted storage. The stolen cookies stay valid at Google no matter what the app does.
3. **Rotate** `BETTER_AUTH_SECRET` (logs everyone out), `VELO_VAULT_KEY`, `GROK_AUTH_CLIENT_SECRET`, and the operator proxy credentials (rotate them at the proxy vendor too).
4. **Notify users** (REQUIRES LEGAL REVIEW for timing and content: GDPR 72 h to the authority, "without undue delay" to users). Tell them to go to Google Account → Security → "Sign out of all other sessions" and change their password. That is the **only** real revocation.
5. **Investigate:** Vercel audit log, Neon query logs (verify availability), GitHub audit log.
6. **Postmortem and hardening:** separate the key from the DB secret store, shorten vault TTL (PRIV-04).

### RB-4 — Bad deploy rollback
1. Vercel → Deployments → the previous Production deployment → **Instant Rollback** (or `vercel rollback <url>`, verify CLI availability on the plan).
2. **Check the schema first:** did the bad deploy apply a migration? `select name, applied_at from _migrations order by applied_at desc limit 5;`. If a new file appears, the old code now runs against the new schema. Confirm the change was additive (expand-only). If not, go to RB-5.
3. Verify `/api/health?deep=1` and one test save.
4. Revert the commit on `main`, so the next push does not redeploy the bad code.

### RB-5 — Migration failure / bad migration
1. **Build failed mid-migration:** each file runs in its own transaction (`migrate.mjs:58-63`), so the failed file rolled back and earlier files in that run **stay committed**. Read the build log (`[migrate] error applying …` plus code/detail/hint).
2. Fix forward. Write a new migration `000N+1_fix.sql`. Never edit an applied file, because `_migrations` is keyed by name.
3. **Migration committed but harmful:** stop writes (maintenance flag or `VELO_VAULT_DISABLED`). Run the prepared reverse script (`migrations/down/000N.sql`, to be written), or restore through **Neon PITR** to a branch at a timestamp just before `applied_at` (verify the plan's retention). Diff the data, then promote or copy back.
4. Delete the `_migrations` row only when the reverse script has actually undone the change.
5. Postmortem. Enforce preview-DB isolation (OPS-05).

---

## Not verified / out of scope

- Live Vercel settings: plan, `maxDuration` ceiling, env var scoping (Production/Preview), log retention and drains, spend caps, firewall rules, custom-domain certificates, and whether Fluid compute is on. All NOT VERIFIED (no Vercel API calls were made, per the brief).
- Neon: plan, region, PITR window, backups, pooled endpoint. NOT VERIFIED.
- Whether python3/curl/ffmpeg exist in the Vercel Node 24 runtime image: NOT VERIFIED live. Bundle evidence only.
- `.vercel/output/` is a local, gitignored build and may lag the working tree.
- Load and performance testing were not performed.
- Security exploitation of the operator installer, SSRF and similar is covered by the security reports.
