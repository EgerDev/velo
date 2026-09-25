# Velo — Master Findings (first-pass audit, 2026-09-23)

**Verdict: NOT ready for either release.** The open-source release has in practice already happened. `EgerDev/velo` has been public since 2026-08-25 and has been cloned, so everything in git history counts as disclosed (REPO-01).

This file merges 228 raw findings from 17 reports into **35 distinct issues** (M-01 … M-35). Each one lists its source IDs; full evidence, commands and reproduction steps are in the per-area reports. Appendix A indexes every raw finding.

## How this was produced

- **Coverage.** Eight independent auditors covered architecture, secrets and history, appsec and AI, supply chain and licensing, GitHub, OSS and release, tests and clean install, web/UX/performance/SEO, and privacy and operations. They read code, ran the build, test, lint, preview, Playwright, axe, Lighthouse and gitleaks, reproduced issues locally, and made read-only `gh api` calls.
- **Orchestrator checks.** The orchestrator re-checked the highest-impact claims itself:
  - M-02 secret presence: confirmed.
  - M-09 sign-in-link logic: confirmed.
  - M-10 `GET /%` crash: **reproduced**. `npm run preview` exits with `URIError: URI malformed` at `h3+rou3+srvx.mjs:256` via `decodePathname`.
  - PRIV-11: downgraded (see calibration).
- **Not verified.** The live Vercel project and production runtime, backups, real multi-instance behaviour, macOS/Linux end-to-end (Linux tests ran in Docker only), and every legal question.

### Severity calibration (where this file differs from a source report)
| Source | Source sev | Master | Why |
|---|---|---|---|
| SEC-13 (extension) | P3 | M-03 **P0** | The receiver's origin check is real, but its allowlist is multi-tenant Grok domains plus localhost, where anyone can host a tab titled "Velo". Three other auditors rated it P0 or P1, and it is already shipped. |
| SEC-02 (sign-in link) | P0 | M-09 **P1** (P0 when enabled) | Off by default in production once OAuth is configured. It opens with `VELO_SIGNIN_LINK=true`, with `VELO_SIGNIN_LINK_EMAILS` (a name that suggests a restriction), or when auth is off. |
| OPS-01/OPS-02 (monitoring, IR) | P0 | M-18 **P1** | A serious launch blocker, but not catastrophic on its own. It becomes critical because of M-05. |
| PRIV-11 (token in log) | P2 | **P3** | The log line fires only when the token could *not* be parsed out of the cookie. Bearer accepting unsigned tokens is Better Auth's default, where the raw session token is the credential. That is hardening, not a hole. |

## Counts

| | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| Raw findings across the 17 reports | 11 | 64 | 80 | 73 | 228 |
| **Distinct issues (this file)** | **7** | **16** | **12** | — (P3s left in Appendix A) | 35 |

Blocks: **OSS** = public repository, **WEB** = public website, **BOTH**.

