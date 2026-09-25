# 04 — Supply-chain audit (prefix SUP-)

Auditor: `supply` · Date: 2026-09-23 · Target: working tree of `C:\Users\PC\orca\velo` (branch `main`, HEAD `81cbd95` plus 27 modified and 3 untracked files).

## Scope and method

Scope: npm dependency tree (`package.json`, `package-lock.json` v3, installed `node_modules`), non-npm runtime components (Python yt-dlp and extras, system binaries), code fetched and executed at runtime, runtime package installers, the GitHub Actions workflow, build tooling (Vite 8 / Rolldown / Nitro beta), the committed browser-extension artifacts, and Docker files (there are none).

Method. Every command below was run from the repo root in Git Bash on Windows 11 with Node v25.2.1 and npm 11.6.2 (registry `https://registry.npmjs.org/`, no `.npmrc`):

| Command | Result |
|---|---|
| `npm audit --json` | exit 0. `vulnerabilities: {}`, total 0 (prod 342, dev 320, optional 117, total 717) |
| `npm audit --omit=dev --json` | exit 0. total 0 |
| `npm audit signatures` | "613 packages have verified registry signatures. 255 packages have verified attestations" |
| `npm outdated` | exit 1, 21 rows (see SUP-11) |
| `npm ls --all` | exit 0. 5 `extraneous` (optional wasm fallbacks), only `UNMET OPTIONAL` peers, no `invalid` |
| lockfile scan (node script over `packages`) | 717 entries. **0** non-registry `resolved` URLs, **0** git/url/tarball/link deps, **0** entries without `integrity`. Only one `hasInstallScript`: `vite/node_modules/fsevents@2.3.3` (optional, macOS only). Deprecated: `eslint@9.39.5`, `recharts@2.15.4` |
| `npm sbom --sbom-format cyclonedx [--omit dev]` | **fails**: `EINVALIDPURLTYPE Invalid type "range" of package "app-builder-workspace@"` (root has no `version`). Worked around, see SUP-13 and "SBOM" below |
| import-usage cross-check (grep each direct dep across `src server scripts vite.config.ts eslint.config.mjs extension extensions`) | 30+ direct deps never imported (SUP-10) |
| `npm view <pkg> maintainers / dist.attestations / time` | see SUP-11 and the maintainer table |

What checked out clean (these are not findings):
- No known advisories (npm audit, prod and all).
- Every tarball comes from registry.npmjs.org with an SRI hash. Registry signatures verify for every package that has them.
- No typosquat look-alikes: every direct dependency's `repository` points at the expected upstream (react-hook-form, pmndrs, colinhacks, LuanRT, Vanilagy, TooTallNate, nodejs/undici, …).
- No Docker, compose, `vercel.json`, `.npmrc`, dependabot or renovate files are tracked (`git ls-files | grep -iE "docker|compose|vercel.json|npmrc|dependabot|renovate"` returns nothing).
- ffmpeg.wasm core is **self-hosted**. `src/lib/audio-encoder.ts:74-85` imports `@ffmpeg/core?url` and `@ffmpeg/core/wasm?url` and passes both to `ffmpeg.load()`. The built output serves `.vercel/output/static/assets/ffmpeg-core-CgUfceKH.wasm` (32,232,419 bytes) from the app's own origin. The worker still contains the library's default `https://unpkg.com/@ffmpeg/core@0.12.9/...` string, but that branch runs only when no `coreURL` is supplied (`n||=e`), and one is always supplied. No unpkg fetch happens (SUP-12).

### Sensitive-path dependency maintainers (npm)

| Package | Installed / latest | npm maintainers | Provenance | Path |
|---|---|---|---|---|
| youtubei.js | 18.1.0 / 18.1.0 | 1 (luanrt) | SLSA v1 | InnerTube metadata, decipher, server |
| bgutils-js | 4.0.3 / 4.0.3 | 1 (luanrt, the same person) | SLSA v1 | BotGuard/PO-token minting, server |
| mediabunny | 1.59.0 / 1.59.0 | 1 (vanilagy) | SLSA v1 | client muxing |
| socks-proxy-agent | 8.0.5 / **10.1.0** | 2 | **none** | proxy transport, server |
| better-auth | 1.6.33 / 1.7.5 (`~1.6.30`) | 1 (bekacru) | SLSA v1 | auth |
| jose | 6.2.9 (exact) / 6.2.12 | — | SLSA v1 | JWT verification of `x-grok-identity` |
| @ffmpeg/core, @ffmpeg/ffmpeg | 0.12.10 / 0.12.15 | — | **none**, last publish 2025-04-07 | client encoder |
| pg | 8.23.0 | — | none | DB |

