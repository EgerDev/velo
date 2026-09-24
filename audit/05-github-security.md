# 05 — GitHub & CI/CD Security (prefix GH-)

Auditor: **oss** (open-source maintainer + release engineer). Date: 2026-09-23.

## Scope & method

- `.github/workflows/auto-update.yml` read line by line, plus `scripts/auto-update.mjs` (the code that workflow runs).
- GitHub repository state checked **read-only** with the authenticated `gh` CLI (account `EgerDev`, repo admin). Only `GET`s were issued; nothing was changed.
- Lockfile checked: `npm ci` run in a scratch clone of `origin/main` (`81cbd95`), with npm 10.9.9 (the CI runner's major version) and `--ignore-scripts`.
- The full gate set (`npm ci`, `typecheck`, `lint`, `test`, `build`) was run on a fresh `git clone https://github.com/EgerDev/velo.git` in the scratchpad, to show what a CI workflow would see.
- Current action SHAs were resolved with `gh api repos/<action>/commits/<tag>` so the YAML drafts below are pinned to real commits.

Key repo facts (from `gh api repos/EgerDev/velo`, `…/actions/permissions*`, `…/community/profile`):

| Fact | Value |
|---|---|
| Visibility | **PUBLIC** (created 2026-08-25, last push 2026-09-23T08:13Z) |
| `origin/main` vs local | in sync at `81cbd95`; the 27 modified + 3 untracked working-tree files are **not** on GitHub |
| Branch protection on `main` | **none** (`404 Branch not protected`); rulesets `[]` |
| Collaborators | 1 (`EgerDev`, admin) |
| Actions | enabled, `allowed_actions: all`, `sha_pinning_required: false` |
| Default `GITHUB_TOKEN` perms | `read` (good); `can_approve_pull_request_reviews: false` |
| Secret scanning / push protection | enabled / enabled; `non_provider_patterns: disabled`, `validity_checks: disabled` |
| Dependabot alerts / security updates | **disabled** / **disabled** |
| Code scanning | none (`404 no analysis found`) |
| Private vulnerability reporting | `{"enabled":false}` |
| Releases / tags / environments / Actions secrets | `[]` / `[]` / `0` / `0` |
| Deployments / commit statuses on HEAD | `0` / `0` (no Vercel Git integration visible, so deploys happen outside GitHub) |
| Community profile health | 28% (README only; no LICENSE/CoC/CONTRIBUTING/templates) |
| Workflow runs | 4 total, **4 failures** (all `auto-update`, schedule) |
| Commit signatures | 0 of 41 verified |

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| GH-01 | P0 | Public repo has exposed the hard-coded OAuth client secret since the first commit; GitHub never flagged it | Both |
| GH-02 | P1 | `main` has no protection or ruleset: force-push, deletion and direct pushes are all allowed | Both |
| GH-03 | P1 | auto-update runs newly resolved third-party code while a write-scoped, persisted `GITHUB_TOKEN` is available | Both |
| GH-04 | P1 | No CI on push or PR: nothing runs typecheck, lint, test or build for contributors or bots | OSS release |
| GH-05 | P1 | auto-update has never worked: 4/4 runs failed, and PR creation would be refused even if they hadn't | OSS release |
| GH-06 | P2 | Actions pinned to mutable tags, several majors out of date and on deprecated Node 20; repo allows any action | Both |
| GH-07 | P2 | yt-dlp installed unpinned and unhashed in CI; its update path can never produce a diff | Both |
| GH-08 | P2 | Supply-chain scanning is off: Dependabot, dependency review, CodeQL, private vulnerability reporting, non-provider secret patterns | Both |
| GH-09 | P2 | No CODEOWNERS, and no rule that changes to workflows need owner review | OSS release |
| GH-10 | P3 | Workflow hygiene: no `concurrency`, no `timeout-minutes`, no egress control, floating `ubuntu-latest` | Neither |
| GH-11 | P3 | All commits unsigned, no signed tags, and author emails leak local machine hostnames | OSS release |
| GH-12 | P3 | No Scorecard, attestations, SBOM or release checksums (see 16-release-engineering) | OSS release |

---

### GH-01 — Public repo has exposed the hard-coded OAuth client secret since the first commit; GitHub never flagged it
- **Severity:** P0
- **Category:** Secret exposure / repository hygiene
- **Blocks:** Both
- **Affected files:** `src/lib/auth/preview.ts:20` (`export const PREVIEW_CLIENT_SECRET = "…"`), `src/lib/auth/server.ts:81-82` (the fallback)
- **Description:** A root cause is already filed by the security auditor; this finding is about the GitHub side. The repo is **already public**, so the secret is not something a future open-source release *would* leak. It has been leaked since `5a40709` (2026-08-24, the initial commit) and sits in every clone and fork since then. Push protection did not stop it, and secret scanning has raised no alert, because this is a custom (non-provider) token: `secret_scanning_non_provider_patterns` is disabled, and xAI's broker secret format is not a partner pattern anyway.
- **Evidence:**
  ```
  $ gh api repos/EgerDev/velo --jq .visibility            -> "public"
  $ gh api repos/EgerDev/velo/contents/src/lib/auth/preview.ts --jq .html_url
    https://github.com/EgerDev/velo/blob/main/src/lib/auth/preview.ts
  $ git log --all --oneline -- src/lib/auth/preview.ts    -> 5a40709 feat: initial commit …
  $ git show HEAD:src/lib/auth/preview.ts | grep -n SECRET
    20:export const PREVIEW_CLIENT_SECRET =
    21:  "8bcd…REDACTED";
  $ gh api repos/EgerDev/velo/secret-scanning/alerts      -> []
  security_and_analysis.secret_scanning_non_provider_patterns.status = "disabled"
  ```
- **Real-world consequence:** Anyone can impersonate the shared `grok_preview` OAuth client against `auth.grok.me`. That client is shared across Grok-built apps, so the blast radius reaches beyond Velo. Rewriting history does **not** fix this: forks, clones, caches and GitHub's own cached views keep the old commits.
- **Recommended fix:** (1) Report it to the secret's owner (xAI / the broker operator) and have them **rotate** it. That is the only real fix, and it is not in this repo's control. (2) Delete the constant, and make `server.ts` fail closed when `GROK_AUTH_CLIENT_ID/SECRET` are unset. (3) Enable `secret_scanning_non_provider_patterns` and validity checks, and add a custom secret-scanning pattern for this client-secret shape. (4) Only after rotation, optionally purge history with `git filter-repo` and ask GitHub Support to drop cached views. That is cosmetic once the secret is rotated.
- **Verification procedure:** `git grep -n PREVIEW_CLIENT_SECRET` returns nothing. The old secret is rejected by the broker's token endpoint (the owner confirms). `gh api repos/EgerDev/velo --jq .security_and_analysis` shows `non_provider_patterns: enabled`.
- **Status:** CONFIRMED (exposure). Whether the secret is still valid is NOT VERIFIED; I did not test it against the broker.

### GH-02 — `main` has no protection or ruleset: force-push, deletion and direct pushes are all allowed
- **Severity:** P1
- **Category:** Repository governance
- **Blocks:** Both
- **Affected files:** GitHub settings (no file)
- **Description:** `main` has no branch protection and the repo has no rulesets. Any credential with push access can force-push, delete `main`, or land unreviewed code. That includes the auto-update job's `GITHUB_TOKEN` (see GH-03). No status checks are required (and none exist, see GH-04). There are no tag rules, so a future `v*` tag could be moved after a release. The site deploys from outside GitHub, so whatever reaches `main` is what someone will eventually build.
- **Evidence:**
  ```
  $ gh api repos/EgerDev/velo/branches/main/protection -> {"message":"Branch not protected","status":"404"}
  $ gh api repos/EgerDev/velo/rulesets                 -> []
  ```
- **Real-world consequence:** A malicious dependency in the auto-update job, a stolen laptop token (the local `gh` token has `repo, workflow` scopes), or a plain mistake can rewrite `main` history or push code straight to production with no review trail.
- **Recommended fix:** Create a **repository ruleset** (it still applies to admins unless you add a bypass on purpose) for `~DEFAULT_BRANCH`:
  - Block deletion and force pushes, and require linear history.
  - Require a pull request with 1 approval, CODEOWNERS review, stale approvals dismissed on push, and all conversations resolved.
  - Require the status checks `ci / verify`, `codeql / analyze (javascript-typescript)` and `dependency-review`, with strict mode (branch must be up to date).
  - Optionally require signed commits.

  Add a second ruleset for `refs/tags/v*` that blocks deletion and updates (immutable release tags). Solo maintainer: allow a bypass of the approval rule for yourself as a *pull-request-only* bypass, never a direct push. Draft payload for `gh api -X POST repos/EgerDev/velo/rulesets --input ruleset.json`:
  ```json
  {
    "name": "protect-main",
    "target": "branch",
    "enforcement": "active",
    "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
    "rules": [
      { "type": "deletion" },
      { "type": "non_fast_forward" },
      { "type": "required_linear_history" },
      { "type": "pull_request", "parameters": {
          "required_approving_review_count": 1,
          "dismiss_stale_reviews_on_push": true,
          "require_code_owner_review": true,
          "require_last_push_approval": false,
          "required_review_thread_resolution": true } },
      { "type": "required_status_checks", "parameters": {
          "strict_required_status_checks_policy": true,
          "required_status_checks": [
            { "context": "verify" },
            { "context": "analyze (javascript-typescript)" },
            { "context": "dependency-review" } ] } }
    ],
    "bypass_actors": []
  }
  ```
- **Verification procedure:** `gh api repos/EgerDev/velo/rulesets` lists `protect-main`. `git push --force origin HEAD~1:main` from a test clone is rejected with `GH013`.
- **Status:** CONFIRMED

### GH-03 — auto-update runs newly resolved third-party code while a write-scoped, persisted `GITHUB_TOKEN` is available
- **Severity:** P1
- **Category:** CI supply-chain / token scope
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml:19-21,27,40,42,44,46`; `scripts/auto-update.mjs:163,176-189,391,423,316-331`
- **Description:** Walking the workflow line by line:
  - **L19-21:** `permissions: contents: write, pull-requests: write` is set at **workflow** level, so every step gets it, not only the PR step.
  - **L27:** `actions/checkout@v4` with the default `persist-credentials: true` writes the token into `.git/config` as `http.https://github.com/.extraheader`. The failed run's own log confirms this: the post-step unsets `http.https://github.com/.extraheader`. Any later process can read it with `git config --get http.https://github.com/.extraheader`.
  - **L40:** `pip install --user "yt-dlp[default,curl-cffi]"` installs the latest release with no version or hash pin (see GH-07).
  - **L42:** `npm ci` runs lifecycle scripts. Today only `fsevents` declares one (and it is macOS-only), so this step is fine *today*.
  - **L44:** `npm run update:deps` is the dangerous part. It runs `npm update <names>` (`auto-update.mjs:391`) or `npm install` (`:423`) **without `--ignore-scripts`**, so it resolves and installs **versions nobody has reviewed**, runs their install scripts, and then runs `typecheck`, `test` and `lint` (`:176-189`). Those execute the new code: ESLint plugins, `tsc`, and node tests that import `youtubei.js`, `bgutils-js`, `jsdom` and others. It also pip-installs the newest yt-dlp (`:316-331`, `--break-system-packages` retry).
  - **L46:** `peter-evans/create-pull-request@v6` uses the default `GITHUB_TOKEN`.

  In short, the job runs the freshest code from about 700 transitive packages plus PyPI while holding a token that can push to an unprotected `main` (GH-02). A compromised release published between two Monday runs is enough. This is the standard shape of an npm worm (e.g. the "Shai-Hulud"-style campaigns that harvest CI tokens).
- **Evidence:**
  ```
  auto-update.yml:19  permissions:
  auto-update.yml:20    contents: write
  auto-update.yml:21    pull-requests: write
  auto-update.yml:27    - uses: actions/checkout@v4        # persist-credentials defaults to true
  auto-update.mjs:391   async () => (await npm(["update", ...names], { quiet: true })).ok,
  auto-update.mjs:423   return (await npm(["install"], { quiet: true })).ok;
  run 35593242129 log: "[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader"
  lock scan: only node_modules/vite/node_modules/fsevents has hasInstallScript (today)
  ```
- **Real-world consequence:** One malicious patch release of any transitive dependency can push a backdoor to `main` (source, lockfile, migrations), create tags and branches, and open PRs. It can also tamper with the committed `public/extensions/velo-session.zip`. `GITHUB_TOKEN` cannot modify `.github/workflows/*`, because that needs the `workflows` scope, but everything else in the repo is writable. That zip is what users install to hand over their Google session cookies.
- **Recommended fix:** Split the workflow into an **untrusted** job and a **trusted** job (draft below):
  - Top-level `permissions: {}`.
  - The `update` job gets `contents: read`, `persist-credentials: false`, and outputs only a patch artifact limited to `package.json` + `package-lock.json`.
  - The `open-pr` job gets `contents: write` + `pull-requests: write`, runs **no** npm or pip code, rejects any patch that touches other paths, and opens the PR with a GitHub App token so that `ci.yml` actually runs on it.
  - Add an npm release cooldown (`NPM_CONFIG_BEFORE`, 3 days) so freshly published (and possibly malicious) versions are not picked up instantly.
  - Better still, and simpler: **replace this custom workflow with Dependabot** (grouped, with a `cooldown`) plus the `ci.yml` below. That gets the same verify-then-merge behaviour with no custom privileged job.
- **Verification procedure:** In the new workflow run, the `update` job's token permissions (shown in the "Set up job" log section) list only `Contents: read`, and `git config --get http.https://github.com/.extraheader` exits 1. A test PR that adds a file outside the manifests to the patch makes `open-pr` fail.
- **Status:** CONFIRMED (configuration). Exploitation itself NOT VERIFIED (no malicious package tested).

### GH-04 — No CI on push or PR: nothing runs typecheck, lint, test or build for contributors or bots
- **Severity:** P1
- **Category:** CI / quality gate
- **Blocks:** OSS release
- **Affected files:** `.github/workflows/` (only `auto-update.yml`)
- **Description:** No workflow triggers on `push` or `pull_request`. README §"Verification & Testing" (`README.md:178-198`) tells contributors to run the gates by hand, and nothing enforces them. The auto-update PRs would also land untested. PRs opened with the default `GITHUB_TOKEN` do **not** trigger other workflows, so even adding `ci.yml` would not cover them unless the PR is opened with an App token or PAT. The gates do pass today on a fresh clone, so turning them on costs nothing.
- **Evidence:**
  ```
  $ ls .github/workflows              -> auto-update.yml
  $ gh api repos/EgerDev/velo/commits/HEAD/check-runs --jq .total_count -> 0
  Fresh clone of origin/main (81cbd95), scratchpad:
    npm ci=0  typecheck=0  lint=0 (0 errors, 189 warnings)  test=0 (179 + 514 tests, 0 fail, 4 skipped)
  ```
- **Real-world consequence:** An external PR that breaks the build, or one that sneaks in a change to `src/lib/auth/*` or a workflow, shows a green-looking PR page with no checks at all. Once the project is announced this is the first thing contributors and reviewers notice.
- **Recommended fix:** Add `ci.yml` (draft below) and make its job a required status check (GH-02). Run `npm run check:auth` in it as well, since that invariant script exists and is not wired anywhere.
- **Verification procedure:** Open a PR. `verify` appears as a required check and blocks the merge when it fails (test by pushing a deliberate `tsc` error on a throwaway branch).
- **Status:** CONFIRMED

### GH-05 — auto-update has never worked: 4/4 runs failed, and PR creation would be refused even if they hadn't
- **Severity:** P1
- **Category:** CI reliability / misleading documentation
- **Blocks:** OSS release
- **Affected files:** `.github/workflows/auto-update.yml:42,46`; `README.md:202-218`; repo setting "Allow GitHub Actions to create and approve pull requests"
- **Description:** Three separate problems stack up here:
  - **The runs fail.** Every scheduled run so far (2026-08-31, 09-07, 09-14, 09-21) failed at `npm ci` with the lockfile out of sync: `Missing: lru-cache@11.5.3 from lock file`, at `e4c1c1e`. HEAD `81cbd95` has since changed the lock, and `npm@10.9.9 ci --ignore-scripts` now succeeds in a scratch clone, so the next run *may* get further. That is NOT VERIFIED.
  - **The PR would be refused.** The repo has `can_approve_pull_request_reviews: false`, which is the "Allow GitHub Actions to create and approve pull requests" toggle. With it off, `create-pull-request` using `GITHUB_TOKEN` pushes the branch and then fails with "GitHub Actions is not permitted to create or approve pull requests".
  - **The README and workflow header describe work that never happened.** They say this "keeps them moving without anyone having to remember" and that it "only ever opens a PR against a green tree". In practice the job has failed silently for a month; scheduled-run failures only email the last committer.
- **Evidence:**
  ```
  $ gh run list -R EgerDev/velo
  completed failure auto-update … schedule 35593242129 21s 2026-09-21
  completed failure auto-update … schedule 34836560400 14s 2026-09-14
  completed failure auto-update … schedule 34113867486 14s 2026-09-07
  completed failure auto-update … schedule 33389597839 13s 2026-08-31
  $ gh run view 35593242129 --log-failed
  npm error `npm ci` can only install packages when your package.json and package-lock.json … are in sync.
  npm error Missing: lru-cache@11.5.3 from lock file
  $ gh api repos/EgerDev/velo/actions/permissions/workflow
  {"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
  ```
- **Real-world consequence:** People believe extraction dependencies are refreshed weekly when they are not. That is exactly the staleness failure the workflow was written to prevent. A lockfile drift like this would also have been caught at PR time by `npm ci` in CI (GH-04).
- **Recommended fix:** Adopt the hardened workflow (below) with an App token (`actions/create-github-app-token`), which does not need the repo-wide "Actions may create PRs" toggle, or switch to Dependabot. Add `npm ci` to `ci.yml` so a drifted lockfile can never be merged. Add a failure notification (open an issue when the scheduled run fails) or accept Dependabot's native UI.
- **Verification procedure:** `gh workflow run auto-update.yml`, then `gh run watch`: the run is green and a PR `auto-update/dependencies` exists with a `verify` check attached.
- **Status:** CONFIRMED

### GH-06 — Actions pinned to mutable tags, several majors out of date and on deprecated Node 20; repo allows any action
- **Severity:** P2
- **Category:** CI supply-chain
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml:27,29,34,46`; repo Actions settings
- **Description:** `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5` and `peter-evans/create-pull-request@v6` are tag references. Tags can be re-pointed (the tj-actions/changed-files compromise of March 2025 did exactly that). Current majors are checkout v7.0.1, setup-node v7.0.0, setup-python v7.0.0 and create-pull-request v8.1.1. The run annotations report the v4/v5 actions are forced from Node 20 to Node 24. The repo also allows **all** actions with `sha_pinning_required: false`.
- **Evidence:** Run 35593242129 annotation: `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4, actions/setup-python@v5`. `gh api repos/EgerDev/velo/actions/permissions` → `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`.
- **Real-world consequence:** A compromised or retagged action runs with the write token (GH-03).
- **Recommended fix:**
  - Pin every action to a full commit SHA with a `# vX.Y.Z` comment; the drafts below use SHAs resolved on 2026-09-23.
  - Let Dependabot (`github-actions` ecosystem) bump them.
  - Settings → Actions → "Allow EgerDev, and select non-EgerDev, actions": GitHub-created plus an explicit allowlist (`peter-evans/create-pull-request@*`, `ossf/scorecard-action@*`, `anchore/sbom-action@*`, `step-security/harden-runner@*`).
  - Enable "Require actions to be pinned to a full-length commit SHA".
- **Verification procedure:** `grep -nE 'uses: [^@]+@(v[0-9]|main|master)' .github/workflows/*.yml` returns nothing. `gh api repos/EgerDev/velo/actions/permissions` shows `sha_pinning_required: true`, `allowed_actions: selected`.
- **Status:** CONFIRMED

### GH-07 — yt-dlp installed unpinned and unhashed in CI; its update path can never produce a diff
- **Severity:** P2
- **Category:** CI supply-chain / reproducibility
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml:40`; `scripts/auto-update.mjs:289-352`; `README.md:135,152,211`
- **Description:** Line 40 installs whatever the newest yt-dlp (plus `curl_cffi` and `yt-dlp-ejs`) is at run time. The updater then compares "installed" with "latest on PyPI", finds them equal, and does nothing. yt-dlp is not pinned anywhere in the repo (no `requirements.txt` or lock), so even a real upgrade on the runner would produce **no commit**. The "yt-dlp half" of the weekly PR is therefore dead code in CI, and the version production runs is not tracked in git. Meanwhile unpinned PyPI code (including a native `curl_cffi` wheel) runs in the job that holds the write token.
- **Evidence:** `find . -maxdepth 2 -name "requirements*"` finds nothing. The workflow runs `python3 -m pip install --user "yt-dlp[default,curl-cffi]"` before `npm run update:deps`; `updateYtdlp()` returns `yt-dlp: X is current` when installed == latest (`auto-update.mjs:300-302`).
- **Real-world consequence:** Server builds are not reproducible: which yt-dlp is deployed depends on when someone last ran pip. A yt-dlp regression cannot be bisected or rolled back from git history.
- **Recommended fix:** Add `requirements.txt` (or `requirements.in` plus a `pip-compile --generate-hashes` lock) that pins `yt-dlp[default,curl-cffi]==<ver>` with `--require-hashes`. Install from it in CI and in the deploy image. Let Dependabot's `pip` ecosystem bump it (`dependabot.yml` below). Delete the pip branch from `auto-update.mjs` once Dependabot owns it.
- **Verification procedure:** `pip install --require-hashes -r requirements.txt` succeeds in CI. A Dependabot pip PR appears when yt-dlp releases.
- **Status:** CONFIRMED

### GH-08 — Supply-chain scanning is off: Dependabot, dependency review, CodeQL, private vulnerability reporting, non-provider secret patterns
- **Severity:** P2
- **Category:** Security tooling
- **Blocks:** Both
- **Affected files:** repo settings; missing `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `.github/workflows/dependency-review.yml`, `SECURITY.md`
- **Description:** Nothing tells the maintainer when one of the ~717 locked packages gets a CVE, nothing blocks a PR that adds a vulnerable or badly licensed dependency, and no SAST runs. That matters for a codebase that spawns `curl`, `python` and `npm` subprocesses and parses untrusted HAR, cookie and VTT input. Security researchers have no private channel for reports. Secret scanning and push protection **are** on, which is good, but the custom-pattern gap is what let GH-01 through.
- **Evidence:**
  ```
  dependabot/alerts           -> 403 "Dependabot alerts are disabled for this repository."
  automated-security-fixes    -> {"enabled":false,"paused":false}
  code-scanning/alerts        -> 404 "no analysis found"
  private-vulnerability-reporting -> {"enabled":false}
  security_and_analysis: secret_scanning=enabled, push_protection=enabled,
                         non_provider_patterns=disabled, validity_checks=disabled
  ```
- **Real-world consequence:** Known-vulnerable dependencies ship unnoticed. Vulnerability reports arrive as public issues, which for a cookie vault means public disclosure of a live-credential bug.
- **Recommended fix:** In Settings → Code security, enable Dependabot alerts and security updates, private vulnerability reporting, non-provider patterns and validity checks. Commit `dependabot.yml`, `codeql.yml` and `dependency-review.yml` (drafts below) and `SECURITY.md` (see OSS-05).
- **Verification procedure:** `gh api repos/EgerDev/velo/dependabot/alerts` returns 200. `gh api repos/EgerDev/velo/code-scanning/analyses` lists a CodeQL analysis. `gh api repos/EgerDev/velo/private-vulnerability-reporting` → `{"enabled":true}`.
- **Status:** CONFIRMED

### GH-09 — No CODEOWNERS, and no rule that changes to workflows need owner review
- **Severity:** P2
- **Category:** Governance
- **Blocks:** OSS release
- **Affected files:** missing `.github/CODEOWNERS`
- **Description:** Once outside contributors or co-maintainers exist, nothing forces owner review on the high-risk paths: `.github/`, `src/lib/auth/`, `src/lib/vault*`, `src/lib/operator-gate.server.ts`, `src/lib/tool-updates*`, `migrations/`, `extensions/`, `public/extensions/`, `package-lock.json`.
- **Evidence:** `gh api repos/EgerDev/velo/community/profile` shows no CODEOWNERS; `ls .github` → `workflows` only.
- **Real-world consequence:** A second maintainer can merge a workflow or auth change that only you should approve.
- **Recommended fix:** Commit:
  ```
  # .github/CODEOWNERS
  *                                   @EgerDev
  /.github/                           @EgerDev
  /src/lib/auth/                      @EgerDev
  /src/lib/vault*                     @EgerDev
  /src/lib/operator-gate.server.ts    @EgerDev
  /src/lib/tool-updates*              @EgerDev
  /migrations/                        @EgerDev
  /extension/                         @EgerDev
  /extensions/                        @EgerDev
  /public/extensions/                 @EgerDev
  /package.json                       @EgerDev
  /package-lock.json                  @EgerDev
  ```
  Then enable `require_code_owner_review` (GH-02).
- **Verification procedure:** A PR touching `.github/` shows "Review required from code owners".
- **Status:** CONFIRMED

### GH-10 — Workflow hygiene: no `concurrency`, no `timeout-minutes`, no egress control, floating `ubuntu-latest`
- **Severity:** P3
- **Category:** CI hygiene
- **Blocks:** Neither
- **Affected files:** `.github/workflows/auto-update.yml:23-25`
- **Description:**
  - There is no `timeout-minutes`, so a hung verify can hold a runner for the 360-minute default.
  - There is no `concurrency`, so a `workflow_dispatch` during a scheduled run means two jobs race on `auto-update/dependencies`.
  - The run warns that `ubuntu-latest` migrates to Ubuntu 26 on 2026-10-19; Python 3.12 is pinned but the OS is not.
  - There is no network egress monitoring (e.g. `step-security/harden-runner` in audit mode), which would have been the cheapest way to detect GH-03 being exploited.
  - Branch naming `auto-update/dependencies` with `delete-branch: true` is fine.
- **Evidence:** File content; run 35593242129 annotation "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026".
- **Real-world consequence:** A wasted or duplicated run, and silent breakage when the image changes.
- **Recommended fix:** `timeout-minutes: 30`, `concurrency: { group: auto-update, cancel-in-progress: false }`, `runs-on: ubuntu-24.04`, and harden-runner `egress-policy: audit` as the first step (all in the drafts).
- **Verification procedure:** Read the workflow; trigger two dispatches and confirm the second waits.
- **Status:** CONFIRMED

### GH-11 — All commits unsigned, no signed tags, and author emails leak local machine hostnames
- **Severity:** P3
- **Category:** Provenance / privacy
- **Blocks:** OSS release
- **Affected files:** git history
- **Description:** None of the 41 commits on `main` is verified. 40 are authored as `andres eger <andreseger@MacBookPro*.lan>`: an unroutable local hostname rather than a noreply address. It leaks machine naming and is not linked to the GitHub account, so contribution attribution and signature verification both fail.
- **Evidence:** `gh api repos/EgerDev/velo/commits?per_page=41` shows 41 × `verification.verified=false`. `git log --format='%an <%ae>' | sort | uniq -c` gives 38 + 1 + 1 `…@MacBookPro[-NN].lan` and 1 `…@users.noreply.github.com`.
- **Real-world consequence:** Downstream users cannot verify that release tags came from the maintainer. That becomes important once extension zips are published (REL-).
- **Recommended fix:** `git config --global user.email 285544328+EgerDev@users.noreply.github.com`. Enable SSH commit signing (`git config --global gpg.format ssh; user.signingkey ~/.ssh/id_ed25519.pub; commit.gpgsign true; tag.gpgsign true`) and upload the key as a *signing* key. Optionally require signed commits in the ruleset. History does not need rewriting.
- **Verification procedure:** A new commit shows "Verified" on GitHub; `git tag -v v0.1.0` passes.
- **Status:** CONFIRMED

### GH-12 — No Scorecard, attestations, SBOM or release checksums (see 16-release-engineering)
- **Severity:** P3
- **Category:** Supply-chain transparency
- **Blocks:** OSS release
- **Affected files:** n/a
- **Description:** No OpenSSF Scorecard workflow, no `actions/attest-build-provenance`, no SBOM, no releases. The design and drafts are in `audit/16-release-engineering.md` (REL-03/REL-04); a Scorecard draft is below.
- **Evidence:** `gh api repos/EgerDev/velo/releases` → `[]`; no workflow other than auto-update.
- **Real-world consequence:** Users of the extension and self-hosters cannot verify what they run.
- **Recommended fix:** `scorecard.yml` (below) plus the release workflow in REL.
- **Verification procedure:** The Scorecard badge renders; `gh attestation verify velo-session-*.zip -R EgerDev/velo` passes.
- **Status:** CONFIRMED

---

## Ready-to-commit drafts (NOT created in `.github/`; copy them when accepted)

SHAs resolved 2026-09-23 via `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Dependabot keeps them current after that.

| Action | Tag | Commit SHA |
|---|---|---|
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7.0.0 | 820762786026740c76f36085b0efc47a31fe5020 |
| actions/setup-python | v7.0.0 | 5fda3b95a4ea91299a34e894583c3862153e4b97 |
| actions/upload-artifact | v7.0.1 | 043fb46d1a93c77aae656e7c1c64a875d1fc6a0a |
| actions/create-github-app-token | v3.2.0 | bcd2ba49218906704ab6c1aa796996da409d3eb1 |
| peter-evans/create-pull-request | v8.1.1 | 5f6978faf089d4d20b00c7766989d076bb2fc7f1 |
| actions/dependency-review-action | v5.0.0 | a1d282b36b6f3519aa1f3fc636f609c47dddb294 |
| github/codeql-action | v4.38.1 | 1c5b675653bb5c22dbe9b12b556ec555138e09fd |
| ossf/scorecard-action | v2.4.4 | 2d1146689b8cda280b9bc96326124645441f03bc |
| step-security/harden-runner | v2.21.1 | e14015d583714f6e62063499dc959a02595150a1 |
| actions/attest-build-provenance | v4.2.2 | 4d101475d8b20a2381f78447822ac1eab6504dd8 |
| anchore/sbom-action | v0.24.2 | 3ad7283483fc7af8ff2b4ea19663c2d5ca935e26 |

> Before committing, check each input name against the action's README at that major version. Major bumps (checkout v4 → v7 etc.) occasionally rename inputs. NOT VERIFIED here: these drafts were not executed.

### `.github/workflows/ci.yml`

```yaml
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
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: step-security/harden-runner@e14015d583714f6e62063499dc959a02595150a1 # v2.21.1
        with:
          egress-policy: audit

      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: package.json   # add "engines": { "node": ">=22 <23" } first, or use node-version: 22
          cache: npm

      # Lockfile must be in sync (this is what broke auto-update for a month).
      # --ignore-scripts: the only install script in the tree today is macOS-only
      # fsevents; nothing here needs a lifecycle script to typecheck/test/build.
      - run: npm ci --ignore-scripts --no-audit --no-fund

      - run: npm audit signatures        # registry provenance/signature check for installed packages
      - run: npm run typecheck
      - run: npm run lint -- --max-warnings=189   # ratchet: lower this number over time, never raise it
      - run: npm test
      - run: npm run check:auth

      # Build without DATABASE_URL: migrate.mjs skips (never touch a real DB from CI).
      - run: npm run build
        env:
          DATABASE_URL: ""

      # The committed extension zip must match its source tree (see REL-02).
      - name: extension zip matches source
        run: |
          set -euo pipefail
          tmp="$(mktemp -d)"
          unzip -q public/extensions/velo-session.zip -d "$tmp"
          diff -r --strip-trailing-cr extensions/velo-session "$tmp/velo-session"
          diff -r --strip-trailing-cr extensions/velo-session public/extensions/velo-session
```

### `.github/workflows/auto-update.yml` (hardened replacement)

```yaml
# Weekly dependency refresh — hardened.
# Untrusted job: resolves + runs NEW third-party code with a read-only token and
# no persisted credentials, and emits only a manifest patch.
# Trusted job: runs no package code; validates the patch touches only the
# manifests, then opens the PR with a GitHub App token so ci.yml runs on it.
name: auto-update

on:
  schedule:
    - cron: "0 6 * * 1"
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
          node-version: 22
          cache: npm

      - run: npm ci --ignore-scripts --no-audit --no-fund

      # Cooldown: never pick up a version published in the last 3 days
      # (most malicious npm releases are caught and yanked within that window).
      - name: update (npm only — yt-dlp is owned by Dependabot pip, see GH-07)
        run: |
          export NPM_CONFIG_BEFORE="$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)"
          npm run update:deps -- --skip-ytdlp

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
    if: needs.update.outputs.changed == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read        # the App token below does the writing
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: actions/download-artifact@v5   # pin to SHA like the others before committing
        with:
          name: manifests-patch

      - name: patch may only touch the manifests
        run: |
          set -euo pipefail
          files="$(git apply --numstat manifests.patch | awk '{print $3}' | sort -u)"
          echo "$files"
          if echo "$files" | grep -vxE 'package\.json|package-lock\.json'; then
            echo "::error::patch touches files other than package.json/package-lock.json"; exit 1
          fi
          git apply manifests.patch
          rm manifests.patch

      - id: app-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          app-id: ${{ vars.DEPS_BOT_APP_ID }}
          private-key: ${{ secrets.DEPS_BOT_PRIVATE_KEY }}
          # App installed on this repo only, permissions: contents:write, pull_requests:write

      - uses: peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1 # v8.1.1
        with:
          token: ${{ steps.app-token.outputs.token }}
          branch: auto-update/dependencies
          title: "chore(deps): weekly verified dependency update"
          commit-message: "chore(deps): weekly verified dependency update"
          add-paths: |
            package.json
            package-lock.json
          delete-branch: true
          body: |
            Automated by `.github/workflows/auto-update.yml` (3-day release cooldown).
            Verified in an unprivileged job with typecheck + test + lint; `ci` re-verifies on this PR.
```

### `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: Etc/UTC }
    cooldown:
      default-days: 3
      semver-major-days: 14
    open-pull-requests-limit: 10
    groups:
      extraction:        # the staleness-critical family the custom updater exists for
        patterns: ["youtubei.js", "bgutils-js", "jsdom", "undici", "socks-proxy-agent"]
      tanstack:
        patterns: ["@tanstack/*"]
      radix:
        patterns: ["@radix-ui/*"]
      dev-tooling:
        dependency-type: development
        update-types: [minor, patch]
    ignore:
      - dependency-name: nitro        # exact-pinned beta on purpose
      - dependency-name: jose         # exact-pinned on purpose
      - dependency-name: nf3          # overridden

  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
    groups:
      actions:
        patterns: ["*"]

  # Enable after adding requirements.txt pinning yt-dlp (GH-07).
  - package-ecosystem: pip
    directory: /
    schedule: { interval: daily }     # yt-dlp breakage is time-critical
    cooldown:
      default-days: 1
