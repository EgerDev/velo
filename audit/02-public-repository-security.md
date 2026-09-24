# 02 — Public Repository Security (auditor: repo, prefix REPO-)

## Scope and method

Scope: working tree (HEAD `81cbd95` plus 27 uncommitted modified files and 3 untracked files), full git history (all 41 reachable commits on every ref), unreachable objects (dropped stashes), `.git/config`, `packed-refs`, `FETCH_HEAD`, `ORIG_HEAD`, reflog, hooks, `.gitignore` / `.gitattributes`, the CI workflow, local untracked-but-present dirs (`.vercel/`, `.tanstack/`, `screenshots/`), binaries (`public/extensions/velo-session.zip`, tracked PNGs), fixtures, tests, and docs.

Method:
- **gitleaks v8.30.1** (downloaded release binary into the scratchpad): `gitleaks git --log-opts="--all" --redact=100` (history) and `gitleaks dir --redact=100` (working tree, including ignored `.vercel/output`).
- Manual `git grep -I -E '<pattern>' $(git rev-list --all)` sweeps for emails, private/public IPv4, JWTs, Google/YouTube cookie values, known token prefixes (ghp_/gho_/github_pat_/xox*/sk-/sk_live_/AKIA/ASIA/AIza/xai-/npm_/SG./Slack & Discord webhooks/vercel_/prj_/team_), DB URLs, and `password|secret|token|api_key|client_secret = "…"` assignments.
- A custom Shannon-entropy scanner over every historical **blob** (`git rev-list --objects --all | git cat-file --batch-check`), strings of 32 or more chars: entropy above 4.6, or hex above 3.3.
- `git log --all --diff-filter=D` (deleted files), largest-blob listing, `git fsck --unreachable --no-reflogs` plus a grep of unreachable commits.
- Unzipped `public/extensions/velo-session.zip` into the scratchpad and ran `diff -r` against `extensions/velo-session/`. Parsed PNG chunks for metadata.
- Read-only GitHub API (`gh api`, as the authenticated owner, GET only) for visibility, security settings, Actions runs and clone traffic. I used `gh search code` to find other public repos with the same template file, and compared their secret by `grep -q` only. The value was never printed or sent anywhere.
- Secrets below show at most the first 6 chars followed by `…REDACTED`.

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| REPO-01 | P1 | Repository is ALREADY public (since 2026-08-25) and cloned; everything in history must be treated as disclosed | Both |
| REPO-02 | P1 | Hard-coded xAI "grok_preview" OAuth client secret in every commit plus a production fallback to it | Both |
| REPO-03 | P1 | Published session extension (zip) broadcasts full YouTube session cookies to any `*.grok.me` / `*.grok.com` / `*.grok-sandbox.com` tab titled "Velo" | Both |
| REPO-04 | P2 | Auto-update workflow runs freshly-bumped dependency code with a persisted `contents: write` token; actions pinned to mutable tags | OSS release |
| REPO-05 | P2 | Third-party (xAI/Grok) template code, branding assets and the AGENTS.md sandbox contract ship with no license; README claims MIT with no LICENSE file | OSS release |
| REPO-06 | P2 | No secret-scanning gate: GitHub non-provider patterns and validity checks off, no gitleaks config or CI, no branch protection, Dependabot security updates off | OSS release |
| REPO-07 | P3 | Author PII and machine hostnames in 40 commits; private Claude session URL in a commit message | Neither |
| REPO-08 | P3 | Committed test private key plus scanner false positives (public BotGuard key, InnerTube keys) with no allowlist | Neither |
| REPO-09 | P3 | `.gitignore` gaps (`.env*` swallows `.env.example`; no cookies.txt/HAR/PEM/coverage/.output/audit patterns) | Neither |
| REPO-10 | P3 | Local `.vercel/output` prebuilt bundle embeds the fallback secret and absolute local paths | Website launch |

