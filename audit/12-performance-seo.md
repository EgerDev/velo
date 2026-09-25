# 12 — Performance and SEO (prefix PERF-)

## Scope and method

**Origins.** All data comes from Velo only:
- The production build (`npm run build`, 2026-09-23, exit 0) served by `npm run preview` at **127.0.0.1:8081**.
- A Node harness that imports the Vercel function entry directly.
- Static analysis of `.vercel/output`.

Port 8080 (occupied by an unrelated project, `orca\cutout`) was never used.

**Tools.**
- **Lighthouse 12** (npm, in the scratchpad), run against Playwright's Chromium 153 (`chromium-1243`) with the mobile (simulated slow 4G, 4× CPU) and desktop presets.
- **Chrome JS/CSS coverage** via Playwright.
- **Transfer sizes:** Playwright response bodies, plus gzip/brotli recomputed with Node `zlib`.
- **Scaling tests:** a mocked 3-hour transcript and 500 to 5,000-URL bulk pastes, with server functions mocked or aborted.

No real YouTube requests were made for these tests. The only third-party loads were the page's own grok.com script and i.ytimg.com thumbnails.

**Caveat:** `vite preview` is not Vercel. Edge compression, TTFB and cold starts on Vercel are NOT VERIFIED.

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| PERF-01 | P2 | Mobile LCP 4.7 s / FCP 4.2 s (Lighthouse mobile perf 73); 32 modulepreloads (249 KB br) and render-blocking CSS on first paint | Website launch |
| PERF-02 | P2 | Bulk queue is not virtualized: 5,000 pasted URLs → 78k DOM nodes, 1.4 s main-thread stall, 61 MB heap | Both |
| PERF-03 | P3 | 70% of shipped JS is unexecuted on first load; dynamic imports defeated (INEFFECTIVE_DYNAMIC_IMPORT ×5) | Neither |
| PERF-04 | P3 | 31.5 MB ffmpeg-core.wasm (7.1 MB br) and 567 KB mediabunny chunk ship as static assets; cost on first audio encode not surfaced to users | Neither |
| PERF-05 | P3 | Server function is 34 MB: 8 MB jsdom plus 16 MB PGLite wasm/data bundled even when Postgres is configured; slow cold path (health 1.36 s cold) | Neither |
| PERF-06 | P3 | Unused heavy dependencies declared (recharts, react-day-picker, @tanstack/react-table, react-query, vaul, react-resizable-panels, date-fns, react-hook-form) | OSS release |
| PERF-07 | P2 | SEO/share metadata is minimal: title "Velo" on every route, no canonical, no og:description/og:image, `twitter:card=summary_large_image` with no image, no structured data | Website launch |
| PERF-08 | P3 | No robots.txt or sitemap.xml (both return the HTML 404 page) | Website launch |
| PERF-09 | P3 | Every page load fetches 4 YouTube thumbnails and a grok.com script (third-party requests and cookies before any user action) | Website launch |

What works (evidence in the findings):
- Hashed `/assets/*` are served `public, max-age=31536000, immutable`.
- Assets are served brotli-compressed by the preview.
- CLS is 0.015 to 0.017. TBT is 10 ms (mobile) and 0 ms (desktop).
- Fonts are self-hosted with `unicode-range` subsets, so only 7 latin woff2 files (137 KB) load on first view. Lighthouse `font-display-insight` passes.
- The transcript view is virtualized: 3,600 cues put 16 rows in the DOM, with 0 long tasks while rendering, scrolling or searching.
- The 404 route returns a real HTTP 404 (no soft 404).
- Lighthouse SEO is 100. It only checks basics, and this is not an indexing assessment.

---

### PERF-01 — Mobile LCP 4.7 s / FCP 4.2 s; heavy critical path
- **Severity:** P2
- **Category:** Core Web Vitals / loading
- **Blocks:** Website launch
- **Affected files:** `src/routes/__root.tsx:16-33`, the route chunk graph (`.vercel/output/static/assets/index-Dv2J--0o.js` 378 KB, `routes-BgVBDO4z.js` 220 KB, `styles-DCDItntN.css` 94 KB)
- **Description:** The SSR HTML emits 32 `<link rel="modulepreload">` entries plus one render-blocking stylesheet. Recomputed: 939 KB raw, 286 KB gzip, 249 KB brotli for the initial JS+CSS. The preloads include feature code the first view never runs: `audio-encoder`, `builder-download`, `hybrid-download`, `nle-export`, `tool-updates`, `cookie-store`.
- **Evidence:**
  - Lighthouse mobile: `performance=73`, FCP 4.2 s, LCP 4.7 s, Speed Index 4.3 s, TTI 4.7 s, TBT 10 ms, CLS 0.017, total bytes 445 KiB. `render-blocking-insight: Est savings of 900 ms` (styles-DCDItntN.css). `unused-javascript: 89 KiB` (index 49.7 KB wasted / 48.9%, routes 41.3 KB / 76.6%).
  - Desktop: `performance=98`, LCP 1.0 s.
  - Local Playwright loads (no throttling): networkidle in 1.1 to 1.6 s across Chromium, Firefox and WebKit.
