# Velo — Remediation Plan

Ordered by risk removed per unit of effort, and by dependency: some decisions change what is worth fixing. IDs refer to [MASTER_FINDINGS.md](MASTER_FINDINGS.md).

Ground rules for remediation:
- Every P0/P1 fix lands with a regression test written first (TDD), in a PR, through CI once CI exists.
- No test is weakened to go green.
- Behaviour changes are recorded in the CHANGELOG.

---

## Phase 0 — Containment (today; hours, not days)

The repo is already public and the extension is already downloadable, so this phase limits ongoing harm before any design work.

1. **Report the leaked `grok_preview` secret to xAI** (M-02) and ask them to rotate it. Only they can.
2. **Remove the preview-client fallback.** Delete `PREVIEW_CLIENT_SECRET` and fail closed when `GROK_AUTH_*` is unset (M-02, M-08). Small diff.
3. **Pull the session extension.** Stop serving `public/extensions/velo-session.zip` and the unpacked copy, remove the in-app install instructions, and publish a notice telling installers to remove it and sign out of all Google sessions (M-03).
4. **Disable the sign-in link.** Set `VELO_SIGNIN_LINK=false` on every deployment now, and delete the feature in Phase 2 (M-09).
5. **GitHub hygiene** (settings only, no code):
   - enable secret scanning and push protection;
   - enable private vulnerability reporting;
   - add a ruleset on `main` (no force-push or deletion, PR required);
   - disable or restrict `auto-update.yml` until it is hardened (M-19).
6. **Decide whether the repo stays public during remediation.** Making it private does not un-leak anything already cloned, but it stops new distribution of the extension and the circumvention code while legal review runs. *This is your call.*
7. **Do not launch the website.** If a deployment is live, consider taking it down or putting it behind Vercel Deployment Protection until Phase 2 is done.

## Phase 1 — Decisions that shape everything else (this week)

These determine which later fixes are needed at all. Fixing M-05 carefully and then deleting the vault would be wasted work.

8. **Legal review** (M-01, M-06, M-21) of:
   - the hosted downloader;
   - the circumvention features (PO token, nsig, BotGuard);
   - storing third-party Google sessions;
   - relicensing the Grok template.

   Counsel's answer may remove features. Start now, because it runs in parallel with Phase 2.
9. **Product scope decision.** Recommended default is to **drop the server-side cookie vault** and keep cookies client-side, sent per request. That removes most of M-05 and shrinks M-06.
10. **Hosting-model decision** (M-07). Either:
    - (a) a long-lived container host with a Dockerfile that pins Python, yt-dlp (with hashes), ffmpeg and curl; or
    - (b) scope the product to what Vercel serverless can do, and delete the subprocess paths, SOCKS pool and Tools tab.

    Everything in Phase 2 on runtime and ops assumes this answer.

## Phase 2 — Security blockers (1–2 weeks)

Each item: failing test first, then fix.

11. **M-10** — Upgrade or patch Nitro/h3, or wrap the entry handler so a `URIError` returns 400 (test: `GET /%` returns 400 and the process survives). Hours. Revisit M-28 while here.
12. **M-04** — Move BotGuard and player-JS execution into real isolation: a worker or child process with an empty env and no filesystem/network, or `isolated-vm`. Delete the `globalThis.window` swapping. Test: a hostile script cannot read `process.env`.
13. **M-05** — If the vault survives step 9:
    - refuse to boot without `VELO_VAULT_KEY`;
    - keep only the allowlisted YouTube cookies;
    - add a TTL;
    - never return plaintext to the client;
    - add an FK with `ON DELETE CASCADE`;
    - add account deletion and export;
    - add dual-key rotation;
    - add isolation tests.
14. **M-08** — A production config validator at boot: exit on a missing `DATABASE_URL`, `BETTER_AUTH_SECRET`, vault key or `GROK_AUTH_*`. Remove the dev-user fallback outside local dev. Health returns 503 on PGLite in production.
15. **M-09** — Delete the sign-in link feature, or replace it with email delivery.
16. **M-11** — Apply the Fetch-Metadata/Origin check to every `/api/*` handler and require `application/json`. Test: a cross-site `text/plain` POST gets 403.
17. **M-12** — Remove the Grok branding/PWA injector. Add a nonce-based CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy and HSTS. Require a user gesture for `auto=1`.
18. **M-13** — Delete runtime `pip install`, the Tools-tab installers and `--remote-components ejs:github`. Pin everything at build time.
19. **M-14** — Delete the proxifly free-proxy list and the corsfix/allorigins relays.
20. **M-16** — Require email verification, or disable email and password; strengthen the password policy.
21. **M-24** — Map errors to stable codes and log details server-side only.
22. **M-03 (redesign, only if the extension is kept)** — Exact-origin allowlist for the production domain, handshake instead of title matching, minimal cookies, no passive capture, built and signed in CI, submitted to the Chrome Web Store.