Clean results (verified, no finding):
- No `.env`, DB dump, log, HAR, cookies.txt, screenshot, `.vercel`, or `.tanstack` file was ever committed. The script listed all 370 paths ever tracked.
- No file was ever deleted from history.
- No real emails appear in code, tests or fixtures. All addresses are `@example.com`, `@x.io` or similar test values. `VELO_ADMIN_EMAILS` has no default value.
- No real cookie values are committed. The only one is `SAPISID\ttest-sapisid-value`.
- No JWTs, cloud keys, DB URLs with credentials, or webhook URLs appear anywhere.
- The largest blobs are `package-lock.json` (390 KB) and two Grok install PNGs (about 100 KB each).
- The 13 unreachable (dropped-stash) commits contain only test fixtures, and they were never pushed.
- `.vercel/` has no `project.json`, so there is no Vercel org or project id.
- The `.git/config` remote is `https://github.com/EgerDev/velo`, with no embedded credentials.
- The zip is content-identical to the source. PNGs carry no EXIF, text or location data; the only metadata is `tEXt Software=Figma` on the two Grok PNGs.
- The working-tree changes add no new secrets. gitleaks `dir` found only the same items reported below.

---

### REPO-01 — Repository is ALREADY public (since 2026-08-25) and cloned; everything in history must be treated as disclosed
- **Severity:** P1
- **Category:** Exposure / release process
- **Blocks:** Both
- **Affected files:** entire repository; `.git/config:9-10` (`origin = https://github.com/EgerDev/velo`)
- **Description:** The audit premise was "the repo goes public tomorrow". It has in fact been public on GitHub since it was created on 2026-08-25. Current HEAD `81cbd95` was pushed today. Every historical object is already disclosed, and rewriting history cannot take it back. Every credential in history (REPO-02) must be handled by **rotation or removal**, not by rewriting. Any decision to publish "after fixes" has already been overtaken.
- **Evidence:**
  ```
  $ curl -s https://api.github.com/repos/EgerDev/velo | grep -E '"(private|visibility|created_at|pushed_at|forks_count|license)"'
    "private": false, "created_at": "2026-08-25T06:50:27Z", "pushed_at": "2026-09-23T08:13:25Z",
    "forks_count": 0, "license": null, "visibility": "public"
  $ gh api repos/EgerDev/velo/branches → main sha 81cbd95cbd8e…
  $ gh api repos/EgerDev/velo/traffic/clones --jq '{count,uniques}'  → {"count":9,"uniques":8}   (last 14 days)
  $ gh api repos/EgerDev/velo/actions/runs → 4 scheduled auto-update runs (08-31, 09-07, 09-14, 09-21), all "failure"
  ```
  Clones happened on 09-10, 09-14, 09-17, 09-20, 09-21 and 09-22 (four that day). Only 09-14 and 09-21 line up with Actions checkouts, so at least 3 clones came from outside Actions. Whether they came from the owner or third parties is NOT VERIFIED.
- **Real-world consequence:** Secret scanners, archive crawlers and search indexes crawl public GitHub repos within minutes. The preview client secret, the author identity, the extension and the xAI template internals are already copied out of the owner's control. The 4 failed workflow logs are also public.
- **Recommended fix:** Decide now whether the repo should stay public while the P1s are open. If not, set it private temporarily (`gh repo edit EgerDev/velo --visibility private --accept-visibility-change-consequences`). This is a manual owner action and was not run. Treat every item in this report as already leaked. Do the rotation and removal work first. Consider history rewriting (REPO-02, REPO-07) only as hygiene afterwards.
- **Verification procedure:** Run `gh api repos/EgerDev/velo --jq .visibility`. After the decision, re-check that traffic and forks remain 0 or are known.
- **Status:** CONFIRMED