- **Real-world consequence:** On mid-range phones over mobile networks, the hero and input appear after roughly 4 to 5 s, which is "needs improvement" to "poor" on the LCP threshold (2.5 s). That hurts conversion and search ranking signals.
- **Recommended fix:**
  - Lazy-load the tabs other than Single (Bulk, Transcript, Channels, Tools) and the header panels with `React.lazy`.
  - Stop static imports of the modules listed in PERF-03, so they drop out of the preload set.
  - Inline critical CSS, or split the Tailwind output per route.
- **Verification procedure:** Rerun Lighthouse mobile against the preview. Target LCP < 2.5 s and fewer than 12 modulepreloads.
- **Status:** CONFIRMED (Lighthouse simulated). Field data NOT VERIFIED.

### PERF-02 — Bulk queue is not virtualized
- **Severity:** P2
- **Category:** Runtime performance / memory
- **Blocks:** Both
- **Affected files:** `src/components/bulk-downloader.tsx:90`, `src/components/bulk-queue-item.tsx`, `src/components/bulk-view.tsx`. A virtualizer exists (`src/components/virtual-rows.tsx`, used by transcripts) but the queue does not use it.
- **Description / Evidence:** Chromium at 1366×900, with server functions aborted, after pasting N URLs and clicking "Add to Queue":
  ```
  {"N":500, "addMs":233, "nodes":8027, "heapMB":13}
  {"N":1000,"addMs":374, "nodes":15803,"heapMB":17}
  {"N":2000,"addMs":577, "nodes":31355,"heapMB":28}
  {"N":5000,"addMs":1434,"nodes":78027,"heapMB":61}
  ```
  DOM grows linearly at about 15.6 nodes per queued item. For comparison, the 3-hour transcript (3,600 cues) kept 521 total nodes.
- **Real-world consequence:** Large playlists or pastes freeze the tab for more than a second on desktop, and far longer on phones. Progress updates across thousands of rows compound the cost.
- **Recommended fix:** Render the queue through `virtual-rows.tsx`, and cap the queue size (UX-12).
- **Verification procedure:** Rerun `bulk2.mjs 5000` (scratchpad). Target < 1,500 nodes and < 200 ms.
- **Status:** CONFIRMED

### PERF-03 — 70% of shipped JS is unexecuted on first load; dynamic imports defeated
- **Severity:** P3
- **Category:** Bundle efficiency
- **Blocks:** Neither
- **Affected files:** `src/components/audio-studio.tsx`, `src/components/save-stage.tsx`, `src/components/app-header.tsx`, `src/components/cookie-import.tsx`, `src/lib/download-client.ts`, `src/lib/user-proxy.server.ts`
- **Description / Evidence:**
  - Coverage on first load: `JS executed-bytes coverage: 261KB used of 859KB (30%)`, `CSS coverage: 64KB used of 91KB (70%)`.
  - The build warns five times with `[INEFFECTIVE_DYNAMIC_IMPORT]`. Example: "src/lib/hybrid-download.ts is dynamically imported by … audio-studio.tsx, download-client.ts but also statically imported by save-stage.tsx, dynamic import will not move module into another chunk". The same applies to `audio-encoder.ts`, `builder-download.ts`, `cookie-store.ts` and `user-proxy-compatibility.server.ts`.
  - The build also emits `Some chunks are larger than 500 kB` (mux-client 567 KB).
- **Real-world consequence:** Parse and compile cost plus bandwidth for code most visitors never run.
- **Recommended fix:** Change the static imports to type-only imports, or move them behind the dynamic boundary. Treat the Vite warnings as errors in CI.
- **Verification procedure:** `npm run build` prints no INEFFECTIVE_DYNAMIC_IMPORT warnings, and first-load coverage is above 50%.
- **Status:** CONFIRMED

