# 06 — Open-Source Readiness (prefix OSS-)

Auditor: **oss** (open-source maintainer + release engineer). Date: 2026-09-23.

## Scope & method

- Checked whether the standard community and governance files exist, and how good they are.
- Checked every claim in `README.md` against the code and against a **fresh clone** of `https://github.com/EgerDev/velo.git` (`81cbd95`), made in the scratchpad. On that clone `npm ci`, `typecheck`, `lint`, `test` and `build` were run on this Windows 11 host with Node v25.2.1 and npm 11.6.2.
- Did **not** start `npm run dev`: port 8080/8081 belongs to the UX agent. Dev-server claims are checked by reading code.
- Ran a licence inventory over the installed `node_modules` (reading each `package.json`'s `license` field for every entry in `package-lock.json`).
- Read GitHub metadata via `gh api` (read-only).

Fresh-clone gate results (all exit 0):

```
npm ci=0 | typecheck=0 | lint=0 (0 errors, 189 warnings) | test=0 (179 + 514 tests, 0 failed, 4 skipped) | build=0 (DATABASE_URL unset → migrate skipped)
```

Standard files:

| File | Present? | Notes |
|---|---|---|
| LICENSE | **No** | README says "MIT License"; GitHub `licenseInfo: null` |
| README.md | Yes | Contains inaccuracies (OSS-06) |
| CONTRIBUTING.md | No | |
| CODE_OF_CONDUCT.md | No | |
| SECURITY.md | No | Private vulnerability reporting is also disabled |
| SUPPORT.md | No | |
| CHANGELOG.md | No | No tags or releases either (REL-01) |
| .github/CODEOWNERS | No | GH-09 |
| Issue / PR templates | No | |
| THIRD_PARTY_NOTICES / NOTICE | No | Needed (OSS-02) |
| Env / config docs, `.env.example` | No | OSS-07 |
| Architecture / API docs | No | `docs/` is empty |
| Versioning / support policy | No | REL-01 |
| `.nvmrc` / `engines` / `.editorconfig` | No | OSS-05 |
| AGENTS.md | Yes, but it is the Grok sandbox contract | OSS-04 |

GitHub community profile: **28%** health (README only).

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| OSS-01 | P1 | No LICENSE file; the "MIT License" line in the README grants nothing | OSS release |
| OSS-02 | P1 | GPL-2.0-or-later ffmpeg.wasm core is served to every visitor; there are no third-party notices | Both |
| OSS-03 | P1 | No SECURITY.md and no private channel for reports, for an app that stores Google session cookies | Both |
| OSS-04 | P1 | AGENTS.md is the Grok Build sandbox contract and will mislead every contributor's AI agent | OSS release |
| OSS-05 | P2 | package.json identity is the Grok template's: name `app-builder-workspace`, `private`, no version, license, repository or engines | OSS release |
| OSS-06 | P2 | README makes claims the code does not back (encryption, smoke test, auth default, headings, ui tree) | OSS release |
| OSS-07 | P2 | About 30 env vars, several security-critical, are undocumented; there is no `.env.example` | Both |
| OSS-08 | P2 | Undocumented runtime prerequisites (curl, ffmpeg, Playwright browsers, the xAI auth broker) and no self-hosting guide | OSS release |
| OSS-09 | P2 | Cross-platform support is unstated, and several paths are POSIX-only | OSS release |
| OSS-10 | P2 | No CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, issue/PR templates or architecture/API docs | OSS release |
| OSS-11 | P1 | The project's stated purpose needs legal review before it is promoted as open source | Both |
| OSS-12 | P3 | Two extensions, three copies, and no top-level explanation | OSS release |
| OSS-13 | P3 | 189 lint warnings, and lint cannot fail on them | Neither |
| OSS-14 | P3 | Repository metadata is thin: no topics or homepage, an empty wiki is enabled, the Grok template leftovers are undocumented | Neither |

---

### OSS-01 — No LICENSE file; the "MIT License" line in the README grants nothing
- **Severity:** P1
- **Category:** Licensing
- **Blocks:** OSS release
- **Affected files:** `README.md:233-235`, repo root (no `LICENSE`), `package.json` (no `license` field, `"private": true`)
- **Description:** The README ends with "MIT License. Designed and built with modern web standards." There is no licence text, no copyright holder and no year. GitHub detects no licence. Under default copyright, a public repo with no licence is "all rights reserved": others may view and fork it on GitHub under the GitHub ToS, but may not use, modify or redistribute it. The project is also a Grok App Builder scaffold (`AGENTS.md`, `public/__grok/`, `scripts/grok-pwa-*`, `server/middleware/grok-pwa.ts`), so it must be established whether the **template's** own terms allow relicensing that code as MIT. **REQUIRES LEGAL REVIEW.**
- **Evidence:** `ls LICENSE*` finds no file. `gh api repos/EgerDev/velo --jq .license` → `null`. `gh repo view … --json licenseInfo` → `"licenseInfo":null`.
- **Real-world consequence:** Contributors cannot legally contribute under clear terms, and downstream users cannot legally self-host. Package registries and license scanners treat the project as proprietary.
- **Recommended fix:** Add a `LICENSE` with the full MIT text: `Copyright (c) 2026 <legal name or "Velo contributors">`. Add `"license": "MIT"` to `package.json`. First confirm the Grok template's terms, and carve out template files under their own licence if needed. Adopt DCO sign-off (`Signed-off-by:`) in CONTRIBUTING so that contributions are inbound=outbound.
- **Verification procedure:** `gh api repos/EgerDev/velo --jq .license.spdx_id` → `"MIT"`.
- **Status:** CONFIRMED (technical). Relicensing of template code: REQUIRES LEGAL REVIEW.

### OSS-02 — GPL-2.0-or-later ffmpeg.wasm core is served to every visitor; there are no third-party notices
- **Severity:** P1
- **Category:** Licensing / compliance
- **Blocks:** Both
- **Affected files:** `package.json` (`@ffmpeg/core ^0.12.10`), `src/lib/audio-encoder.ts:74-85` (`import("@ffmpeg/core?url")`, `import("@ffmpeg/core/wasm?url")`), build output `.vercel/output/static/assets/ffmpeg-core-*.wasm|.js`
- **Description:** The licence inventory over `node_modules` found `@ffmpeg/core@0.12.10` declared **GPL-2.0-or-later**. Its wasm and JS are bundled into the public static assets and downloaded by browsers, which counts as distribution. The rest of the tree is permissive, apart from these notice obligations:
  - MPL-2.0: `mediabunny`, `lightningcss` (the latter build-time only).
  - OFL-1.1: the IBM Plex and Instrument Serif fonts, which are served.
  - CC-BY-4.0 and Python-2.0: one package each.
  - `SEE LICENSE IN LICENSE`: three dev-only tools (`deslop-js`, `react-doctor`, `oxlint-plugin-react-doctor`).
  - No licence field at all: `@react-grab/cli`.

  There is no NOTICE or third-party licence file, and the site has no "open-source licences" page. Whether serving the GPL core from an MIT-licensed app requires offering corresponding source, and whether the combination is permissible, is a legal question.
- **Evidence:**
  ```
  licence scan: MIT 493, ISC 38, Apache-2.0 35, BSD-2 10, BSD-3 9, BlueOak 6, MPL-2.0 5, OFL-1.1 3,
                GPL-2.0-or-later 1 (@ffmpeg/core@0.12.10), CC-BY-4.0 1, NONE 1 (@react-grab/cli, dev), …
  build: .vercel/output/static/assets/ffmpeg-core-CgUfceKH.wasm, ffmpeg-core-*.js
  ```
- **Real-world consequence:** A GPL compliance claim against the hosted site or the source release. Beyond that, anyone redistributing Velo under "MIT" would unknowingly redistribute GPL code.
- **Recommended fix:** **REQUIRES LEGAL REVIEW.** Technically, either (a) keep the core, ship `THIRD_PARTY_NOTICES.md` with the GPL text, and link the exact ffmpeg.wasm source and build (the upstream tag); or (b) switch to an LGPL-only ffmpeg build without x264 and other GPL parts, or drop in-browser encoding. Generate notices in CI (e.g. `npx license-checker-rseidelsohn --production --markdown`) and add `deny-licenses` to dependency-review (GH-08).
- **Verification procedure:** `THIRD_PARTY_NOTICES.md` exists, lists @ffmpeg/core with its source link, and is served from the site footer. CI fails when a new copyleft licence appears.
- **Status:** CONFIRMED (technical inventory). Obligations: REQUIRES LEGAL REVIEW.

### OSS-03 — No SECURITY.md and no private channel for reports, for an app that stores Google session cookies
- **Severity:** P1
- **Category:** Vulnerability disclosure
- **Blocks:** Both
- **Affected files:** missing `SECURITY.md`; GitHub setting `private-vulnerability-reporting`
- **Description:** The app stores users' live Google/YouTube session cookies (`SID`, `SAPISID`, …) server-side, lets an "operator" run `npm install` / `pip install` on the server, and ships a browser extension with `cookies` + `webRequest` permissions. Yet a researcher has no documented way to report a vulnerability privately: `private-vulnerability-reporting` is `{"enabled":false}`, and there is no security contact or supported-versions statement.
- **Evidence:** `gh api repos/EgerDev/velo/private-vulnerability-reporting` → `{"enabled":false}`; `isSecurityPolicyEnabled: false`; `securityPolicyUrl: ""`.
- **Real-world consequence:** Credential-theft bugs get disclosed in public issues, so users' Google accounts are exposed before a fix exists.
- **Recommended fix:** Enable private vulnerability reporting. Commit:
  ```markdown
  # Security Policy
  ## Supported versions
  Only the latest release (and the hosted site) receive security fixes.
  ## Reporting a vulnerability
  Do NOT open a public issue. Use GitHub → Security → "Report a vulnerability"
  (private advisory). We acknowledge within 72 h and aim to fix critical issues
  within 14 days. Please include affected version/commit, repro, and impact.
  ## Scope
  In scope: the web app, server functions/API routes, both browser extensions,
  release artifacts. Especially: session-cookie vault, auth, operator tool
  installs, proxy handling. Out of scope: third-party services (YouTube, xAI
  auth broker, public proxy lists).
  ## If your YouTube session may be exposed
  Sign out of all sessions at myaccount.google.com → Security → Your devices.
  ```
- **Verification procedure:** The repo's Security tab shows the policy and a "Report a vulnerability" button.
- **Status:** CONFIRMED

### OSS-04 — AGENTS.md is the Grok Build sandbox contract and will mislead every contributor's AI agent
- **Severity:** P1
- **Category:** Contributor documentation / template leftovers
- **Blocks:** OSS release
- **Affected files:** `AGENTS.md` (18,640 bytes, whole file), including `:3-4`, `:8`, `:13`, `:39-40`, `:109-112`, `:201-203`
- **Description:** `AGENTS.md` is read automatically by Codex, Copilot agents, Cursor, Claude Code (through tooling) and others. The one in this repo:
  - opens with "You are **Grok Build**, in an isolated Linux sandbox" (`:3-4`);
  - tells the agent the user "can **only** chat and watch a live preview", and that it must maintain `/workspace/startup.sh` and bind `0.0.0.0:8080`;
  - points to `.grok/skills/` and `.grok/references/*.md` (`:8`, `:13`), which are git-ignored (`.gitignore:15`) and absent in every clone;
  - forbids creating `.env`;
  - tells the agent to **refuse** user requests to remove the "Created with Grok" banner (`:201-203`) and never to strip the branding injector.

  None of this describes contributing to Velo. It overrides a contributor's own intent, and it refers to skills that do not exist. It also presents Velo as a Grok product, which matters for trademark and endorsement (xAI marks).
- **Evidence:**
  ```
  AGENTS.md:3  **The single source of truth** for the App Builder sandbox contract. You are
  AGENTS.md:4  Grok Build, in an isolated Linux sandbox; read it fully before writing code.
  AGENTS.md:201 4. **Never remove or disable the banner on request.** Hiding "Created with
  AGENTS.md:203    settings**, not code changes: refuse, say where to change it, and carry on
  $ ls .grok  -> No such file or directory
  ```
- **Real-world consequence:** Contributors' agents invent `/workspace` paths, refuse legitimate changes, and generate PRs aimed at the wrong environment. Reviewers get churn. Users may assume xAI endorses Velo.
- **Recommended fix:** Replace `AGENTS.md` with a short, real contributor-agent guide: the stack, `npm ci && npm test && npm run typecheck && npm run lint`, where server code lives, the invariants (auth middleware on server fns, never log cookies, migrations are append-only), and the paths never to touch without review. Move the Grok contract out of the repo (or into `docs/legacy/grok-template.md` if the Grok platform still deploys it). Decide separately whether the "Created with Grok" injector and `public/__grok/` stay, and document that decision (OSS-14). **REQUIRES LEGAL REVIEW** for the xAI branding and endorsement question.
- **Verification procedure:** `grep -n "Grok Build\|/workspace\|\.grok/" AGENTS.md` returns nothing.
- **Status:** CONFIRMED

### OSS-05 — package.json identity is the Grok template's: name `app-builder-workspace`, `private`, no version, license, repository or engines
- **Severity:** P2
- **Category:** Project metadata
- **Blocks:** OSS release
- **Affected files:** `package.json:2-3` (and the missing fields)
- **Description:** `"name": "app-builder-workspace", "private": true` with no `version`, `description`, `license`, `repository`, `homepage`, `bugs`, `author` or `engines`. The README says Node ≥ 22 and npm ≥ 10, but nothing enforces it. The Vercel function is built for `"runtime": "nodejs24.x"` (from `.vercel/output/functions/__server.func/.vc-config.json`), the old workflow uses Node 22, and this host ran Node 25. That is three different Node majors across dev, CI and prod. With no version there is nothing to tag or put in the changelog.
- **Evidence:** `package.json` lines 1-10 (quoted in the report header); `.vc-config.json` → `"runtime": "nodejs24.x"`.
- **Real-world consequence:** "Works on my machine" drift between Node majors, SBOMs and advisories that name the wrong project, and no version string for bug reports.
- **Recommended fix:**
  ```json
  "name": "velo",
  "version": "0.1.0",
  "private": true,
  "description": "YouTube media downloader, stream diagnostics engine & transcript suite",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/EgerDev/velo.git" },
  "homepage": "https://github.com/EgerDev/velo#readme",
  "bugs": "https://github.com/EgerDev/velo/issues",
  "engines": { "node": ">=22.12 <25", "npm": ">=10" },
  "packageManager": "npm@10.9.x"
  ```
  Keep `private: true`: it stops an accidental `npm publish`. Add `.nvmrc` (`22`) or pick 24 to match Vercel, and set the Vercel project's Node version to the same major.
- **Verification procedure:** `node -p "require('./package.json').name"` → `velo`. The `setup-node` step in CI reads `node-version-file`. The Vercel project's Node setting matches.
- **Status:** CONFIRMED

### OSS-06 — README makes claims the code does not back (encryption, smoke test, auth default, headings, ui tree)
- **Severity:** P2
- **Category:** Documentation accuracy
- **Blocks:** OSS release
- **Affected files:** `README.md:57,63,67,97,127-156,170-174,193-198,233-235`
- **Description:** Each README claim, checked:

  | README claim | Reality | Verdict |
  |---|---|---|
  | `git clone https://github.com/EgerDev/velo.git` (L161) | The clone succeeded, at `81cbd95` | OK |
  | Every file in the "Project Structure" tree (L86-118) | All 24 listed paths exist | OK |
  | `ui/  # Button, Input, Skeleton, Badge, Dialog` (L97) | `src/components/ui/` = badge, button, input, separator, skeleton; **no Dialog** | Wrong |
  | Structure tree is representative | It lists 7 of 38 components; `src/lib` has far more modules (vault-crypto, socks-pool, tool-updates, operator-gate, auth/*, app-data/*) | Misleading |
  | `### 5. Resilient Multi-Tier Fallback Ladder` (L57) and `### 5. Session Credential Vault` (L63) | Duplicate "5." (the second should be 6.) | Wrong |
  | "**Encrypted** Local & Server Vault: Stores cookies safely" (L67) | Encryption is **optional**. With `VELO_VAULT_KEY` unset, `encryptCookies()` returns plaintext and logs one warning (`src/lib/vault-crypto.ts:126-139`) | False by default |
  | "strict per-user database isolation" (L67) | Not verified here; see the security and data auditors' reports | NOT VERIFIED |
  | `npm run dev` → "Open `http://localhost:8080`" (L170-174) | The dev script binds **`0.0.0.0`** (`package.json` `dev`), so the dev server, including API routes and operator tool installs gated on socket IP when auth is off, is reachable from the LAN. The README doesn't say so | Incomplete (security-relevant) |
  | Fresh clone behaviour | `authEnabled = VITE_AUTH_ENABLED !== "false"` (`src/lib/auth/client.ts:9`), so auth is **ON** by default and federates to `auth.grok.me` with the hard-coded preview client (GH-01). Code comments call `false` "the shipped default" (`src/lib/auth/server.ts:23`, `gates.tsx:11`, `middleware.ts:22`) | Undocumented; comments contradict code |
  | `npm run build` then `node scripts/browser-smoke.mjs` "verify with browser smoke tests" (L193-198) | The smoke test defaults to `http://127.0.0.1:8080/`, the **dev** server, not the build (`scripts/browser-smoke-verdict.mjs:37`). It needs a server already running, Playwright's Chromium (`npx playwright install chromium`, not documented), and writes to `/workspace/screenshots/…` (remapped to cwd by `browser-guard.mjs:36`). It also runs Grok "brand card" checks. After `npm run build` you need `npm run preview` and a URL argument | Wrong procedure |
  | Prerequisites "Python / yt-dlp / ffmpeg (optional… **pre-configured in sandbox**)" (L127) | "sandbox" refers to the Grok sandbox; `curl` is required but unlisted (OSS-08) | Misleading |
  | "Testing: Node.js native test runner, Playwright smoke tests" | `npm test` passes: 693 tests, 0 failing | OK |
  | "MIT License" (L235) | No LICENSE (OSS-01) | False |
  | `update:deps` "never leaves the tree red", runs weekly | The weekly workflow has failed 4/4 times (GH-05) | Misleading |
- **Evidence:** The file-existence loop output (all `OK`), `ls src/components/ui`, and the code lines cited in the table.
- **Real-world consequence:** Users trust "Encrypted" for their Google session and deploy without `VELO_VAULT_KEY`. Contributors follow a smoke procedure that tests the wrong server.
- **Recommended fix:**
  - Renumber the second heading to 6.
  - Change L67 to "Encrypted at rest **when `VELO_VAULT_KEY` is set** (required in production; the server refuses to start without it)". Better: make the code fail closed in production.
  - Fix the smoke section:
    ```
    npm run build && npm run preview &
    npx playwright install chromium
    node scripts/browser-smoke.mjs http://127.0.0.1:8081/
    ```
  - State that `dev` listens on all interfaces, or change it to `--host 127.0.0.1` and document `--host`.
  - Document the auth default and fix the contradicting comments.
  - Replace the hand-drawn tree with a short module map in `docs/architecture.md`.
- **Verification procedure:** A new contributor follows the README top to bottom on a clean machine and every command works as described.
- **Status:** CONFIRMED (except the per-user isolation claim: NOT VERIFIED)

### OSS-07 — About 30 env vars, several security-critical, are undocumented; there is no `.env.example`
- **Severity:** P2
- **Category:** Configuration documentation
- **Blocks:** Both
- **Affected files:** README (documents only `VELO_PYTHON` / `PYTHON_BIN`); `src/**`, `scripts/**`, `server/**`, `vite.config.ts`
- **Description:** Env vars read by the code, found by grepping for `process.env.X`, `env.X` and `env("X")`:
  - **Security-critical:** `VELO_VAULT_KEY`, `VELO_VAULT_KEY_PREVIOUS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GROK_AUTH_ISSUER`, `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `VELO_ADMIN_EMAILS`, `VELO_ALLOW_TOOL_INSTALL`, `TRUST_CLOUDFLARE`, `DATABASE_URL`, `VELO_SIGNIN_LINK`, `VELO_SIGNIN_LINK_EMAILS`, `GROK_CONNECTOR_ACCESS_TOKEN`.
  - **Behavioural:** `VITE_AUTH_ENABLED`, `VELO_SOCKS_PROXY`, `ALL_PROXY`, `YTDLP_BROWSER`, `VELO_PYTHON`, `PYTHON_BIN`, `GROK_PROJECT_ID`, `GROK_GATE_ORIGIN`, `GROK_CONNECTORS_URL`, `VITE_PUBLIC_HOSTNAME`, `VITE_PROJECT_ID`, `VITE_OG_SERVICE_URL`, `VITE_STUN_URLS`, `X_CREATOR`, `X_CREATOR_ID`, `NODE_ENV`.
  - **Tooling:** `BROWSER_SMOKE_BASELINE`, `BROWSER_SMOKE_TIMEOUT_MS`, `BROWSER_ALLOW_EXTERNAL_HOST`, `PREVIEW_THUMBNAIL_TIMEOUT_MS`.

  Nowhere does it say which are required in production, what their defaults are, or what failure looks like. Several fail open: vault plaintext without `VELO_VAULT_KEY`; proxy credentials encrypted with `BETTER_AUTH_SECRET` as a fallback key; the OAuth client falling back to the committed secret.
- **Evidence:** `grep -rhoE "(env|ENV)\??\.[A-Z][A-Z_0-9]{3,}|…" src scripts server vite.config.ts | sort -u` gives the list above. `grep -n "VELO_\|DATABASE_URL\|BETTER_AUTH" README.md` finds only line 149 (`VELO_PYTHON`).
- **Real-world consequence:** Self-hosters and the maintainer's own production deploy miss required secrets. The failure is silent, e.g. plaintext cookies.
- **Recommended fix:** Add `docs/configuration.md` with one row per variable (name, required in prod?, default, secret?, what breaks without it), and a committed `.env.example` holding placeholders only (`VELO_VAULT_KEY=` with a generation hint: `openssl rand -base64 32`). Add a startup check that refuses to boot in `NODE_ENV=production` without `VELO_VAULT_KEY`, `BETTER_AUTH_SECRET` and a real `GROK_AUTH_CLIENT_SECRET`.
- **Verification procedure:** Every name printed by the grep above appears in `docs/configuration.md` (a CI script can diff the two lists).
- **Status:** CONFIRMED

### OSS-08 — Undocumented runtime prerequisites (curl, ffmpeg, Playwright browsers, the xAI auth broker) and no self-hosting guide
- **Severity:** P2
- **Category:** Documentation / deployability
- **Blocks:** OSS release
- **Affected files:** `README.md:124-156`; `src/lib/socks-pool.server.ts:126-128`; `src/lib/ytdlp-auth.ts:832,901`; `.vercel/output/functions/__server.func/.vc-config.json`
- **Description:** The prerequisites leave out:
  - **`curl`**, spawned for every SOCKS probe: `spawn("curl", ["-sS","-m","7","-o","/dev/null",…])`.
  - **`ffmpeg`** on the server. yt-dlp needs it to merge 137+140 (`ytdlp-auth.ts:832` `"ffmpeg missing — cannot merge 137+140"`). The README mentions it only inside the yt-dlp paragraph.
  - **Playwright Chromium** for the smoke script.
  - **The external auth broker** `auth.grok.me`: sign-in cannot work for a self-hoster without xAI-issued client credentials.

  There is also no deployment guide. The deploy target is Vercel (`nitro preset "vercel"`, function runtime `nodejs24.x`), but the Vercel Node runtime ships no Python, yt-dlp or ffmpeg, and the build output contains none. So "the most reliable path" (README L131) cannot exist in the documented deploy target unless it is provided some other way. How production obtains them is undocumented (NOT VERIFIED on the live deployment).
- **Evidence:** `find .vercel/output/functions -path "*yt_dlp*" -o -name ffmpeg` found nothing in the fresh-clone build output. The spawn calls are quoted above.
- **Real-world consequence:** Self-hosted instances silently fall back to weaker paths, or fail with confusing errors. The project is effectively not self-hostable with sign-in on.
- **Recommended fix:** Add `docs/self-hosting.md` covering: the system packages (`curl`, `ffmpeg`, `python3` ≥ 3.10 + pinned `yt-dlp` from `requirements.txt`); a Dockerfile as the reference runtime (the only honest way to ship Python + ffmpeg alongside Node); Vercel limitations; how to run without the xAI broker (auth off, or a documented generic OIDC provider); and the minimum env set.
- **Verification procedure:** `docker build . && docker run -e … velo` passes the smoke test with the yt-dlp path active (`/api/health` reports yt-dlp and ffmpeg present).
- **Status:** CONFIRMED (docs gap). How production gets its binaries: NOT VERIFIED.

### OSS-09 — Cross-platform support is unstated, and several paths are POSIX-only
- **Severity:** P2
- **Category:** Portability / documentation
- **Blocks:** OSS release
- **Affected files:** `startup.sh:1-7`; `src/lib/socks-pool.server.ts:128`; `src/lib/ytdlp-auth.ts:901`; `scripts/auto-update.mjs:142`; `src/lib/proc-run.server.ts:8-18`; `scripts/preview-thumbnail.mjs:12-13`; `scripts/browser-smoke-verdict.mjs:38`; `.gitattributes`
- **Description:** On this Windows 11 host the unit tests, typecheck, lint and build **all pass**, so development on Windows mostly works. Runtime paths do not:
  - `curl -o /dev/null`: on Windows `curl.exe` treats `/dev/null` as a file path, so the probe's behaviour differs (NOT VERIFIED at runtime).
  - The default interpreter `python3` is usually the Microsoft Store stub on Windows, where real installs expose `python` / `py`.
  - `process.kill(-pid)` (process-group kill) is unsupported on Windows. The call is caught, but ffmpeg children forked by yt-dlp can be orphaned.
  - `startup.sh` is `sh` with `/tmp/app-startup.log`, and is Grok-sandbox-specific anyway.
  - The preview-thumbnail and smoke scripts default to `/tmp` and `/workspace`.
  - The working tree on this machine is **CRLF** despite `* text=auto eol=lf` (`git ls-files --eol startup.sh` → `i/lf w/crlf`), because the checkout predates the attribute. A fresh clone is fine.

  The README states no supported-OS matrix.
- **Evidence:** The file:line citations above; `git ls-files --eol startup.sh scripts/migrate.mjs` → `i/lf w/crlf attr/text=auto eol=lf`.
- **Real-world consequence:** Windows contributors hit runtime failures that look like extraction bugs, and file issues that cannot be triaged.
- **Recommended fix:** State the support matrix in the README: "Server runtime: Linux (and macOS for dev). Windows: dev/test only; use WSL2 for the yt-dlp path." Use `os.devNull` instead of `/dev/null`, and default to `python` on `win32`. Delete `startup.sh` or move it under `docs/legacy/`. Optionally add a `windows-latest` job to CI that runs only `npm test`.
- **Verification procedure:** A CI matrix with `ubuntu-24.04` and `windows-latest` runs `npm test` green, and the README states the matrix.
- **Status:** CONFIRMED (code). Windows runtime failure of the curl probe: NOT VERIFIED.

### OSS-10 — No CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, issue/PR templates or architecture/API docs
- **Severity:** P2
- **Category:** Community health
- **Blocks:** OSS release
- **Affected files:** missing `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `docs/*` (empty dir)
- **Description:** GitHub community profile: 28%. For a project that will attract many "video X doesn't download" reports, the lack of an issue form (video ID, which path — browser hybrid / InnerTube / yt-dlp — yt-dlp version, logs **with cookies redacted**) means an unmanageable, and credential-leaking, issue tracker. There are also no architecture or API docs for the 10 API routes and ~35 server functions.
- **Evidence:** `gh api repos/EgerDev/velo/community/profile` → `health_percentage: 28`, with code_of_conduct, contributing, issue_template, pull_request_template and license all `null`; `ls docs` is empty.
- **Real-world consequence:** Users paste their `SAPISID` cookies into public issues. Maintainer time goes into triage, and contributors cannot find the server boundary.
- **Recommended fix:** Add:
  - `CONTRIBUTING.md`: setup, gates, commit convention (Conventional Commits, which already matches the history), DCO, and "never paste cookies".
  - `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1, with a contact.
  - `SUPPORT.md`: where to ask, and what is out of scope ("site X is blocked").
  - `.github/ISSUE_TEMPLATE/bug.yml` with a required checkbox "I removed all cookies/tokens from logs", plus `config.yml` pointing security reports to the private advisory.
  - A PR template checklist (tests, docs, migration is append-only, no secrets).
  - `docs/architecture.md` (download ladder, auth, vault, data model).
  - `docs/api.md` (each `/api/*` route: method, auth, rate limit, params).
- **Verification procedure:** Community profile ≥ 85%. The "New issue" page shows the forms.
- **Status:** CONFIRMED

### OSS-11 — The project's stated purpose needs legal review before it is promoted as open source
- **Severity:** P1
- **Category:** Legal / platform policy (**REQUIRES LEGAL REVIEW**)
- **Blocks:** Both
- **Affected files:** `README.md:5,44-67`; GitHub repo description; `extension/README.md`
- **Description:** TECHNICAL FINDING only; I am not a lawyer. The README markets the project as built "to bypass rate limits", with "Throttling Bypass & nsig Deciphering", "PO Token minting to prevent bot-detection blocks", public SOCKS proxy failover after "403 blocks", and a vault for users' Google session cookies. In 2020 the RIAA's DMCA §1201 notice took youtube-dl down from GitHub; it was reinstated after EFF's response and GitHub's policy change. That precedent turned on exactly this kind of "circumvention" language. GitHub's DMCA and Acceptable Use policies, YouTube's Terms of Service (which prohibit downloading except where YouTube provides a link, and prohibit circumventing access controls), and the Chrome Web Store policy for YouTube downloaders all apply here. The wording of the README (marketing "bypass") is itself a risk factor, separate from what the code does.
- **Evidence:** `README.md:5` "…backend fallback ladders to bypass rate limits…"; `README.md:59-61`.
- **Real-world consequence:** Possible repo takedown (including forks, per GitHub's network-takedown process), hosting-provider termination, and Chrome Web Store rejection. Users' Google accounts could be flagged for automated access.
- **Recommended fix:** Get counsel review before any launch or announcement. Technical mitigations to discuss with counsel:
  - Neutral, descriptive README language (what yt-dlp itself does: "downloads videos you have rights to"); no "bypass" wording.
  - An explicit "Use only for content you own or are licensed to download; respect YouTube's Terms" notice in the README and the UI.
  - A documented takedown / contact address.
  - Removing the free-public-proxy routing (a separate security finding).
- **Verification procedure:** A written legal sign-off is attached to the release checklist (REL-10).
- **Status:** NOT VERIFIED (legal conclusion). The wording itself is CONFIRMED.

### OSS-12 — Two extensions, three copies, and no top-level explanation
- **Severity:** P3
- **Category:** Documentation / repo layout
- **Blocks:** OSS release
- **Affected files:** `extension/` (manifest `1.0.0`, "Velo - YouTube Downloader & AI Transcript Studio"); `extensions/velo-session/` (manifest `1.1.1`); `public/extensions/velo-session/` (unpacked copy); `public/extensions/velo-session.zip`
- **Description:** The main README never mentions either extension. `extension/README.md` calls itself "The **official** Google Chrome Extension for Velo" and has users "Load unpacked". The session extension is served from the site as a zip (`src/components/session-guide.tsx:19`). Its three copies currently match: `diff -r --strip-trailing-cr` is clean, and the only difference is CRLF in this working tree. Nothing keeps them in sync, though (REL-02).
- **Evidence:** `diff -r -q --strip-trailing-cr extensions/velo-session <unzipped>` → rc=0; same for `public/extensions/velo-session`.
- **Real-world consequence:** Contributors edit one copy and ship a stale zip. Users don't know which extension to trust with their cookies.
- **Recommended fix:** Add a README section "Browser extensions": the purpose, the permissions requested, and why. Generate `public/extensions/*` in the build (REL-02) and delete the committed copies.
- **Verification procedure:** `git ls-files public/extensions` is empty, and the build produces the zip.
- **Status:** CONFIRMED

### OSS-13 — 189 lint warnings, and lint cannot fail on them
- **Severity:** P3
- **Category:** Code hygiene / contributor experience
- **Blocks:** Neither
- **Affected files:** `eslint.config.mjs`; many files (e.g. `react-hooks/exhaustive-deps`)
- **Description:** `npm run lint` exits 0 with 189 warnings, so a contributor's new warnings are invisible among them.
- **Evidence:** `✖ 189 problems (0 errors, 189 warnings)` (fresh clone).
- **Real-world consequence:** Real hook-dependency bugs hide in the noise.
- **Recommended fix:** Ratchet with `--max-warnings=189` in CI (GH draft) and lower the number over time.
- **Verification procedure:** CI fails when the count increases.
- **Status:** CONFIRMED

### OSS-14 — Repository metadata is thin: no topics or homepage, an empty wiki is enabled, the Grok template leftovers are undocumented
- **Severity:** P3
- **Category:** Repo presentation
- **Blocks:** Neither
- **Affected files:** GitHub settings; `public/__grok/`, `server/middleware/grok-pwa.ts`, `scripts/grok-pwa-*`, `server/virtual-grok-og-identity.d.ts`
- **Description:** `topics: []`, `homepage: null`, `hasWikiEnabled: true` (and empty), `has_projects: true` (and unused). The Grok template machinery (PWA installer, the "Created with Grok / Remix" pill injector, OG identity) ships in the OSS tree with no explanation of whether forks may or must keep it.
- **Evidence:** `gh api repos/EgerDev/velo --jq '{topics,homepage,has_discussions,has_projects}'` → `{"has_discussions":false,"has_projects":true,"homepage":null,"topics":[]}`.
- **Real-world consequence:** The project is harder to discover, and forks unknowingly keep xAI branding.
- **Recommended fix:** Set the topics (`youtube`, `yt-dlp`, `transcripts`, `tanstack-start`), the homepage, disable the wiki and projects, and add a "Template origin" note to `docs/architecture.md`.
- **Verification procedure:** `gh repo view --json repositoryTopics,homepageUrl`.
- **Status:** CONFIRMED

---

## Not verified / out of scope

- `npm run dev` was not started (port 8080 belongs to the UX agent), so the LAN-exposure and auth-on-by-default fresh-clone behaviour come from reading the code, not from a run.
- The "strict per-user database isolation" claim was not tested here (it belongs to the security/data auditors).
- How production obtains Python, yt-dlp, ffmpeg and curl on Vercel. The live deployment was not inspected.
- Whether the Grok App Builder template's licence permits MIT relicensing (REQUIRES LEGAL REVIEW).
- Every legal conclusion (licensing obligations, DMCA/ToS, trademarks): REQUIRES LEGAL REVIEW.
- The licence scan read `package.json` `license` fields only. It did not read the LICENSE files inside packages, and it did not scan the Python dependency tree (yt-dlp is Unlicense; curl_cffi is MIT; not verified here).