Bus factor: both reverse-engineering libraries the product depends on (youtubei.js, bgutils-js) are published by a single npm account. Neither has advisories and both carry provenance. This is a maintenance risk, not a defect. Keep lockfile pinning and the review step for bumps (see SUP-04 for where that review is skipped).

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| SUP-01 | P1 | Remote BotGuard JS fetched per mint and executed with `new Function` inside the Node server process (full `process.env` access), no host allowlist or hash | Both |
| SUP-02 | P1 | Third-party script `https://grok.com/grok-app-builder/extensions.js` injected into every HTML page, no SRI, no CSP | Both |
| SUP-03 | P1 | Guest requests trigger an unpinned, ungated `pip install PySocks` / `curl_cffi` on the live server | Both |
| SUP-04 | P1 | In-app Tools updater runs `npm install <pkg>@latest --save` / `pip install --upgrade yt-dlp` on the live server: crosses majors, mutates manifests, runs install scripts, no verification or rollback | Both |
| SUP-05 | P1 | Egress routing chosen by a mutable third-party list (`proxifly/free-proxy-list@main` via jsDelivr), no pin, signature or allowlist | Website launch |
| SUP-06 | P1 | Browser extension sends the user's full Google cookie jar to any tab on third-party multi-tenant domains (`*.grok.me`, `*.grok.com`, `*.grok-sandbox.com`) whose title starts with "Velo" | Both |
| SUP-07 | P2 | yt-dlp and every non-npm runtime component is untracked and unpinned; yt-dlp is told to download remote JS (`--remote-components ejs:github`) and run it under unsandboxed Node | Both |
| SUP-08 | P2 | GitHub Actions: tag-pinned third-party actions, write-scoped token reachable by freshly updated package code, PRs with no CI | OSS release |
| SUP-09 | P2 | Pre-release server runtime (exact-pinned `nitro 3.0.260610-beta`, h3 v2 RC bundled into the function) plus an undocumented `nf3` override that blocks Nitro upgrades | Both |
| SUP-10 | P3 | 30+ unused direct dependencies (template leftovers), incl. `react-scan`, which pulls ~38 packages with non-OSI licenses and an agent-config installer | OSS release |
| SUP-11 | P3 | Outdated, deprecated and unexplained exact pins (eslint 9 EOL, socks-proxy-agent 2 majors behind, jose 3 patches behind on the auth path) | Neither |
| SUP-12 | P3 | `@ffmpeg/core` is stale (FFmpeg 5.1 era, no provenance, 17 months since publish) and decodes untrusted media in the browser | Neither |
| SUP-13 | P3 | Reproducibility gaps: no `engines` or `.nvmrc`, root has no version (breaks `npm sbom`), hand-built committed extension zip, extraneous packages | OSS release |
| SUP-14 | P3 | UI sends users to third-party cookie-export extensions that get full access to their Google session | Website launch |

---

### SUP-01 — Remote BotGuard interpreter executed in the Node server realm with full privileges
- **Severity:** P1
- **Category:** Runtime-downloaded code / remote code execution surface
- **Blocks:** Both
- **Affected files:** src/lib/po-token.server.ts:160-167, 189-203, 231-248; callers src/lib/resolve-video.ts, youtube-client.server.ts, youtube-stream.server.ts, ytdlp.server.ts, ytdlp-meta.server.ts
- **Description:** Each minter (re)creation fetches `https://www.youtube.com/`, extracts `ytAtN` → `bgChallenge.interpreterUrl`, downloads `https:${interpreterUrl}`, and runs it with `new Function(...)`. Nothing checks the host, path, hash or size. `new Function` compiles in the Node main realm. The parameters named `window`, `self` and `globalThis` only shadow those identifiers, so the script can still reach Node's real `process`, `process.env` (DATABASE_URL, BETTER_AUTH_SECRET, VELO_VAULT_KEY, the proxy creds) and, through `process`, native capabilities. jsdom only supplies DOM stubs; it is not a sandbox here. While the code runs, the fake window is bound onto `globalThis` for the whole mint (comment at lines 79-90 admits other requests can observe it).
- **Evidence:**
  ```ts
  // po-token.server.ts:195-201
  const interpreterUrl = challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const script = await (await fetch(`https:${interpreterUrl}`, { signal: … })).text();
  // :232-242
  const vm = new Function("window","self","globalThis","document","location","navigator","yt", script);
  vm(window, window, window, window.document, …);
  ```
  Realm proof:
  `node --input-type=module -e 'const f=new Function("window","self","globalThis","document","return [typeof process, typeof process.env, Object.keys(process.env).length>0, typeof (Function(\"return this\")()).process]");console.log(f({}, {}, {}, {}))'` → `[ 'object', 'object', true, 'object' ]`.
  `grep -rn "interpreterUrl" src` → only lines 17, 195-198. There is no allowlist.
