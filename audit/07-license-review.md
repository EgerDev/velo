# 07 — License review (prefix LIC-)

Auditor: `supply` · Date: 2026-09-23 · Target: working tree of `C:\Users\PC\orca\velo`.

> The auditor is not a lawyer. Every item is labelled either **TECHNICAL LICENSE COMPATIBILITY FINDING** (facts: what license text says, what ships where, what is missing) or **REQUIRES LEGAL REVIEW** (questions for counsel; no conclusion is offered).

## Scope and method

1. **Ownership map.** Git history (41 commits, authors `andres eger <andreseger@MacBookPro*.lan>` and `EgerDev <…@users.noreply.github.com>`, many commits co-authored with `Claude Fable 5 <noreply@anthropic.com>`) was cross-checked against file naming, the Grok App Builder contract (AGENTS.md), and grep for template markers (`grok`, `app-builder`) and attribution comments (`copyright|spdx|licensed under|adapted from|ported from|borrowed from|github.com/...`).
2. **Dependency licenses.** A Node script (scratchpad `supply/licenses.mjs`) walked every `package-lock.json` entry, read `node_modules/<pkg>/package.json` (`license` / `licenses`), and listed each package's LICENSE/COPYING/NOTICE files. The dev/prod flag comes from the lockfile. 614 of 717 lock entries are installed on this machine (the rest are optional platform binaries for other OSes).
3. **Binary inspection.** `grep -ao -- "--enable-[a-z0-9-]*"` on `node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm` for the FFmpeg configure line. Built output `.vercel/output/**` was checked for shipped assets and preserved license headers.
4. **Python.** `python -m pip show yt-dlp mutagen curl_cffi` on this machine.

### License counts (installed packages)

| Scope | Count by license |
|---|---|
| **prod** (351 installed, incl. optional platform binaries) | MIT 290 · ISC 24 · Apache-2.0 7 · BSD-3-Clause 7 · **MPL-2.0 5** · BlueOak-1.0.0 3 · **OFL-1.1 3** · MIT-0 2 · BSD-2-Clause 2 · (Apache-2.0 AND BSD-3-Clause) 1 · **GPL-2.0-or-later 1** · Python-2.0 1 · CC-BY-4.0 1 · Unlicense 1 · CC0-1.0 1 · 0BSD 1 · MIT AND ISC 1 |
| **dev** (263 installed) | MIT 203 · Apache-2.0 28 · ISC 14 · BSD-2-Clause 8 · BlueOak-1.0.0 3 · **"SEE LICENSE IN LICENSE" 3** · BSD-3-Clause 2 · **UNKNOWN 1** · (MIT OR CC0-1.0) 1 |

Every non-permissive, unknown or custom license:

| Scope | Package | License | Where it ends up |
|---|---|---|---|
| prod | `@ffmpeg/core@0.12.10` | **GPL-2.0-or-later** (package ships **no** LICENSE file) | Served to every browser as `static/assets/ffmpeg-core-*.wasm` → LIC-02 |
| prod | `mediabunny@1.59.0` | **MPL-2.0** | Client bundle `mux-client-*.js` and server `_libs/mediabunny.mjs` → LIC-05 |
| prod | `lightningcss@1.32.0 / 1.33.0` (+ `lightningcss-win32-x64-msvc` ×2) | MPL-2.0 | Build-time CSS tool only, not in output (listed in `dependencies` though) |
| prod | `@fontsource/ibm-plex-mono`, `ibm-plex-sans`, `instrument-serif` @5.3.0 | **OFL-1.1** | `.woff2` files in `static/assets/` → LIC-04 |
| prod (build-time) | `caniuse-lite` | CC-BY-4.0 | babel/browserslist, not shipped |
| prod (build-time) | `argparse@2.0.1` | Python-2.0 | js-yaml via eslint, not shipped |
| dev | `react-doctor`, `deslop-js`, `oxlint-plugin-react-doctor` @0.9.12 | **"Modified MIT" (non-OSI)**, Million Software, Inc. | dev-only via unused `react-scan` → LIC-07 |
| dev | `@react-grab/cli@0.2.0` | UNKNOWN in package.json (LICENSE file is MIT, Aiden Bai) | dev-only |
| python (runtime, host) | `yt-dlp 2026.8.19` | Unlicense | subprocess |
| python (runtime, host) | `mutagen 1.48.1` | **GPL-2.0-or-later** | pulled by `yt-dlp[default]`, subprocess → LIC-09 |
| python (runtime, host) | `curl_cffi 0.15.0` | MIT (bundles curl-impersonate/BoringSSL, not inspected) | subprocess |

