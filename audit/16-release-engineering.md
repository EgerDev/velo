# 16 — Release Engineering (prefix REL-)

Auditor: **oss** (open-source maintainer + release engineer). Date: 2026-09-23.

## Scope & method

- Inventory of versioning, tags, releases, changelog, artifacts, deploy and migration mechanics.
- Read `package.json`, `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `migrations/*.sql`, `vite.config.ts` (nitro preset), both extension manifests, the committed extension zip, `src/routes/api/health.ts` and `src/lib/tool-updates.server.ts`.
- Read-only `gh api` for tags, releases, deployments and statuses.
- Built the fresh clone of `origin/main` (`81cbd95`) **twice** in the scratchpad with `DATABASE_URL` unset, and compared the SHA-256 of every output file outside `node_modules`.
- Unzipped `public/extensions/velo-session.zip` and diffed it against both source copies.

Key facts:

| Fact | Evidence |
|---|---|
| Version | `package.json` has **no `version`**; name `app-builder-workspace` |
| Tags / releases | `git tag` → none; `gh api …/tags` → `[]`; `…/releases` → `[]` |
| CHANGELOG | none |
| Deploys visible to GitHub | `…/deployments` → `0`; `…/commits/HEAD/statuses` → `0`; no `vercel.json`; `.vercel/` holds only `output/` (not linked) |
| Build output | `.vercel/output` (Vercel Build Output API v3), function `runtime: "nodejs24.x"`, `supportsResponseStreaming: true` |
| Build determinism (same host) | 293/293 output files byte-identical across two builds |
| Migrations | 5 files, applied by `npm run build` → `db:migrate` when `DATABASE_URL` is set |
| Extension artifacts | `extension/` v1.0.0 (not distributed); `extensions/velo-session/` v1.1.1, plus `public/extensions/velo-session/` (unpacked copy) and `public/extensions/velo-session.zip` (sha256 `d90f463b…4d92f`), committed by hand |

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| REL-01 | P1 | No versioning: no version, tags, releases or CHANGELOG, and the running build cannot identify itself | Both |
| REL-02 | P1 | The cookie-extracting extension zip is a hand-committed binary with no build, hash, signature or provenance | Both |
| REL-03 | P1 | Migrations run inside `npm run build` against whatever `DATABASE_URL` the build sees: previews can migrate prod, a failure leaves a half-applied schema, there is no rollback | Website launch |
| REL-04 | P1 | Deployment is not driven, gated or recorded by the repo; nothing documents promotion or rollback | Website launch |
| REL-05 | P1 | The deployed artifact is mutable at runtime: the Tools tab runs `npm install` / `pip install` on the live server | Both |
| REL-06 | P2 | Toolchain drift: Node 22 docs/CI vs `nodejs24.x` prod vs 25 local; yt-dlp unpinned; Python/ffmpeg absent from the Vercel artifact; production on a nitro beta | Both |
| REL-07 | P2 | No SBOM, provenance attestations or checksums for any artifact | OSS release |
| REL-08 | P1 | Extension distribution: sideload-only, never updates, hard-wired to Grok hosts, Chrome Web Store policy unresolved | Both |
| REL-09 | P2 | No release checklist, post-deploy smoke test or rollback runbook | Both |
| REL-10 | P3 | Build output is deterministic on one host; cross-host reproducibility is unproven | Neither |

---

### REL-01 — No versioning: no version, tags, releases or CHANGELOG, and the running build cannot identify itself
- **Severity:** P1
- **Category:** Versioning
- **Blocks:** Both
- **Affected files:** `package.json` (no `version`), `src/routes/api/health.ts` (no version/commit field), `extension/manifest.json:4` (`1.0.0`), `extensions/velo-session/manifest.json:4` (`1.1.1`)
- **Description:** The web app has no version at all. The two extension versions are bumped by hand and independently, with no link to app commits. `/api/health` reports datastore and uptime, but no build ID, so a bug report or an uptime alert cannot be tied to a commit. There are 41 commits with good Conventional-Commit subjects (`feat:`, `fix(security):`, `chore:`), so a changelog can be generated. None exists.
- **Evidence:** `git tag` prints nothing. `gh api repos/EgerDev/velo/releases` → `[]`. `grep -n "version\|commit\|VERCEL_" src/routes/api/health.ts` finds nothing.
- **Real-world consequence:** "Which version are you on?" has no answer. Security fixes cannot be announced against affected versions (SECURITY.md needs a "supported versions" line). Rollback targets have no names.
- **Recommended fix:** Adopt SemVer, starting at **0.1.0**. 0.x signals that the API and DB schema can change. Rules:
  - MAJOR: breaking DB migration or config removal.
  - MINOR: features.
  - PATCH: fixes, including yt-dlp/youtubei.js bumps.

  Tag `vX.Y.Z` (signed: `git tag -s`) on `main`, and keep `CHANGELOG.md` in Keep-a-Changelog format with an `## [Unreleased]` section. Inject the version and commit into the build (`define: { __APP_VERSION__: JSON.stringify(pkg.version), __GIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "dev") }` in `vite.config.ts`). Return both from `/api/health` and show them in the footer. Version the extensions in lockstep with the app, or give each its own tag prefix (`ext-session-v1.1.1`). Pick one scheme and write it down. Optional automation: `release-please` (Conventional Commits → PR that bumps the version and CHANGELOG). Doing it by hand is fine at the current cadence.
- **Verification procedure:** `curl https://<prod>/api/health` returns `version` and `commit` matching `git describe --tags`; `gh release list` shows `v0.1.0`.
- **Status:** CONFIRMED

### REL-02 — The cookie-extracting extension zip is a hand-committed binary with no build, hash, signature or provenance
- **Severity:** P1
- **Category:** Artifact integrity / supply chain
- **Blocks:** Both
- **Affected files:** `public/extensions/velo-session.zip`; `public/extensions/velo-session/*`; `extensions/velo-session/*`; `src/components/session-guide.tsx:19,186,282,331`
- **Description:** The website tells users to download `/extensions/velo-session.zip` and load it. The extension holds `cookies`, `webRequest`, `tabs` and `downloads` permissions over `*.youtube.com` and `*.googlevideo.com`, and sends the Google session to a page. The zip is a binary committed by hand, with nothing to produce it: there is no build script (`grep -rn velo-session.zip scripts/` finds nothing; the only reference is the UI link). No checksum is published, and it has no signature or attestation. It currently matches its source: the three copies are identical apart from CRLF in this working tree, and zip entry dates run 2026-08-25 to 08-26. But nothing enforces that, and review cannot see inside a binary diff. Any write to `main` (GH-02/GH-03) or to the deployment can swap it for a credential stealer that looks the same. The zip is also byte-identical in the build output, `.vercel/output/static/extensions/velo-session.zip` → `d90f463b…4d92f`, so the site serves exactly what was committed.
- **Evidence:**
  ```
  $ diff -r -q --strip-trailing-cr extensions/velo-session <unzipped>/velo-session   -> rc=0
  $ diff -r -q --strip-trailing-cr extensions/velo-session public/extensions/velo-session -> rc=0
  $ sha256sum public/extensions/velo-session.zip
  d90f463b397e15b91bc64c920c2113b50727981b4430ce3e8cbaf1405d24d92f
  $ git log --format='%h %ad %s' --date=short -- public/extensions/velo-session.zip
  fbf0867 2026-08-27 … extension v1.1.1 …
  dca3f85 2026-08-25 fix(extension): stop session spray …
  5a40709 2026-08-24 feat: initial commit …
  ```
- **Real-world consequence:** A tampered zip turns every Velo user's browser into a Google-session exfiltration tool. Users have no way to check what they installed.
- **Recommended fix:** Delete `public/extensions/velo-session.zip` and `public/extensions/velo-session/` from git and add them to `.gitignore`. Build them in the release workflow (below) from `extensions/velo-session/` with a deterministic zip (fixed mtimes, sorted entries, `zip -X`). Publish the zip, `SHA256SUMS` and a build-provenance attestation as GitHub Release assets. Copy the zip into `public/extensions/` at build time (a `prebuild` step), so the website serves the same bytes as the release. Show the SHA-256 and a `gh attestation verify` command next to the download button. Until then, the CI check in `05-github-security.md` (`ci.yml` "extension zip matches source") at least blocks drift.
- **Verification procedure:** `git ls-files public/extensions` is empty. `gh attestation verify velo-session-v1.1.1.zip -R EgerDev/velo` passes. `sha256sum` of the file downloaded from the site equals the release's `SHA256SUMS` entry.
- **Status:** CONFIRMED (the artifact is unmanaged; its contents currently match the source)

### REL-03 — Migrations run inside `npm run build` against whatever `DATABASE_URL` the build sees: previews can migrate prod, a failure leaves a half-applied schema, there is no rollback
- **Severity:** P1
- **Category:** Database release safety
- **Blocks:** Website launch
- **Affected files:** `package.json` (`"build": "… vite build && npm run db:migrate"`); `scripts/migrate.mjs:5-7,21-27,45-92`; `migrations/0005_proxy_operations.sql:4-33`; `src/lib/db.ts:117-121`
- **Description:** Five problems stack up here.
  1. **Which DB?** Vercel runs `npm run build` for **every** deployment, Preview included (every pushed branch and PR). If the Preview environment has `DATABASE_URL` (the Neon/Vercel integration sets it for all environments unless branching is configured), an unreviewed branch's migration runs against that database, and it may be production's. There is no environment guard.
  2. **Ordering.** Migrations are applied after `vite build` but **before** the deployment is live or promoted, while the previous production deployment is still serving. Every migration must therefore stay compatible with the *old* code (expand/contract). Nothing documents or checks that rule. 0005, for example, adds `NOT NULL` + `UNIQUE (priority)` constraints: safe only because the old code never touched `velo_proxy` (0004 and 0005 landed in the same commit `e4c1c1e`).
  3. **Mid-deploy failure.** Each file is its own transaction (`migrate.mjs:58-63`). If file N+1 fails, files ≤ N stay committed, the build fails, and no deployment is created. The DB is then ahead of the code in production. The next deploy resumes at N+1, which is fine, but there is no alert beyond a red build.
  4. **Rollback.** There are no down migrations and no pre-migration backup or branch step. Vercel Instant Rollback restores *code only*, so rolled-back code runs against the newer schema.
  5. **Concurrency claim is weaker than the comment says.** `migrate.mjs:70-81` treats a `_migrations_pkey` violation as "applied by a concurrent deploy". But the loser runs the migration SQL *before* its `INSERT`. For a non-idempotent file such as 0005 (`alter table … add column`), the loser fails with `duplicate_column` (42701), not 23505, so the build fails. The comment only holds for idempotent files. NOT VERIFIED by execution; this is from reading the code.

  Also: with no `DATABASE_URL`, production silently uses **in-memory PGLite per instance** (`db.ts:117-121`), so accounts and vault rows vanish on every cold start. It should be an error in production.
- **Evidence:** The `package.json` build script and `migrate.mjs` lines quoted above. Fresh-clone build log: `[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).`
- **Real-world consequence:** A feature branch drops or reshapes a production table before review. A failed deploy leaves production code on a schema it does not expect. A rollback during an incident makes things worse.
- **Recommended fix:**
  - Take `db:migrate` **out of** `build` (`"build": "node scripts/with-app-env.mjs vite build"`).
  - Run migrations as a separate CI job in the GitHub `production` environment (required reviewer), before promotion: (1) take a Neon branch or snapshot (or `pg_dump`) as the rollback point; (2) `npm run db:migrate`; (3) deploy `--prebuilt` to production; (4) smoke test; (5) promote.
  - For Preview, use a Neon branch per preview (or no DB at all), **never** the production URL. Make `migrate.mjs` refuse to run when `VERCEL_ENV !== "production"` unless `MIGRATE_ALLOW_NONPROD=1`.
  - Write down the expand → migrate → contract policy (additive migrations only in a release; removals one release later) in CONTRIBUTING, and add a CI lint that flags `drop|rename|alter column .* type|set not null` for manual sign-off.
  - Take a `pg_advisory_xact_lock` inside each migration's transaction. It is transaction-scoped, so it is safe through PgBouncer/Neon poolers, which answers the objection in the comment.
  - Fail startup when `NODE_ENV=production` and `DATABASE_URL` is unset.
- **Verification procedure:** Push a branch that adds a no-op migration: the Preview build log shows `[migrate]` refusing or targeting a branch DB, and production's `_migrations` table is unchanged. A production deploy shows the migrate job waiting on environment approval.
- **Status:** CONFIRMED (mechanism). Whether Vercel's Preview env actually holds the production `DATABASE_URL`: NOT VERIFIED (no access to the project settings).

### REL-04 — Deployment is not driven, gated or recorded by the repo; nothing documents promotion or rollback
- **Severity:** P1
- **Category:** Deployment
- **Blocks:** Website launch
- **Affected files:** repo (no `vercel.json`, no deploy workflow); `.vercel/` (only `output/`, no `project.json`); `vite.config.ts:209-210` (`nitro({ preset: "vercel" })`)
- **Description:** GitHub records no deployments or commit statuses, so the Vercel Git integration is not connected to this repo. The local `.vercel/` is not linked to a project. Deploys therefore happen out of band: through the Grok App Builder platform ("the deployer injects a per-app `GROK_AUTH_*`", `src/lib/auth/server.ts:15`) or by hand. Nobody can tell which commit production runs (REL-01). There is no gate between `main` and production, and no documented promote or rollback.
- **Evidence:** `gh api repos/EgerDev/velo/deployments --jq length` → `0`; `…/commits/HEAD/statuses` → `0`; `ls .vercel` → `output` only.
- **Real-world consequence:** An unreviewed local working tree can be deployed; right now 27 modified files are not on GitHub. Incidents have no known-good target to roll back to.
- **Recommended fix:** One deploy path: either connect the Vercel Git integration (production = `main`, with a required-checks gate via Vercel's "wait for GitHub checks"), or have CI run `vercel build` and `vercel deploy --prebuilt` in the `production` environment using `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets. Deploy only from a tag (`v*`) or from `main` after `ci` passes. Promote a verified preview with `vercel promote <url>`. Roll back with `vercel rollback <deployment>`, or Instant Rollback in the dashboard, remembering that the schema does not roll back (REL-03). Record the deployment URL in the GitHub Release notes. Forbid deploying from local working trees.
- **Verification procedure:** `gh api repos/EgerDev/velo/deployments` lists one deployment per release, with `environment: production` and `sha` equal to the tag commit.
- **Status:** CONFIRMED (no repo-driven deploy). The actual current deploy mechanism: NOT VERIFIED.

### REL-05 — The deployed artifact is mutable at runtime: the Tools tab runs `npm install` / `pip install` on the live server
- **Severity:** P1
- **Category:** Artifact immutability / change control
- **Blocks:** Both
- **Affected files:** `src/lib/tool-updates.server.ts:17-24,135-140,176-233`; `src/lib/tool-versions.ts` (`npmInstallArgs`, `pipUpgradeArgs`); `src/lib/operator-gate.server.ts`
- **Description:** An "operator" can install newer npm or pip packages into the running server from the UI, bypassing CI, review, the lockfile and any release. After that, the code serving users is not the code that was built and tagged. On Vercel the function filesystem is read-only, so the install fails or only affects `/tmp`. That makes the feature misleading in the documented deploy target, and dangerous on self-hosted instances. Gate strength is covered by the security auditor. The release-engineering objection holds whatever the gate: an immutable artifact is the thing that makes rollback, attestation and bug triage mean anything.
- **Evidence:** `tool-updates.server.ts` header: "for an operator — install the newer one"; `runLogged(command, args…)` spawns `npm`/`pip` with `CI: "1"`.
- **Real-world consequence:** An undetectable drift from the release, a live server bricked by a bad install, and dependency versions that no SBOM or attestation describes.
- **Recommended fix:** Remove the install action from production builds (keep read-only "update available" reporting). Updates flow through Dependabot → CI → release → deploy. If a hot yt-dlp bump is needed faster, cut a PATCH release; with the pipeline below that takes minutes.
- **Verification procedure:** In a production build, the install endpoint returns 404/403 and the Tools tab shows versions only.
- **Status:** CONFIRMED (code). Behaviour on Vercel: NOT VERIFIED.

### REL-06 — Toolchain drift: Node 22 docs/CI vs `nodejs24.x` prod vs 25 local; yt-dlp unpinned; Python/ffmpeg absent from the Vercel artifact; production on a nitro beta
- **Severity:** P2
- **Category:** Reproducibility / environment parity
- **Blocks:** Both
- **Affected files:** `README.md:125`; `.github/workflows/auto-update.yml:31`; `.vercel/output/functions/__server.func/.vc-config.json` (`"runtime": "nodejs24.x"`); `package.json` (`"nitro": "3.0.260610-beta"`, `overrides.nf3`); no `requirements.txt`
- **Description:**
  - Node: the docs and the workflow say 22, the production function is built for 24, this host runs 25, and there is no `engines` field (OSS-05).
  - yt-dlp: whichever version was last pip-installed on the host (GH-07).
  - Python, yt-dlp and ffmpeg: not in the Vercel build output at all (`find .vercel/output/functions -path "*yt_dlp*" -o -name ffmpeg` finds nothing), although the README calls the yt-dlp path "the most reliable".
  - Nitro: production runs an exact-pinned **beta**.
- **Evidence:** As cited above.
- **Real-world consequence:** Tests pass on one Node major and production runs another. The yt-dlp behaviour of a given release is unknowable.
- **Recommended fix:** Pin Node to one major everywhere (`engines`, `.nvmrc`, `setup-node`, the Vercel project setting). Pin yt-dlp with hashes in `requirements.txt`. Decide explicitly whether production has a yt-dlp path. If it does, ship a container (Dockerfile) rather than Vercel functions for that path, and document it. Track the nitro beta → stable move as a release blocker for 1.0.
- **Verification procedure:** `node -v` in CI equals the Vercel runtime major. `/api/health?deep=1` reports the yt-dlp version from `requirements.txt`, or "unavailable" by design.
- **Status:** CONFIRMED (config). The live production runtime: NOT VERIFIED.

### REL-07 — No SBOM, provenance attestations or checksums for any artifact
- **Severity:** P2
- **Category:** Supply-chain transparency
- **Blocks:** OSS release
- **Affected files:** n/a (no release workflow)
- **Description:** No CycloneDX or SPDX SBOM, no SLSA provenance, no `SHA256SUMS`. For a project that asks users to install an extension handling Google session cookies, and to self-host a server that stores them, those are the minimum verifiable artifacts.
- **Evidence:** `gh api repos/EgerDev/velo/releases` → `[]`; no workflows besides auto-update.
- **Real-world consequence:** Nobody (users, the Chrome Web Store, security researchers) can verify what a release contains.
- **Recommended fix:** In the release workflow (below): `npm sbom --sbom-format cyclonedx --omit dev > sbom.cdx.json` (built into npm ≥ 10, no extra action needed); `sha256sum * > SHA256SUMS`; `actions/attest-build-provenance` over the zips, the SBOM and a tarball of `.vercel/output`; everything uploaded to the GitHub Release.
- **Verification procedure:** `gh attestation verify <asset> -R EgerDev/velo` passes for every release asset.
- **Status:** CONFIRMED

### REL-08 — Extension distribution: sideload-only, never updates, hard-wired to Grok hosts, Chrome Web Store policy unresolved
- **Severity:** P1
- **Category:** Extension release
- **Blocks:** Both
- **Affected files:** `extensions/velo-session/manifest.json:6-17,31-42,49-53`; `extensions/velo-session/content.js:1-15`; `extensions/velo-session/popup.js:15-21`; `extension/README.md` (install steps)
- **Description:**
  - **Distribution.** Both extensions are distributed only as "Developer mode → Load unpacked". Unpacked extensions **never auto-update**, so every user stays on whatever version they downloaded, including any future security fix. Chrome also shows a persistent developer-mode warning.
  - **Hosts.** `velo-session`'s host permissions and content scripts target `localhost`, `127.0.0.1`, `*.grok-sandbox.com`, `*.grok.com` and `*.grok.me`: the Grok sandbox hosts, **not** a Velo production domain. `content.js` relays the cookie jar with `window.postMessage(…, window.location.origin)` to *any* page on those hosts, which includes every other user's Grok-built app on `*.grok-sandbox.com`. That is a security finding for the extension auditor. For release it means the extension cannot be released as-is for a custom production domain, and it has to be rebuilt per environment.
  - **Firefox.** `browser_specific_settings.gecko.id` is `velo-session@velo.app`, which implies ownership of `velo.app` (NOT VERIFIED). Firefox release builds require AMO signing.
  - **Store policy.** The Chrome Web Store has historically rejected extensions that download YouTube content (**REQUIRES LEGAL/POLICY REVIEW**).
- **Evidence:** `manifest.json:7-17` host_permissions list; `content.js:3-11` `window.postMessage({source:"velo-extension",type:"velo-youtube-cookies",netscape:…}, window.location.origin)`.
- **Real-world consequence:** A permanently stale install base, an extension that leaks the session to unrelated Grok-hosted pages, and a store rejection.
- **Recommended fix:**
  - Generate `manifest.json` at build time from a template, with the production origin(s) only (`https://<velo-domain>/*`); no Grok wildcards; `localhost` only in a separate dev build.
  - Decide on channels: Chrome Web Store (after the policy review) or self-hosted CRX with `update_url` for enterprise-style installs, plus Firefox AMO (signed, can be unlisted).
  - Keep the signing keys (the CWS item key, the AMO API key) only in the GitHub `release` environment secrets.
  - Bump the manifest version from the release tag.
- **Verification procedure:** In the release zip's manifest, `host_permissions` and `content_scripts.matches` contain no `grok`. The store listing ID and update channel are documented in README "Browser extensions".
- **Status:** CONFIRMED (manifest/code). Store acceptance: REQUIRES LEGAL/POLICY REVIEW.

### REL-09 — No release checklist, post-deploy smoke test or rollback runbook
- **Severity:** P2
- **Category:** Process
- **Blocks:** Both
- **Affected files:** n/a
- **Description:** `scripts/browser-smoke.mjs` exists but only allows loopback URLs unless `BROWSER_ALLOW_EXTERNAL_HOST=1` (`scripts/browser-guard.mjs`), and nothing runs it after a deploy. `/api/health?deep=1` exists (good) but nothing probes it after a deploy. There is no written procedure.
- **Evidence:** See REL-04; `browser-guard.mjs:25-29` (loopback guard).
- **Real-world consequence:** Broken deploys are discovered by users. Rollbacks are improvised under pressure.
- **Recommended fix:** The checklist and workflow below.
- **Verification procedure:** The next release follows the checklist, and its GitHub Release links the checklist issue.
- **Status:** CONFIRMED

### REL-10 — Build output is deterministic on one host; cross-host reproducibility is unproven
- **Severity:** P3
- **Category:** Reproducibility
- **Blocks:** Neither
- **Affected files:** `.vercel/output/**`
- **Description:** Two consecutive `npm run build` runs of the fresh clone on this Windows host gave **293/293 byte-identical files** (static + functions, excluding bundled `node_modules`). That is a good sign. Whether the output matches across OS or Node versions (Windows local vs Linux CI vs Vercel's builder) was not tested, and it matters if a release attests a CI build while Vercel rebuilds from source.
- **Evidence:** `sha256sum` manifests `h1.txt`/`h2.txt` in the scratchpad: 293 lines each, `diff` empty.
- **Real-world consequence:** An attested CI build might not be the bytes Vercel serves.
- **Recommended fix:** Deploy the CI-built output with `vercel deploy --prebuilt`, so the attested bytes *are* the deployed bytes, rather than letting Vercel rebuild.
- **Verification procedure:** The SHA-256 of `static/assets/*` from the CI artifact equals what the production URL serves (spot-check with `curl | sha256sum`).
- **Status:** CONFIRMED (same host). Cross-host: NOT VERIFIED.

---

## Proposed release process

### Versioning & branches
- SemVer `vMAJOR.MINOR.PATCH`, starting at `v0.1.0`. Trunk-based: `main` is always releasable, and releases are **signed annotated tags** on `main`. A tag ruleset makes `v*` tags immutable (GH-02).
- Extension versions follow the app version (so `manifest.version` is written from the tag at build time). This removes a whole class of "which zip is this" questions.
- `CHANGELOG.md` in Keep-a-Changelog format. Every user-visible PR adds a line under `## [Unreleased]`: **Added / Changed / Deprecated / Removed / Fixed / Security**. The release PR moves them under the new version.
- Security fixes: a GitHub Security Advisory with the affected range, plus a PATCH release.

### Release workflow draft (`.github/workflows/release.yml`, NOT created)

```yaml
name: release
on:
  push:
    tags: ["v*.*.*"]
permissions: {}
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write        # attestations
      attestations: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { persist-credentials: false }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version: 22, cache: npm }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run typecheck && npm run lint && npm test && npm run check:auth
      - name: version matches tag
        run: test "v$(node -p "require('./package.json').version")" = "${GITHUB_REF_NAME}"
      - name: build extensions (deterministic)
        run: |
          set -euo pipefail
          V="${GITHUB_REF_NAME#v}"; mkdir -p dist
          for ext in extensions/velo-session extension; do
            name="$(basename "$ext")"; [ "$name" = extension ] && name=velo-extension
            work="$(mktemp -d)/$name"; cp -r "$ext" "$work"
            node -e 'const f=process.argv[1],v=process.argv[2],m=require(f);m.version=v;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$work/manifest.json" "$V"
            find "$work" -exec touch -h -d '1980-01-01T00:00:00Z' {} +
            (cd "$(dirname "$work")" && find "$name" -print | LC_ALL=C sort | zip -X -D -q "$GITHUB_WORKSPACE/dist/$name-v$V.zip" -@)
          done
          mkdir -p public/extensions && cp "dist/velo-session-v$V.zip" public/extensions/velo-session.zip
      - run: npm run build          # db:migrate removed from build (REL-03)
        env: { DATABASE_URL: "" }
      - run: tar -C .vercel -czf "dist/vercel-output-${GITHUB_REF_NAME}.tgz" output
      - run: npm sbom --sbom-format cyclonedx --omit dev > "dist/sbom-${GITHUB_REF_NAME}.cdx.json"
      - run: (cd dist && sha256sum * > SHA256SUMS)
      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with: { subject-path: "dist/*" }
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with: { name: release-dist, path: dist/, retention-days: 30 }

  publish:
    needs: build
    runs-on: ubuntu-24.04
    environment: release            # required reviewer
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v5   # pin to SHA before committing
        with: { name: release-dist, path: dist }
      - env: { GH_TOKEN: "${{ github.token }}" }
        run: |
          gh release create "$GITHUB_REF_NAME" dist/* -R "$GITHUB_REPOSITORY" \
            --verify-tag --title "$GITHUB_REF_NAME" --notes-from-tag

  deploy:
    needs: publish
    runs-on: ubuntu-24.04
    environment: production         # required reviewer; holds VERCEL_* + DATABASE_URL (migrate only)
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { persist-credentials: false }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version: 22, cache: npm }
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - uses: actions/download-artifact@v5
        with: { name: release-dist, path: dist }
      - run: mkdir -p .vercel && tar -C .vercel -xzf dist/vercel-output-*.tgz
      # 1. rollback point (Neon: create a branch from main at "now"; or pg_dump)
      # 2. migrate (additive-only; see REL-03)
      - run: npm run db:migrate
        env: { DATABASE_URL: "${{ secrets.DATABASE_URL }}" }
      # 3. deploy the ATTESTED bytes, not a rebuild
      - run: npx --yes vercel@latest deploy --prebuilt --prod --token "$VERCEL_TOKEN" > url.txt
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
      # 4. post-deploy smoke
      - run: |
          url="$(cat url.txt)"
          curl -fsS "$url/api/health?deep=1" | tee health.json
          node -e 'const h=require("./health.json");if(h.version!==process.env.GITHUB_REF_NAME.slice(1))process.exit(1)'
```

> Pin `vercel` to an exact version and `download-artifact` to a SHA before committing. With `--prod` the new deployment serves immediately. For a canary, drop `--prod`, smoke the preview URL, then `vercel promote <url>`. Draft NOT executed.

### Deploy promotion & rollback
- **Promote:** deploy without `--prod` → smoke the preview URL (health `deep=1`, the Playwright smoke with `BROWSER_ALLOW_EXTERNAL_HOST=1`) → `vercel promote <url>`.
- **Code rollback:** `vercel rollback <previous-deployment-url>` (Instant Rollback). This is only safe because migrations are additive (expand/contract).
- **Schema rollback:** only by restoring the pre-migration Neon branch or dump taken in step 1. Treat that as a data-loss event (writes since the migration are lost) and announce it.
- **Extension rollback:** re-publish the previous version with a *higher* version number (stores reject downgrades). Unpacked installs cannot be rolled back remotely, which is one more reason to leave sideloading behind.

### Release checklist (copy into a `release` issue template)

**T-7 days (freeze prep)**
1. [ ] `main` is green on `ci`, `codeql` and `dependency-review`; no open P0/P1 security advisories.
2. [ ] Dependabot/auto-update PRs merged or explicitly deferred; `yt-dlp` pin in `requirements.txt` is current.
3. [ ] Legal/policy sign-off is on file for this release's scope (OSS-11, REL-08). The first release **must** have it.

**Release PR**
4. [ ] Bump `package.json` `version` (`npm version <x.y.z> --no-git-tag-version`), which also updates the lockfile's root version.
5. [ ] Move the `CHANGELOG.md` `[Unreleased]` entries under `## [x.y.z] - YYYY-MM-DD`; update the compare links.
6. [ ] Migrations in this release are additive only (the CI lint passes, or there is a written exception with a contract step planned for the next release).
7. [ ] `docs/configuration.md` updated for any new or removed env var; production env vars set in Vercel **before** deploy (`VELO_VAULT_KEY`, `BETTER_AUTH_SECRET`, `GROK_AUTH_CLIENT_ID/SECRET` (never the preview fallback), `DATABASE_URL`, `TRUST_CLOUDFLARE` as appropriate).
8. [ ] The extension's source manifest has no `grok` or localhost hosts in the production build config.
9. [ ] PR reviewed by CODEOWNERS and merged (squash); `ci` is green on the merge commit.

**Tag & build**
10. [ ] `git switch main && git pull --ff-only && git tag -s vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
11. [ ] `release` workflow: the build job is green (version==tag, tests, deterministic zips, SBOM, SHA256SUMS, attestations).
12. [ ] Approve the `release` environment, and check the GitHub Release lists the zips, `sbom-*.cdx.json`, `vercel-output-*.tgz` and `SHA256SUMS`.
13. [ ] Locally: `gh attestation verify dist/velo-session-vX.Y.Z.zip -R EgerDev/velo` passes.

**Deploy**
14. [ ] Approve the `production` environment. The rollback point (Neon branch or dump) is created and its ID recorded in the deploy log.
15. [ ] `db:migrate` output reviewed (lists exactly the expected files).
16. [ ] Deploy with `--prebuilt`. `/api/health?deep=1` returns `ok`, and `version` equals the tag.
17. [ ] Playwright smoke against the production URL (desktop + mobile) passes, and the console is clean.
18. [ ] Manual spot check: one public video resolves and downloads; transcript loads; sign-in round-trip works; vault save and delete work (with a test account only).
19. [ ] The SHA-256 of `/extensions/velo-session.zip` served by the site equals the `SHA256SUMS` entry.

**Extensions (if changed)**
20. [ ] Upload the release zip to the Chrome Web Store / AMO (keys held only in the `release` environment); record the store version and review status in the Release notes.

**Post-release**
21. [ ] Publish the GitHub Release notes (from the CHANGELOG); link the deployment URL and the checklist issue.
22. [ ] Watch error rates and `/api/health` for 24 h. Rollback trigger: health not `ok` for more than 5 min, or an error-rate spike. Procedure: `vercel rollback`, then assess the schema (see above).
23. [ ] Open the next `## [Unreleased]` section.

## Not verified / out of scope

- The actual current production deploy mechanism, the Vercel project settings (Preview/Production env vars, Node version, "wait for checks") and the live runtime binaries. I have no Vercel project access; `.vercel` is not linked.
- The concurrent-migration failure mode (REL-03 point 5) comes from reading the code; it was not executed.
- Cross-host build reproducibility (REL-10).
- Chrome Web Store / AMO acceptance and every licensing or policy question (REQUIRES LEGAL REVIEW).
- The release, CI and deploy YAML drafts were not executed; check input names against each action's README at the pinned version.