### REPO-02 — Hard-coded xAI "grok_preview" OAuth client secret in every commit plus a production fallback to it
- **Severity:** P1
- **Category:** Secret in source / third-party credential
- **Blocks:** Both
- **Affected files:** `src/lib/auth/preview.ts:19-21`, `src/lib/auth/server.ts:46-47,81-86`, built `.vercel/output/functions/__server.func/_ssr/server-DDP6iEQJ.mjs` (local, untracked)
- **Description:**
  - `PREVIEW_CLIENT_SECRET` is a 64-character value (prefix `8bcdb7…REDACTED`) for the confidential OAuth client `grok_preview` at the xAI broker `https://auth.grok.me`.
  - It entered history in the **initial commit `5a40709` (2026-08-24)**. It is present in **all 41 of 41 reachable commits**, because the file never changed, and in HEAD.
  - It is xAI's credential, not this project's. The file comment names xAI's broker repo path (`app-builder-deployer/auth/src/preview-oauth.ts`), says the secret is stored in "the broker's Vercel env", and says the broker keeps only its `base64url(SHA-256)` hash. The broker accepts it for any redirect `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`.
  - The Grok App Builder template injects this constant into every exported app. `gh search code grok_preview` returns about 30 public repos with `src/lib/auth/preview.ts`. At least one (`rardo711/Theos-Logos`) holds the **same** value. Two others hold a **different** value, which suggests xAI rotates it across template versions.
  - `server.ts:81-82` uses the constant whenever `GROK_AUTH_CLIENT_ID/SECRET` are unset. `authConfigured` (`server.ts:85-86`) then becomes true. A self-hosted or Vercel deployment outside the Grok platform therefore silently runs federated sign-in with xAI's shared preview client.
- **Evidence:**
  ```
  $ git log --all --format='%h %ad' --date=short -S"<secret>"      → 5a40709 2026-08-24
  $ for c in $(git rev-list --all); do git grep -q -F "<secret>" $c && echo $c; done | wc -l   → 41   (git rev-list --all | wc -l → 41)
  gitleaks git: generic-api-key src/lib/auth/preview.ts:20 commit 5a40709
  src/lib/auth/server.ts:81  const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
  src/lib/auth/server.ts:82  const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;
  gh api repos/rardo711/Theos-Logos/contents/src/lib/auth/preview.ts | grep -q -F "<secret>" → SAME secret
  grep -rlF "<secret>" .vercel/output → functions/__server.func/_ssr/server-DDP6iEQJ.mjs ; static/: 0 matches (not in client bundle)
  gh api repos/EgerDev/velo/secret-scanning/alerts → []   (GitHub never flagged it)
  ```
- **Real-world consequence:**
  - Anyone can authenticate to `auth.grok.me` as the `grok_preview` confidential client. Anyone with a free Grok Build sandbox controls a `*.grok-sandbox.com` host that is a valid redirect target.
  - An attacker can therefore run a real authorization-code flow that the broker attributes to the shared preview client. With a phishing preview app, they can exchange victims' codes for broker-issued identity and tokens for their Google/X sign-in.
  - All preview apps share one client, and so one token audience. A Velo instance on the fallback trusts identities minted for every other preview app. Whether any cross-app token replay works is NOT VERIFIED.
  - Other grants (for example `client_credentials`) are NOT VERIFIED. I deliberately did not exercise the credential.
  - For Velo, a self-hosted build without `GROK_AUTH_*` either breaks sign-in (the broker rejects a non-sandbox `redirect_uri`) or depends on a third party's secret that xAI can rotate at any time. That is NOT VERIFIED; it was not run against the broker.
- **Recommended fix:**
  1. **Rotation: needed, and only xAI can do it.** Report it to xAI security as "the platform-wide preview client secret is exported into every public App Builder repo". This is a design issue on xAI's side, and rotating once will not help while the template keeps exporting it. This project cannot rotate it.
  2. **Project action: remove it.** Delete `PREVIEW_CLIENT_SECRET` and `PREVIEW_CLIENT_ID` from `preview.ts`. Make `server.ts` fail closed: `authConfigured = false`, plus a loud startup error, when `GROK_AUTH_CLIENT_ID/SECRET` are unset, or require the project's own OAuth provider. Rebuild `.vercel/output`.
  3. **History rewrite: not needed for security.** The value is already public in this repo for a month and in about 30 unrelated public repos, and a rewrite revokes nothing. It is optional hygiene, to stop scanners and forks from re-flagging the repo. If the owner wants it, do it **after** step 2, and only with every collaborator's agreement. It rewrites all 41 SHAs. Commands (NOT run):
     ```bash
     pip install git-filter-repo
     git clone --mirror https://github.com/EgerDev/velo velo-mirror && cd velo-mirror
     # create expressions.txt locally, never commit it; one line:  <full secret>==>REMOVED_PREVIEW_CLIENT_SECRET
     git filter-repo --replace-text ../expressions.txt
     git log --all -S"REMOVED_PREVIEW_CLIENT_SECRET" --oneline | wc -l      # expect 41
     git push --force --mirror origin
     # then: ask GitHub Support to purge cached views/refs of old SHAs; every existing clone must re-clone.
     ```