## Phase 3 — Engineering gates and operations (parallel with late Phase 2)

23. **M-19** — Commit the drafts from 05-github-security.md:
    - `ci.yml` (install, typecheck, lint with warnings as errors, test, build; SHA-pinned; `permissions: contents: read`);
    - Dependabot for npm, github-actions and pip;
    - CodeQL;
    - dependency review;
    - CODEOWNERS;
    - required status checks.

    Harden `auto-update.yml`: no write token during install/test, and a separate PR job.
24. **M-20** — Route-level integration tests for every `/api/*` handler, the auth middleware, vault isolation, the operator gate and the relay allowlist. Make the five fixture-less parser tests real.
25. **M-15** — Shared rate-limit store (a Redis-class Marketplace integration), caps on bulk size and fan-out, per-request cost accounting and spend alerts.
26. **M-17** — Take migrations out of `npm run build` and make them an approved, separate step with a backup/PITR checkpoint first. Run a restore drill. Backups count as NOT VERIFIED until a restore succeeds.
27. **M-18** — Error tracking, an uptime monitor on a deep health check (DB plus an extraction canary), structured logs with request IDs and redaction, and the runbooks sketched in 14-operations.md. Split custody of the DB URL and the vault key.
28. **M-30** — One pool per process, connection and statement timeouts, and error handlers on every pool.

## Phase 4 — Open-source readiness (after Phases 0–2; the repo is already public, so sooner is better)

29. **M-21:**
    - Replace ffmpeg.wasm with an LGPL audio-only build.
    - Remove or replace the Grok template code and xAI assets, or get permission.
    - Add LICENSE (MIT or Apache-2.0, pending counsel) and a NOTICE/THIRD_PARTY file (MPL mediabunny, OFL fonts).
    - Resolve the provenance of the code ported from yt-final.
30. **M-22:**
    - Replace AGENTS.md with a real contributor guide.
    - Add SECURITY.md, CONTRIBUTING, CODE_OF_CONDUCT, SUPPORT, CHANGELOG and issue/PR templates.
    - Add `.env.example` and a full env-var table (start from `docs/architecture.md`).
    - Correct the README claims.
    - Document the prerequisites and supported platforms.
31. **M-23:**
    - Commit the working tree (27 modified plus 3 untracked files, including `src/lib/transfer-progress.ts`) as reviewed PRs.
    - Add a version and SemVer tags, a changelog and a tag-driven release workflow that builds the extension zip, SBOM, checksums and attestations.
    - Deploy only the attested output, and document rollback.
32. **M-27, M-35** — Delete the unused deps (30+), dead modules (multiplayer, connectors), duplicate extension copies and template leftovers (`startup.sh`, `.node_modules.lock`, `public/__grok`, grok-pwa). Rename the package.
33. **M-29, M-33** — Bind dev to 127.0.0.1 by default with a configurable port. Add `engines`, `.nvmrc` and a Node floor matching the deps.

## Phase 5 — Launch polish (after legal sign-off)

34. **M-06** — Privacy policy, terms, subprocessor list, cookie/storage notice, footer, contact and DMCA address. Write them only after Phases 1–2, so they describe the real data flows.
35. **M-25** — WebKit hydration fix, mobile panel overflow, visible focus, contrast, then a full manual accessibility pass. Do not claim compliance.
36. **M-26** — Virtualize the bulk queue, restore the lazy boundaries, and trim first-view preloads. Target mobile LCP under 2.5 s.
37. **M-31, M-32** — SEO metadata, robots and sitemap. Privacy residuals: guest ID, clearing local media on sign-out, retention jobs for session and verification rows.
38. **All remaining P3s** in the Appendix A index.

## Exit criteria for each release

- **Open-source repo "clean":**
  - Phases 0, 2 (items 11–19), 23, 29–33 are done;
  - gitleaks is clean on HEAD;
  - LICENSE and NOTICE are present;
  - CI is green and required on `main`.
- **Website launch:**
  - All of the above, plus Phases 1, 2, 3 and 34–36;
  - a production-like staging deploy passes a real 1080p end-to-end download, the `/%` crash test, the cross-site CSRF test and the CSP check;
  - a restore drill succeeds;
  - counsel's sign-off is recorded.