- **Real-world consequence:** The server runs, at full privilege, obfuscated code chosen per request by a third party (Google's anti-bot team, whose code exists to detect and fingerprint automation). Anyone who can influence that response (a compromised Google CDN path, a TLS-intercepting egress in some self-hosted deployments, or a future change where this fetch runs through a SOCKS hop) gets RCE with every server secret. Guest traffic can trigger it at will.
- **Recommended fix:** Run BotGuard in an isolated context: a `worker_threads` Worker with `resourceLimits`, no `env`, no `process` access, or `isolated-vm`, or a separate low-privilege process with an empty environment. Allowlist the interpreter host (`www.google.com`, path `/js/th/`), and reject protocol-relative URLs pointing anywhere else. Cap the script size. Better still, move minting to the client or behind a feature flag that is off for the public site.
- **Verification procedure:** Unit-test that a stubbed `ytAtN` with `interpreterUrl: "//evil.example/x.js"` is rejected. Then, in the isolated runner, evaluate `typeof process` from the interpreter and assert `"undefined"`, and assert `process.env` keys are not reachable.
- **Status:** CONFIRMED (code path and realm behaviour). Live exploitation NOT VERIFIED (no traffic sent).

### SUP-02 — Unpinned third-party script injected into every page
- **Severity:** P1
- **Category:** Third-party client-side code / missing SRI and CSP
- **Blocks:** Both
- **Affected files:** scripts/grok-pwa-shared.mjs:203, 231-243, 454-455; server/middleware/grok-pwa.ts; scripts/grok-pwa-plugin.mjs; build output `.vercel/output/functions/__server.func/index.mjs`
- **Description:** The Grok App Builder chrome injects `<script src="https://grok.com/grok-app-builder/extensions.js" defer>` into every HTML document, in dev and in the Vercel build. There is no `integrity`, no `crossorigin` and no Content-Security-Policy (the only CSP in the repo is `sandbox` on `/api/relay`, src/routes/api/relay.ts:26). The script runs in Velo's origin, the same origin that holds the session vault UI, the Better Auth session, and the `window.postMessage` channel over which the extension delivers the user's YouTube cookie jar (extensions/velo-session/content.js:3-11 posts to `window.location.origin`, so any same-origin script can listen).
- **Evidence:** `grep -n "GROK_EXTENSIONS_SCRIPT_SRC\|integrity" scripts/grok-pwa-*.mjs` shows the constant at line 203 and no integrity attribute. `grep -o 'grok.com/grok-app-builder/extensions.js' .vercel/output/functions/__server.func/index.mjs` matches, so it ships. AGENTS.md "Hard rules for the shell" #2 forbids removing it or adding a CSP that blocks grok.com.
- **Real-world consequence:** xAI, or anyone who compromises that URL or grok.com's CDN, can read cookies pasted into the vault, capture the extension's cookie `postMessage`, act as the signed-in user, or change downloads, for every Velo visitor, with no code change in this repo. For an OSS release, every self-hoster inherits the same dependency on a script they don't control.
- **Recommended fix:** For the public/OSS build, remove the Grok injector (`grokPwaPlugin()`, `server/middleware/grok-pwa.ts`, `public/__grok/`). If it has to stay, load it only on the Grok preview host, set a strict CSP (`script-src 'self'` plus hashes) and pin it with SRI, which needs a versioned URL from xAI. Whatever happens, move the cookie hand-off off `window.postMessage` to a `chrome.runtime` external messaging channel (`externally_connectable`).
- **Verification procedure:** `curl -s <deployed>/ | grep -c grok-app-builder` returns 0, and response headers include a CSP with no third-party script origins.
- **Status:** CONFIRMED

### SUP-03 — Request-triggered, unpinned `pip install` on the live server
- **Severity:** P1
- **Category:** Runtime package installation
- **Blocks:** Both
- **Affected files:** src/lib/ytdlp-python.server.ts:108-145 (`optionalModule`, `ensurePySocks`, `ensureImpersonate`); callers src/lib/ytdlp.server.ts:256, src/lib/ytdlp-meta.server.ts:76-77
- **Description:** On the first yt-dlp run in a process (guest downloads, metadata and subtitle fetches included), the server checks for `import socks` / `import curl_cffi`. If either is missing it runs `python -m pip install --quiet PySocks` / `curl_cffi`: no version pin, no `--require-hashes`, no index pinning, no operator gate. After a failure it retries after a cooldown.
- **Evidence:**
  ```ts
  // ytdlp-python.server.ts:116-120
  const check = await run(bin, ["-c", `import ${module}`], 8_000)...
  if (check.code === 0) return true;
  const install = await run(bin, ["-m", "pip", "install", "--quiet", pipName], 90_000)...
  export const ensurePySocks = optionalModule("socks", "PySocks");
  export const ensureImpersonate = optionalModule("curl_cffi", "curl_cffi");
  ```
- **Real-world consequence:** An anonymous visitor can make the production host download and run (via build/`setup.py` hooks and import) whatever PyPI serves under those names at that moment. A compromised or hijacked release becomes server RCE with no human involved. It also breaks immutability, so the SBOM and audits no longer describe what's running. On Vercel's read-only filesystem the install fails and retries forever (NOT VERIFIED on Vercel).
- **Recommended fix:** Delete the auto-install. Declare Python deps in a committed `requirements.txt` with exact versions and `--hash=` lines, install them at image/build time (`pip install --require-hashes -r requirements.txt`), and fail closed with a clear error if a module is missing.
- **Verification procedure:** `grep -rn '"pip", "install"' src` returns nothing outside an admin-only, build-time script. On a host without PySocks, trigger a guest download and confirm no pip process spawns (`ps`/procmon) and the log shows "PySocks missing".
- **Status:** CONFIRMED (code). Runtime trigger on a live host NOT VERIFIED.

### SUP-04 — In-app Tools updater mutates the live server's dependencies with no verification
- **Severity:** P1
- **Category:** Unverified runtime update channel
- **Blocks:** Both
- **Affected files:** src/lib/tool-updates.server.ts:135-163, 183-267; src/lib/tool-versions.ts:28-77; src/lib/tool-updates.ts:67-85 (server fns); gate in src/lib/operator-gate.server.ts (security audit covers the gate itself)
- **Description:** The Tools tab lets an "operator" update `youtubei.js`, `bgutils-js` and `yt-dlp` on the running server:
  - npm: `npm install <pkg>@latest --no-audit --no-fund --loglevel=error --save` in `process.cwd()`. It ignores the committed range (`^18.0.0` → whatever `latest` is, majors included), rewrites package.json and package-lock.json on the server, runs every lifecycle script of the new tree (no `--ignore-scripts`), and skips typecheck, tests and rollback.
  - pip: `python -m pip install --upgrade --no-input yt-dlp`, with no version, no hashes, and without the `[default,curl-cffi]` extras the CI updater uses. On PEP 668 hosts it retries with `--break-system-packages` (tool-updates.server.ts:202-205).
  `scripts/auto-update.mjs` shows the project knows how to do this safely (batch, verify, bisect, byte-exact rollback, skip exact pins). The live-server path uses none of that.
- **Evidence:** tool-versions.ts:64-77:
  ```ts
  return ["install", `${assertInstallPkg(pkg)}@latest`, "--no-audit", "--no-fund", "--loglevel=error", "--save"];
  return ["-m", "pip", "install", "--upgrade", "--no-input", assertInstallPkg(pkg)];
  ```
- **Real-world consequence:** One click, or one forged operator identity (see the security report on `operator-gate`, whose fallbacks include "socket IP when auth off"), installs and executes unreviewed code from two registries on production. A compromised youtubei.js/bgutils-js release (single-maintainer accounts, see table) goes straight to prod. A major bump can break the running server while it's serving, with no rollback. After that, production no longer matches git, so the lockfile, this SBOM and every audit are wrong.
- **Recommended fix:** Remove install capability from the web app. Keep a read-only "update available" badge. Updates go through the PR workflow (SUP-08) and a redeploy. If a live path is kept for self-hosters, make it a CLI that calls `scripts/auto-update.mjs` (verify + rollback), respect the committed ranges, pass `--ignore-scripts`, and pin pip with hashes.
- **Verification procedure:** `grep -rn "npmInstallArgs\|pipUpgradeArgs\|installTool" src` has no server-function caller. The Tools UI has no install button in a production build.
- **Status:** CONFIRMED

### SUP-05 — Egress proxies chosen by a mutable third-party list
- **Severity:** P1
- **Category:** Runtime-downloaded data controlling network trust
- **Blocks:** Website launch
- **Affected files:** src/lib/socks-pool.server.ts:19-20, 105-122, 150-171; consumers src/lib/ytdlp.server.ts:256-290, src/lib/ytdlp-meta.server.ts:37-51, src/lib/ytdlp-proc.server.ts:21
- **Description:** Every 8 minutes the server fetches `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.json`. That is a moving branch head of a third-party GitHub repo, with no commit pin, signature or allowlist. It then probes up to ~45 s worth of entries with `curl -x` and routes guest yt-dlp downloads, metadata and subtitle runs through anonymous public SOCKS5 hosts, with `socks5h`, so DNS goes through them too. Whoever can push to that repo (or poison jsDelivr's cache) decides which machines relay Velo's traffic, and can pack the list with attacker hosts that answer the `generate_204` probe. Proxy state persists in `os.tmpdir()` files (`velo-socks-good.json`, `velo-socks-dead.json`).
  The code comments say "Account cookies never go here", and ytdlp-auth.ts:531-538 skips cookies on non-trusted proxies, which is the right intent. What still crosses the hops: minted PO tokens and visitorData (`extractorArgs(... hasCookies ? null : opts.visitorData ...)`), video IDs, the host's request timing, and the fetched media. TLS to Google protects content only as long as certificate verification stays on (`grep` for `--no-check-certificate`/`rejectUnauthorized` found nothing, good).
- **Evidence:** file excerpt above. `LIST_URL` constant at socks-pool.server.ts:19-20. `takeSocks(1)` at ytdlp-meta.server.ts:44 and ytdlp.server.ts:260.
- **Real-world consequence:** Attacker-run relays see which videos Velo users fetch, can tamper with or throttle downloads, can harvest PO tokens, and put Velo's traffic in the same pool as abuse traffic. A supply-chain push to proxifly@main takes effect within 8 minutes with no deploy on Velo's side.
- **Recommended fix:** Remove the public free-proxy pool from the hosted product. Use only operator-configured, authenticated proxies (the `user-proxy` feature already exists). If a list is ever needed, pin it to a commit SHA, vendor it, and verify a hash.
- **Verification procedure:** `grep -rn "free-proxy-list\|jsdelivr" src` returns nothing. With `VELO_SOCKS_PROXY` unset, a guest download never spawns `curl -x socks5h://`.
- **Status:** CONFIRMED (code). The list's current contents NOT VERIFIED (not fetched, to keep network use low).

### SUP-06 — Extension delivers the Google cookie jar to tabs on third-party multi-tenant domains
- **Severity:** P1
- **Category:** Trust delegated to domains outside project control (extension supply chain)
- **Blocks:** Both
- **Affected files:** extensions/velo-session/manifest.json (host_permissions and content_scripts `*.grok.com`, `grok.me`, `*.grok.me`, `*.grok-sandbox.com`, localhost); extensions/velo-session/popup.js:25-52; extensions/velo-session/content.js:1-15; identical copies in public/extensions/velo-session/ and public/extensions/velo-session.zip; extension/manifest.json and extension/background.js:60-63, extension/content.js:90-93 (older extension, same domains)
- **Description:** "Send" extracts the YouTube/Google cookies, HttpOnly SID/SAPISID included. `sendToVelo` then messages **every** tab whose hostname passes `isVeloHost` and whose title is `"Velo"` or starts with `"Velo "`. The content script re-posts the Netscape cookie file to the page. `*.grok.me` and `*.grok.com` host other people's Grok-built apps (the repo's own tests use `my-app.grok.me`). Any app on those domains can title itself "Velo …" and receive the cookies.
- **Evidence:** popup.js:27-30 `if (!isVeloHost(host)) return false; const title = (tab.title || "").trim(); return title === "Velo" || title.startsWith("Velo ");`. content.js posts `{ type: "velo-youtube-cookies", netscape: message.netscape, … }` to `window.location.origin`. `cmp` of the source, public copy and zip: identical apart from CRLF line endings.
- **Real-world consequence:** Google account takeover (these cookies are full session credentials) for any Velo extension user who has a lookalike tab open when they click Send. The trust boundary sits with xAI's hosting tenants, not this project.
- **Recommended fix:** Pin the extension to the exact production origin(s). Use `externally_connectable` with that origin and have the page request the cookies through `chrome.runtime.sendMessage` with an origin check in the background worker. Drop the title heuristic and remove the `*.grok.*` wildcards from any published build.
- **Verification procedure:** Load the unpacked extension, open a page on another allowed host titled "Velo test", click Send, and confirm nothing arrives (listen for `message` events).
- **Status:** CONFIRMED (code). Not exercised end to end.

### SUP-07 — Non-npm runtime components untracked and unpinned; remote EJS solver executed under Node
- **Severity:** P2
- **Category:** Unpinned toolchain / runtime-downloaded code
- **Blocks:** Both
- **Affected files:** .github/workflows/auto-update.yml:39 (`pip install --user "yt-dlp[default,curl-cffi]"`); scripts/auto-update.mjs:262-352; src/lib/ytdlp-auth.ts:520-548 (`--js-runtimes node`, `--remote-components ejs:github`), :948 (tells users `pip install -U yt-dlp`); src/lib/fallback-path.ts:22 and ytdlp-auth.ts:832 (system `ffmpeg`); src/lib/socks-pool.server.ts:126 (system `curl`)
- **Description:** No `requirements.txt`, `pyproject.toml`, lock or hash file exists (`git ls-files | grep -iE "requirements|pyproject"` is empty). The yt-dlp version in production is whatever the host has. Locally that's `yt-dlp 2026.8.19` (`python -m pip show yt-dlp`), which pulls `mutagen 1.48.1` (GPL-2.0-or-later, see LIC-09) and `curl_cffi 0.15.0`. The CI job installs the latest yt-dlp, but its result is never recorded anywhere a deploy reads. `ffmpeg`, `curl` and `python3` are unversioned host binaries. yt-dlp is also invoked with `--remote-components ejs:github`, which lets it download the EJS challenge-solver JavaScript from GitHub at runtime, and with `--js-runtimes node`, so that JS runs in an unsandboxed Node (yt-dlp's docs recommend Deno, which is permission-sandboxed).
- **Evidence:** ytdlp-auth.ts:521-548 argv excerpt: `"--no-js-runtimes","--js-runtimes","node", … "--remote-components","ejs:github"`. The test at ytdlp-auth.test.ts:145 asserts it.
- **Real-world consequence:** Builds can't be reproduced, the SBOM can't be complete, and a malicious or buggy yt-dlp/EJS release reaches production silently. A remote EJS release runs with the Node user's filesystem and network rights.
- **Recommended fix:** Commit `requirements.txt` with exact versions and hashes for `yt-dlp`, `yt-dlp-ejs`, `curl_cffi`, `PySocks`, `mutagen`, etc. Install with `--require-hashes` at build time. Drop `--remote-components ejs:github` (the `yt-dlp-ejs` pip package from `[default]` bundles the solver) or pin it, and prefer `--js-runtimes deno` with Deno's permission flags. Record the ffmpeg/curl/python versions in the health endpoint and the SBOM.
- **Verification procedure:** `pip install --require-hashes -r requirements.txt` succeeds in a clean venv. yt-dlp argv no longer contains `ejs:github`. `/api/health` reports the tool versions.
- **Status:** CONFIRMED for the unpinned install and the flags. Whether yt-dlp verifies the integrity of `ejs:github` downloads is NOT VERIFIED.