- **Verification procedure:**
  - `git grep -n -E 'PREVIEW_CLIENT_SECRET|8bcdb7' HEAD` returns nothing.
  - `gitleaks dir .` shows no preview.ts finding.
  - Starting the server with `GROK_AUTH_*` unset logs "auth not configured" and `authConfigured === false`.
  - `grep -rlF` over a fresh `.vercel/output` returns 0 files.
  - If rewritten: `git log --all -S"<secret>"` is empty on a fresh clone.
- **Status:** CONFIRMED (presence, history, fallback, reuse in other repos). The attacker capabilities at the broker are NOT VERIFIED.

### REPO-03 — Published session extension (zip) broadcasts full YouTube session cookies to any `*.grok.me` / `*.grok.com` / `*.grok-sandbox.com` tab titled "Velo"
- **Severity:** P1
- **Category:** Distributed binary / credential exfiltration (cross-reference for the extension auditor)
- **Blocks:** Both
- **Affected files:** `public/extensions/velo-session.zip`, `public/extensions/velo-session/*`, `extensions/velo-session/manifest.json:7-43`, `extensions/velo-session/popup.js:13-53`, `extensions/velo-session/content.js`
- **Description:**
  - **Zip contents:** 10 files (`manifest.json` v1.1.1, background/popup/content JS, popup.html, README.txt, 3 icons). They are content-identical to `extensions/velo-session/` and to the unpacked `public/extensions/velo-session/`. The zip has LF line endings and the working tree has CRLF. There are no hidden or extra files.
  - **The problem is what that code does.** The popup reads every youtube.com cookie, including SID, HSID, SSID, APISID, SAPISID, LOGIN_INFO and `__Secure-*`. It then sends the full Netscape jar to **every** tab whose hostname is localhost, `grok.com`/`*.grok.com`, `grok.me`/`*.grok.me` or `*.grok-sandbox.com` and whose `document.title` starts with "Velo".
  - The content script is injected on all those hosts and forwards the jar with `window.postMessage` to the page.
  - Any Grok App Builder user can publish an app on `*.grok.me` or run a `*.grok-sandbox.com` preview and set its title to "Velo". The real Velo production domain is not in the list at all.
- **Evidence:**
  ```
  $ unzip -q public/extensions/velo-session.zip -d scratch && diff -r --strip-trailing-cr -q scratch/velo-session extensions/velo-session ; echo rc=$?   → rc=0
  popup.js:13-22  isVeloHost: localhost | 127.0.0.1 | grok.com | *.grok.com | grok.me | *.grok.me | *.grok-sandbox.com
  popup.js:24-30  isVeloTab: … title === "Velo" || title.startsWith("Velo ")
  popup.js:36-45  for (const tab of targets) await chrome.tabs.sendMessage(tab.id, { type: "velo-inject-session", netscape })
  content.js:     window.postMessage({ source:"velo-extension", type:"velo-youtube-cookies", netscape, … }, window.location.origin)
  manifest.json:  content_scripts.matches includes "https://*.grok.me/*", "https://*.grok-sandbox.com/*", "https://*.grok.com/*"
  ```