No AGPL, SSPL, BUSL, EPL, CC-BY-SA, LGPL-only or UNLICENSED packages appear among the npm packages. Prod packages that ship no LICENSE file (license only in package.json): `@better-auth/utils`, `@bufbuild/protobuf`, `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/types`, `@ffmpeg/util`, `@napi-rs/wasm-runtime`, `@rolldown/binding-win32-x64-msvc`, `@tybys/wasm-util`, `pg-types`, `pgpass`, `react-remove-scroll-bar`, `saxes`, `victory-vendor`.

Key named libraries: youtubei.js MIT (© 2021 LuanRT) · bgutils-js MIT (© 2024 LuanRT) · jsdom MIT · lucide-react ISC · all Radix packages MIT · PGLite: package.json says Apache-2.0, and the README says "dual-licensed under Apache 2.0 and the PostgreSQL License, you can choose", with Postgres-source changes under the PostgreSQL License · jose MIT · better-auth MIT · undici MIT · socks-proxy-agent MIT · pg MIT · Tailwind MIT · TanStack MIT · React MIT · Vite/Rolldown MIT · Nitro MIT · yt-dlp Unlicense.

### What the project owns vs third-party (technical map, ownership NOT legally determined)

| Area | Evidence of origin |
|---|---|
| **Grok App Builder template (xAI, presumably)** | AGENTS.md (the Grok Build sandbox contract); package name `app-builder-workspace`; `scripts/grok-pwa-{plugin,shared}.mjs`, `scripts/install-page.html`, `server/middleware/grok-pwa.ts`, `server/virtual-grok-og-identity.d.ts`, `public/__grok/**` (incl. `logo-grok.svg`, the Grok-mark `icon-180.png`, `ob-ipad.png`, `ob-phone.png`); `scripts/{with-app-env,app-env-plugin,browser-smoke*,browser-guard,brand-check,check-auth-invariant,migrate,migration-plan,sign-out-plan,preview-thumbnail}.mjs`; `src/lib/auth/*` (incl. `preview.ts`, `popup.server.ts`), `src/lib/app-data/*`, `src/lib/db.ts`, `src/lib/preview-host-bridge.ts`, `src/lib/multiplayer/*`, `src/lib/og/site.json`, `src/routes/__root.tsx`, `vite.config.ts` plugins named `app-builder:*`. 38 source files mention grok/app-builder. Many have a single commit (the 209-file, 36,020-line initial commit 5a40709). |
| **Velo application code** | `src/lib/*` media, YouTube, proxy, transcript, bulk and vault modules, `src/components/*`, `src/routes/api/*`, `extension/`, `extensions/velo-session/`, `migrations/`. Authored by the "andres eger"/EgerDev identities, much of it co-authored with an AI model per commit trailers. |
| **"Ported" logic** | `src/lib/throttle-advisor.ts:4,23` ("borrowed from yt-final's speed-test", "mirrors yt-final's calibration"), `src/lib/audio-profiles.ts:2,141` ("browser-side counterpart to yt-final's"), commits d8f1dd2 and 72bced4. `yt-final` isn't in the repo. Windows "Recent" shortcuts `C:\Users\PC\Recent\yt-final.lnk` suggest it's a local project of this user (NOT VERIFIED). |
| **Upstream constants** | `src/lib/ytdlp-auth.ts:160` "InnerTube user agents from yt-dlp 2026.08.19 (`INNERTUBE_CLIENTS`)" (yt-dlp is Unlicense). |
| **Own brand assets** | `public/favicon.svg` (a hand-written 3-line chevron SVG). Extension icons are generated by `scripts/build-extension-icons.mjs` from `extension/icons/icon.svg`. |

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| LIC-01 | P1 | No LICENSE file. The README claims MIT, package.json has no `license` field, and nobody has determined who holds copyright | OSS release |
| LIC-02 | P1 | ffmpeg.wasm core is a **GPL** build (`--enable-gpl --enable-libx264 --enable-libx265`) served to every visitor with no license text and no source offer; the GPL parts go unused by the app | Both |
| LIC-03 | P1 | Grok App Builder template code and xAI brand assets (Grok logo, "Created with Grok" injector) come with no license grant in the repo | Both |
| LIC-04 | P2 | Third-party notices are missing from every distributed artifact (web bundle, fonts, extension zip). Build output strips all license headers | Both |
| LIC-05 | P3 | MPL-2.0 `mediabunny` in the client bundle: file-level copyleft, compatible if unmodified and noticed | Both |
| LIC-06 | P3 | OFL-1.1 fonts are fine to bundle, but the OFL text must travel with them | Both |
| LIC-07 | P3 | Dev-only "Modified MIT" (non-OSI) packages via unused `react-scan`, whose terms restrict AI-training use and hosted-service use | OSS release |
| LIC-08 | P2 | Provenance gaps: code "ported from yt-final" (unknown license), AI-co-authored commits, inconsistent author identities | OSS release |
| LIC-09 | P3 | yt-dlp `[default]` pulls GPL `mutagen`. It runs as a subprocess, but matters for any image or bundle that redistributes it | Neither |
| LIC-10 | P0 | Product-level legal exposure (YouTube ToS, anti-circumvention, downloader-hosting precedent, storage of third-party Google sessions, extension-store policy) has had no review | Both |
| LIC-11 | P2 | License recommendation and compatibility matrix (technical) | OSS release |