### PERF-04 — 31.5 MB ffmpeg-core.wasm and 567 KB mediabunny chunk
- **Severity:** P3
- **Category:** Heavy on-demand assets
- **Blocks:** Neither
- **Affected files:** `src/lib/audio-encoder.ts:74-85` (`@ffmpeg/core?url`, `@ffmpeg/core/wasm?url`), `mux-client-8t42H2Pm.js`
- **Description / Evidence:**
  - `ffmpeg-core-CgUfceKH.wasm`: 32,232 KB raw, 10,046 KB gzip, 7,110 KB brotli.
  - `mux-client`: 554 KB raw, 112 KB brotli.
  - Neither is in the initial modulepreload set, so both are lazy (good).
  - The single-threaded ffmpeg core means COOP/COEP are not required.
  - The wasm is also emitted into the SSR build output (`node_modules/.nitro/vite/services/ssr/assets/ffmpeg-core-*.wasm`, 32 MB). That output is not deployed.
- **Real-world consequence:** The first audio encode downloads about 7 to 10 MB. On mobile data that is slow and costly. I did not verify whether the UI warns about it.
- **Recommended fix:** Show a download-size notice and progress for the ffmpeg load. Check the cached reuse (immutable cache is set). Consider WebCodecs or mediabunny-only paths where possible.
- **Verification procedure:** Trigger an audio encode with throttling and confirm a progress/size indicator.
- **Status:** CONFIRMED (sizes, laziness). UI behaviour NOT VERIFIED.

### PERF-05 — 34 MB server function with jsdom and PGLite bundled; slow cold path
- **Severity:** P3
- **Category:** Serverless cold start
- **Blocks:** Neither
- **Affected files:** `vite.config.ts:57-83` (`pgliteAssetsPlugin` copies `pglite.wasm` and `pglite.data` into the function unconditionally), `vite.config.ts:189-191` (`ssr.external`)
- **Description / Evidence:**
  - `du -sh .vercel/output/functions` → 34M.
  - `_libs/jsdom.mjs` 8.2 MB, `_libs/pglite.wasm` 10.1 MB, `_libs/pglite.data` 6.3 MB, `_libs/mediabunny.mjs` 1.1 MB.
  - The pglite files carry the timestamp `Sep 22 20:29`, a day earlier than this build. The plugin copies them into a stale output directory and never cleans them.
  - Harness cold call: `/api/health -> 200 … "database":{"source":"pglite","ok":true,"latencyMs":1359}`.
  - The build log warns "Ensure your production environment matches the builder OS and architecture (win32-x64)".