- **Real-world consequence:** A user clicks "Send" while any attacker-controlled Grok-hosted tab titled "Velo" is open, even alongside the real one, since it broadcasts to all matches. The attacker then receives the user's YouTube/Google session cookies, which is enough to hijack the YouTube session. The installable zip ships from the public site, so every installed copy carries this.
- **Recommended fix:** Restrict hosts and matches to the exact production origin(s) plus localhost. Drop the wildcard grok hosts. Deliver to exactly one explicitly chosen tab: the active tab, confirmed by origin, not by title. Rebuild the zip from source in CI and publish a checksum.
- **Verification procedure:** Open a local page on a matching host titled "Velo" that is not the app. Confirm "Send" refuses it. Then `grep -n 'grok' extensions/velo-session/*` returns nothing, and the zip diff still shows rc=0.
- **Status:** CONFIRMED (code path). End-to-end exfiltration was not exercised.

### REPO-04 — Auto-update workflow runs freshly-bumped dependency code with a persisted `contents: write` token; actions pinned to mutable tags
- **Severity:** P2
- **Category:** CI / supply chain
- **Blocks:** OSS release
- **Affected files:** `.github/workflows/auto-update.yml:21-60`, `scripts/auto-update.mjs:138,163,316-344`
- **Description:**
  - `permissions: contents: write, pull-requests: write`.
  - `actions/checkout@v4` uses its default `persist-credentials: true`, which writes GITHUB_TOKEN into `.git/config`.
  - The job then runs `npm ci` and `npm run update:deps`. That script runs `npm install` of newer versions without `--ignore-scripts`, then runs typecheck, test and lint, which execute the new code. It also runs `pip install yt-dlp` at the latest version.
  - All actions, including third-party `peter-evans/create-pull-request@v6`, are pinned to mutable tags, not SHAs.
  - A compromised upstream release of youtubei.js, bgutils-js, yt-dlp or any transitive dependency would run with a token that can push to the repo.
  - All 4 runs so far failed at `npm ci`. Their logs are public. I read them and they contain no secrets.
- **Evidence:** Workflow file quoted in the scope read. `gh run view <id> --log-failed` shows `npm error … Run "npm help ci"` / `exit code 1`. `grep -n ignore-scripts scripts/auto-update.mjs` returns no match.
- **Real-world consequence:** A single malicious upstream release turns into a write-capable foothold in a public repo, for example a tampered `public/extensions/velo-session.zip`.
- **Recommended fix:** Set `persist-credentials: false` on checkout. Run install and test with `--ignore-scripts` in a job with `contents: read`. Hand the diff as an artifact to a second minimal job that only opens the PR. Pin actions to full commit SHAs. Fix the `npm ci` failure.
- **Verification procedure:** Check the workflow YAML review diff. Confirm no step with `contents: write` runs `npm`/`pip`. Confirm `grep -E 'uses: .*@[0-9a-f]{40}'` matches every `uses:`.
- **Status:** CONFIRMED

### REPO-05 — Third-party (xAI/Grok) template code, branding assets and the AGENTS.md sandbox contract ship with no license; README claims MIT with no LICENSE file
- **Severity:** P2
- **Category:** Licensing / copyrighted material / third-party infra disclosure. **REQUIRES LEGAL REVIEW.**
- **Blocks:** OSS release
- **Affected files:** `README.md:233-235`, (no `LICENSE`), `public/__grok/**` (`logo-grok.svg`, `ob-phone.png`, `ob-ipad.png`, `icon-180.png`, `styles.css`), `scripts/grok-pwa-*.mjs`, `scripts/install-page.html`, `server/middleware/grok-pwa.ts`, `AGENTS.md`, `src/lib/app-data/client.server.ts:18,43-44`, `src/lib/auth/gate-identity.server.ts:139-144`
- **Description:**
  - TECHNICAL FINDING: the README says "MIT License". There is no LICENSE file, and the GitHub API reports `license: null`.
  - The repo contains material authored by xAI's App Builder template, and none of it carries a license grant:
    - Grok logo and install-tutorial art: Figma exports showing a phone/iPad home screen.
    - The PWA/branding injector.
    - AGENTS.md, an 18 KB instruction contract for "Grok Build".
  - It also discloses xAI infrastructure details: the staging domains `gate.app-builder-testing.com` and `connectors.app-builder-testing.com`, the broker repo path, and the broker env var names. These are already public in many template repos, so the marginal exposure is small.
  - AGENTS.md is written as imperative instructions to AI agents ("You are Grok Build…"). Contributors' coding agents may obey it, which amounts to a prompt-injection surface for anyone who clones the repo.