---

### LIC-01 — No LICENSE file; the stated MIT has no copyright holder and cannot cover everything
- **Severity:** P1
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING (+ REQUIRES LEGAL REVIEW for authorship)
- **Blocks:** OSS release
- **Affected files:** README.md:233-235 ("MIT License. Designed and built with modern web standards."); package.json (no `license`, `"private": true`, name `app-builder-workspace`); extension/manifest.json, extensions/velo-session/manifest.json (no license); repo root (no LICENSE/COPYING/NOTICE, per `git ls-files | grep -iE "LICENSE|NOTICE"` → empty)
- **Description:** Publishing without a LICENSE file means that, by default, nobody receives rights to the code. A README sentence without a copyright line or the license text is ambiguous. On top of that, the tree mixes (a) template code with no stated license (LIC-03), (b) a GPL binary (LIC-02), (c) AI-co-authored code (LIC-08). One "MIT" line can't cover all three.
- **Evidence:** as cited.
- **Real-world consequence:** Contributors and downstream users get no clear grant. Forks and redistributors could face claims later. Package registries and store listings will show "no license".
- **Recommended fix:** Once LIC-02/03/08 are resolved: add `LICENSE` (MIT text with `Copyright (c) 2026 <legal owner>`), set `"license": "MIT"` in package.json, rename the package, add `THIRD_PARTY_NOTICES.md` (LIC-04), and add SPDX headers (`// SPDX-License-Identifier: MIT`) to owned files. Mark template-derived files with their own terms, or remove them.
- **Verification procedure:** `test -f LICENSE && node -p "require('./package.json').license"` → `MIT`. A license scanner (e.g. `npx license-checker-rseidelsohn --summary`, or ScanCode on the repo) reports a declared project license.
- **Status:** CONFIRMED