### SUP-08 — CI workflow: tag-pinned actions, write token exposed to fresh dependency code, no CI on the result
- **Severity:** P2
- **Category:** CI/CD supply chain
- **Blocks:** OSS release
- **Affected files:** .github/workflows/auto-update.yml (entire file)
- **Description:**
  - Actions are pinned to mutable tags: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, and the third-party `peter-evans/create-pull-request@v6` (current major is v7).
  - `permissions: contents: write, pull-requests: write` applies to the whole job. `actions/checkout` persists the token in `.git/config` by default. The job then runs `npm update <names>`, whose lifecycle scripts come from the new, unreviewed versions, followed by `npm run test` and `npm run lint`, which execute that new code. All of it runs while the write token sits on disk.
  - It runs `pip install --user "yt-dlp[default,curl-cffi]"` unpinned (SUP-07).
  - PRs opened with the default `GITHUB_TOKEN` trigger no other workflows, and no other workflow exists anyway (no test or build CI). The PR body says "verified", but nothing in GitHub re-checks it, and there's no `npm audit`, `npm audit signatures`, or `npm run build` step.
- **Evidence:** `.github/workflows/auto-update.yml`: `permissions: contents: write / pull-requests: write` (job-wide), `- uses: actions/checkout@v4` (no `persist-credentials: false`), `- run: python3 -m pip install --user "yt-dlp[default,curl-cffi]"`, `- run: npm ci`, `- run: npm run update:deps`, `- uses: peter-evans/create-pull-request@v6`. `ls .github/workflows` → `auto-update.yml` only.
- **Real-world consequence:** A compromised dependency release could push to any branch, tamper with the PR it's riding in, or change workflows (if the token scope allows). An auto-PR could be merged with no independent CI.
- **Recommended fix:** Pin every action to a full commit SHA and bump v6 → v7. Set `persist-credentials: false` on checkout. Split the job: an unprivileged job (`permissions: contents: read`) runs update + verify and uploads the diff as an artifact, then a second job with write permission, which executes no package code, opens the PR. Add a normal CI workflow (install with `npm ci --ignore-scripts`, typecheck, test, lint, build, `npm audit signatures`) that runs on PRs, and use a GitHub App token for the auto-PR so CI triggers. Add `timeout-minutes` and `concurrency`.
- **Verification procedure:** `grep -E "uses: .*@[0-9a-f]{40}" .github/workflows/*.yml` matches every `uses:`. An auto-update PR shows the CI checks.
- **Status:** CONFIRMED