- **Evidence:** `ls LICENSE*` gives "No such file". PNG chunk scan: `ob-phone.png 1014x882 tEXt Software=Figma`. `git grep app-builder-testing HEAD` hits the lines cited above.
- **Real-world consequence:** An unlicensed public repo is "all rights reserved" by default. An MIT claim over xAI-owned files may be invalid and may infringe copyright or trademark. The Grok logo is a trademark. Contributors get no clear rights.
- **Recommended fix:** Legal review of the template's terms. Add a real LICENSE covering only the project's own code. Remove `public/__grok/`, the Grok branding injector, AGENTS.md and the `grok_preview`/gate plumbing if the project is leaving the Grok platform, or add a third-party notice if licensed.
- **Verification procedure:** A `LICENSE` exists. `gh api repos/EgerDev/velo --jq .license.spdx_id` is non-null. `git ls-files public/__grok AGENTS.md` is empty, or a NOTICE file covers it.
- **Status:** CONFIRMED (technical facts). The legal conclusion is NOT VERIFIED.

### REPO-06 — No secret-scanning gate: GitHub non-provider patterns and validity checks off, no gitleaks config or CI, no branch protection, Dependabot security updates off
- **Severity:** P2
- **Category:** Repository hygiene / detection
- **Blocks:** OSS release
- **Affected files:** repository settings; `.github/workflows/` (only `auto-update.yml`)
- **Description:** GitHub secret scanning and push protection are enabled. However, `secret_scanning_non_provider_patterns` and `secret_scanning_validity_checks` are disabled, and the alert list is empty: the committed OAuth secret (REPO-02) and PEM key (REPO-08) were never flagged. There is no gitleaks or trufflehog config or CI step. `main` is unprotected (404 on protection). Dependabot security updates are disabled.
- **Evidence:** `gh api repos/EgerDev/velo --jq .security_and_analysis` returns `secret_scanning: enabled, push_protection: enabled, non_provider_patterns: disabled, validity_checks: disabled, dependabot_security_updates: disabled`. `gh api …/secret-scanning/alerts` returns `[]`. `gh api …/branches/main/protection` returns `Branch not protected (404)`.
- **Real-world consequence:** The next real secret (for example a pasted `VELO_VAULT_KEY`, DATABASE_URL or cookie jar) can land on a public `main` with nothing to stop it.
- **Recommended fix:** Enable non-provider patterns and validity checks. Add a `gitleaks` CI job with a `.gitleaks.toml` allowlist (REPO-08). Protect `main` (PR required, status checks). Enable Dependabot security updates.
- **Verification procedure:** Re-query `security_and_analysis`. Push a branch with a dummy high-entropy `SECRET="…"` and confirm CI fails.
- **Status:** CONFIRMED