### LIC-02 — GPL ffmpeg.wasm build distributed to browsers without GPL compliance
- **Severity:** P1
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING (redistribution obligations) + REQUIRES LEGAL REVIEW (effect on the app's own license)
- **Blocks:** Both
- **Affected files:** package.json (`@ffmpeg/core ^0.12.10`), src/lib/audio-encoder.ts:74-85, src/lib/audio-profiles.ts:46-120, `.vercel/output/static/assets/ffmpeg-core-CgUfceKH.wasm` (32,232,419 bytes)
- **Description:** `@ffmpeg/core` declares `"license": "GPL-2.0-or-later"` and ships no license file. The wasm's embedded configure line includes `--enable-gpl --enable-libx264 --enable-libx265 --enable-libass --enable-libfreetype --enable-libfribidi --enable-libmp3lame --enable-libopus --enable-libtheora --enable-libvorbis --enable-libvpx --enable-libwebp --enable-libzimg --enable-zlib` (also `x264 - core`, `x265 configuration` strings), so the binary as a whole is GPL. Velo serves this object code to every visitor who opens the Audio Studio, which is distribution in the GPL sense. That triggers GPLv2 §3: accompany it with the complete corresponding source (FFmpeg plus x264, x265 and the other libs, plus build scripts) or a written offer, and include the license text. The repo and site do neither. The app uses **only audio encoders**: `libmp3lame` (LGPL), native `aac`, `libopus` (BSD), native `flac`, `pcm_s24le`, and a `-c:v copy` for cover art. The GPL components (x264/x265, `--enable-gpl`) add nothing functional.
- **Evidence:** `node -p "require('./node_modules/@ffmpeg/core/package.json').license"` → `GPL-2.0-or-later`. `ls node_modules/@ffmpeg/core` → `dist package.json` (no LICENSE). The grep of configure flags is shown above. `grep -n '"-c:a"' src/lib/audio-profiles.ts` → libmp3lame, aac, libopus, flac, pcm_s24le, copy.
- **Real-world consequence:** Distributing GPL binaries without source or an offer is a license violation that ends the right to distribute (GPLv2 §4) until cured. Whether the MIT app code loaded alongside the wasm (separate worker, message-passing, dynamically fetched) forms a "work based on the Program" is a legal question. Also, x264/x265 are patent-encumbered codecs.
- **Recommended fix (technical):** Replace the core with an **LGPL, audio-only** ffmpeg.wasm build: no `--enable-gpl`, no x264/x265/libass/libvpx/libtheora/libwebp/zimg, keep lame/opus/vorbis and native aac/flac. Publish its build script and exact source tarball URLs and hashes. Ship `LICENSE.LGPL` and a source pointer next to the wasm. Keep it dynamically loaded and replaceable so LGPL relinking is satisfied. Alternatively, drop ffmpeg.wasm and use WebCodecs or mediabunny encoders plus a JS LAME port. Until then, if the GPL core stays, add the GPL text and a corresponding-source link and offer.
- **Verification procedure:** `grep -ao -- "--enable-gpl\|libx264\|libx265" <new wasm>` is empty. A notices page lists FFmpeg (LGPL-2.1-or-later) with a source link.
- **Status:** CONFIRMED (technical). Whether the app itself must be GPL is **REQUIRES LEGAL REVIEW**.

### LIC-03 — Grok App Builder template and xAI brand assets have no license grant
- **Severity:** P1
- **Category:** REQUIRES LEGAL REVIEW (copyright and trademark), with technical facts below
- **Blocks:** Both
- **Affected files:** AGENTS.md; scripts/grok-pwa-shared.mjs:203 (`https://grok.com/grok-app-builder/extensions.js`), 230-243 ("Platform 'Created with Grok' banner — injected into every HTML document"); scripts/grok-pwa-plugin.mjs; scripts/install-page.html; server/middleware/grok-pwa.ts; server/virtual-grok-og-identity.d.ts; public/__grok/icon-180.png (Grok sparkle mark, 180×180, viewed); public/__grok/install/assets/homescreen/logo-grok.svg, ob-ipad.png, ob-phone.png, glass-*.svg, plus.svg; src/lib/auth/preview.ts (xAI broker client, and a committed client secret, see security report); plus the template-origin files in the ownership table
- **Description:** The template's author (presumably xAI) grants nothing in the repo: no LICENSE, header or notice. `grep -i "licen[cs]e\|copyright"` over AGENTS.md and the grok-pwa files finds nothing. AGENTS.md sets rules for the platform branding ("Never strip it, hide the pill…", "Hiding 'Created with Grok'… are project settings"), which suggests the Grok App Builder terms of service control that code. The repo also redistributes the Grok logo and xAI UI screenshots.
- **Evidence:** file list above. `git log --format=%h -- public/__grok/icon-180.png AGENTS.md scripts/grok-pwa-shared.mjs` → only the initial commit 5a40709.
- **Real-world consequence:** Publishing this code under MIT could mean sublicensing code you have no right to sublicense. Redistributing xAI trademarks in a product that markets YouTube "bypass" could draw a trademark or ToS complaint, and could imply an endorsement that doesn't exist.
- **Recommended fix (technical):** For the OSS release and the independent website, remove or rewrite the template-specific parts: `public/__grok/`, the grok-pwa plugin and middleware, `install-page.html`, the xAI auth broker (`preview.ts`, `popup.server.ts`), AGENTS.md, `extensions.js` injection, `*.grok.*` extension host permissions. Rewrite the generic helpers (with-app-env, migrate, db, browser-smoke) from scratch, or keep them only after counsel confirms the template terms allow redistribution under MIT.
- **Questions for counsel:** Who owns code generated or scaffolded in Grok App Builder, and on what terms can it be redistributed? Can the "Created with Grok / Remix" pill be removed when self-hosting? Can the Grok logos be redistributed? The Remix feature suggests other users can clone the project; what does that mean for confidentiality and licensing of Velo's own code?
- **Verification procedure:** `grep -rIl -i "grok" --exclude-dir=node_modules --exclude-dir=audit .` returns only intentional references. `ls public/__grok` doesn't exist.
- **Status:** CONFIRMED (facts). Rights: REQUIRES LEGAL REVIEW.

### LIC-04 — No third-party notices in distributed artifacts
- **Severity:** P2
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** Both
- **Affected files:** `.vercel/output/static/**` (browser bundle), `.vercel/output/functions/__server.func/**`, public/extensions/velo-session.zip, the extension folders, the repo root (no NOTICE)
- **Description:** MIT, ISC and BSD require their copyright and permission notice in "all copies or substantial portions". Apache-2.0 requires the license and any NOTICE. OFL-1.1 requires the license to accompany the fonts. MPL-2.0 requires telling recipients how to get the source. The minified browser bundle keeps **no** license headers: `grep -l "@license\|Copyright" -r .vercel/output/static/assets` matches only the ffmpeg wasm, and 14 files in the server `_libs`. No `THIRD_PARTY_NOTICES`, `/licenses` route or `LICENSES/` folder exists. The extension zip contains only Velo files, so it's fine as long as it bundles no third-party code (verified: it bundles none).
- **Evidence:** as above. `find .vercel/output/static -iname "*licen*"` → empty.
- **Real-world consequence:** Technical non-compliance with the attribution terms of ~350 prod packages. It's easy to cure, but it's a release blocker for a clean OSS or commercial launch.
- **Recommended fix:** Generate `THIRD_PARTY_NOTICES.txt` at build time from the lockfile (e.g. `rollup-plugin-license`/`vite-plugin-license`, or `npx license-checker-rseidelsohn --production --customPath …`), including full texts for Apache-2.0, MPL-2.0, OFL-1.1 and GPL/LGPL. Serve it at `/licenses.txt`, link it from the footer, and include it in the repo and any release archive.
- **Verification procedure:** `curl <site>/licenses.txt` lists every prod package in the SBOM (`audit/sbom.cdx.json`) with its license text.
- **Status:** CONFIRMED

### LIC-05 — MPL-2.0 mediabunny in the web bundle
- **Severity:** P3
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** Both
- **Affected files:** src/lib/mux-client.ts (import), `.vercel/output/static/assets/mux-client-8t42H2Pm.js` (4 matches of `mediabunny|Vanilagy`), server `_libs/mediabunny.mjs`
- **Description:** MPL-2.0 is file-level copyleft. Distributing it (minified) in Executable Form requires (§3.2) making the Source Code Form of the MPL files available and informing recipients how to get it. Larger works may be under any license (§3.3), so MIT is compatible for Velo's own files. No patches to mediabunny were found (no `patches/` directory, no patch-package).
- **Evidence:** `node -p "require('./node_modules/mediabunny/package.json').license"` → `MPL-2.0`. `head -1 node_modules/mediabunny/LICENSE` → "Mozilla Public License Version 2.0".
- **Real-world consequence:** Minor. Covered by listing mediabunny with its source URL and version in the notices (LIC-04).
- **Recommended fix:** Include it in the notices with a link to the exact version's source (github.com/Vanilagy/mediabunny at v1.59.0). Don't modify its files without publishing the changes.
- **Verification procedure:** The notices file contains a mediabunny MPL-2.0 entry with a source URL.
- **Status:** CONFIRMED

### LIC-06 — OFL-1.1 fonts (IBM Plex Sans/Mono, Instrument Serif)
- **Severity:** P3
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** Both
- **Affected files:** package.json (`@fontsource/ibm-plex-mono`, `@fontsource/ibm-plex-sans`, `@fontsource/instrument-serif`), `.vercel/output/static/assets/ibm-plex-*.woff2` etc.
- **Description:** OFL-1.1 allows bundling and embedding with any software, including MIT or commercial, on these conditions: the fonts are not sold by themselves; the copyright notice and license are included (as a separate file or in font metadata); modified versions don't use a Reserved Font Name and stay OFL. Copyrights: "Copyright 2017/2019 IBM Corp.", "Copyright 2022 The Instrument Serif Project Authors". `grep "Reserved Font Name"` on the three LICENSE files finds only the definition clause, with no RFN declared in these copies. Fontsource's pre-subset woff2 files are redistributed unmodified.
- **Evidence:** `node_modules/@fontsource/*/LICENSE`.
- **Real-world consequence:** None beyond LIC-04 as long as the OFL text is included.
- **Recommended fix:** Put the three OFL texts in the notices (LIC-04).
- **Verification procedure:** The notices contain "SIL Open Font License, Version 1.1" three times with the copyright lines.
- **Status:** CONFIRMED

### LIC-07 — Non-OSI "Modified MIT" dev dependencies via unused react-scan
- **Severity:** P3
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** OSS release
- **Affected files:** package.json devDependencies `react-scan ^0.5.7` → `react-doctor@0.9.12`, `deslop-js@0.9.12`, `oxlint-plugin-react-doctor@0.9.12` (license field "SEE LICENSE IN LICENSE")
- **Description:** Their LICENSE is MIT plus: "the following uses require prior written permission … 1. Using the Software … as training, fine-tuning, or evaluation data, or as input to any automated pipeline for training or improving any machine learning model or AI system. 2. Selling the Software, or offering it … as a paid, hosted, or managed product or service … whose value derives entirely or substantially from the Software." These are dev-only and not in the shipped output. `react-scan` is imported nowhere (SUP-10).
- **Evidence:** `sed -n 15,40p node_modules/react-doctor/LICENSE`. `npm ls react-doctor` → under `react-scan@0.5.7`.
- **Real-world consequence:** A non-OSI dependency in an "MIT" project's dev toolchain complicates corporate adoption, and clause 1 arguably touches AI-assisted development workflows. It's also unnecessary.
- **Recommended fix:** `npm uninstall react-scan`.
- **Verification procedure:** `npm ls react-doctor` → empty.
- **Status:** CONFIRMED

### LIC-08 — Provenance: ported code, AI co-authorship, author identity
- **Severity:** P2
- **Category:** REQUIRES LEGAL REVIEW (ownership and copyrightability), technical facts below
- **Blocks:** OSS release
- **Affected files:** src/lib/throttle-advisor.ts:4,23; src/lib/audio-profiles.ts:2,141; commits d8f1dd2 ("control-anchored throttle diagnosis ported from yt-final's engine"), 72bced4 ("Ports yt-final's --audio-codec / --loudnorm"); commit trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` across most history; author emails `andreseger@MacBookPro.lan`, `@MacBookPro-69.lan`, `@MacBookPro-79.lan` (local hostnames) and `EgerDev <285544328+EgerDev@users.noreply.github.com>`
- **Description:** (a) "yt-final" isn't in the repo, and its license and ownership are unknown. The commit text says the logic and calibration were ported, not the code, but that is NOT VERIFIED. (b) Most commits credit an AI model as co-author, and how copyrightable AI-generated contributions are, and who owns them, varies by jurisdiction. (c) Several author identities with machine-local emails make it unclear which natural or legal person holds copyright. (d) `ytdlp-auth.ts:160` copies yt-dlp's `INNERTUBE_CLIENTS` user-agent constants. yt-dlp is Unlicense, so no attribution duty arises (technical).
- **Evidence:** grep and git log output as cited.
- **Real-world consequence:** An unclear chain of title weakens the MIT grant, and if yt-final carries a restrictive license, its terms could apply.
- **Recommended fix:** Confirm that yt-final is owned by the same person/entity (or get its license), and record that in a NOTICE. Decide on the copyright holder (person or company), normalize the git identity (`.mailmap`), and consider a DCO or CLA before accepting outside contributions.
- **Questions for counsel:** Ownership and copyrightability of AI-assisted code. Whether the yt-final-derived logic creates obligations.
- **Verification procedure:** A NOTICE records yt-final's provenance. `.mailmap` maps the identities.
- **Status:** CONFIRMED (facts). yt-final contents NOT VERIFIED.

### LIC-09 — GPL mutagen via yt-dlp[default]
- **Severity:** P3
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** Neither
- **Affected files:** .github/workflows/auto-update.yml:39, scripts/auto-update.mjs:322 (`yt-dlp[default,curl-cffi]`)
- **Description:** `pip show mutagen` → `License-Expression: GPL-2.0-or-later` (1.48.1), installed as a yt-dlp default extra. Velo runs yt-dlp as a separate Python process. It doesn't import or link mutagen and doesn't redistribute it today; it's installed on the host. It would matter if Velo ever ships a Docker image, desktop bundle or zip that includes the Python environment.
- **Evidence:** pip output shown in Method.
- **Real-world consequence:** None for the SaaS in its current form. It would trigger GPL obligations for bundled redistributions.
- **Recommended fix:** If a container image is published, include the GPL text and source pointers for mutagen (and check FFmpeg's system-package license).
- **Verification procedure:** The image's notices list mutagen.
- **Status:** CONFIRMED

### LIC-10 — Product-level legal questions (no conclusions offered)
- **Severity:** P0 (as a gating item: launching before counsel reviews these is the risk. This is not a legal finding.)
- **Category:** REQUIRES LEGAL REVIEW
- **Blocks:** Both
- **Affected files:** README.md:5 ("bypass rate limits"), :49 ("prevent … BotGuard burst triggers"), :59 ("Proof-of-Origin (PO Token): Automated WebPO token minting … to prevent bot-detection blocks"), :60 ("Throttling Bypass & nsig Deciphering"), :63-67 ("Session Credential Vault"); src/lib/po-token.server.ts (BotGuard execution and GenerateIT); src/lib/nsig.ts, stream-unlock.ts (signature/n deciphering); src/lib/cookies.ts:67 (SID/HSID/SSID/APISID/SAPISID/__Secure-*PSID); src/lib/vault.ts; src/routes/api/{bypass,unlock,relay,download}.ts; src/lib/socks-pool.server.ts; extension/ and extensions/velo-session/ (cookie extraction, "Download YouTube videos in 1080p/4K"); public/extensions/velo-session.zip
- **Questions for counsel:**
  1. **YouTube Terms of Service / API ToS.** Downloading, the "bypass" and anti-throttling features, and automated access through public proxies, looked at both for the operator of a public service and for its users. What exposure comes from marketing these features explicitly?
  2. **Anti-circumvention.** Whether PO-token/BotGuard minting, signature and `n`-parameter deciphering, and proxy rotation to evade blocks count as circumventing a "technological measure" under **17 U.S.C. §1201** (US) and **Art. 6 of the EU InfoSoc Directive 2001/29/EC** (and national implementations such as German UrhG §95a). Consider both the hosted service and publishing the source.
  3. **Precedent.** The October 2020 RIAA §1201 notice that got youtube-dl removed from GitHub (reinstated in November 2020 after an EFF response and GitHub's policy change), and later litigation against youtube-dl hosting in Germany (Sony/Warner/Universal v. Uberspace, LG Hamburg). The auditor has NOT VERIFIED the current status of that case. Does publishing this repo on GitHub carry a similar takedown risk, especially given the README's explicit "bypass" language and the test fixtures that name specific videos?
  4. **Hosting a public downloader.** Secondary or contributory liability for infringing downloads by users, DMCA §512 safe-harbor eligibility (designated agent, repeat-infringer policy), EU DSA obligations, and whether guest (unauthenticated) access changes any of it.
  5. **Storing third-party Google session cookies.** The server-side vault holds SID/SAPISID-class credentials, the extension extracts HttpOnly cookies, and cookies may be stored in plaintext when `VELO_VAULT_KEY` is unset (security report). Questions: GDPR/UK GDPR/CCPA (lawful basis, DPIA, data processor terms, breach notification), Google's Terms (account sharing, automated use), and computer-misuse law if a session is used beyond the user's consent.
  6. **Browser-extension distribution.** Chrome Web Store program policies on extensions that download from YouTube, and on cookie-harvesting permissions. Mozilla/Edge equivalents. Distributing the zip off-store from `public/extensions/`.
  7. **Grok App Builder terms** (see LIC-03), and **Google/YouTube trademarks** in product copy, the extension name "Velo YouTube Session", and the store listing.
  8. **Free public proxies.** Routing traffic through unknown third-party machines (SUP-05): user notice and consent, and liability for traffic attribution.
- **Evidence:** file references above. The feature set is described in the shared brief and the README.
- **Real-world consequence:** Not assessed (legal).
- **Recommended fix (process):** Get counsel review before launching the website and before making the repo public. Until then, keep the repository private, and consider removing the "bypass"/circumvention marketing language and features from any public build.
- **Verification procedure:** A written legal sign-off referenced in the release checklist.
- **Status:** NOT VERIFIED (legal questions, by design)

### LIC-11 — Recommended license and compatibility matrix
- **Severity:** P2
- **Category:** TECHNICAL LICENSE COMPATIBILITY FINDING
- **Blocks:** OSS release
- **Affected files:** repository root
- **Description:** Compatibility with an MIT license for Velo's own code:

| Component | License | Compatible with MIT project? | Condition |
|---|---|---|---|
| ~330 MIT/ISC/BSD/0BSD/MIT-0/BlueOak/Unlicense/CC0 prod packages | permissive | Yes | Keep notices (LIC-04) |
| Apache-2.0 (PGLite [or PostgreSQL License], @bufbuild/protobuf, …) | permissive + patent | Yes | Include license and NOTICE if present. PGLite may be taken under the PostgreSQL License instead |
| mediabunny, lightningcss | MPL-2.0 | Yes (file-level) | Source availability for MPL files (LIC-05). lightningcss is build-only |
| IBM Plex, Instrument Serif | OFL-1.1 | Yes | Include the OFL text (LIC-06) |
| @ffmpeg/core 0.12.10 | **GPL-2.0-or-later** | **Not as-is** for a permissive distribution | Replace with an LGPL audio-only build (LIC-02) or comply with the GPL. Effect on the app: legal review |
| yt-dlp (Unlicense), curl_cffi (MIT), PySocks (BSD) | permissive | Yes | Not redistributed |
| mutagen | GPL-2.0-or-later | Not relevant while it's only a subprocess on the host | LIC-09 |
| react-doctor et al. (dev) | Modified MIT, non-OSI | Not distributed | Remove (LIC-07) |
| Grok template code and assets | **unknown / none stated** | **Cannot determine** | LIC-03 |

- **Recommendation (technical):** MIT is technically workable for Velo-owned code once (1) the GPL ffmpeg core is swapped for an LGPL audio-only build, (2) template code and assets are removed or cleared, and (3) a notices file ships. If the owner wants patent-grant language for contributors, **Apache-2.0** is the usual alternative and is equally compatible with the dependency set. If the GPL core is kept deliberately, the conservative technical option is to license the whole distribution **GPL-2.0-or-later** (or GPL-3.0-or-later). Counsel should confirm whichever is chosen (REQUIRES LEGAL REVIEW).
- **Evidence:** the license counts and table above.
- **Real-world consequence:** See LIC-01/02/03.
- **Recommended fix:** Pick the license after LIC-02/03 are resolved, then implement LIC-01 and LIC-04.
- **Verification procedure:** A license scanner (ScanCode or `license-checker --production --failOn "GPL-2.0-or-later;GPL-3.0;AGPL-3.0"`) passes in CI.
- **Status:** CONFIRMED (technical analysis)

---

## Not verified / out of scope

- Legal conclusions of any kind (LIC-03, LIC-08, LIC-10 are questions for counsel).
- Contents and license of `yt-final`.
- The Grok App Builder / xAI terms of service text (not in the repo, not fetched).
- Licenses of native code inside `curl_cffi` wheels (curl-impersonate, BoringSSL), host `ffmpeg`, `curl` and `python3` builds.
- The 103 lockfile entries not installed on this machine (optional platform binaries). Their licenses were read from the lockfile `license` field only: 83 MIT, 20 MPL-2.0 (lightningcss platform binaries).
- Whether any image in `public/__grok/install/assets/homescreen/*.png` contains third-party (Apple device frame) artwork. Only `icon-180.png` was viewed.
- Status of the Uberspace litigation referenced in LIC-10.
