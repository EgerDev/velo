# 10 — Production web security (prefix WEB-)

## Scope and method

Auditor: "web". Target: the working tree on `main` (27 modified + 3 untracked files), built on 2026-09-23 with `npm run build` (exit 0, 7.5 s; log kept in the auditor scratchpad). I served the build with `npm run preview` (Nitro `vercel` preset through `vite preview` on 127.0.0.1:8081). For dev-only checks I ran `vite dev` on **127.0.0.1:8093**, not 8080: port 8080 was already held by an unrelated project (`C:\Users\PC\orca\cutout`, PID 5224) that the user had started before the audit, and I left it running.

Methods:
- curl header and path probes.
- Direct calls to the `/_serverFn/<id>` endpoints. I rebuilt the id map from `.vercel/output/functions/__server.func/_ssr/ssr.mjs`, and the request framing matches what the real client sends, captured with Playwright.
- A Node harness that imports the Vercel function entry (`__server.func/index.mjs`) and calls its `fetch()`.
- grep over `.vercel/output`.

No live Vercel deployment was found or tested. Anything below that depends on Vercel edge behaviour is marked NOT VERIFIED. I started no servers on shared ports, and I stopped all servers I started.

Real YouTube traffic: one unintended request. My CSRF probe body used the placeholder id `not-a-video`, which happens to be exactly 11 characters. It passed `parseVideoId`, so the server really ran yt-dlp against YouTube for a non-existent video id (see WEB-04).

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| WEB-01 | P1 | One malformed percent-encoded URL (`GET /%`) crashes the whole Node server process | Both |
| WEB-02 | P1 | No security response headers at all (no CSP, frame-ancestors/XFO, nosniff, Referrer-Policy, Permissions-Policy; HSTS left to platform) | Both |
| WEB-03 | P1 | A third-party script (grok.com) is injected into every page with no SRI or CSP, on the same origin where users paste Google session cookies | Both |
| WEB-04 | P1 | `/api/*` routes have no CSRF / Fetch-Metadata gate: a cross-site `text/plain` POST started yt-dlp on the server | Both |
| WEB-05 | P2 | Raw upstream errors go to anonymous callers (server file paths, toolchain, proxy failover ladder) | Both |
| WEB-06 | P2 | Page can be framed, and a `?v=…&auto=1` link auto-starts a download with no user gesture (clickjacking / drive-by quota burn) | Website launch |
| WEB-07 | P2 | README-documented `npm run dev` binds 0.0.0.0 and serves project source (including the committed OAuth secret) to the LAN | OSS release |
| WEB-08 | P2 | Guide coaches users to copy their YouTube/Google session cookies to the clipboard with a bookmarklet and paste them into the site | Both |
| WEB-09 | P1 | The committed preview OAuth client secret is baked into the deployable server bundle (confirms the brief's lead) | Both |
| WEB-10 | P3 | Server-function errors return HTTP 200 with the error in the body; zod validation errors echo the input schema | Neither |
| WEB-11 | P3 | `/api/health?deep=1` is unauthenticated, uncached and not rate-limited (DB round-trips on demand) | Neither |
| WEB-12 | P3 | Sign-in on a self-hosted / localhost origin fails with "not a trusted origin" and the UI names the auth library | OSS release |
| WEB-13 | P3 | No `security.txt`; unknown `/api/*` paths return an HTML 404 page instead of JSON | Neither |

Things checked and found OK (not findings):
- **Server functions:** Cross-site calls are rejected. `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site`, `Origin: null` and a same-site sibling all returned `403 Forbidden` (TanStack Start's built-in check, plus `assertSameSiteRequest` in the auth middleware). HTTP methods are enforced: GET→POST fn gives `405 expected POST method. Got GET`, and PUT/DELETE are also 405.
- **Privileged functions:** All 12 privileged functions I called anonymously returned `Unauthorized`: checkToolUpdates, listUserProxies, loadVault, listProxyOperations, listProxyHistoryPage, updateTool, saveVault, clearVault, addUserProxy, clearProxyHistory, isolateOwnSession, requestSignInLink. updateTool was called only with a nonexistent tool name.
- **Build output:** No `*.map` source maps anywhere in `.vercel/output`. The client bundle holds no secret values: `grep -r 8bcdb7… static` finds nothing, and the only `BETTER_AUTH_SECRET` string is better-auth's runtime `env` getter. No `VITE_*` values are inlined.
- **Header hygiene:** No `X-Powered-By` header. `/__app-env` and `/auth/popup` return 404 in the production build.
- **Caching:** `/assets/*` gets `cache-control: public, max-age=31536000, immutable` from `.vercel/output/config.json`.
- **Cookies:** In code, cookies use the `__Host-` prefix with `secure:true, sameSite:"lax", path:"/"` (`src/lib/auth/server.ts:227-240`). I did not see them set in practice, because sign-in could not complete locally (WEB-12).
- **CORS:** The app sets no CORS headers of its own. The `Access-Control-Allow-Origin` echo I saw on the preview happened only for `http://localhost:*` origins and came from `vite preview`'s default dev CORS. That is not production behaviour.

---

### WEB-01 — One malformed percent-encoded URL (`GET /%`) crashes the whole Node server process
- **Severity:** P1
- **Category:** Availability / input handling (DoS)
- **Blocks:** Both
- **Affected files:** `.vercel/output/functions/__server.func/_libs/h3+rou3+srvx.mjs:256` (bundled `h3` from `nitro 3.0.260610-beta`, `package.json` devDependency), `vite.config.ts:218-229` (Nitro plugin)
- **Description:** h3's `decodePathname` calls `decodeURI()` on the raw path. For an invalid escape (`%`, `%E0%A4%A`) this throws `URIError`, and nothing catches it. Under `vite preview` (the Nitro dev/preview server) the exception escapes and **the process exits**. Under the Vercel entry, the async `fetch()` handler rejects instead of returning a response.
- **Evidence:**
  - I sent `curl http://127.0.0.1:8081/%` as part of a path probe. Every later request returned curl code `000`, and the preview background task exited with code 1. The preview log ends with:
    ```
    URIError: URI malformed
        at decodeURI (<anonymous>)
        at decodePathname (…/__server.func/_libs/h3+rou3+srvx.mjs:256:9)
        at new H3Event (…/h3+rou3+srvx.mjs:274:50)
        at H3Core.fetch (…/h3+rou3+srvx.mjs:618:26)
        at Object.appHandler [as fetch] (…/__server.func/index.mjs:544:16)
    Node.js v25.2.1
    ```
  - Harness that imports the Vercel entry and calls `mod.default.fetch(new Request("http://127.0.0.1"+path))`:
    ```
    /% -> REJECTED URIError URI malformed
    /%E0%A4%A -> REJECTED URIError URI malformed
    /api/health -> 200 {"status":"ok",…}
    ```
- **Real-world consequence:** On any Node host (self-hosters, `vite preview`, a future node-server preset), a single anonymous request with no auth kills the server and every in-flight download. On Vercel, each such request becomes an invocation failure. Whether the instance gets recycled (and concurrent Fluid-compute requests die with it) is **NOT VERIFIED**.
- **Recommended fix:** Upgrade Nitro/h3 to a release that guards `decodeURI`, or add a first middleware or Vercel route that returns 400 for paths that fail `decodeURI`. Add a regression test for `/%`, `/%E0%A4%A` and `/%%`.
- **Verification procedure:** Run `npm run build && npm run preview`, then `curl -i http://127.0.0.1:8081/%`. Expect a 400/404 response and the server still up (`curl /api/health` → 200). Repeat with the harness above: expect a Response, not a rejection.
- **Status:** CONFIRMED (process crash on preview; handler rejection on the Vercel entry). Vercel runtime impact NOT VERIFIED.

### WEB-02 — No security response headers at all
- **Severity:** P1
- **Category:** Security headers / hardening
- **Blocks:** Both
- **Affected files:** `.vercel/output/config.json` (the only header rule is the asset cache-control), `server/middleware/grok-pwa.ts` (touches HTML responses but adds no security headers), `vite.config.ts`
- **Description:** HTML, API, static and error responses carry no `Content-Security-Policy`, no `frame-ancestors` / `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy` and no `Cross-Origin-Opener-Policy`. HSTS is not set by the app. Vercel adds HSTS on its domains by default, but I did not verify that without a live deployment. There is also no COOP/COEP. That is not a functional problem: the ffmpeg build in use is single-threaded `@ffmpeg/core` 0.12, which does not need SharedArrayBuffer.
- **Evidence:** `curl -D -` against `/`, `/api/health`, `/assets/styles-DCDItntN.css`, `/nope-404` and `/api/nope` returned only these headers: `Vary`, `content-type`, `cache-control` (health only), `Date`, `Connection`, `Keep-Alive`, `Transfer-Encoding`. `config.json` routes: `[{"headers":{"cache-control":"public, max-age=31536000, immutable"},"src":"/assets/(.*)"},{"handle":"filesystem"},{"src":"/(.*)","dest":"/__server"}]`.
- **Real-world consequence:** With no CSP, any XSS or compromised third-party script (WEB-03) has unrestricted access to the page. That includes cookie text users paste into the page (WEB-08) and the vault UI. With no frame-ancestors, the site can be framed anywhere (WEB-06). Without nosniff, user-influenced responses such as `/api/relay` passthroughs can be MIME-sniffed.
- **Recommended fix:** Add headers in Nitro `routeRules` or a server middleware. Start with a strict CSP and tighten it from there: `script-src 'self'`, `frame-ancestors` limited to the real embedders (the Grok preview origin, if embedding is kept), `connect-src 'self'`, and `img-src 'self' https://i.ytimg.com`. Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with unused features disabled, and explicit HSTS for custom domains.
- **Verification procedure:** `curl -sD - -o /dev/null https://<deploy>/` and `/api/health`. Confirm each header is present, then run a CSP evaluator on the policy.
- **Status:** CONFIRMED (locally, build output). Live Vercel headers NOT VERIFIED.

### WEB-03 — A third-party script (grok.com) is injected into every page with no SRI or CSP, on the same origin where users paste Google session cookies
- **Severity:** P1
- **Category:** Supply chain / third-party script / privacy
- **Blocks:** Both
- **Affected files:** `scripts/grok-pwa-shared.mjs:231-243` (`grokExtensionsHeadTags`), `server/middleware/grok-pwa.ts` (streams it into every HTML document), `scripts/grok-pwa-plugin.mjs`
- **Description:** Every HTML response gets `<script src="https://grok.com/grok-app-builder/extensions.js" defer></script>`, with no `integrity` attribute and no CSP. The script runs with full same-origin privileges. It also sets cookies: Firefox logged `Cookie "grok_device_id" has been rejected because it is in a cross-site context` from that script, and Lighthouse flagged the third-party cookie `__cf_bm` from `grok.com/grok-app-builder/extensions.js`. The user sees no notice and gives no consent. AGENTS.md forbids removing this script. For an OSS or independent launch, that rule is a policy decision to revisit, not a technical constraint.
- **Evidence:**
  - Homepage `<head>` from the preview ends with `<script src="https://grok.com/grok-app-builder/extensions.js" defer></script>`.
  - Playwright network log on first load: `GET https://grok.com/grok-app-builder/extensions.js`.
  - Lighthouse (mobile + desktop): `third-party-cookies: {"name":"__cf_bm","url":"https://grok.com/grok-app-builder/extensions.js"}` and `inspector-issues` for the same URL.
- **Real-world consequence:** Whoever controls or compromises that URL can read anything on the page. That includes YouTube/Google cookie text pasted into the cookie importer (held in memory in `src/lib/cookie-store.ts`), bearer tokens and vault contents, and it can call every same-origin server function as the user. Device-ID cookies set with no disclosure may also need consent under ePrivacy/GDPR (REQUIRES LEGAL REVIEW).
- **Recommended fix:** For the OSS / self-hosted build, remove the injector or put it behind an explicit opt-in env flag. If it is kept, pin a versioned URL with SRI, allow it by CSP hash or nonce, and disclose its cookies in a privacy notice.
- **Verification procedure:** `curl -s https://<deploy>/ | grep -c grok.com/grok-app-builder` → 0 (or the tag includes `integrity=`). Lighthouse shows no `third-parties` entity for grok.com.
- **Status:** CONFIRMED

### WEB-04 — `/api/*` routes have no CSRF / Fetch-Metadata gate: a cross-site `text/plain` POST started yt-dlp on the server
- **Severity:** P1
- **Category:** CSRF / abuse / trust boundary
- **Blocks:** Both
- **Affected files:** `src/routes/api/ytdlp.ts:16-58`, `src/routes/api/builder.ts:47-60`, `src/routes/api/unlock.ts:18-58`, `src/routes/api/download.ts`, `src/routes/api/relay.ts`, `src/routes/api/bypass.ts`; the gate that exists but is not applied here: `src/lib/auth/isolation.server.ts:34`
- **Description:** Server functions are protected (TanStack origin check plus `assertSameSiteRequest`). The file-route API handlers are not. They call `request.json()` whatever the `Content-Type` is, so a "simple" cross-site `fetch(…,{mode:'no-cors',method:'POST',body:'{…}'})` or an HTML form needs no preflight. Download quota is keyed by bearer token or client IP, so an attacker page can make each visitor's browser burn that visitor's IP quota. It can also make the server run expensive yt-dlp / decipher / BotGuard work attributed to the visitor.
- **Evidence:**
  - Request: `curl -X POST http://127.0.0.1:8081/api/ytdlp -H "Origin: https://evil.example" -H "Sec-Fetch-Site: cross-site" -H "Sec-Fetch-Mode: no-cors" -H "Content-Type: text/plain;charset=UTF-8" --data '{"id":"not-a-video","itag":18}'`
  - Result: the handler ran. The preview (`vite.js preview`, PID 66416) spawned `python3 -m yt_dlp … --proxy socks5h://144.91.121.61:1088 … --remote-components ejs:github … -f 18 … https://www.youtube.com/watch?v=not-a-video`. The response came back as `502` with the verbose body quoted in WEB-05.
  - The spawned command line also shows that downloads are routed through an anonymous public SOCKS proxy. That independently confirms the brief's socks-pool lead. It also shows `--remote-components ejs:github`, meaning yt-dlp fetches challenge-solver code from GitHub at runtime (`src/lib/ytdlp-auth.ts:546`); other auditors own that.
- **Real-world consequence:** Any website a user visits can silently drive Velo downloads from that user's browser and IP. That exhausts their quota and gets their IP into YouTube abuse signals. For the operator, it is free amplification of server CPU and egress, and third-party load that looks like it comes from many real users.
- **Recommended fix:** Call the same Fetch-Metadata check (`Sec-Fetch-Site` ∈ {same-origin, none, absent}) at the top of every `/api/*` handler, or in one Nitro middleware scoped to `/api/`. Require `Content-Type: application/json` on POST, and reject `Origin` values outside the app's origin.
- **Verification procedure:** Repeat the curl above with an invalid id such as `"id":"x"`: expect `403`, not `400 Bad video id` or `502`. Also confirm the same-origin UI flow still works.
- **Status:** CONFIRMED

### WEB-05 — Raw upstream errors go to anonymous callers
- **Severity:** P2
- **Category:** Information disclosure / error handling
- **Blocks:** Both
- **Affected files:** `src/routes/api/ytdlp.ts:55`, `src/routes/api/builder.ts:34`, `src/routes/api/unlock.ts:54` (`err instanceof Error ? err.message : …`), plus the client error UI that renders these strings
- **Description:** Handlers return `err.message` verbatim in `502` JSON. The message chains yt-dlp stderr, every fallback rung and subprocess invocations.
- **Evidence:** Response to the anonymous cross-site request in WEB-04:
  `{"error":"web_embedded: download · [youtube] not-a-video: This video is unavailable · … web_embedded@socks: … tv_simply@socks: … android@socks: android: network · Command '['C:\\\\Program Files\\\\nodejs\\\\node.EXE', 'C:\\\\Users\\\\PC\\\\bgutil-ytdlp-pot-provider\\\\server\\\\build\\\\generate_once.js', '--version']' timed "} -> 502`
- **Real-world consequence:** This reveals absolute server paths, the OS user name, installed tools (the bgutil POT provider), the extraction/proxy ladder and the timeouts. An attacker or an anti-abuse team can use that to fingerprint and profile the service.
- **Recommended fix:** Log the full error on the server. Return a stable error code with a generic message (the app already has `classifyDownloadError` in `src/lib/download-error.ts`), and drop subprocess or path text before it reaches the response.
- **Verification procedure:** Trigger a failed download (invalid 11-char id). The response body must contain no `\\`, `/Users/`, `Command '` or `@socks`.
- **Status:** CONFIRMED

### WEB-06 — Page can be framed, and `?v=…&auto=1` auto-starts a download with no user gesture
- **Severity:** P2
- **Category:** Clickjacking / UI redress / drive-by action
- **Blocks:** Website launch
- **Affected files:** `src/routes/index.tsx:72-78` (`params.get("auto") === "1"` → `autoDownloadRef`; `params.get("v")` → immediate `lookup`), `src/routes/index.tsx:100-104` (auto `runDownload`); no frame-ancestors (WEB-02)
- **Description:** Visiting `/?v=<id>&auto=1` resolves the video and starts the download automatically. With no `frame-ancestors`/`X-Frame-Options`, any site can load that URL in a hidden iframe. Header and dialog controls can also be framed for classic clickjacking. Embedding is intentional for the Grok preview, but it is not restricted to that origin.
- **Evidence:** Code at `index.tsx:72-78`. Headers per WEB-02 (no XFO/CSP). I did not run an actual framed drive-by, to avoid real YouTube traffic.
- **Real-world consequence:** Hidden downloads burn a visitor's quota and bandwidth, and generate YouTube traffic from the visitor's IP. Framed clicks could trigger sign-in-link or session actions.
- **Recommended fix:** Set `frame-ancestors 'self' <grok preview origin>`. Honour `auto=1` only for top-level, same-origin navigations (e.g. only when `window.top === window` and `document.referrer` is same-origin), or drop it and require a click.
- **Verification procedure:** Serve `<iframe src="https://<deploy>/?v=jNQXAC9IVRw&auto=1">` from another origin and confirm the frame is refused. Open the URL top-level from a cross-origin link and confirm no download starts without a click.
- **Status:** CONFIRMED (code + headers); the end-to-end framed attack is NOT VERIFIED

### WEB-07 — README-documented `npm run dev` binds 0.0.0.0 and serves project source to the LAN
- **Severity:** P2
- **Category:** Insecure default / exposure
- **Blocks:** OSS release
- **Affected files:** `package.json:12` (`vite dev --host 0.0.0.0 --port 8080`), `vite.config.ts:183` (`host: "0.0.0.0"`), `README.md:171-174` ("Start the development server: npm run dev"), `scripts/app-env-plugin.mjs`
- **Description:** The README's only run instruction is `npm run dev`, and that binds every interface. The Vite dev server serves any project file it can transform. On my loopback-bound dev instance (same config, port 8093):
  - `GET /src/lib/auth/preview.ts` returned the source, including `PREVIEW_CLIENT_SECRET = "8bcdb7…REDACTED"`.
  - `GET /.vercel/output/config.json` returned 200.
  - `/__app-env` returned `{"BASE_URL":"/","MODE":"development","DEV":true,"PROD":false}`.
  - `/.env`, `/@fs/…/package.json` and `/@fs/C:/Windows/win.ini` returned 404 (Vite's fs.deny works).
- **Evidence:** Commands and outputs above. The dev server also enables the dev-only `/auth/popup` handler and the PGLite dev DB.
- **Real-world consequence:** A self-hoster following the README exposes their source tree, any local secrets in source files, built server bundles and a running downloader to everyone on the same network (café Wi-Fi, office LAN).
- **Recommended fix:** Default `npm run dev` to `--host 127.0.0.1`. Keep a separate `dev:sandbox` script for the Grok 0.0.0.0 contract. Document a production start command instead of dev.
- **Verification procedure:** After the fix, `npm run dev`, then `netstat -ano | findstr :8080` shows `127.0.0.1:8080` only.
- **Status:** CONFIRMED (binding from config; file exposure verified on a loopback instance)

### WEB-08 — Guide coaches users to copy their YouTube/Google session cookies to the clipboard with a bookmarklet and paste them into the site
- **Severity:** P2
- **Category:** Session-credential handling / social-engineering pattern (TECHNICAL FINDING + REQUIRES LEGAL REVIEW)
- **Blocks:** Both
- **Affected files:** `src/components/session-guide.tsx:51` (`BOOKMARKLET_CODE`: reads `document.cookie` on youtube.com and writes JSON to the clipboard), `src/components/session-guide.tsx:128` ("Universal 1-Click Bookmarklet (Works on Any Browser)")
- **Description:** The anonymous Guide panel tells visitors to install a bookmarklet that dumps every non-HttpOnly youtube.com cookie and then paste the result into Velo. That teaches users the exact workflow that cookie-stealing scams use. The pasted text then sits on a page that also runs an unpinned third-party script (WEB-03) and has no CSP (WEB-02).
- **Evidence:** Code quoted above. Screenshot `shots/dlg-1366-Guide.png` (scratchpad) shows the panel with the "Export YouTube Cookies (Drag to Bookmarks)" button.
- **Real-world consequence:** Account-takeover exposure for users if the origin or any script on it is ever compromised. The practice also conflicts with Google account terms and helps phishers imitate the flow (REQUIRES LEGAL REVIEW).
- **Recommended fix:** Remove the bookmarklet. If cookie import stays, restrict it to the extension flow, explain the risk in plain words, and never ask users to move session cookies through the clipboard.
- **Verification procedure:** `grep -rn "document.cookie" src/components` returns nothing; the Guide panel no longer offers cookie export.
- **Status:** CONFIRMED

### WEB-09 — The committed preview OAuth client secret is baked into the deployable server bundle
- **Severity:** P1
- **Category:** Secret management
- **Blocks:** Both
- **Affected files:** `src/lib/auth/preview.ts:20-21`, `.vercel/output/functions/__server.func/_ssr/server-DDP6iEQJ.mjs`
- **Description:** This confirms the brief's lead at the artifact level. The hard-coded `PREVIEW_CLIENT_SECRET` (`8bcdb7…REDACTED`) is compiled into the Vercel function. It is not in the client bundle.
- **Evidence:** `grep -l "8bcdb7…" -r static` → no match. `grep -l "8bcdb7…" -r functions` → `functions/__server.func/_ssr/server-DDP6iEQJ.mjs`. The dev server also serves it (WEB-07).
- **Real-world consequence:** The secret is public for anyone with repo or bundle access. Anyone can act as the shared `grok_preview` OAuth client (impact analysed by the auth auditor).
- **Recommended fix:** Rotate the secret with the broker owner, delete it from source and git history, and require env configuration with fail-closed behaviour.
- **Verification procedure:** `grep -r <first 10 chars> src .vercel/output` returns nothing after a rebuild; `git log -S` shows the purge.
- **Status:** CONFIRMED

### WEB-10 — Server-function errors return HTTP 200 with the error in the body; zod validation errors echo the input schema
- **Severity:** P3
- **Category:** Error semantics / information disclosure
- **Blocks:** Neither
- **Affected files:** `src/lib/auth/middleware.ts:42-46`, `src/lib/sign-in-link.ts` (validator)
- **Description / Evidence:** Anonymous `GET /_serverFn/<loadVault>` → `200 {"t":10,…"message":{"t":1,"s":"Unauthorized"},"c":"$TSR/Error"}`. `POST requestSignInLink` with an empty object → `200 …"message":"[\n {\n \"expected\": \"string\",\n \"code\": \"invalid_type\",\n \"path\"…`.
- **Real-world consequence:** Monitoring and WAF rules cannot see auth failures (everything is 200). The schema text helps probing. Low impact.
- **Recommended fix:** Throw typed errors that set a 401/400 status (TanStack `setResponseStatus`), and return generic validation messages.
- **Verification procedure:** Anonymous `loadVault` → 401.
- **Status:** CONFIRMED

### WEB-11 — `/api/health?deep=1` is unauthenticated, uncached and not rate-limited
- **Severity:** P3
- **Category:** Abuse / operational
- **Blocks:** Neither
- **Affected files:** `src/routes/api/health.ts:65-81`
- **Description / Evidence:** Each call does a `select 1` and, with `deep=1`, a `to_regclass('verification')` query, with `Cache-Control: no-store` and no backstop. The first call in the harness took 1,359 ms (`"latencyMs":1359`, cold PGLite). The response does leak `source: pglite|neon`. That is minor, and the file header says it is intentional.
- **Real-world consequence:** Cheap DB load amplification; small reconnaissance value.
- **Recommended fix:** Rate-limit, or put `deep=1` behind a monitor token. Allow a short cache (`max-age=5`).
- **Verification procedure:** 100 rapid `deep=1` calls → 429 after the limit.
- **Status:** CONFIRMED (behaviour); load impact NOT VERIFIED

### WEB-12 — Sign-in on a self-hosted / localhost origin fails with "not a trusted origin" and the UI names the auth library
- **Severity:** P3
- **Category:** Auth configuration / OSS usability
- **Blocks:** OSS release
- **Affected files:** `src/lib/auth/server.ts` (trustedOrigins), `src/routes/login.tsx`
- **Description / Evidence:** Email sign-in on `http://127.0.0.1:8081/login` shows "This page is not a trusted origin — Better Auth rejected the sign-in POST. Open Velo from its own URL and retry." The server log shows `ERROR [Better Auth]: Invalid origin: http://127.0.0.1:8081`, and also `WARN … Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket`. Screenshot `shots/login-error.png`.
- **Real-world consequence:** Self-hosters cannot sign in without undocumented config. Better Auth's rate limiting collapses to one shared bucket when the IP header is missing (all users share one limit).
- **Recommended fix:** Document `BETTER_AUTH_URL` / trusted origins, configure `advanced.ipAddress.ipAddressHeaders`, and show product-level error copy.
- **Verification procedure:** Set the documented env, then sign in successfully at `http://localhost:<port>`.
- **Status:** CONFIRMED

### WEB-13 — No `security.txt`; unknown `/api/*` paths return an HTML 404 page
- **Severity:** P3
- **Category:** Disclosure process / API hygiene
- **Blocks:** Neither
- **Affected files:** `public/` (no `.well-known/security.txt`), router 404 handling
- **Description / Evidence:** `GET /api/nope` → `404 content-type: text/html` (full app shell). There is no `/.well-known/security.txt`. `/api/auth/ok` → `{"ok":true}` (fine).
- **Real-world consequence:** Researchers have no reporting channel. API clients get HTML where they expect JSON.
- **Recommended fix:** Add `security.txt` (plus a SECURITY.md for OSS). Return JSON 404s under `/api/`.
- **Verification procedure:** `curl -i /api/nope` → `application/json`.
- **Status:** CONFIRMED

## Not verified / out of scope
- Live Vercel edge behaviour: HSTS default, compression, how the platform handles the WEB-01 rejection, and body-size limits. The platform limit is presumably ~4.5 MB; the app's own `request.json()` reads the body with no limit, and `cookies` is capped by zod at 400,000 characters only after parsing.
- Function timeouts: `.vc-config.json` sets no `maxDuration`, so platform defaults apply. Long yt-dlp runs may be cut off (NOT VERIFIED).
- `__Host-` cookie flags as actually emitted in a response (sign-in could not complete locally).
- Signed-in / operator UI paths (Tools tab, proxy operations console): they are hidden for guests (`src/routes/index.tsx` filters `tools` when signed out), and I verified the server-side enforcement above. The signed-in UI itself was not exercised.
- `/api/relay`, `/api/download`, `/api/bypass`, `/api/feed`, `/api/captions` with real targets. I avoided them to limit YouTube and third-party traffic. They share the missing CSRF gate by inspection (WEB-04).
- Leftover temp dir created by the server during WEB-04: `C:\Users\PC\AppData\Local\Temp\velo-ytdl-R9pkXM` (not in the repo; left untouched).