| ID | Sev | Issue | Blocks |
|---|---|---|---|
| M-01 | P0 | Product purpose (circumventing YouTube's technical measures, public downloader) needs legal review | BOTH |
| M-02 | P0 | Third-party OAuth client secret committed, public for a month, silent production fallback | BOTH |
| M-03 | P0 | Published session extension hands the full Google cookie jar to attacker-controllable tabs | BOTH |
| M-04 | P0 | Remote JavaScript (BotGuard/player) executes in the server realm with access to all secrets | BOTH |
| M-05 | P0 | Google-session vault: plaintext by default, over-collects, never expires, decrypted to the browser, undeletable, unrotatable | BOTH |
| M-06 | P0 | No privacy policy, terms, third-party disclosures or takedown contact | WEB |
| M-07 | P0 | The deploy target (Vercel) cannot run the product as designed | WEB |
| M-08 | P1 | Fail-open configuration: missing env vars silently give in-memory DB, random secrets, shared dev user, auth on via leaked client | BOTH |
| M-09 | P1 | Copy-paste sign-in link mints sessions without proof of address ownership (account takeover, reproduced) | WEB |
| M-10 | P1 | One unauthenticated request (`GET /%`) crashes the server process (reproduced) | BOTH |
| M-11 | P1 | `/api/*` routes have no CSRF/Origin check; a cross-site POST made the server run yt-dlp | WEB |
| M-12 | P1 | No security headers; unpinned grok.com script on the page where users paste cookies; site frameable; auto-download deep link | BOTH |
| M-13 | P1 | Production mutates itself: guest-triggered `pip install`, remote yt-dlp components, Tools-tab `npm`/`pip install` | BOTH |
| M-14 | P1 | Traffic egresses via anonymous free SOCKS proxies (list fetched from `@main`) and public CORS relays | BOTH |
| M-15 | P1 | Abuse and denial-of-wallet: per-instance rate limits, 50× amplification, all bytes billed through Vercel egress | WEB |
| M-16 | P1 | Weak account security: 8-char passwords, unverified email sign-up signs in immediately | WEB |
| M-17 | P1 | Migrations run inside `npm run build` against whatever DB the build sees; no rollback, no verified backup | WEB |
| M-18 | P1 | No error monitoring, alerting or incident/credential-compromise runbook | WEB |
| M-19 | P1 | GitHub posture: unprotected `main`, no CI, auto-update workflow runs new code with a write token (and has never succeeded) | BOTH |
| M-20 | P1 | Tests do not exercise the security surface (routes, auth middleware, vault isolation, operator gate) | BOTH |
| M-21 | P1 | Licensing: no LICENSE, GPL ffmpeg.wasm served to browsers, Grok template/xAI assets unlicensed, no notices | BOTH |
| M-22 | P1 | OSS readiness: no SECURITY.md; AGENTS.md is a Grok sandbox contract; env vars undocumented; README claims false | OSS |
| M-23 | P1 | Release engineering: no versions or tags, hand-committed cookie-extension zip, ungated deploys, shipping state uncommitted | BOTH |
| M-24 | P2 | Raw upstream/internal error text returned to anonymous callers and shown in the UI | BOTH |
| M-25 | P2 | UX launch defects: Safari hydration error on every load, mobile panels off-screen, invisible focus, 1.17:1 contrast | WEB |
| M-26 | P2 | Performance: mobile LCP 4.7 s; bulk queue unvirtualized (5,000 rows → 78k DOM nodes, 1.4 s freeze); 70% unused JS | WEB |
| M-27 | P2 | Dead code: 30+ unused deps, ~1,300 unreachable lines, duplicate implementations, three extension copies, template leftovers | OSS |
| M-28 | P2 | Production runs on a Nitro beta / prerelease h3 (the root of M-10); undocumented `nf3` override; deprecated deps | BOTH |
| M-29 | P2 | Dev server binds `0.0.0.0:8080` with strictPort and serves source (including the secret) to the LAN | OSS |
| M-30 | P2 | Three `pg` pools per process, no connection/query timeouts, one pool without an error handler | WEB |
| M-31 | P2 | Minimal SEO/share metadata; no robots.txt or sitemap; every page titled "Velo" | WEB |
| M-32 | P2 | Privacy residuals: video IDs and signed URLs in platform logs, permanent guest ID, 180 MB local media left after sign-out, session IP/UA and idToken kept forever | WEB |
| M-33 | P2 | Node version unenforced and misdocumented; platform support unstated; POSIX-only runtime paths | OSS |
| M-34 | P2 | Import-time global side effects: `dns.lookup` forced to IPv4, undici dispatcher replaced; any proxy-table DB error fails every InnerTube request | WEB |
| M-35 | P2 | Orphaned modules shipped: multiplayer/WebRTC (needs a nonexistent `/api/rtc`), Grok connectors, uncalled endpoints | OSS |

---

## P0 — catastrophic / immediate blockers

### M-01 — Product purpose needs legal review before any promotion or launch
- **Severity:** P0 (as a gate; this is not a legal conclusion)
- **Category:** Legal / product. **REQUIRES LEGAL REVIEW.**
- **Sources:** LIC-10, ARCH-23, OSS-11, UX-05, WEB-08
- **Affected:** README.md (the "bypass rate limits", "Throttling Bypass & nsig Deciphering", "PO Token … to prevent bot-detection blocks" sections), `src/lib/po-token.server.ts`, `src/lib/nsig.ts`, `src/lib/stream-unlock.ts`, `src/lib/bypass*.ts`, the in-app copy (UX-05), `extension/README.md` ("official Google" wording).
- **Description:** The stated design goal is to defeat YouTube's bot detection, throttling and IP binding, and to run that as a public, hosted downloader. Relevant precedent and law include YouTube's Terms of Service, anti-circumvention law (DMCA §1201, EU InfoSoc Art. 6) and the 2020 RIAA DMCA notice against youtube-dl on GitHub.
- **Evidence:** README feature list. Minting code in `po-token.server.ts`. UI copy that advertises beating bot detection (UX-05).
- **Consequence:** DMCA takedown of the repo, platform (Vercel/GitHub) account action, and personal legal exposure of the operator. Removing features later does not un-publish the marketing.
- **Fix:** Get counsel's review of both the hosted service and the repository before any launch or promotion. In the meantime, soften the circumvention marketing in README/UI (a technical change, not a legal cure).
- **Verification:** Written legal sign-off recorded in the release checklist.
- **Status:** CONFIRMED (facts). Legal conclusion NOT VERIFIED.

### M-02 — Third-party OAuth client secret committed, public, and used as a silent production fallback
- **Severity:** P0 · **Category:** Secrets · **Blocks:** BOTH
- **Sources:** REPO-01, REPO-02, GH-01, SEC-03, ARCH-05, INST-01, WEB-09, REPO-10, WEB-07
- **Affected:** `src/lib/auth/preview.ts` (the `PREVIEW_CLIENT_SECRET` constant, value `8bcdb7…REDACTED`), `src/lib/auth/server.ts:81-82`, and the built server bundle under `.vercel/output`.
- **Description:** The secret is xAI's shared `grok_preview` OAuth client secret for `auth.grok.me`.
  - It has been in all 41 commits since `5a40709` (2026-08-24).
  - The repository has been public since 2026-08-25, and GitHub traffic shows clones.
  - Whenever `GROK_AUTH_CLIENT_ID/SECRET` are unset, `server.ts` falls back to it, so a fresh clone or misconfigured deploy runs real federated sign-in through this client (INST-01).
  - About 30 other public repos carry the same template file.
- **Consequence:** Anyone can impersonate that OAuth client at the broker, using any free `*.grok-sandbox.com` preview as the redirect URI. The project cannot rotate the secret; only xAI can. Deployments that forget the env vars silently authenticate through a third party's shared client.
- **Fix:**
  1. Report to xAI (the credential owner) and ask for rotation.
  2. Delete the constant, and make auth fail closed at boot when `GROK_AUTH_*` is unset in production.
  3. Enable secret scanning with push protection.
  4. Rewriting history is optional hygiene only: the secret is already disclosed, so rotation is the real fix.
- **Verification:**
  - `git grep -n "8bcdb7" HEAD` returns nothing.
  - Booting with `NODE_ENV=production` and no `GROK_AUTH_*` exits with a clear error.
  - xAI confirms rotation.
- **Status:** CONFIRMED. Validity of the leaked value: NOT VERIFIED (deliberately not tested).

### M-03 — Published session extension delivers the full Google cookie jar to attacker-controllable tabs
- **Severity:** P0 · **Category:** Credential exfiltration / extension · **Blocks:** BOTH
- **Sources:** PRIV-03, REPO-03, SUP-06, SEC-13, REL-08, PRIV-12
- **Affected:** `extensions/velo-session/{background.js,content.js,manifest.json}`, and the identical committed copies `public/extensions/velo-session/` and `public/extensions/velo-session.zip` (served publicly as a download).
- **Description:** "Send to Velo" looks for a tab on `*.grok.me`, `*.grok.com`, `*.grok-sandbox.com` or localhost whose **page title** starts with "Velo". It then posts that tab SID/SAPISID and the rest of the YouTube/Google cookie jar. Anyone can deploy a Grok-hosted app with that title. The extension also passively records every YouTube `Cookie` header from install onwards. Velo's own production domain is not even on its host list.
- **Consequence:** Full Google-account session takeover for any user who installed it. The zip is already downloadable from the live repo and site.
- **Fix:**
  1. Immediately stop serving the zip and its unpacked copy, and remove the install instructions.
  2. Tell anyone who installed it to remove it and sign out of all Google sessions.
  3. If the extension is kept, redesign it: exact-origin allowlist for the one production origin, `externally_connectable` or a nonce handshake, no title matching, only the minimal YouTube cookies, no passive capture.
  4. Build and sign it in CI (see M-23).
- **Verification:** A test page titled "Velo" on a non-production origin receives nothing, and a manifest review shows no multi-tenant hosts.
- **Status:** CONFIRMED (code). Live exploitation: NOT VERIFIED.

### M-04 — Remote JavaScript executes in the Node server realm
- **Severity:** P0 · **Category:** RCE / supply chain · **Blocks:** BOTH
- **Sources:** SEC-01, SUP-01, ARCH-08, SEC-12, OPS-11
- **Affected:** `src/lib/po-token.server.ts:195-242` (the BotGuard interpreter via `new Function`, with global `window`/`document` swapped onto `globalThis` for the duration of a request), and the nsig/player JavaScript evaluation in the server decipher path.
- **Description:** JavaScript fetched from Google on each mint, plus YouTube player code, runs through `new Function` inside the main server process. The appsec auditor showed that code run this way can reach `process`, `child_process` and `process.env`: `DATABASE_URL`, `BETTER_AUTH_SECRET` and `VELO_VAULT_KEY`.
- **Consequence:** A hostile or compromised upstream response, or a MITM through the free proxies (M-14), becomes server RCE. That means every stored Google session and every secret.
- **Fix:** Run it in real isolation: a separate worker or process with no env and no network, or `isolated-vm`, or a separate sandboxed service. Pin a host allowlist, and never execute code in the request realm. Remove the `globalThis.window` swapping.
- **Verification:** A regression test where a hostile script tries to read `process.env` gets a ReferenceError or nothing.
- **Status:** CONFIRMED (appsec proof of concept against the local code path).

### M-05 — The Google-session cookie vault is unsafe as designed
- **Severity:** P0 · **Category:** Sensitive-data handling · **Blocks:** BOTH
- **Sources:** PRIV-02, PRIV-04, PRIV-06, OPS-07, ARCH-20, TEST-04
- **Affected:** `src/lib/vault.ts`, `src/lib/vault-crypto.ts:114-131` (encryption skipped when `VELO_VAULT_KEY` is unset), `migrations/0002_youtube_vault.sql` (no FK or cascade), and the client callers of `loadVault`.
- **Description:**
  - Stored in **plaintext** unless `VELO_VAULT_KEY` is set, which only produces a warning. The README says "Encrypted … safely".
  - Keeps every `.youtube.com` and `.google.com` cookie, i.e. a whole Google-account session, not the minimum YouTube needs.
  - No TTL.
  - `loadVault` returns the decrypted jar to browser JavaScript on page load, on the same page as the third-party grok.com script (M-12).
  - No account deletion or export, and orphaned rows when users are removed.
  - No `VELO_VAULT_KEY_PREVIOUS` for cookies, so rotating the key bricks every vault and the client hides the error.
- **Consequence:** A database leak or backup leak equals mass Google-account takeover, and the operator cannot meet deletion requests.
- **Fix:**
  1. Decide whether a server-side vault should exist at all. The strongest fix is removing it: keep cookies client-side only and send them per request.
  2. If it stays:
     - refuse to start in production without a key;
     - allowlist only the needed YouTube cookies;
     - add a TTL;
     - never return plaintext to the client, and use it only server-side;
     - add an FK with `ON DELETE CASCADE`, account deletion and export;
     - add dual-key rotation;
     - add tests.
- **Verification:** A production boot without a key fails. The DB row starts with `v1:gcm:`. The `loadVault` response contains no cookie values. A delete-account e2e test removes the row.
- **Status:** CONFIRMED.

### M-06 — No privacy policy, terms, disclosures or takedown channel
- **Severity:** P0 · **Category:** Privacy / legal · **Blocks:** WEB · **REQUIRES LEGAL REVIEW**
- **Sources:** PRIV-01, PRIV-08, PRIV-09, UX-06, PRIV-16
- **Description:** The app collects Google session credentials, emails, IPs, OAuth tokens, HAR files and proxy credentials. It sends data to xAI's auth broker, grok.com, YouTube/Google, corsfix, allorigins, anonymous SOCKS proxies, SponsorBlock and jsDelivr. There is no privacy policy, terms, cookie or storage notice, subprocessor list, age policy, contact or DMCA/takedown address anywhere. There isn't even a footer. The data inventory is in 13-privacy-data.md.
- **Consequence:** GDPR/CCPA/ePrivacy exposure. The Chrome Web Store and the OAuth broker's terms likely require a policy.
- **Fix:** Fix the underlying data flows first (M-03, M-05, M-12, M-14), because the policy must describe reality. Then have counsel draft the policy and terms, add a footer and a consent mechanism where required.
- **Verification:** Every flow in the 13-privacy-data.md table is covered by the published policy, and the counsel sign-off is recorded.
- **Status:** CONFIRMED (absence).

### M-07 — The deploy target cannot run the product as designed
- **Severity:** P0 · **Category:** Architecture / operations · **Blocks:** WEB
- **Sources:** ARCH-01, OPS-03, OPS-04, ARCH-11, ARCH-25, OPS-10, OPS-11
- **Description:**
  - Every preset above 720p, the captions fallback and the SOCKS same-hop path spawn `python`/yt-dlp, `ffmpeg`, `curl` or `node`. The single Vercel Node function ships none of them.
  - There is no `maxDuration` against an ~8-minute fallback ladder.
  - Multi-GB streams pass through one function.
  - A 400 MB disk cache sits inside a 512 MB `/tmp`.
  - Per-instance state (download slots, caches, the BotGuard minter) behaves inconsistently across instances.
  - The in-app installer cannot work on a read-only filesystem.
- **Consequence:** The headline features silently degrade or fail in production, while everything looks green in local testing.
- **Fix:** Choose the hosting model *first*. Either a long-lived container host (Fly, Railway, a VM) with pinned Python, yt-dlp and ffmpeg in a Dockerfile, or scope the product down to what serverless can do and delete the rest.
- **Verification:** A production-like staging deploy completes a real 1080p download end-to-end.
- **Status:** CONFIRMED by code and bundle inspection. Live Vercel behaviour NOT VERIFIED.

---

## P1 — serious release blockers

### M-08 — Fail-open configuration defaults
- **Sources:** ARCH-03, ARCH-04, ARCH-05, ARCH-15, OPS-06, INST-01, INST-05, PRIV-07, SEC-06, TEST-09 · **Blocks:** BOTH
- **Description:** Missing environment variables fail open instead of stopping the app:
  - Missing `DATABASE_URL` gives per-instance in-memory PGLite (the build even copies PGLite into the function), and `/api/health` still returns 200.
  - Missing `BETTER_AUTH_SECRET` gives a random secret per process, so sessions break across instances, and the proxy key derives from it.
  - Auth is ON by default although the comments say OFF, via the leaked client (M-02).
  - Email and password sign-up is on with no verification.
  - With auth off and no DB, all visitors share one `dev-user`. SEC-06 reproduced one visitor reading another's saved cookie vault.
- **Consequence:** Silent data loss, session chaos, and cross-user credential exposure caused by a single missing env var.
- **Fix:** A production boot-time config validator (zod over `process.env`) that exits on a missing `DATABASE_URL`, `BETTER_AUTH_SECRET`, `VELO_VAULT_KEY` or `GROK_AUTH_*`. Remove the dev-user fallback from any shareable mode. Make health report the datastore kind and fail when it is PGLite in production.
- **Verification:** A matrix test that boots with each variable missing and expects a non-zero exit.
- **Status:** CONFIRMED (SEC-06 reproduced).

### M-09 — Sign-in link is an account-takeover primitive
- **Sources:** SEC-02, SEC-10 · **Blocks:** WEB · **Severity:** P1 (P0 when enabled)
- **Affected:** `src/lib/sign-in-link.ts`, `src/lib/sign-in-link-policy.ts`
- **Description:** `requestSignInLink` returns the login token **to the caller** (there is no email delivery), upserts the user with `emailVerified=true`, and redeeming it deletes the victim's other sessions.
  - It is enabled when auth is unconfigured, when `VELO_SIGNIN_LINK=true`, or when `VELO_SIGNIN_LINK_EMAILS` is set.
  - With the allowlist set, anyone who knows an allowlisted address, typically the admin's, mints that admin's session. Through `VELO_ADMIN_EMAILS` that grants the operator role, which runs npm/pip on the host.
  - The appsec auditor reproduced the whole chain locally; the orchestrator confirmed the code path.
- **Fix:** Delete the feature, or deliver the token only by email to the address.
- **Verification:** The endpoint is gone, or a test asserts the response never contains a token.
- **Status:** CONFIRMED.

### M-10 — `GET /%` crashes the server process
- **Sources:** WEB-01 (root cause M-28) · **Blocks:** BOTH
- **Evidence:** The orchestrator reproduced it with `npm run preview`, then `curl 'http://127.0.0.1:8081/%'`. The process exits with `URIError: URI malformed at decodeURI … decodePathname (h3+rou3+srvx.mjs:256) … new H3Event`, and every following request fails.
- **Consequence:** Anyone can take the service down with one unauthenticated request, repeatably. On Vercel, the instance is killed and retried (per-instance behaviour NOT VERIFIED).
- **Fix:** Upgrade or patch h3/Nitro, or wrap the entry handler to return 400 on a `URIError`. Add a regression test.
- **Verification:** `curl /%` returns 400, and the process stays up.
- **Status:** CONFIRMED (reproduced).

### M-11 — No CSRF/Origin check on `/api/*`
- **Sources:** SEC-05, WEB-04 · **Blocks:** WEB
- **Description:** File routes (`/api/ytdlp`, `/api/builder`, `/api/unlock`, `/api/relay`, …) accept cross-site requests. A cross-site `text/plain` POST started yt-dlp on the server. Server functions are correctly protected, with 403 on cross-site calls.
- **Consequence:** Any website can drive downloads from visitors' browsers, spending their quota and IP and, with the cookie body fields, their session.
- **Fix:** Apply the same Fetch-Metadata/Origin check (`assertSameSiteRequest`) to every `/api/*` handler, require `application/json`, and add tests.
- **Status:** CONFIRMED (reproduced).

### M-12 — No security headers; third-party script on the credential page
- **Sources:** WEB-02, WEB-03, WEB-06, ARCH-06, ARCH-21, PRIV-05, SUP-02 · **Blocks:** BOTH
- **Description:**
  - No CSP, frame-ancestors/XFO, nosniff, Referrer-Policy or Permissions-Policy.
  - `grok.com/grok-app-builder/extensions.js` is injected on every page with no pin and no SRI, same-origin with `loadVault` output, and it sets third-party cookies.
  - Anyone can frame the site, and `?v=…&auto=1` starts a download without a click.
- **Consequence:** A change to, or compromise of, that script reads every user's Google session.
- **Fix:** Remove the Grok branding injector (it is a template feature, not needed off-platform), add a strict CSP with nonces, `frame-ancestors 'none'`, the standard headers and HSTS, and require a user gesture for `auto=1`.
- **Status:** CONFIRMED.

### M-13 — Production modifies its own code at runtime
- **Sources:** ARCH-07, SUP-03, SUP-04, SUP-07, REL-05, OPS-10, OPS-14, SEC-10 · **Blocks:** BOTH
- **Description:**
  - Guest requests can trigger an unpinned `pip install PySocks/curl_cffi` (`src/lib/ytdlp-python.server.ts:118`).
  - yt-dlp runs with `--remote-components ejs:github`.
  - The Tools tab runs `npm install …@latest --save` and `pip install --upgrade` on the live server, with every secret in the child env and no verification or rollback.
- **Consequence:** What runs is not what was built or reviewed, and a malicious package release gets immediate server-side execution.
- **Fix:** Delete runtime installs, pin yt-dlp and extras with hashes in the image, and ship updates only through CI builds.
- **Status:** CONFIRMED.

### M-14 — Untrusted third-party egress infrastructure
- **Sources:** ARCH-09, SEC-04, SEC-07, SEC-14, SUP-05, PRIV-09, PRIV-10 · **Blocks:** BOTH
- **Description:**
  - Downloads can egress through anonymous free SOCKS5 proxies taken from `cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main`, a list anyone can change, with no private-IP filtering on that path.
  - The browser calls `proxy.corsfix.com` and `api.allorigins.win` directly, leaking IP and viewing activity, and media also flows through them.
  - Per ARCH and PRIV, user cookies are **not** sent over the free SOCKS pool. That is verified, and it narrows the impact.
- **Consequence:** Traffic runs through botnet-grade hosts (MITM of media and of the player JS that feeds M-04), with legal and reputational exposure and undisclosed data sharing.
- **Fix:** Remove the free proxy list and the public CORS relays. Use operator-owned egress only, if any.
- **Status:** CONFIRMED.

### M-15 — Abuse and denial-of-wallet
- **Sources:** ARCH-02, ARCH-10, OPS-08, SEC-09, UX-12, PERF-02 · **Blocks:** WEB
- **Description:**
  - Quotas, sign-up and link throttles, the yt-dlp process cap and caches are in-memory per instance.
  - `resolveBulkVideos` performs 50 full resolves for one metadata token.
  - All media bytes are billed as Vercel egress.
  - YouTube blocks datacenter IPs.
  - The bulk queue has no limit (one paste queued 4,863 items).
- **Fix:** A shared rate-limit store (a Redis-class Marketplace integration), per-request cost accounting, caps on bulk size, and spend alerts. Prefer client-direct media wherever it works.
- **Status:** CONFIRMED (code). Cost figures NOT VERIFIED.

### M-16 — Weak account security
- **Sources:** SEC-08, ARCH-05 · **Blocks:** WEB
- **Description:** 8-character minimum passwords, no breached-password check, unverified accounts sign in immediately, and the sign-up throttle is per instance (reproduced).
- **Fix:** Require email verification (or disable email and password), use a stronger password policy, and a shared throttle.

### M-17 — Migrations inside the build
- **Sources:** OPS-05, REL-03, ARCH-14 · **Blocks:** WEB
- **Description:**
  - `npm run build` runs `db:migrate` against whatever `DATABASE_URL` the build sees, including preview builds of any branch.
  - Migrations apply while the old code is still serving.
  - Each file commits separately.
  - There are no down migrations and no documented or tested backup.
  - Without a DB, migrations are silently skipped.
- **Fix:** Separate, approved migrate step, a pre-migration backup or PITR checkpoint, and a restore drill. Backups are NOT VERIFIED until a restore has been done.

### M-18 — No observability or incident response
- **Sources:** OPS-01, OPS-02, OPS-13, ARCH-26 · **Blocks:** WEB
- **Description:** No error monitoring, alerts, request IDs or structured logs. Health checks only the DB and nothing polls it. There is no runbook for credential compromise, the DB URL and the vault key sit in the same env, and there is no kill switch or way to notify users. Runbook skeletons are in 14-operations.md.
- **Fix:** Error tracking, an uptime monitor on a deep health check that covers the extraction canary, log redaction, and the runbooks. Split the key custody.

### M-19 — GitHub posture
- **Sources:** GH-02 … GH-08, TEST-01, OPS-09, SUP-08, REPO-04, REPO-06 · **Blocks:** BOTH
- **Description:**
  - `main` has no protection or ruleset.
  - There is no CI on push or PR.
  - `auto-update.yml` runs newly resolved npm/PyPI code while a persisted write-scoped `GITHUB_TOKEN` is available. All 4 runs failed at `npm ci`, and PR creation is disabled anyway.
  - Actions are tag-pinned.
  - Dependabot, CodeQL, dependency review, private vulnerability reporting and push protection are all off.
- **Fix:** Ready-to-commit drafts are in 05-github-security.md: `ci.yml`, a hardened auto-update workflow, Dependabot, CodeQL, dependency review, Scorecard, a ruleset and CODEOWNERS.

### M-20 — Tests don't cover the security surface
- **Sources:** TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-08 · **Blocks:** BOTH
- **Evidence:** `npm test` gives 714 tests, 0 failing, 4 skipped. Only 88 of 207 source files are ever loaded, so about 57% of source lines never run.
  - No test executes an `/api/*` handler, the auth middleware, the Better Auth config, vault isolation or the real operator gate.
  - Five parser tests make zero assertions, because their `/tmp` fixtures never exist.
  - The "cookies only go through trusted proxies" check is a regex over source text.
- **Fix:** Route-level integration tests, one per fixed P0/P1, written first. Make the fixtures real.

### M-21 — Licensing blocks an MIT release · **REQUIRES LEGAL REVIEW** for the template and assets
- **Sources:** LIC-01 … LIC-08, OSS-01, OSS-02, REPO-05 · **Blocks:** BOTH
- **Description:**
  - There is no LICENSE file, and the README's "MIT" grants nothing.
  - The ffmpeg.wasm served to browsers is a GPL build (`--enable-gpl`, x264/x265) with no GPL compliance. The app only uses audio encoders, so an LGPL audio-only build removes the problem.
  - The Grok App Builder template code and xAI logos under `public/__grok/` come with no licence grant.
  - There are no third-party notices, and the OFL font texts are not shipped.
  - Provenance of code "ported from yt-final" is unknown.
- **Technical finding:** MIT or Apache-2.0 is compatible with the dependency tree once the GPL ffmpeg build and the Grok template code/assets are removed or replaced. Otherwise the project would have to be GPL.

### M-22 — Open-source documentation readiness
- **Sources:** OSS-03, OSS-04, OSS-06, OSS-07, OSS-08, OSS-10, INST-06, CLEAN-02 · **Blocks:** OSS
- **Description:**
  - No SECURITY.md or private reporting channel.
  - AGENTS.md is the Grok Build sandbox contract ("You are Grok Build…") and will misdirect contributors' agents.
  - About 30 env vars are undocumented, several security-critical, and there is no `.env.example`.
  - README inaccuracies: the "encrypted" vault, the smoke test that targets dev, "localhost" when dev binds 0.0.0.0, and a duplicate heading.
  - No CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, CHANGELOG or issue/PR templates (GitHub community score 28%).
  - `docs/architecture.md` now exists; it was written in this audit.

### M-23 — Release engineering
- **Sources:** REL-01, REL-02, REL-04, REL-09, INST-03, ARCH-19 · **Blocks:** BOTH
- **Description:**
  - No version, tags, releases or CHANGELOG, and the build can't identify itself.
  - The cookie-extracting extension zip is a hand-committed binary.
  - Deployment is not gated or recorded by the repo.
  - The state that will ship is uncommitted: 27 modified and 3 untracked files, and modified files import the untracked `src/lib/transfer-progress.ts`.
- **Fix:** A full process design and a 23-step checklist are in 16-release-engineering.md.

---

## P2 — significant

- **M-24** — **Raw errors to clients** (SEC-11, WEB-05, UX-07, WEB-10). `err.message` and upstream text, including server paths, tooling and the proxy chain, reach anonymous callers and the UI. Fix: map to stable error codes and log details server-side only.
- **M-25** — **UX launch defects** (UX-01 … UX-04):
  - WebKit hydration error 10/10, caused by the cookie-import skeleton.
  - History and Guide panels at −100 px on 390-wide screens.
  - The main input has no visible focus.
  - The Guide heading has 1.17:1 contrast.

  Accessibility is **not** claimed compliant; axe plus a manual keyboard pass found more (see 11-ux-accessibility.md).
- **M-26** — **Performance** (PERF-01 … PERF-04):
  - Mobile Lighthouse score 73, LCP 4.7 s, 32 preloaded scripts.
  - The bulk queue is unvirtualized.
  - 70% of the JS on first view never runs, and lazy boundaries are defeated by static imports.
- **M-27** — **Dead code and template leftovers** (CLEAN-01 … CLEAN-18, SUP-10, PERF-06). 30+ unused deps, including react-scan with about 38 transitive packages, ~1,300 unreachable lines, a duplicated `operatorGate`, and three extension copies.
- **M-28** — **Pre-release server stack** (SUP-09, SUP-11, INST-08). Nitro `3.0.260610-beta` is pinned exactly, with prerelease h3 in the production function (the root of M-10), an undocumented `nf3` override, and deprecated eslint 9 and recharts 2.
- **M-29** — **Dev server exposed on LAN** (INST-04, WEB-07). It binds `0.0.0.0:8080` with strictPort, serves source including the M-02 secret, and the override is undocumented.
- **M-30** — **DB pools** (OPS-12, ARCH-17). Three pools per process, no connect or statement timeouts, and the proxy pool has no `error` handler, so a dropped connection crashes the process.
- **M-31** — **SEO and social** (PERF-07, PERF-08, UX-13). One title everywhere, no canonical, no og:image or og:description, no robots.txt or sitemap.
- **M-32** — **Privacy residuals** (PRIV-13, PRIV-14, PRIV-15, PERF-09):
  - Video IDs and signed URLs appear in platform request logs.
  - A permanent guest ID lives in localStorage.
  - Up to 180 MB of media stays on shared devices after sign-out.
  - Session IP/UA and the idToken are kept forever, and verification rows are never cleaned up.
  - Every visit contacts YouTube and grok.com before any user action.
- **M-33** — **Toolchain and platform** (INST-02, OSS-05, OSS-09). README says Node 22.0+, but deps need ^22.22 / ^24.15. There is no `engines` field or `.nvmrc`, package name `app-builder-workspace`, and POSIX-only paths (`/tmp`, `/dev/null`, `python3`).
- **M-34** — **Global side effects** (ARCH-12, ARCH-13). Importing `ipv4-bind.server.ts` forces IPv4 on `dns.lookup` and replaces the undici dispatcher process-wide, and any proxy-table DB error fails every InnerTube call, including for guests.
- **M-35** — **Orphaned modules** (ARCH-18, PRIV-17, CLEAN-07). The multiplayer/WebRTC module (public STUN servers, and it calls a nonexistent `/api/rtc`), the app-data connectors to `connectors.grok.me`, and endpoints with no caller (`/api/download`, `listUserProxies`, `testUserProxy`).

## What holds (so the picture stays calibrated)
- **Server functions:** cross-site calls get 403, wrong methods get 405, and all 12 privileged server functions reject anonymous callers (WEB).
- **Data access:** queries are scoped by the verified `userId`, and no IDOR was found (SEC).
- **Crypto and proxies:** AES-256-GCM envelope with a fresh IV when a key is set. The user-proxy SSRF filter blocks 169.254.169.254 and RFC1918 ranges.
- **Subprocesses:** fixed-argv spawning, so no command injection was found.
- **Dev-only routes:** `/auth/popup` and `/__app-env` are excluded from the production build.
- **npm tree:** 0 audit vulnerabilities, every entry from the registry with integrity hashes, no git or tarball deps.
- **Tests and migrations:** the suite is hermetic and deterministic (5 runs, no flakes; passes with `--network none` on Linux), and migrations apply cleanly and idempotently to real Postgres 16.
- **History:** no `.env`, dump, HAR, cookie jar or screenshot was ever committed.

## Not verified (first pass)
- The live Vercel project settings, environment scoping, deployed runtime behaviour, bandwidth costs and backups/PITR.
- Validity of the leaked secret (deliberately untested).
- Real multi-instance behaviour.
- macOS; Linux beyond the Docker test run.
- Real YouTube downloads end-to-end (traffic kept minimal on purpose).
- The CI and YAML drafts (not run).
- Every legal question.

---

## Appendix A — Index of all 228 raw findings
| Source ID | Sev | Title | Report |
|---|---|---|---|
| ARCH-01 | P0 | Core download path needs Python/yt-dlp/ffmpeg/curl/node subprocesses; the only deploy target ships none of them | [01-architecture.md](01-architecture.md) |
| ARCH-02 | P1 | All abuse controls, pools and caches are per-process memory | [01-architecture.md](01-architecture.md) |
| ARCH-03 | P1 | Missing `DATABASE_URL` silently runs production on in-memory PGLite | [01-architecture.md](01-architecture.md) |
| ARCH-04 | P1 | Missing `BETTER_AUTH_SECRET` silently generates a random per-process secret | [01-architecture.md](01-architecture.md) |
| ARCH-05 | P1 | Auth defaults contradict their own documentation; OAuth falls back to a hard-coded third-party preview client; unverified email sign-up is on | [01-architecture.md](01-architecture.md) |
| ARCH-06 | P1 | Every HTML page loads xAI's `extensions.js` without SRI or CSP | [01-architecture.md](01-architecture.md) |
| ARCH-07 | P1 | Runtime self-modification: guest-triggered `pip install`, remote yt-dlp components, operator `npm install --save` | [01-architecture.md](01-architecture.md) |
| ARCH-08 | P1 | Remote JavaScript executed in-process with `new Function`; `globalThis.window` swapped mid-request | [01-architecture.md](01-architecture.md) |
| ARCH-09 | P1 | Production relies on anonymous free SOCKS5 proxies and public CORS proxies; media flows through them | [01-architecture.md](01-architecture.md) |
| ARCH-10 | P1 | Unauthenticated metadata server functions allow large amplification | [01-architecture.md](01-architecture.md) |
| ARCH-11 | P2 | Long-running streamed downloads vs serverless duration and bandwidth; no platform config | [01-architecture.md](01-architecture.md) |
| ARCH-12 | P2 | Process-wide monkey-patching of DNS and the global undici dispatcher on import | [01-architecture.md](01-architecture.md) |
| ARCH-13 | P2 | Every InnerTube request hard-depends on the proxy table | [01-architecture.md](01-architecture.md) |
| ARCH-14 | P2 | Migrations run inside `npm run build` | [01-architecture.md](01-architecture.md) |
| ARCH-15 | P2 | Dev-only / hidden behaviour reachable in production | [01-architecture.md](01-architecture.md) |
| ARCH-16 | P2 | Hard-wired Grok platform hosts across the codebase | [01-architecture.md](01-architecture.md) |
| ARCH-17 | P2 | Three independent unbounded `pg` pools per process | [01-architecture.md](01-architecture.md) |
| ARCH-18 | P2 | Orphaned / unfinished functionality still exposed or shipped | [01-architecture.md](01-architecture.md) |
| ARCH-19 | P2 | Working tree is not a buildable commit | [01-architecture.md](01-architecture.md) |
| ARCH-20 | P2 | README claims that the implementation does not meet | [01-architecture.md](01-architecture.md) |
| ARCH-21 | P2 | No security headers anywhere; no platform config | [01-architecture.md](01-architecture.md) |
| ARCH-22 | P2 | No test/build CI; yt-dlp version not pinned in the repo | [01-architecture.md](01-architecture.md) |
| ARCH-23 | P1 | Design goal is circumvention of YouTube technical measures | [01-architecture.md](01-architecture.md) |
| ARCH-24 | P3 | Whole-file buffering in the browser; in-memory mux | [01-architecture.md](01-architecture.md) |
| ARCH-25 | P3 | `/tmp`-based caches sized near typical serverless limits | [01-architecture.md](01-architecture.md) |
| ARCH-26 | P3 | Health endpoint checks only the database | [01-architecture.md](01-architecture.md) |
| REPO-01 | P1 | Repository is ALREADY public (since 2026-08-25) and cloned; everything in history must be treated as disclosed | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-02 | P1 | Hard-coded xAI "grok_preview" OAuth client secret in every commit plus a production fallback to it | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-03 | P1 | Published session extension (zip) broadcasts full YouTube session cookies to any `*.grok.me` / `*.grok.com` / `*.grok-sandbox.com` tab titled "Velo" | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-04 | P2 | Auto-update workflow runs freshly-bumped dependency code with a persisted `contents: write` token; actions pinned to mutable tags | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-05 | P2 | Third-party (xAI/Grok) template code, branding assets and the AGENTS.md sandbox contract ship with no license; README claims MIT with no LICENSE file | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-06 | P2 | No secret-scanning gate: GitHub non-provider patterns and validity checks off, no gitleaks config or CI, no branch protection, Dependabot security updates off | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-07 | P3 | Author PII and machine hostnames in 40 commits; private Claude session URL in a commit message | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-08 | P3 | Committed test private key plus scanner false positives (public BotGuard key, InnerTube keys) with no allowlist | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-09 | P3 | `.gitignore` gaps (`.env*` swallows `.env.example`; no cookies.txt/HAR/PEM/coverage/.output/audit patterns) | [02-public-repository-security.md](02-public-repository-security.md) |
| REPO-10 | P3 | Local `.vercel/output` prebuilt bundle embeds the fallback secret and absolute local paths | [02-public-repository-security.md](02-public-repository-security.md) |
| SEC-01 | P0 | Server-side remote JavaScript runs in a non-isolating `new Function`, not a real sandbox | [03-application-security.md](03-application-security.md) |
| SEC-02 | P0 | Copy-paste sign-in link is an account-takeover primitive; the gate is reachable and mints sessions without proof of address ownership | [03-application-security.md](03-application-security.md) |
| SEC-03 | P0 | Committed shared OAuth client secret is the silent production fallback | [03-application-security.md](03-application-security.md) |
| SEC-04 | P1 | Downloads egress through free anonymous SOCKS proxies pulled from a third-party list | [03-application-security.md](03-application-security.md) |
| SEC-05 | P1 | `/api/*` routes have no CSRF/Origin check | [03-application-security.md](03-application-security.md) |
| SEC-06 | P1 | Auth-off + no database serves one shared `dev-user`; all per-user data is world-shared | [03-application-security.md](03-application-security.md) |
| SEC-07 | P1 | `/api/relay` + third-party CORS proxies: app-origin fetch of YouTube/googlevideo with header pass-through | [03-application-security.md](03-application-security.md) |
| SEC-08 | P1 | Weak password policy and immediate sign-in of unverified accounts | [03-application-security.md](03-application-security.md) |
| SEC-09 | P2 | Quota and rate limits are per-instance in-memory; they do not hold on Vercel | [03-application-security.md](03-application-security.md) |
| SEC-10 | P2 | Operator install gate: auth-off socket-IP path and allowlist semantics | [03-application-security.md](03-application-security.md) |
| SEC-11 | P2 | Internal error text returned to clients | [03-application-security.md](03-application-security.md) |
| SEC-12 | P2 | BotGuard minter mutates process-global `window`/`self`/`document` on the request loop | [03-application-security.md](03-application-security.md) |
| SEC-13 | P3 | Chrome extensions: broad permissions and cookie flows | [03-application-security.md](03-application-security.md) |
| SEC-14 | P3 | Free-SOCKS and relay egress not filtered for private/metadata IPs | [03-application-security.md](03-application-security.md) |
| SUP-01 | P1 | Remote BotGuard interpreter executed in the Node server realm with full privileges | [04-supply-chain.md](04-supply-chain.md) |
| SUP-02 | P1 | Unpinned third-party script injected into every page | [04-supply-chain.md](04-supply-chain.md) |
| SUP-03 | P1 | Request-triggered, unpinned `pip install` on the live server | [04-supply-chain.md](04-supply-chain.md) |
| SUP-04 | P1 | In-app Tools updater mutates the live server's dependencies with no verification | [04-supply-chain.md](04-supply-chain.md) |
| SUP-05 | P1 | Egress proxies chosen by a mutable third-party list | [04-supply-chain.md](04-supply-chain.md) |
| SUP-06 | P1 | Extension delivers the Google cookie jar to tabs on third-party multi-tenant domains | [04-supply-chain.md](04-supply-chain.md) |
| SUP-07 | P2 | Non-npm runtime components untracked and unpinned; remote EJS solver executed under Node | [04-supply-chain.md](04-supply-chain.md) |
| SUP-08 | P2 | CI workflow: tag-pinned actions, write token exposed to fresh dependency code, no CI on the result | [04-supply-chain.md](04-supply-chain.md) |
| SUP-09 | P2 | Pre-release server runtime and an undocumented nf3 override | [04-supply-chain.md](04-supply-chain.md) |
| SUP-10 | P3 | Unused direct dependencies (template leftovers) | [04-supply-chain.md](04-supply-chain.md) |
| SUP-11 | P3 | Outdated, deprecated and unexplained pins | [04-supply-chain.md](04-supply-chain.md) |
| SUP-12 | P3 | Stale ffmpeg.wasm core decoding untrusted media | [04-supply-chain.md](04-supply-chain.md) |
| SUP-13 | P3 | Reproducibility and SBOM gaps | [04-supply-chain.md](04-supply-chain.md) |
| SUP-14 | P3 | Users sent to third-party cookie-export extensions | [04-supply-chain.md](04-supply-chain.md) |
| GH-01 | P0 | Public repo has exposed the hard-coded OAuth client secret since the first commit; GitHub never flagged it | [05-github-security.md](05-github-security.md) |
| GH-02 | P1 | `main` has no protection or ruleset: force-push, deletion and direct pushes are all allowed | [05-github-security.md](05-github-security.md) |
| GH-03 | P1 | auto-update runs newly resolved third-party code while a write-scoped, persisted `GITHUB_TOKEN` is available | [05-github-security.md](05-github-security.md) |
| GH-04 | P1 | No CI on push or PR: nothing runs typecheck, lint, test or build for contributors or bots | [05-github-security.md](05-github-security.md) |
| GH-05 | P1 | auto-update has never worked: 4/4 runs failed, and PR creation would be refused even if they hadn't | [05-github-security.md](05-github-security.md) |
| GH-06 | P2 | Actions pinned to mutable tags, several majors out of date and on deprecated Node 20; repo allows any action | [05-github-security.md](05-github-security.md) |
| GH-07 | P2 | yt-dlp installed unpinned and unhashed in CI; its update path can never produce a diff | [05-github-security.md](05-github-security.md) |
| GH-08 | P2 | Supply-chain scanning is off: Dependabot, dependency review, CodeQL, private vulnerability reporting, non-provider secret patterns | [05-github-security.md](05-github-security.md) |
| GH-09 | P2 | No CODEOWNERS, and no rule that changes to workflows need owner review | [05-github-security.md](05-github-security.md) |
| GH-10 | P3 | Workflow hygiene: no `concurrency`, no `timeout-minutes`, no egress control, floating `ubuntu-latest` | [05-github-security.md](05-github-security.md) |
| GH-11 | P3 | All commits unsigned, no signed tags, and author emails leak local machine hostnames | [05-github-security.md](05-github-security.md) |
| GH-12 | P3 | No Scorecard, attestations, SBOM or release checksums (see 16-release-engineering) | [05-github-security.md](05-github-security.md) |
| OSS-01 | P1 | No LICENSE file; the "MIT License" line in the README grants nothing | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-02 | P1 | GPL-2.0-or-later ffmpeg.wasm core is served to every visitor; there are no third-party notices | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-03 | P1 | No SECURITY.md and no private channel for reports, for an app that stores Google session cookies | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-04 | P1 | AGENTS.md is the Grok Build sandbox contract and will mislead every contributor's AI agent | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-05 | P2 | package.json identity is the Grok template's: name `app-builder-workspace`, `private`, no version, license, repository or engines | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-06 | P2 | README makes claims the code does not back (encryption, smoke test, auth default, headings, ui tree) | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-07 | P2 | About 30 env vars, several security-critical, are undocumented; there is no `.env.example` | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-08 | P2 | Undocumented runtime prerequisites (curl, ffmpeg, Playwright browsers, the xAI auth broker) and no self-hosting guide | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-09 | P2 | Cross-platform support is unstated, and several paths are POSIX-only | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-10 | P2 | No CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, issue/PR templates or architecture/API docs | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-11 | P1 | The project's stated purpose needs legal review before it is promoted as open source | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-12 | P3 | Two extensions, three copies, and no top-level explanation | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-13 | P3 | 189 lint warnings, and lint cannot fail on them | [06-open-source-readiness.md](06-open-source-readiness.md) |
| OSS-14 | P3 | Repository metadata is thin: no topics or homepage, an empty wiki is enabled, the Grok template leftovers are undocumented | [06-open-source-readiness.md](06-open-source-readiness.md) |
| LIC-01 | P1 | No LICENSE file; the stated MIT has no copyright holder and cannot cover everything | [07-license-review.md](07-license-review.md) |
| LIC-02 | P1 | GPL ffmpeg.wasm build distributed to browsers without GPL compliance | [07-license-review.md](07-license-review.md) |
| LIC-03 | P1 | Grok App Builder template and xAI brand assets have no license grant | [07-license-review.md](07-license-review.md) |
| LIC-04 | P2 | No third-party notices in distributed artifacts | [07-license-review.md](07-license-review.md) |
| LIC-05 | P3 | MPL-2.0 mediabunny in the web bundle | [07-license-review.md](07-license-review.md) |
| LIC-06 | P3 | OFL-1.1 fonts (IBM Plex Sans/Mono, Instrument Serif) | [07-license-review.md](07-license-review.md) |
| LIC-07 | P3 | Non-OSI "Modified MIT" dev dependencies via unused react-scan | [07-license-review.md](07-license-review.md) |
| LIC-08 | P2 | Provenance: ported code, AI co-authorship, author identity | [07-license-review.md](07-license-review.md) |
| LIC-09 | P3 | GPL mutagen via yt-dlp[default] | [07-license-review.md](07-license-review.md) |
| LIC-10 | P0 | Product-level legal questions (no conclusions offered) | [07-license-review.md](07-license-review.md) |
| LIC-11 | P2 | Recommended license and compatibility matrix | [07-license-review.md](07-license-review.md) |
| TEST-01 | P1 | No CI runs test/typecheck/lint/build on push or PR | [08-testing.md](08-testing.md) |
| TEST-02 | P1 | No test executes any HTTP route, server-fn auth middleware or Better Auth config (57 % of source never loaded) | [08-testing.md](08-testing.md) |
| TEST-03 | P1 | The operator gate that guards live `npm`/`pip install` and proxy management is tested only through injected fakes | [08-testing.md](08-testing.md) |
| TEST-04 | P1 | Per-user cookie-vault isolation and plaintext-fallback mode have zero tests | [08-testing.md](08-testing.md) |
| TEST-05 | P2 | 5 media-parser tests silently pass with zero assertions (fixtures in `/tmp` that never exist) | [08-testing.md](08-testing.md) |
| TEST-06 | P2 | Security routing properties "tested" by regex over source text | [08-testing.md](08-testing.md) |
| TEST-07 | P2 | Lint cannot fail: every rule is `warn`; 189 warnings incl. 35 dead imports in `ytdlp-proc.server.ts` | [08-testing.md](08-testing.md) |
| TEST-08 | P2 | No E2E, UI or extension tests; browser smoke only checks that `/` renders text | [08-testing.md](08-testing.md) |
| TEST-09 | P2 | Skipped tests hide the auth-default contract; in every clone the reality is auth ON | [08-testing.md](08-testing.md) |
| TEST-10 | P3 | `npm run check:auth` is unusable standalone (hard-coded 8080, Grok-sandbox endpoint) | [08-testing.md](08-testing.md) |
| TEST-11 | P2 | The weekly auto-update gate omits `npm run build`, so it can open PRs with a broken build | [08-testing.md](08-testing.md) |
| TEST-12 | P3 | gate-identity test swallows a thrown `setCookie` error; session-cookie expiry is never asserted | [08-testing.md](08-testing.md) |
| TEST-13 | P3 | Template leftovers under test (Grok connectors) and global TLS-disable in one test file | [08-testing.md](08-testing.md) |
| TEST-14 | P3 | `mediaFileResponse` test is tautological about the filename | [08-testing.md](08-testing.md) |
| TEST-15 | P3 | `scripts/migrate.mjs` has no automated test against real Postgres (manually verified OK) | [08-testing.md](08-testing.md) |
| TEST-16 | P3 | Windows process-tree kill path is untested (test skipped on win32) | [08-testing.md](08-testing.md) |
| TEST-17 | P3 | Positive: suite is hermetic, fast and deterministic, which is a good base for CI (info) | [08-testing.md](08-testing.md) |
| TEST-18 | P3 | Relay allow-list tests do not cover ports; `isRelayTarget` accepts any port | [08-testing.md](08-testing.md) |
| INST-01 | P1 | A fresh clone runs with sign-in ON through the committed shared preview OAuth client, contradicting docs and code comments | [09-clean-install.md](09-clean-install.md) |
| INST-02 | P2 | Node version support is undocumented or wrong (README "v22.0.0+", no `engines`/`.nvmrc`; deps need ^22.22.2 / ^24.15 / ≥26; test runner needs ≥22.6) | [09-clean-install.md](09-clean-install.md) |
| INST-03 | P2 | The state to be shipped is uncommitted: HEAD differs from the working tree by 27 modified + 3 untracked files (and CRLF in 15 of them) | [09-clean-install.md](09-clean-install.md) |
| INST-04 | P2 | Dev server hard-coded to `0.0.0.0:8080` + `strictPort`; override undocumented; direct wrapper invocation breaks on Windows | [09-clean-install.md](09-clean-install.md) |
| INST-05 | P2 | `npm run build` silently skips migrations without `DATABASE_URL`, and the app then runs on per-process in-memory PGLite | [09-clean-install.md](09-clean-install.md) |
| INST-06 | P2 | External runtime dependencies and required env vars are not documented (python3/yt-dlp/ffmpeg/curl, Playwright browsers, DATABASE_URL, VELO_VAULT_KEY, BETTER_AUTH_SECRET) | [09-clean-install.md](09-clean-install.md) |
| INST-07 | P3 | Grok-sandbox scaffolding confuses contributors: `startup.sh` (/tmp, 8080), AGENTS.md, `/workspace` paths, brand notes | [09-clean-install.md](09-clean-install.md) |
| INST-08 | P3 | Deprecated dev/runtime deps at install (`eslint@9.39.5` EOL, `recharts@2`) | [09-clean-install.md](09-clean-install.md) |
| INST-09 | P3 | Build output is heavy (68 MB; a 32 MB wasm is static; 500 kB+ chunks) and noisy (56 directive warnings) | [09-clean-install.md](09-clean-install.md) |
| INST-10 | P3 | Dev server prints unhandled `Error: aborted … status 500` stack traces on every client abort | [09-clean-install.md](09-clean-install.md) |
| INST-11 | P3 | Stray committed `.node_modules.lock` | [09-clean-install.md](09-clean-install.md) |
| INST-12 | P3 | `/api/health` labels any Postgres as `"neon"` | [09-clean-install.md](09-clean-install.md) |
| WEB-01 | P1 | One malformed percent-encoded URL (`GET /%`) crashes the whole Node server process | [10-production-web-security.md](10-production-web-security.md) |
| WEB-02 | P1 | No security response headers at all | [10-production-web-security.md](10-production-web-security.md) |
| WEB-03 | P1 | A third-party script (grok.com) is injected into every page with no SRI or CSP, on the same origin where users paste Google session cookies | [10-production-web-security.md](10-production-web-security.md) |
| WEB-04 | P1 | `/api/*` routes have no CSRF / Fetch-Metadata gate: a cross-site `text/plain` POST started yt-dlp on the server | [10-production-web-security.md](10-production-web-security.md) |
| WEB-05 | P2 | Raw upstream errors go to anonymous callers | [10-production-web-security.md](10-production-web-security.md) |
| WEB-06 | P2 | Page can be framed, and `?v=…&auto=1` auto-starts a download with no user gesture | [10-production-web-security.md](10-production-web-security.md) |
| WEB-07 | P2 | README-documented `npm run dev` binds 0.0.0.0 and serves project source to the LAN | [10-production-web-security.md](10-production-web-security.md) |
| WEB-08 | P2 | Guide coaches users to copy their YouTube/Google session cookies to the clipboard with a bookmarklet and paste them into the site | [10-production-web-security.md](10-production-web-security.md) |
| WEB-09 | P1 | The committed preview OAuth client secret is baked into the deployable server bundle | [10-production-web-security.md](10-production-web-security.md) |
| WEB-10 | P3 | Server-function errors return HTTP 200 with the error in the body; zod validation errors echo the input schema | [10-production-web-security.md](10-production-web-security.md) |
| WEB-11 | P3 | `/api/health?deep=1` is unauthenticated, uncached and not rate-limited | [10-production-web-security.md](10-production-web-security.md) |
| WEB-12 | P3 | Sign-in on a self-hosted / localhost origin fails with "not a trusted origin" and the UI names the auth library | [10-production-web-security.md](10-production-web-security.md) |
| WEB-13 | P3 | No `security.txt`; unknown `/api/*` paths return an HTML 404 page | [10-production-web-security.md](10-production-web-security.md) |
| UX-01 | P2 | History and Guide header panels render partly off-screen on phones | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-02 | P2 | WebKit/Safari hydration mismatch on every mobile load | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-03 | P2 | Main URL/search input has no adequately visible focus indicator | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-04 | P2 | Guide panel heading is 1.17:1 contrast | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-05 | P2 | UI copy advertises circumvention and an "AI" feature | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-06 | P2 | No footer / legal surface anywhere in the UI | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-07 | P3 | Raw exception text shown to users | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-08 | P3 | Most touch targets are below 44×44 px on mobile | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-09 | P3 | Command palette does not return focus to the page on Esc | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-10 | P3 | Tab and mode state are not in the URL | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-11 | P3 | Header panels stay open after keyboard focus leaves them | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-12 | P3 | Bulk queue accepts an unbounded number of items | [11-ux-accessibility.md](11-ux-accessibility.md) |
| UX-13 | P3 | Accessible name does not match visible label; page titles are not distinct | [11-ux-accessibility.md](11-ux-accessibility.md) |
| PERF-01 | P2 | Mobile LCP 4.7 s / FCP 4.2 s; heavy critical path | [12-performance-seo.md](12-performance-seo.md) |
| PERF-02 | P2 | Bulk queue is not virtualized | [12-performance-seo.md](12-performance-seo.md) |
| PERF-03 | P3 | 70% of shipped JS is unexecuted on first load; dynamic imports defeated | [12-performance-seo.md](12-performance-seo.md) |
| PERF-04 | P3 | 31.5 MB ffmpeg-core.wasm and 567 KB mediabunny chunk | [12-performance-seo.md](12-performance-seo.md) |
| PERF-05 | P3 | 34 MB server function with jsdom and PGLite bundled; slow cold path | [12-performance-seo.md](12-performance-seo.md) |
| PERF-06 | P3 | Unused heavy dependencies declared | [12-performance-seo.md](12-performance-seo.md) |
| PERF-07 | P2 | SEO/share metadata is minimal | [12-performance-seo.md](12-performance-seo.md) |
| PERF-08 | P3 | No robots.txt or sitemap.xml | [12-performance-seo.md](12-performance-seo.md) |
| PERF-09 | P3 | Third-party requests and cookies on every page load | [12-performance-seo.md](12-performance-seo.md) |
| PRIV-01 | P0 | No privacy policy, terms, cookie/storage notice, or third-party disclosure anywhere, for an app that collects Google session credentials | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-02 | P0 | Vault stores Google session cookies in plaintext unless `VELO_VAULT_KEY` is set (warn-only), while the README says "Encrypted … safely" | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-03 | P0 | Extension "Send to Velo" hands the Google session to any `*.grok.me` / `*.grok.com` / localhost tab whose *title* starts with "Velo". It also passively records every YouTube `Cookie` header | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-04 | P1 | Over-collection: the vault keeps every `.youtube.com` and `.google.com` cookie (a full Google-account session), has no TTL, and sends the decrypted jar to browser JS on every page load | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-05 | P1 | A mutable third-party script (`grok.com/grok-app-builder/extensions.js`) runs on every page, same-origin with the vault, with no SRI or CSP | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-06 | P1 | No account deletion or data export. `youtube_vault` has no FK or cascade to `user`, and nothing ever deletes data | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-07 | P1 | Shared `dev-user` vault: with auth off and no `DATABASE_URL`, every visitor reads and overwrites the same Google session | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-08 | P1 | Identity data goes to xAI's broker (`auth.grok.me`, default shared `grok_preview` client) and to the Grok gate. This is not disclosed | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-09 | P1 | Undisclosed third parties get user IPs and viewing activity: CORS relays (corsfix, allorigins) straight from the browser, plus free anonymous SOCKS proxies | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-10 | P2 | Every signed-in user's Google session goes out through operator-configured global proxies. This risks Google locking accounts, and users are not told | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-11 | P2 | Log line records the raw Better Auth session token (bearer plugin accepts unsigned tokens) | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-12 | P2 | Session credentials land on the OS clipboard and in Downloads (bookmarklet, both extensions, HAR/cookies.txt export) | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-13 | P2 | Persistent guest identifier plus browser storage inventory. Watch history, watch list and media copies stay on shared devices after sign-out | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-14 | P2 | Platform request logs record viewing history per IP (`/api/download?id=`, `/api/relay?url=<signed googlevideo URL>`) | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-15 | P2 | Session IP/UA and the OAuth `idToken` (email, name) are stored unencrypted with no retention; `verification` rows grow forever | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-16 | P3 | No age or children policy for an app that asks for Google account credentials | [13-privacy-data.md](13-privacy-data.md) |
| PRIV-17 | P3 | Dead code with third-party data paths ships in the OSS tree (`multiplayer/p2p.ts` STUN, `app-data` → `connectors.grok.me`) | [13-privacy-data.md](13-privacy-data.md) |
| OPS-01 | P0 | No way to see an outage: no error monitoring, no alerting, no server-side logging of download/extraction failures. `/api/health` checks only the DB and nothing watches it | [14-operations.md](14-operations.md) |
| OPS-02 | P0 | No incident-response or credential-compromise runbook for a service that holds users' Google sessions. DB and vault key sit in the same Vercel env, and there is no mass-revoke or notify mechanism | [14-operations.md](14-operations.md) |
| OPS-03 | P1 | The "most reliable path" (python/yt-dlp, curl, ffmpeg) is not in the Vercel bundle and fails silently in production | [14-operations.md](14-operations.md) |
| OPS-04 | P1 | Workload vs Vercel limits: no `maxDuration`, an 8-min ladder, multi-GB streams through one function, a 400 MB disk cache against a 512 MB `/tmp` | [14-operations.md](14-operations.md) |
| OPS-05 | P1 | Deploy-time migrations run in `npm run build` against `DATABASE_URL` (preview builds too). No down migrations, rollback does not revert schema, no documented backup/PITR | [14-operations.md](14-operations.md) |
| OPS-06 | P1 | A missing `DATABASE_URL` silently puts production on per-instance in-memory PGLite, and `/api/health` still reports `200 ok` | [14-operations.md](14-operations.md) |
| OPS-07 | P1 | Rotating the cookie vault key is impossible: no `VELO_VAULT_KEY_PREVIOUS` for cookies (proxy secrets have it). Rotation bricks every vault, and the client hides the error | [14-operations.md](14-operations.md) |
| OPS-08 | P1 | Denial of wallet and IP bans: quotas are per-instance in-memory, all bytes are proxied through Vercel egress, YouTube blocks datacenter IPs, and the app depends on free third-party infrastructure with no SLA | [14-operations.md](14-operations.md) |
| OPS-09 | P2 | No CI gate: tests/typecheck/lint/build never run on push or PR. The only workflow is a write-scoped weekly auto-updater | [14-operations.md](14-operations.md) |
| OPS-10 | P2 | The live npm/pip installer targets an immutable, per-instance serverless filesystem and hands all secrets to package lifecycle scripts | [14-operations.md](14-operations.md) |
| OPS-11 | P2 | In-memory per-instance state (slots, rate limits, SOCKS pool, "direct blocked" bit, jsdom bound to `globalThis`) behaves inconsistently under Fluid / multi-instance | [14-operations.md](14-operations.md) |
| OPS-12 | P2 | DB connection handling: two default `pg` Pools per instance, no connection/statement timeouts, no Fluid pool attach | [14-operations.md](14-operations.md) |
| OPS-13 | P2 | Logging hygiene: unstructured `console.*`, no request IDs, raw error objects, one session-token leak (PRIV-11), no retention/drain config | [14-operations.md](14-operations.md) |
| OPS-14 | P3 | Runtime code/config pulled from mutable upstreams (`--remote-components ejs:github`, proxifly `@main`, grok.com script) with no pinning or fallback visibility | [14-operations.md](14-operations.md) |
| OPS-15 | P3 | `startup.sh` / AGENTS.md sandbox contract ships in the product repo. `startup.sh` logs to `/tmp` with no rotation | [14-operations.md](14-operations.md) |
| AI-01 | P3 | Copy-a-prompt feature ships untrusted transcript content as an LLM prompt | [15-ai-security.md](15-ai-security.md) |
| AI-02 | P3 | Silent clipboard hand-off of transcript to third-party LLMs; no auto-open URLs | [15-ai-security.md](15-ai-security.md) |
| REL-01 | P1 | No versioning: no version, tags, releases or CHANGELOG, and the running build cannot identify itself | [16-release-engineering.md](16-release-engineering.md) |
| REL-02 | P1 | The cookie-extracting extension zip is a hand-committed binary with no build, hash, signature or provenance | [16-release-engineering.md](16-release-engineering.md) |
| REL-03 | P1 | Migrations run inside `npm run build` against whatever `DATABASE_URL` the build sees: previews can migrate prod, a failure leaves a half-applied schema, there is no rollback | [16-release-engineering.md](16-release-engineering.md) |
| REL-04 | P1 | Deployment is not driven, gated or recorded by the repo; nothing documents promotion or rollback | [16-release-engineering.md](16-release-engineering.md) |
| REL-05 | P1 | The deployed artifact is mutable at runtime: the Tools tab runs `npm install` / `pip install` on the live server | [16-release-engineering.md](16-release-engineering.md) |
| REL-06 | P2 | Toolchain drift: Node 22 docs/CI vs `nodejs24.x` prod vs 25 local; yt-dlp unpinned; Python/ffmpeg absent from the Vercel artifact; production on a nitro beta | [16-release-engineering.md](16-release-engineering.md) |
| REL-07 | P2 | No SBOM, provenance attestations or checksums for any artifact | [16-release-engineering.md](16-release-engineering.md) |
| REL-08 | P1 | Extension distribution: sideload-only, never updates, hard-wired to Grok hosts, Chrome Web Store policy unresolved | [16-release-engineering.md](16-release-engineering.md) |
| REL-09 | P2 | No release checklist, post-deploy smoke test or rollback runbook | [16-release-engineering.md](16-release-engineering.md) |
| REL-10 | P3 | Build output is deterministic on one host; cross-host reproducibility is unproven | [16-release-engineering.md](16-release-engineering.md) |
| CLEAN-01 | P2 | 32 declared dependencies are never imported | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-02 | P2 | Grok App Builder template leftovers | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-03 | P2 | Three copies of the `velo-session` extension | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-04 | P2 | `operatorGate` implemented twice | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-05 | P2 | Unreachable modules and test-only code | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-06 | P2 | 179 unused-variable warnings; `ytdlp-proc.server.ts` dead imports and wrong header | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-07 | P2 | Endpoints and exported aliases with no caller | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-08 | P3 | Duplicate small implementations and two transcript UIs | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-09 | P3 | Obsolete / orphan scripts | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-10 | P3 | Duplicate migration | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-11 | P3 | Env vars that only feed dead or template code | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-12 | P3 | Hard-coded localhost / sandbox paths | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-13 | P3 | Developer-/tool-specific configuration | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-14 | P3 | CRLF/LF churn in the working tree | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-15 | P3 | Template placeholder text and example code | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-16 | P3 | `console.log` and dead variables in the shipped extension | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-17 | P3 | Dead feature flags and no-op functions | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
| CLEAN-18 | P3 | `extension/` is unshipped and unversioned | [17-codebase-cleanliness.md](17-codebase-cleanliness.md) |