### SUP-09 — Pre-release server runtime and an undocumented nf3 override
- **Severity:** P2
- **Category:** Build tooling / pre-release dependencies
- **Blocks:** Both
- **Affected files:** package.json (`"nitro": "3.0.260610-beta"` in devDependencies, `"overrides": {"nf3": "0.3.17"}`), vite.config.ts (nitro plugin), scripts/auto-update-plan.mjs:18,133,189 (overrides never bumped)
- **Description:** The production server function is built by a Nitro beta pinned exactly to `3.0.260610-beta` (2026-06-10). The newer `3.0.260903-beta` exists. Its runtime pulls pre-release packages into the Vercel function: `.vercel/output/functions/__server.func/_libs/` contains `h3+rou3+srvx.mjs` and `h3-v2+rou3.mjs` (lock: `h3-v2 2.0.1-rc.20` prod, `h3 2.0.1-rc.22`, `unenv 2.0.0-rc.24`, `unstorage 2.0.0-alpha.7`, `ofetch 2.0.0-alpha.3`). `nf3` is Nitro's node-file-trace (it decides what gets copied into the function). It's forced to `0.3.17` (2026-05-07) against 0.3.24 latest. No rationale is recorded: `git log -S'"nf3"'` shows only the initial commit, and README/docs never mention it. `npm view nitro@3.0.260903-beta dependencies` requires `nf3 ^0.3.24`, so the override silently holds the tracer back on any Nitro bump.
- **Evidence:** `npm ls nf3` → `nitro@3.0.260610-beta └── nf3@0.3.17 overridden`. `npm view nitro dist-tags` → `{"latest":"3.0.260903-beta"}` (no stable 3.x).
- **Real-world consequence:** Framework-level security fixes land only in betas. The pin plus the override stop them from reaching you, and the updater skips both by design (`--pinned` is manual). Beta/RC HTTP stacks (h3 v2) have seen breaking changes and security fixes land in RC iterations.
- **Recommended fix:** Record why `nf3@0.3.17` is pinned (link the upstream issue) or remove the override. Move to the current Nitro beta, then to stable 3.0 once it ships. Until then, track nitro/h3 advisories by hand, and put the pin reasons in package.json comments or README.
- **Verification procedure:** `npm ls nf3` shows no `overridden`, or README documents the reason. `npm run build` then a smoke test pass.
- **Status:** CONFIRMED