### REPO-07 — Author PII and machine hostnames in 40 commits; private Claude session URL in a commit message
- **Severity:** P3
- **Category:** PII / metadata
- **Blocks:** Neither
- **Affected files:** git metadata of commits `5a40709`…`e4c1c1e`; commit message of `1efd948`
- **Description:**
  - 40 of 41 commits carry author and committer `andres eger <andreseger@MacBookPro.lan>`, `…@MacBookPro-69.lan` and `…@MacBookPro-79.lan`. That is a full personal name plus local LAN hostnames. Only `81cbd95` uses the GitHub noreply identity.
  - Commit `1efd948` contains `Claude-Session: https://claude.ai/code/session_014h2P…REDACTED`. Whether that URL is accessible without the owner's login is NOT VERIFIED; it is presumed private.
  - 18 commits carry `Co-Authored-By: Claude …` trailers. These are informational: they disclose AI-generated code.
  - No personal email (for example the owner's real mailbox) appears anywhere in history or code.
- **Evidence:** `git shortlog -sne --all` gives 38 / 1 / 1 / 1 as above. `git log --all --format=%B | grep Claude-Session` finds 1 hit.
- **Real-world consequence:** Low. It ties a real name and a device naming pattern to a tool that markets YouTube anti-bot-detection bypass, which may matter for the owner's legal exposure (REQUIRES LEGAL REVIEW). The data is already public (REPO-01).
- **Recommended fix:** Owner decision. Set `git config user.email 285544328+EgerDev@users.noreply.github.com` going forward (already done for the latest commit). To rewrite (NOT run; same caveats as REPO-02; combine into one rewrite):
  ```bash
  cat > mailmap.txt <<'EOF'
  EgerDev <285544328+EgerDev@users.noreply.github.com> <andreseger@MacBookPro.lan>
  EgerDev <285544328+EgerDev@users.noreply.github.com> <andreseger@MacBookPro-69.lan>
  EgerDev <285544328+EgerDev@users.noreply.github.com> <andreseger@MacBookPro-79.lan>
  EOF
  git filter-repo --mailmap mailmap.txt --replace-message <(printf 'regex:Claude-Session: https://claude\\.ai/\\S+==>\n')
  git push --force --mirror origin
  ```
- **Verification procedure:** `git log --all --format='%ae %ce' | sort -u` shows only the noreply address. `git log --all --grep=Claude-Session` is empty.
- **Status:** CONFIRMED

### REPO-08 — Committed test private key plus scanner false positives (public BotGuard key, InnerTube keys) with no allowlist
- **Severity:** P3
- **Category:** Secret-scanner noise / test material
- **Blocks:** Neither
- **Affected files:** `src/lib/ipv4-bind.test.ts:58-70` (added in `81cbd95`, in 1 commit), `src/lib/po-token.server.ts:26` (`REQUEST_KEY = "O43z0d…REDACTED"`), bundled `youtubei.js` / `bgutils-js` `AIza…` keys (only in `.vercel/output`, not in the repo)
- **Description:**
  - The test embeds a PKCS#8 `BEGIN PRIVATE KEY` block. Its comment reads "Throwaway self-signed pair for 127.0.0.1 (valid to 2126); test-only". It grants nothing, but gitleaks flags it, and it teaches contributors that committing PEMs is fine.
  - `REQUEST_KEY` is YouTube's public BotGuard request key, and the `AIza…` hits are YouTube's public InnerTube web-client keys shipped inside npm packages. Neither is a project secret.
- **Evidence:** gitleaks history returned 3 findings: `private-key ipv4-bind.test.ts:59 (81cbd95)`, `generic-api-key po-token.server.ts:26`, `generic-api-key preview.ts:20`. gitleaks dir added `gcp-api-key` findings only in `.vercel/output/functions/__server.func/_libs/{youtubei.js,bgutils-js}.mjs`.
- **Real-world consequence:** None directly. It adds alert fatigue that could hide a real leak.
- **Recommended fix:** Generate the key pair at test runtime (`crypto.generateKeyPairSync` plus a self-signed cert, or `selfsigned`), or move it into a fixture listed in `.gitleaks.toml` `[allowlist]`. Allowlist `REQUEST_KEY` by path and regex. No rotation and no history rewrite are needed.
- **Verification procedure:** `gitleaks git --log-opts=--all` on HEAD returns 0 findings after the allowlist and REPO-02 fixes.
- **Status:** CONFIRMED

### REPO-09 — `.gitignore` gaps (`.env*` swallows `.env.example`; no cookies.txt/HAR/PEM/coverage/.output/audit patterns)
- **Severity:** P3
- **Category:** Repository hygiene
- **Blocks:** Neither
- **Affected files:** `.gitignore:1-25`
- **Description:**
  - The good part: `.vercel/`, `.tanstack/`, `screenshots/`, `.grok/`, `*.log` and `.env*` are ignored. None of these was ever committed (verified against all 370 historical paths).
  - `.env*` also ignores `.env.example` (`git check-ignore -v .env.example` → `.gitignore:24:.env*`), so the many required env vars (`VELO_VAULT_KEY`, `BETTER_AUTH_SECRET`, `VELO_ADMIN_EMAILS`, `GROK_AUTH_*`, `DATABASE_URL`, …) cannot be documented through a template file.
  - Nothing covers the credential artefacts this app handles: `cookies.txt`, `*.har`, `*.pem`/`*.key`.
  - Build dirs `.output/`, `.nitro/` and `coverage/` are not covered.
  - `audit/` (this report plus SBOMs) is not ignored. Committing vulnerability reports to a public repo before the fixes land would disclose them.
  - `.vercel` is listed twice.
  - The local `screenshots/` (49 PNGs, 18 MB, ignored) shows only a QA test account (`qa1790139938036`). It contains no real PII.
- **Evidence:** `.gitignore` contents; `git check-ignore -v cookies.txt session.har key.pem coverage/x .output/x audit/x` matched only `.env.example`.
- **Real-world consequence:** A developer debugging the vault who drops a real `cookies.txt` or HAR in the repo root can commit a live Google session to a public repo.
- **Recommended fix:** Add `!.env.example`, `cookies*.txt`, `*.har`, `*.pem`, `*.key`, `*.p12`, `.output/`, `.nitro/`, `coverage/`. Decide explicitly whether `audit/` is committed, and only after the fixes.
- **Verification procedure:** `git check-ignore -v cookies.txt x.har k.pem coverage/a .output/a` matches every path, and `.env.example` is not ignored.
- **Status:** CONFIRMED

### REPO-10 — Local `.vercel/output` prebuilt bundle embeds the fallback secret and absolute local paths
- **Severity:** P3
- **Category:** Build artefact
- **Blocks:** Website launch
- **Affected files:** `.vercel/output/functions/__server.func/_ssr/server-DDP6iEQJ.mjs`, `.vercel/output/functions/__server.func/_tanstack-start-manifest_v-D8sRvLam.mjs`
- **Description:**
  - `.vercel/output` (68 MB, ignored, never committed) contains no `DATABASE_URL`, `BETTER_AUTH_SECRET`, vault key or Vercel org/project id. There is no `.vercel/project.json`, and `config.json`, `.vc-config.json` and `nitro.json` hold no env values.
  - The server bundle does embed the REPO-02 preview secret and absolute Windows paths (`filePath: "C:/Users/PC/orca/velo/src/routes/__root.tsx"`).
  - A `vercel deploy --prebuilt` from this machine (the command is suggested in `nitro.json`) would ship both. They are server-side only; the static client bundle has 0 matches.
- **Evidence:** `grep -rlF "<secret>" .vercel/output` → 1 server file; `grep -rlF … static | wc -l` → 0; `grep -rhoE 'C:[\\/]+Users[\\/]+PC' functions` → the manifest `filePath` entries.
- **Real-world consequence:** Low. Paths leak only through server errors or stack traces, and the secret already matters under REPO-02.
- **Recommended fix:** After fixing REPO-02, delete and rebuild `.vercel/output` in CI (Linux), not from a developer machine.
- **Verification procedure:** Rebuild, then run `grep -rlE "8bcdb7|C:/Users" .vercel/output`; it should return nothing.
- **Status:** CONFIRMED

---

## Not verified / out of scope

- **What an attacker can actually do with the `grok_preview` secret at `auth.grok.me`:** supported grants, consent-screen branding, and token audience reuse. I deliberately did not use the credential. Whether this repo's value is still current at the broker is also unknown.
- **Whether the 8 unique cloners in the last 14 days were the owner, GitHub Actions or third parties.** GitHub does not expose identities.
- **Whether the `claude.ai/code/session_…` URL is readable without the owner's login.**
- **Legal status** of the xAI template assets, the Grok trademark use, and the product's YouTube ToS and anti-circumvention posture. REQUIRES LEGAL REVIEW, which belongs to other auditors.
- **Deep behavioural review of both extensions, the runtime vault crypto and the server endpoints.** I covered only what the repository exposes. REPO-03 is a cross-reference for the extension auditor.
- **npm dependency contents** (node_modules was not scanned by gitleaks) and the SBOM, both owned by other auditors (`audit/sbom*.cdx.json`).
- **trufflehog** was not run. gitleaks v8.30.1, manual regex sweeps and an entropy scan were used instead.