- **Real-world consequence:**
  - Larger bundles mean slower cold starts.
  - Without `DATABASE_URL`, each serverless instance boots its own empty in-memory PGLite, so auth and vault state is per-instance (the brief's lead).
  - Building on Windows for Linux Lambdas risks native-module mismatch.
- **Recommended fix:**
  - Copy the PGLite assets only when `DATABASE_URL` is absent at build time, and fail the build for production without Postgres.
  - Lazy-import jsdom only where it is needed.
  - Build in Linux CI.
- **Verification procedure:** Build with `DATABASE_URL` set and confirm that `_libs/pglite.*` is absent and the function is under 15 MB.
- **Status:** CONFIRMED (sizes, cold latency locally). Vercel cold start NOT VERIFIED.

### PERF-06 — Unused heavy dependencies declared
- **Severity:** P3
- **Category:** Dependency hygiene
- **Blocks:** OSS release
- **Affected files:** `package.json` dependencies
- **Description / Evidence:** A grep for imports in `src server scripts` (excluding tests) found 0 importing files for each of: `recharts`, `react-day-picker`, `@tanstack/react-table`, `@tanstack/react-query`, `vaul`, `react-resizable-panels`, `date-fns`, `react-hook-form`, `@hookform/resolvers`. None of them appear in the client bundle, so tree-shaking works. They still add install time, audit surface and supply-chain exposure for every contributor.
- **Real-world consequence:** Slower installs, more CVE noise, more attack surface. There is no runtime cost.
- **Recommended fix:** `npm uninstall` them. Run `knip` or `depcheck` in CI.
- **Verification procedure:** `npx depcheck` reports no unused dependencies.
- **Status:** CONFIRMED

### PERF-07 — SEO/share metadata is minimal
- **Severity:** P2
- **Category:** SEO / social sharing
- **Blocks:** Website launch
- **Affected files:** `src/routes/__root.tsx:16-26`, `src/lib/og/site.json` (only `{"title":"Velo","color":"0C0C0E"}`), `scripts/grok-pwa-shared.mjs:95-104,336-370` (`publicAppHost` returns `""` for IPs and `*.vercel.app`, so no `og:image` is emitted there)
- **Description / Evidence:**
  - The served `<head>` contains `twitter:card=summary_large_image`, `og:title=Velo`, `<title>Velo</title>` and a meta description.
  - It has no `og:description`, `og:image`, `og:url` or `rel=canonical`, and no JSON-LD.
  - `/login` and the 404 page also use the title "Velo".
  - Deep links (`/?v=…`, `?tab=`, `?q=`) have no canonical, so every lookup URL becomes separately indexable. Search-result pages built from arbitrary `q=` are thin or duplicate content.
  - Per AGENTS.md, the Grok PWA injector owns og tags, so fixes must go through `site.json` or `public/og.jpg`. Removing the injector may be preferable (WEB-03).
- **Real-world consequence:** Shared links show a large empty card. Search snippets are generic, and crawl budget is spent on parameter URLs.
- **Recommended fix:**
  - Add a description and custom card in `site.json`, or a public og image.
  - Set per-route `head()` titles and descriptions.
  - Add `<link rel="canonical" href="https://<domain>/">` to the root.
  - Add `noindex` for parameterised lookup states and for `/login`.
  - Optionally add `WebApplication` JSON-LD.
- **Verification procedure:** `curl -s https://<domain>/ | grep -E 'og:image|og:description|canonical'` shows all three, and a share-card debugger renders an image.
- **Status:** CONFIRMED (local host). The og:image behaviour on a `*.grok.me` or custom domain is NOT VERIFIED.

### PERF-08 — No robots.txt or sitemap.xml
- **Severity:** P3
- **Category:** SEO / crawl control
- **Blocks:** Website launch
- **Affected files:** `public/` (neither file exists)
- **Description / Evidence:** `GET /robots.txt` → `404 content-type: text/html` (the app's 404 page). `GET /sitemap.xml` → the same.
- **Real-world consequence:** There is no crawl control. `/api/*` download endpoints and `?v=` lookup URLs are open to crawlers, and bots crawling lookup URLs trigger server-side YouTube resolution and quota use.
- **Recommended fix:** Add `public/robots.txt` that disallows `/api/`, `/_serverFn/` and `/login`, and add a minimal sitemap.
- **Verification procedure:** `curl -i /robots.txt` → `200 text/plain`.
- **Status:** CONFIRMED

### PERF-09 — Third-party requests and cookies on every page load
- **Severity:** P3
- **Category:** Performance / privacy
- **Blocks:** Website launch
- **Affected files:** `src/components/sample-chips.tsx` (thumbnails from `https://i.ytimg.com/vi/<id>/default.jpg`), `scripts/grok-pwa-shared.mjs:231-243`
- **Description / Evidence:**
  - First-load request log: `GET https://grok.com/grok-app-builder/extensions.js` and 4× `GET https://i.ytimg.com/vi/…/default.jpg`.
  - Lighthouse third-parties: grok.com 9.2 KB, YouTube 14.4 KB, and the third-party cookie `__cf_bm`.
  - Lighthouse network tree: no preconnect hints.
- **Real-world consequence:** Every visitor's IP goes to Google and grok.com before any action, which may be relevant under consent rules (REQUIRES LEGAL REVIEW). There are also extra DNS and TLS round-trips on mobile.
- **Recommended fix:** Self-host or inline the four sample thumbnails, and gate or remove the grok.com script (WEB-03).
- **Verification procedure:** First-load network log shows only same-origin requests.
- **Status:** CONFIRMED

## Not verified / out of scope
- Vercel edge: HTML compression (`vite preview` served `/` with no `content-encoding`, so this is a preview artifact), real TTFB, cold-start time, regional latency.
- Warm `/api/health` latency on Vercel (cold local only: 1,359 ms).
- INP from real interactions. Proxies used: TBT 10 ms, and 0 long tasks during transcript scroll and search.
- Memory and CPU during real downloads, muxing and ffmpeg encoding (not exercised, to avoid YouTube traffic).
- PWA manifest content per host (`/__grok/manifest.webmanifest` returned 308 bytes; name derivation for non-grok.me hosts not inspected).
- Image optimisation beyond the thumbnails (the app has almost no first-party images; favicon is SVG).