### SUP-10 — Unused direct dependencies (template leftovers)
- **Severity:** P3
- **Category:** Dependency hygiene / attack surface
- **Blocks:** OSS release
- **Affected files:** package.json
- **Description:** No file under `src server scripts vite.config.ts eslint.config.mjs extension extensions` imports these: `@ffmpeg/util`, `@hookform/resolvers`, 20 `@radix-ui/*` packages (accordion, alert-dialog, avatar, checkbox, collapsible, dialog, dropdown-menu, label, popover, progress, radio-group, scroll-area, select, separator, slider, switch, tabs, toggle, toggle-group, tooltip), `@tanstack/react-table`, `date-fns`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `recharts` (deprecated 2.x), `vaul`, `eslint-plugin-prettier`, and `react-scan` (dev). `react-scan` alone brings ~38 lock entries (`react-doctor`, `deslop-js`, `oxlint-plugin-react-doctor`, `react-grab`, `@react-grab/cli`, two copies of `agent-install`, a tool that "Install[s] SKILL.md files, MCP servers, and AGENTS.md guidance for any coding agent"). It also brings the non-OSI "Modified MIT" license (LIC-07). (Tool-only packages such as typescript, prettier, @types/*, lightningcss and @tanstack/router-plugin are expected and excluded.)
- **Evidence:** the grep loop in Method. `grep -rn "radix\|recharts\|react-hook-form\|date-fns\|vaul" src` → only unrelated word matches. `npm ls agent-install` → under `react-scan`.
- **Real-world consequence:** More install-time code, more advisories to triage, a misleading dependency list for OSS users, and extra license obligations.
- **Recommended fix:** `npm uninstall` the list, then re-run typecheck, test and build.
- **Verification procedure:** Re-run the import-usage loop and get zero "UNUSED?" rows other than tool packages.
- **Status:** CONFIRMED (static grep. Dynamic string imports would be missed, but none were found).

### SUP-11 — Outdated, deprecated and unexplained pins
- **Severity:** P3
- **Category:** Maintenance
- **Blocks:** Neither
- **Affected files:** package.json, package-lock.json
- **Description:** From `npm outdated`:
  - `jose 6.2.9` is exact-pinned (latest 6.2.12). It's the JWT verifier for the `x-grok-identity` gate (src/lib/auth/gate-identity.server.ts:6) and better-auth dedupes onto it. The README (line 225) says "pinned deliberately" without saying why.
  - `socks-proxy-agent 8.0.5` → 10.1.0 (two majors behind, no provenance).
  - `better-auth 1.6.33` (`~1.6.30`) → 1.7.5.
  - `eslint 9.39.5` is marked deprecated ("no longer supported").
  - `recharts 2.15.4` is deprecated (and unused).
  - `lucide-react 0.510` → 1.47, `typescript 5.9` → 7.0, `@vitejs/plugin-react 5` → 6, `react-day-picker 9` → 10, `kysely 0.28` → 0.29.
  npm audit reports no known advisory for any of the installed versions.
- **Evidence:** npm outdated output (scratch `outdated.txt`). Lockfile `deprecated` fields.
- **Real-world consequence:** Low today. Security fixes for the auth path (jose, better-auth) need a manual action, because the updater skips exact pins.
- **Recommended fix:** Document each exact pin, or move `jose` to `^6.2.12`. Upgrade eslint to 10 and socks-proxy-agent to 10. Drop recharts.
- **Verification procedure:** `npm outdated` shows no deprecated rows. Pins are documented.
- **Status:** CONFIRMED

### SUP-12 — Stale ffmpeg.wasm core decoding untrusted media
- **Severity:** P3
- **Category:** Stale binary component
- **Blocks:** Neither
- **Affected files:** package.json (`@ffmpeg/core ^0.12.10`, `@ffmpeg/ffmpeg ^0.12.15`), src/lib/audio-encoder.ts:74-85, `.vercel/output/static/assets/ffmpeg-core-CgUfceKH.wasm`, `worker-A4ZT02e5.js`
- **Description:** `@ffmpeg/core@0.12.10` was last published 2025-04-07, with no npm provenance. The wasm embeds `Lavf59.27.100` (FFmpeg 5.1 series, 2022), per `grep -ao "Lavf[0-9.]*"`. It demuxes and decodes YouTube-served audio in the user's browser. The wasm sandbox contains memory-safety bugs, but decoder CVEs fixed in FFmpeg 6/7 aren't in this build. The worker keeps a dormant `https://unpkg.com/@ffmpeg/core@0.12.9/...` default, unused because `coreURL` is always passed (verified in the minified worker: `n||=e` only applies when `coreURL` is falsy).
- **Evidence:** `npm view @ffmpeg/core time.modified` → `2025-04-07T21:01:41.989Z`, provenance `NONE`. Wasm strings above.
- **Real-world consequence:** Limited. A malicious media file could crash or misbehave inside the wasm worker. The build also adds GPL obligations (LIC-02).
- **Recommended fix:** Build or choose a current, audio-only, LGPL ffmpeg.wasm (see LIC-02), self-host it, and record its hash. Or do the encoding with WebCodecs/mediabunny.
- **Verification procedure:** The wasm version string shows a current FFmpeg release. `grep -c unpkg` on the built worker returns 0 if the library allows overriding the default.
- **Status:** CONFIRMED

### SUP-13 — Reproducibility and SBOM gaps
- **Severity:** P3
- **Category:** Build reproducibility
- **Blocks:** OSS release
- **Affected files:** package.json (no `version`, no `engines`, name `app-builder-workspace`, `private: true`); no `.nvmrc`; public/extensions/velo-session.zip; local node_modules
- **Description:**
  - `npm sbom` fails on the real tree with `EINVALIDPURLTYPE … "app-builder-workspace@"` because the root has no version.
  - `npm sbom --omit dev --package-lock-only` silently dropped 124 non-dev lock entries, including react, react-dom, zod, @electric-sql/pglite and pg-types, so the prod SBOM had to be derived (see below).
  - No Node version contract: CI uses 22, this machine has 25.2.1, and `@napi-rs/wasm-runtime` declares `^20.19 || ^22.13 || >=23.5`.
  - `npm ls` reports 5 extraneous optional wasm packages (`@emnapi/*`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`). Harmless, and `npm ci` clears them.
  - The extension zip is a hand-built binary committed at fbf0867. Its contents match `extensions/velo-session/` apart from CRLF endings (verified with `unzip` + `diff` after `tr -d '\r'`), but no script builds it, so drift can't be detected.
- **Evidence:** command outputs in Method and the SBOM section.
- **Real-world consequence:** OSS users can't reproduce the deployed build, and SBOM tooling breaks.
- **Recommended fix:** Add `"version"`, `"name": "velo"`, `"license"` and `"engines": {"node": ">=22.13 <23 || >=24"}` (whatever you actually support), plus `.nvmrc`. Add a `scripts/build-extension-zip.mjs` and a CI check that the zip matches the source.
- **Verification procedure:** `npm sbom --sbom-format cyclonedx --omit dev` exits 0 on the real tree, and the component count matches the non-dev lock entries.
- **Status:** CONFIRMED

### SUP-14 — Users sent to third-party cookie-export extensions
- **Severity:** P3
- **Category:** User-side supply chain
- **Blocks:** Website launch
- **Affected files:** src/components/session-guide.tsx:36-42
- **Description:** The session guide links to "Get cookies.txt LOCALLY" and "Cookie-Editor" on the Chrome, Firefox and Edge stores. Those extensions can read every cookie in the user's profile, and extensions in this category have been hijacked or sold before (a differently named "Get cookies.txt" was pulled from the Chrome Web Store for exfiltration). Not verified against current store listings.
- **Evidence:** file lines as cited.
- **Real-world consequence:** If one of those extensions is compromised, Velo users who followed the guide lose their Google sessions, and the harm traces back to Velo's guidance.
- **Recommended fix:** Recommend only Velo's own reviewed extension, or none. At minimum, warn about the privilege level and link to the source repositories.
- **Verification procedure:** Copy review.
- **Status:** CONFIRMED (links present). Current state of the extensions NOT VERIFIED.

---

## SBOM

- `audit/sbom-full.cdx.json`: CycloneDX 1.5, 716 components (706 from the lockfile + 10 non-npm runtime components added by hand).
- `audit/sbom.cdx.json`: CycloneDX 1.5, 406 components (396 non-dev lockfile entries, optional platform binaries included, + the same 10 non-npm components).

How they were made: `npm sbom` fails on the real tree (SUP-13). package.json and package-lock.json were copied to a scratch directory named `velo`, with `version: "0.0.0-audit"` added, and `npm sbom --package-lock-only --sbom-format cyclonedx` was run there. The prod variant came out incomplete with `--omit dev`, so it was derived from the full SBOM by keeping components whose lock entry lacks `dev: true`, with dependency edges filtered to match. The appended non-npm components (yt-dlp, curl_cffi, PySocks, yt-dlp-ejs, system ffmpeg/curl/python3, the remote BotGuard script, the remote Grok extensions.js, and the proxifly list) carry the property `velo:audit:source`. Repo files were not modified.

## Not verified / out of scope

- Live behaviour against YouTube, Google's BotGuard endpoint, jsDelivr/proxifly and grok.com: none of it was fetched, to keep network use minimal. Code paths were confirmed statically.
- Whether the Vercel runtime has python3/yt-dlp/ffmpeg/curl at all, and how the runtime pip installs behave on its read-only filesystem (deployment audit).
- Integrity checking of yt-dlp `--remote-components ejs:github` downloads.
- Contents of the `yt-final` project that code was "ported from" (see LIC-08).
- The strength of `operator-gate` / auth gating for the Tools tab (security audit). This report covers only what the gated action does.
- Transitive Python dependency tree beyond `pip show` of yt-dlp, mutagen and curl_cffi on this machine.