```

### `.github/workflows/codeql.yml`

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

### `.github/workflows/dependency-review.yml`

```yaml
name: dependency-review
on: pull_request
permissions: {}
jobs:
  dependency-review:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      pull-requests: write   # for the summary comment; drop to omit comments
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          fail-on-severity: moderate
          comment-summary-in-pr: on-failure
          # License policy is a legal decision (see OSS-09): GPL @ffmpeg/core is already in the tree.
          deny-licenses: AGPL-3.0-only, AGPL-3.0-or-later
```

### `.github/workflows/scorecard.yml`

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
    permissions:
      contents: read
      security-events: write
      id-token: write
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

### Settings checklist (GitHub UI, one-time)

1. Settings → Rules → Rulesets: `protect-main` (GH-02) plus `protect-release-tags` (`refs/tags/v*`: block deletion and update).
2. Settings → Actions → General: allow only selected actions, require SHA pinning, keep the default token `read`, and leave "Allow Actions to create/approve PRs" **off** (the App token replaces it).
3. Settings → Code security: Dependabot alerts and security updates **on**; private vulnerability reporting **on**; secret scanning non-provider patterns and validity checks **on**; add a custom pattern for the broker client-secret format.
4. Settings → Environments: create `production` with required reviewer = maintainer. Deploy and release jobs use it (REL-05).
5. Settings → General: enable "Automatically delete head branches"; disable the wiki unless it is used (`hasWikiEnabled: true` today, with no content).

## Not verified / out of scope

- Whether the leaked `grok_preview` client secret is still accepted by `auth.grok.me` (not tested; it would mean using a credential).
- Whether the *next* scheduled auto-update run passes `npm ci` at HEAD `81cbd95`: `npm@10.9.9 ci --ignore-scripts` succeeded locally, but the runner's npm/Node patch version and a non-`--ignore-scripts` install were not reproduced.
- The YAML drafts were not executed. Input names should be checked against each action's README at the pinned major.
- Organisation-level settings, GitHub App installations (`/installation` returned 401 with a user token), webhooks (the listing needs the `admin:repo_hook` scope; the call returned `[]`), and Vercel project settings.
- The 27 uncommitted working-tree files are not on GitHub. Their content is covered by the code auditors, not here.
