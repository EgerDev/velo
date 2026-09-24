# 01 — Architecture audit (auditor: arch)

## Scope and method

Scope: the working tree of `C:\Users\PC\orca\velo` on 2026-09-23 (HEAD `81cbd95` + 27 modified +
3 untracked files), including `src/`, `server/`, `scripts/`, `migrations/`, `extension/`,
`extensions/`, `public/`, `vite.config.ts`, `package.json`, the CI workflow and the local build
output `.vercel/output/` (produced by a local `npm run build`).

Method: full reading of every route, every `createServerFn`, the auth stack, the extraction
ladder, the download pools/caches, the subprocess call sites, the Vite/Nitro config and both
extensions; import-graph reachability analysis (script in the auditor's scratchpad); grep of every
`process.env`/`import.meta.env`, every outbound URL literal and every `spawn`. No source was
modified. No server was started (ports 8080/8081 belong to the UX agent). No live Vercel
deployment was available, so every claim about Vercel runtime behaviour is marked **NOT VERIFIED**
unless it is visible in `.vercel/output`. Secrets are shown truncated.

The companion document `docs/architecture.md` describes the system; this file lists problems.

## Summary

| ID | Sev | Title | Blocks |
|---|---|---|---|
| ARCH-01 | P0 | Core download path needs Python/yt-dlp/ffmpeg/curl/node subprocesses; the only deploy target (Vercel functions) ships none of them | Website launch |
| ARCH-02 | P1 | All abuse controls, pools and caches are per-process memory — meaningless on serverless | Website launch |
| ARCH-03 | P1 | Missing `DATABASE_URL` silently runs production on in-memory PGLite (accounts, sessions, cookie vault, proxies evaporate per instance) | Website launch |
| ARCH-04 | P1 | Missing `BETTER_AUTH_SECRET` silently generates a random per-process signing secret | Website launch |
| ARCH-05 | P1 | Auth defaults contradict their own documentation: "off" is not the default; OAuth falls back to a hard-coded third-party preview client; email+password sign-up is on with no verification | Both |
| ARCH-06 | P1 | Every HTML page loads xAI's `grok.com/grok-app-builder/extensions.js` (no SRI, no CSP) on the page where users paste Google session cookies | Both |
| ARCH-07 | P1 | Runtime self-modification: guest requests trigger `pip install`, yt-dlp fetches executable code from GitHub, operators run `npm install --save` on the live server | Both |
| ARCH-08 | P1 | Remote YouTube/Google JavaScript is executed in the server process with `new Function`, with `globalThis.window` swapped mid-request (documented, deferred hazard) | Both |
| ARCH-09 | P1 | Production infrastructure depends on anonymous free SOCKS5 proxies and two public CORS proxies; media bytes flow through them contrary to the code's own contract | Both |
| ARCH-10 | P1 | Unauthenticated metadata server functions allow large amplification (`resolveBulkVideos`: 50 full resolves incl. yt-dlp subprocesses for 1 token) | Website launch |
| ARCH-11 | P2 | Long-running streamed downloads vs serverless duration/bandwidth; no `maxDuration`/`vercel.json` | Website launch |
| ARCH-12 | P2 | Process-wide monkey-patching of DNS and the global undici dispatcher on import | Neither |
| ARCH-13 | P2 | Every InnerTube request hard-depends on the proxy table: a DB error fails all metadata; guests boot PGLite | Website launch |
| ARCH-14 | P2 | Migrations run inside `npm run build` against whatever `DATABASE_URL` the build has (incl. preview builds) | Website launch |
| ARCH-15 | P2 | Dev-only / hidden behaviour reachable in production (popup OAuth, `?auto=1`, `YTDLP_BROWSER`, sign-in links, open proxy management) | Both |
| ARCH-16 | P2 | Hard-wired Grok platform hosts across auth, bridge, builder mode and both extensions; the session extension cannot talk to a non-Grok domain | Both |
| ARCH-17 | P2 | Three independent unbounded `pg` pools per process | Website launch |
| ARCH-18 | P2 | Orphaned/unfinished functionality still exposed or shipped (multiplayer→`/api/rtc`, `app-data` connectors, uncalled endpoints) | OSS release |
| ARCH-19 | P2 | Working tree is not a buildable commit: modified files import an untracked module | OSS release |
| ARCH-20 | P2 | README claims that the implementation does not meet | OSS release |
| ARCH-21 | P2 | No security headers anywhere (CSP, frame-ancestors, HSTS); no platform config | Website launch |
| ARCH-22 | P2 | No test/build CI; yt-dlp version is not pinned anywhere in the repo | Both |
| ARCH-23 | P2 | Design goal is circumvention of YouTube technical measures (BotGuard/PO token, nsig, IP rotation) — REQUIRES LEGAL REVIEW | Both |
| ARCH-24 | P3 | Whole-file buffering in the browser; in-memory MP4 mux | Neither |
| ARCH-25 | P3 | `/tmp`-based caches sized near typical serverless `/tmp` limits | Neither |
| ARCH-26 | P3 | Health endpoint checks only the database | Neither |

---

### ARCH-01 — Core download path needs Python/yt-dlp/ffmpeg/curl/node subprocesses; the only deploy target ships none of them
- **Severity:** P0
- **Category:** Infrastructure assumption / deploy target mismatch
- **Blocks:** Website launch
- **Affected files:** `vite.config.ts:207-217` (nitro preset `vercel`), `src/lib/builder.server.ts:63` (non-18/22 itags go to yt-dlp only), `src/lib/youtube-stream.server.ts:243-248` (video-only → 422 "Save uses yt-dlp"), `src/lib/ytdlp-python.server.ts:65-97`, `src/lib/socks-pool.server.ts:124-148` (`curl`), `src/lib/ytdlp-auth.ts:521-567` (`--js-runtimes node`, ffmpeg merge), `README.md` "Prerequisites"
- **Description:** Every preset above 720p (video-only DASH itags 137/299/…, HLS 96), all server-side muxing, the metadata enrichment for ≥1080p, caption fallback and the entire SOCKS same-hop path shell out to `python3 -m yt_dlp` (which itself needs `ffmpeg` and `node`) and to `curl`. The build produces a single Vercel Node function with no Python interpreter, no yt-dlp, no ffmpeg and no curl in the bundle. README calls Python "optional … pre-configured in sandbox" — the sandbox is the Grok dev container, not the deploy target.
- **Evidence:**
  - `.vercel/output/functions/__server.func/.vc-config.json` → `"runtime": "nodejs24.x", "launcherType": "Nodejs"`; `find .vercel/output/functions/__server.func -iname "python*" -o -iname ffmpeg` → no results (only transpiled `ytdlp-*.mjs` chunks).
  - `builder.server.ts:63`: `const order = muxed ? [tryInnertube, tryYtdlp] : [tryYtdlp];`
  - `ytdlp-python.server.ts:95-98` throws the actionable "Python 3 is not available" message the moment the interpreter is missing.
- **Real-world consequence:** On Vercel, 1080p/1440p/4K "Save" can only succeed through the browser hybrid path (public CORS relays + browser mux) or not at all; the server ladder fails on the first spawn. The headline feature does not work on the configured platform. Whether the Vercel image happens to contain `curl`/`python3` is **NOT VERIFIED** (no live deployment); even if present, yt-dlp/ffmpeg are not.
- **Recommended fix:** Decide the hosting model explicitly: either (a) run the server on a container/VM (Fly, Render, Docker) with pinned Python/yt-dlp/ffmpeg and drop the `vercel` preset, or (b) keep Vercel for the UI and move extraction to a separate long-lived worker service; document it in README; fail the build/boot health check when the chosen runtime lacks the binaries.
- **Verification procedure:** Deploy the current build to a Vercel preview, call `POST /api/ytdlp {"id":"jNQXAC9IVRw","itag":18}` and `GET /api/health`; inspect the 502 body for "Python 3 is not available". Locally: `ls .vercel/output/functions/__server.func`.
- **Status:** CONFIRMED (code dependency and bundle contents); live-runtime binary availability NOT VERIFIED

### ARCH-02 — All abuse controls, pools and caches are per-process memory
- **Severity:** P1
- **Category:** Serverless vs in-memory state
- **Blocks:** Website launch
- **Affected files:** `src/lib/guest-limit.server.ts:39-48` (buckets), `src/routes/api/auth/$.ts:5-7` (sign-up limiter), `src/lib/sign-in-link.ts:26-29`, `src/lib/download-pool.server.ts:12-18,26-27,103-104` (slot pool, mux cache index, coalescing), `src/lib/socks-pool.server.ts:57-60`, `src/lib/po-token.server.ts:35-42`, `src/lib/youtube-client.server.ts:40-83`, `src/lib/tool-updates.server.ts:35,177`, `src/lib/ytdlp-python.server.ts:15-17`
- **Description:** Rate limits (guest/user/IP/metadata), sign-up and sign-in-link throttles, the "max 4 yt-dlp processes / 32 queued" capacity guard, the mux cache, request coalescing, SOCKS health, BotGuard minter, the single-install lock and the "direct is blocked" bit are module-level `Map`s/variables. Nitro builds one function; Vercel scales it horizontally and recycles instances.
- **Evidence:** `const buckets = new Map<string, Bucket>(); const ipBuckets = new Map<string, Bucket>();` (`guest-limit.server.ts:39,42`); `export const MAX_YTDLP = 4;` / `let inflight = 0;` (`download-pool.server.ts:12,26`); `let inflight: Promise<UpdateResult> | null = null;` ("One install at a time — two npm installs into one tree corrupt it", `tool-updates.server.ts:176-177`).
- **Real-world consequence:** Quotas reset on every cold start and are multiplied by the number of warm instances; a flood simply spreads across instances. The OOM guard ("Caps yt-dlp/ffmpeg so a Grok sandbox cannot OOM", `download-pool.server.ts:1-2`) caps nothing globally. The tool-install lock does not serialise installs across instances. Operators will believe limits exist that do not.
- **Recommended fix:** Move quota, throttle and lock state to a shared store (Postgres rows with `FOR UPDATE`, Redis/Upstash, or Vercel Firewall rate-limit rules); document which caches are best-effort per instance.
- **Verification procedure:** Deploy with ≥2 instances (or run two `vite preview` processes behind a round-robin proxy) and send 30 guest downloads alternating instances; observe that each instance independently allows its full bucket.
- **Status:** CONFIRMED (code); multi-instance behaviour on Vercel NOT VERIFIED by live test

### ARCH-03 — Missing `DATABASE_URL` silently runs production on in-memory PGLite
- **Severity:** P1
- **Category:** Data store / infrastructure assumption
- **Blocks:** Website launch
- **Affected files:** `src/lib/db.ts:8-19,115-175,239-244`, `vite.config.ts:55-79` (copies PGLite wasm into the Vercel function), `src/lib/auth/server.ts:144-146`, `src/routes/api/health.ts:64-81`
- **Description:** With `DATABASE_URL` unset the server boots an in-memory PGLite per process and applies all migrations on first use. The build deliberately ships PGLite into the Vercel function, so a misconfigured deploy works "fine" — users can register, save cookie vaults and operator proxies — and all of it is lost at the next cold start and is invisible to other instances. `/api/health` reports `status:"ok"` with `source:"pglite"`.
- **Evidence:** `export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";` (`db.ts:19`); `pgliteAssetsPlugin` copies `*.wasm`/`*.data` to `.vercel/output/functions/__server.func/_libs` — confirmed present: `initdb.wasm, pglite.data, pglite.wasm`.
- **Real-world consequence:** Accounts and sessions vanish unpredictably; a user signs up on instance A and is unknown on instance B; saved Google cookies disappear (arguably safer, but a correctness failure); a sign-up flood grows process memory.
- **Recommended fix:** In production (`NODE_ENV=production` or `VERCEL=1`) refuse to start (or return 503 from `/api/health` and all DB routes) when `DATABASE_URL` is missing; keep PGLite for dev only and stop copying its assets into production output.
- **Verification procedure:** `npm run build` without `DATABASE_URL`, `npm run preview`, sign up, restart preview, try to sign in → account gone; `curl /api/health` shows `"source":"pglite"` with 200.
- **Status:** CONFIRMED

### ARCH-04 — Missing `BETTER_AUTH_SECRET` silently generates a random per-process secret
- **Severity:** P1
- **Category:** Auth infrastructure / serverless assumption
- **Blocks:** Website launch
- **Affected files:** `src/lib/auth/server.ts:59-65,190`, `src/lib/vault-crypto.ts:82-90`
- **Description:** `secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret()` where `previewAuthSecret` is `randomBytes(32)` stored on `globalThis`. The comment justifies it for HMR in the Grok preview. In production nothing warns or fails. The proxy-credential key also falls back to `BETTER_AUTH_SECRET`, so rotating the auth secret makes stored proxy credentials undecryptable.
- **Evidence:** `globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");` (`server.ts:63`); `const secret = process.env.VELO_VAULT_KEY?.trim() || process.env.BETTER_AUTH_SECRET?.trim();` (`vault-crypto.ts:83`).
- **Real-world consequence:** Session cookies signed by one instance are rejected by another and all sessions die on every cold start; `encryptOAuthTokens: true` tokens become unreadable. Coupling proxy encryption to the auth secret creates an unexpected data-loss path on secret rotation.
- **Recommended fix:** Require `BETTER_AUTH_SECRET` (throw at module load) whenever not in `vite dev`; give proxy credentials their own mandatory key (or `VELO_VAULT_KEY`) and document rotation (`VELO_VAULT_KEY_PREVIOUS`).
- **Verification procedure:** Build/preview without the variable, sign in, restart the server → session invalid; grep logs for any warning (there is none).
- **Status:** CONFIRMED

### ARCH-05 — Auth defaults contradict their own documentation; OAuth falls back to a hard-coded third-party preview client; unverified email sign-up is on
- **Severity:** P1
- **Category:** Auth modes / temporary fallback in production / doc mismatch
- **Blocks:** Both
- **Affected files:** `src/lib/auth/server.ts:14-26,73-86,94-126`, `src/lib/auth/preview.ts:19-24`, `src/lib/auth/email-password.ts:1-10`, `src/lib/auth/client.ts:9`, `src/lib/auth/use-current-user.ts:15-19`, `scripts/with-app-env.mjs:28,34-35`
- **Description:**
  1. Comments throughout say "Off (`VITE_AUTH_ENABLED=false`, the shipped default)". The code treats **only the literal `"false"`** as off; `.grok/app-env.json` (the file meant to carry the flag) does not exist in the repo, so the shipped default is **auth on**.
  2. With auth on and no `GROK_AUTH_CLIENT_ID/SECRET`, the server uses a **hard-coded shared OAuth client of xAI's broker** (`grok_preview`, secret `8bcdb7…REDACTED` committed in `preview.ts:20-21`) whose callbacks the broker only accepts for `*.grok-sandbox.com` (per the file's own comment). On any other domain Google/X buttons are rendered but cannot complete.
  3. `email-password.ts` says "Off by default. To enable: set `emailAndPasswordEnabled` to `true`" — and the value is `true`. Better Auth runs without email verification or an email transport; `BETTER_AUTH_URL` unset makes `baseURL` a dynamic `*.grok-sandbox.com`/localhost list with fallback `http://localhost:8080`.
- **Evidence:** `const authDisabled = env("VITE_AUTH_ENABLED") === "false";` / `const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;` (`server.ts:75,82`); `export const emailAndPasswordEnabled = true;` (`email-password.ts:10`); `ls .grok` → no such directory.
- **Real-world consequence:** A self-hoster (OSS) or the launch deployment that forgets three variables ends up with: broken OAuth, a committed third-party credential in use, and open, unverified email/password registration as the only working login — which then unlocks the cookie vault and higher download quotas. Security review of the committed secret itself is covered by the security auditors.
- **Recommended fix:** Make auth mode explicit and fail-closed: require `VITE_AUTH_ENABLED` to be set, remove the preview client fallback from production code, gate email/password behind an env flag and email verification, and require `BETTER_AUTH_URL` in production. Fix the comments.
- **Verification procedure:** `npm run build && npm run preview` with a clean env; open `/login` on `http://127.0.0.1:8081`, click "Google" → broker rejects redirect_uri; sign up with any email → works immediately.
- **Status:** CONFIRMED (code); broker rejection behaviour NOT VERIFIED live

### ARCH-06 — Every HTML page loads xAI's `extensions.js` without SRI or CSP
- **Severity:** P1
- **Category:** Third-party runtime dependency / template leftover in production
- **Blocks:** Both
- **Affected files:** `scripts/grok-pwa-shared.mjs:203,231-244`, `server/middleware/grok-pwa.ts:105-117`, `scripts/grok-pwa-plugin.mjs:177-183`, `vite.config.ts:204`, `AGENTS.md` ("Keep the branding injector … Never strip it")
- **Description:** The Grok template's Nitro middleware stream-injects `<script src="https://grok.com/grok-app-builder/extensions.js" defer>` (the "Created with Grok / Remix" pill) plus `og:*` tags pointing at `og.grok.me` into every HTML document, in dev, preview and production. The app has no Content-Security-Policy, so that script runs with full DOM access on the same page where users paste raw Google `SID/SAPISID` cookie jars (`cookie-import.tsx`) and where the bearer token sits in `sessionStorage`.
- **Evidence:** `export const GROK_EXTENSIONS_SCRIPT_SRC = "https://grok.com/grok-app-builder/extensions.js";` and `tags.push(\`<script src="${GROK_EXTENSIONS_SCRIPT_SRC}"…defer></script>\`)` (`grok-pwa-shared.mjs:203,238-242`); middleware applies to every document path (`grok-pwa.ts:105-116`).
- **Real-world consequence:** A third party (and anyone who compromises that URL) can read user session cookies and auth tokens; an OSS release that ships this silently phones home to xAI and brands the site "Created with Grok". Privacy disclosure/consent implications — REQUIRES LEGAL REVIEW.
- **Recommended fix:** Remove the injector, `server/middleware/grok-pwa.ts`, `grokPwaPlugin` and `public/__grok/` for the non-Grok release; if any third-party script is kept, pin it with SRI and a strict CSP.
- **Verification procedure:** `npm run build && npm run preview`; `curl -s http://127.0.0.1:8081/ | grep -o 'grok.com/grok-app-builder/extensions.js'`.
- **Status:** CONFIRMED (code); rendered output not fetched by this auditor (port owned by UX agent)

### ARCH-07 — Runtime self-modification: guest-triggered `pip install`, remote yt-dlp components, operator `npm install --save`
- **Severity:** P1
- **Category:** Runtime installs / supply chain / serverless assumption
- **Blocks:** Both
- **Affected files:** `src/lib/ytdlp-python.server.ts:108-145`, `src/lib/ytdlp.server.ts:157,256`, `src/lib/ytdlp-meta.server.ts:6-8`, `src/lib/ytdlp-auth.ts:545-547`, `src/lib/tool-updates.server.ts:183-267`, `src/lib/tool-versions.ts:64-77`
- **Description:**
  1. `ensurePySocks`/`ensureImpersonate` run `python -m pip install --quiet PySocks` / `curl_cffi` (unpinned, from PyPI) the first time any **guest** download reaches the SOCKS/impersonation stage — no operator gate.
  2. Every yt-dlp run passes `--remote-components ejs:github`, i.e. yt-dlp downloads its JS challenge solver from GitHub at runtime and executes it with `node`.
  3. The Tools tab runs `npm install <pkg>@latest --save` in `process.cwd()` (rewrites `package.json`/`package-lock.json` of the running deployment) and `pip install --upgrade [--break-system-packages] yt-dlp`.
- **Evidence:** `const install = await run(bin, ["-m", "pip", "install", "--quiet", pipName], 90_000)` (`ytdlp-python.server.ts:118`); `"--remote-components", "ejs:github",` (`ytdlp-auth.ts:546-547`); `npmInstallArgs` → `["install", \`${pkg}@latest\`, …, "--save"]` (`tool-versions.ts:64-73`).
- **Real-world consequence:** Production behaviour depends on whatever PyPI/GitHub/npm serve at request time (unreviewed code enters the server without a deploy); a compromised upstream release is executed on first use. On serverless the installs fail (read-only deployment filesystem, `npm` likely absent — NOT VERIFIED) so the Tools tab is non-functional and its "needs restart" guidance is meaningless; on a VM it produces drift between the deployed tree and git.
- **Recommended fix:** Bake PySocks/curl_cffi/yt-dlp (pinned, hashed) into the image; vendor or pin the yt-dlp EJS component (`--remote-components` off, `yt-dlp-ejs` pip extra pinned); remove the in-app installer from production builds and do updates through CI + redeploy.
- **Verification procedure:** On a host without PySocks, run one guest download that reaches the SOCKS stage and check `pip list` before/after; `grep -n remote-components src/lib/ytdlp-auth.ts`.
- **Status:** CONFIRMED (code)

### ARCH-08 — Remote JavaScript executed in-process with `new Function`; `globalThis.window` swapped mid-request
- **Severity:** P1
- **Category:** Experimental component / known unfixed concurrency hazard
- **Blocks:** Both
- **Affected files:** `src/lib/youtube-client.server.ts:8`, `src/lib/po-token.server.ts:60-105,195-254`, `src/lib/db.ts:179-186`
- **Description:** (a) youtubei.js is configured with `Platform.shim.eval = (data) => new Function(data.output)()` — YouTube's player script is evaluated in the Node process that holds DB credentials and user cookies. (b) The PO-token minter downloads the BotGuard interpreter from the URL YouTube's HTML names and runs it via `new Function` against a jsdom window that is **assigned to `globalThis.window/self/document`** for the duration of async work. The code documents this as a "KNOWN CONCURRENCY HAZARD (needs-design) … deferred". `db.ts` decides "am I in a browser?" with `typeof window !== "undefined"`.
- **Evidence:** `po-token.server.ts:79-90` (hazard comment); `g.window = bgWindow; g.self = bgWindow; g.document = bgWindow.document;` (:66-71); `if (typeof window !== "undefined") { throw new Error("@/lib/db is server-only …` (`db.ts:180-185`).
- **Real-world consequence:** Any request whose first `getSql()` (or any other `typeof window` branch, e.g. `builder-save`, `hybrid-net`) interleaves with a mint can fail intermittently with a misleading "server-only" error; the executed third-party code has full process privileges (no `vm`/worker isolation).
- **Recommended fix:** Run youtubei.js player evaluation and BotGuard in a `worker_threads` worker or `node:vm` context with no access to process globals; never mutate `globalThis` on the request event loop.
- **Verification procedure:** Unit harness: start `mintPoTokenDetailed(id)` and, while it is awaiting, call a function that checks `typeof window` (or a first `getSql()` on a fresh process); observe the browser branch.
- **Status:** CONFIRMED (code + in-code acknowledgement); intermittent failure not reproduced live

### ARCH-09 — Production relies on anonymous free SOCKS5 proxies and public CORS proxies; media flows through them
- **Severity:** P1
- **Category:** Undocumented third-party infrastructure / contract mismatch
- **Blocks:** Both
- **Affected files:** `src/lib/socks-pool.server.ts:19-20,105-122`, `src/lib/cors-relays.ts:1-3,11-23`, `src/lib/bypass.server.ts:77-126`, `src/lib/bypass.ts:60-110,337-416`, `src/routes/api/relay.ts:69`, `src/routes/api/bypass.ts`
- **Description:** The server downloads a live list of free anonymous SOCKS5 proxies from `cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main` (unpinned branch) and routes guest yt-dlp runs through them; server and browser both route watch pages **and media bytes** through `proxy.corsfix.com` and `api.allorigins.win`. `cors-relays.ts:1-3` states the opposite contract ("Public CORS hops for watch-page HTML only. googlevideo bytes go through /api/builder"). User cookies are correctly kept off the free SOCKS pool (`ytdlp.server.ts:178`, `ytdlp-auth.ts:537-541`) — the brief's concern about cookies over free SOCKS is **not** borne out by the code — but guest traffic, visitor data and PO tokens are.
- **Evidence:** `const media = await hop(mediaUrl, relay.wrap, 90_000, signal);` (`bypass.server.ts:116`); `wrap: (url) => \`https://proxy.corsfix.com/?${url…}\`` (`cors-relays.ts:18`).
- **Real-world consequence:** Availability depends on third parties with no SLA who can see, modify or inject into responses (integrity only checked by content-type/`ftyp` sniffing); unknown proxy operators see the server's traffic; browsers leak user IP + requested video to corsfix/allorigins without disclosure; use of those services may violate their terms (REQUIRES LEGAL REVIEW).
- **Recommended fix:** Remove the free-proxy list and public relays from production; if egress proxies are needed use operator-owned ones (the proxy console already exists); fix the `cors-relays.ts` contract comment; disclose any third-party relay in the privacy notice.
- **Verification procedure:** `grep -n "hop(mediaUrl" src/lib/bypass.server.ts`; run `GET /api/bypass?id=jNQXAC9IVRw&itag=18` locally and check `X-Velo-Bypass: corsfix|allorigins` on success.
- **Status:** CONFIRMED (code)

### ARCH-10 — Unauthenticated metadata server functions allow large amplification
- **Severity:** P1
- **Category:** Resource exhaustion / cost / architecture of rate limiting
- **Blocks:** Website launch
- **Affected files:** `src/lib/resolve-video.ts:4-16,102-114`, `src/lib/youtube.server.ts:64-73,116-142`, `src/lib/guest-limit.server.ts:103-109,413-420`, `src/lib/socks-pool.server.ts:150-171`
- **Description:** All eight `resolve-video.ts` server functions are unauthenticated and pay one token of the per-IP META bucket (300 / 10 min, per instance). `resolveBulkVideos` accepts 50 ids for that single token; each id runs a full resolve: POT mint, up to 14 InnerTube calls and — when no ≥1080p format is found — a `yt-dlp -J` subprocess that may first sweep up to 45 s of free-SOCKS `curl` probes. `mintPoToken`/`decipherCipher` run BotGuard/nsig on arbitrary ids for one token each.
- **Evidence:** `ids: z.array(z.string().regex(/^[a-zA-Z0-9_-]{11}$/)).min(1).max(50)` + a single `await assertMetadataBudget()` (`resolve-video.ts:102-112`); `listYtdlpFormats(id)` in `resolveYoutubeVideo` (`youtube.server.ts:66-69`).
- **Real-world consequence:** One IP can trigger ~15 000 video resolutions (and many subprocesses) per 10 min per instance, exhausting function time/cost and getting the egress IP banned by YouTube for all users.
- **Recommended fix:** Charge per id, cap bulk size for guests, require sign-in for bulk, move the yt-dlp format enrichment off the synchronous metadata path, and put a global (shared) limiter in front (see ARCH-02).
- **Verification procedure:** Call the server function RPC for `resolveBulkVideos` with 50 ids 10× from one IP and count upstream requests / spawned processes.
- **Status:** CONFIRMED (code); load not executed

### ARCH-11 — Long-running streamed downloads vs serverless duration and bandwidth; no platform config
- **Severity:** P2
- **Category:** Infrastructure assumption
- **Blocks:** Website launch
- **Affected files:** `src/lib/ytdlp.server.ts:115` (8-min ladder budget), `src/lib/download-pool.server.ts:14` (45 s slot wait), `src/lib/youtube-stream.server.ts:277-296`, `src/routes/api/relay.ts`, `.vercel/output/functions/__server.func/.vc-config.json` (no `maxDuration`), no `vercel.json`
- **Description:** A save may wait 45 s for a slot, spend up to 8 min walking the ladder, then stream a multi-GB file through the function (`/api/builder`, `/api/ytdlp`, `/api/download`, `/api/relay` for googlevideo bytes, `/api/bypass`). No duration, memory or region is configured, so platform defaults apply (typical Vercel default is 300 s with Fluid compute — **NOT VERIFIED** for this project/plan). Streaming response size limits on Vercel **NOT VERIFIED**.
- **Evidence:** `const LADDER_BUDGET_MS = 8 * 60_000;`; `.vc-config.json` = `{"handler":"index.mjs","launcherType":"Nodejs","shouldAddHelpers":false,"supportsResponseStreaming":true,"runtime":"nodejs24.x"}`.
- **Real-world consequence:** Large downloads are cut off mid-stream; every served byte is billed as function egress; one popular video can dominate function concurrency.
- **Recommended fix:** Host extraction on long-lived compute (ARCH-01), or configure `maxDuration`/memory explicitly and redirect clients to signed direct URLs instead of proxying bytes.
- **Verification procedure:** Deploy a preview and time a 4K save; check function logs for timeout termination.
- **Status:** NOT VERIFIED (platform limits); CONFIRMED that no limits are configured

### ARCH-12 — Process-wide monkey-patching of DNS and the global undici dispatcher on import
- **Severity:** P2
- **Category:** Hidden global side effect
- **Blocks:** Neither
- **Affected files:** `src/lib/ipv4-bind.server.ts:15-63`, `package.json:4-6` (`sideEffects`), importers: all `/api/*` media routes, `youtube-client.server.ts`, `po-token.server.ts`, `ytdlp*.server.ts`
- **Description:** Importing the module replaces `dns.lookup` with a wrapper that forces `family: 4` for **every** lookup in the process, disables Happy Eyeballs, and installs a global undici `Agent({ allowH2:false, family:4 })`. It exists to fix a Grok sandbox IPv6/NAT mismatch.
- **Evidence:** `dns.lookup = ((hostname, options, callback) => { … family: 4 …})` (:30-37); `undici.setGlobalDispatcher(new undici.Agent({ allowH2: false, connect: { family: 4, autoSelectFamily: false } }))` (:54-56).
- **Real-world consequence:** IPv6-only services (some managed Postgres/pooler endpoints, auth broker, operator proxies) become unreachable from the whole process; HTTP/2 is disabled for every fetch; behaviour depends on module import order.
- **Recommended fix:** Apply IPv4 pinning per request (a dedicated undici `Agent` passed as `dispatcher` for YouTube fetches, `--force-ipv4` for yt-dlp) instead of global mutation; make it configurable.
- **Verification procedure:** In a Node REPL: `import("./src/lib/ipv4-bind.server.ts")` then `dns.lookup("ipv6.google.com", console.log)` → ENOTFOUND/ENODATA.
- **Status:** CONFIRMED (code)

### ARCH-13 — Every InnerTube request hard-depends on the proxy table
- **Severity:** P2
- **Category:** Coupling / availability
- **Blocks:** Website launch
- **Affected files:** `src/lib/youtube-client.server.ts:50-72` (`fetch: proxiedFetch`), `src/lib/user-proxy.server.ts:41-55,69-95`, `src/lib/user-proxy-repository-db.server.ts:77-88`
- **Description:** youtubei.js uses `proxiedFetch` for every request; `proxiedFetch` first calls `userProxyLadder("metadata")`, which converts **any** repository error into `ProxyRepositoryUnavailableError` and rethrows. Without `DATABASE_URL` it also forces the PGLite bootstrap on the first guest lookup.
- **Evidence:** `if (error instanceof Error) throw new ProxyRepositoryUnavailableError();` (`user-proxy.server.ts:52`); `const ladder = await userProxyLadder("metadata");` with no catch (`:73`).
- **Real-world consequence:** A database blip (Neon suspend, pool exhaustion — see ARCH-17) takes down search, lookup, transcripts and downloads for all users, including guests who never use the DB.
- **Recommended fix:** Treat an unavailable proxy repository as "no proxies" for the metadata path (log + direct fetch), and cache the route list with a stale-while-error policy.
- **Verification procedure:** Set `DATABASE_URL` to an unreachable host and call `resolveVideo` → fails with "The proxy route repository is unavailable."
- **Status:** CONFIRMED (code)

### ARCH-14 — Migrations run inside `npm run build`
- **Severity:** P2
- **Category:** Deploy process
- **Blocks:** Website launch
- **Affected files:** `package.json:13`, `scripts/migrate.mjs`, `migrations/0005_proxy_operations.sql`
- **Description:** `build` = `vite build && npm run db:migrate`. Every Vercel build — preview branches included — applies pending migrations to the `DATABASE_URL` it sees. If preview and production share the variable, an unmerged branch migrates production. `0005` uses plain `ALTER TABLE … ADD COLUMN` / `CREATE TABLE` (not idempotent) and relies solely on the `_migrations` bookkeeping; there is no down-migration.
- **Evidence:** `"build": "node scripts/with-app-env.mjs vite build && npm run db:migrate"`.
- **Real-world consequence:** Schema changes ship before code review completes; a failing migration fails the build; builds require network access to the production database.
- **Recommended fix:** Run migrations as an explicit release step (CI job gated on `main`), use separate DBs per environment, add rollback guidance.
- **Verification procedure:** Inspect Vercel project env scoping; run `DATABASE_URL=<scratch db> npm run build` and observe `[migrate] applied …`.
- **Status:** CONFIRMED (code)

### ARCH-15 — Dev-only / hidden behaviour reachable in production
- **Severity:** P2
- **Category:** Dev-only behaviour / hidden feature flags
- **Blocks:** Both
- **Affected files:** `src/lib/auth/client.ts:64-80`, `src/lib/auth/oauth-popup.ts:2-6`, `vite.config.ts:90-93` (`/auth/popup` `apply:"serve"`), `src/routes/index.tsx:72,101-105`, `src/lib/ytdlp-auth.ts:484-489`, `src/lib/sign-in-link-policy.ts:60-68`, `src/lib/sign-in-link.ts:80-109`, `src/lib/tool-versions.ts:194-207`, `extension/background.js:4`
- **Description:**
  - When the app is framed (any iframe) `signIn` opens `/auth/popup`, a route that exists only in `vite dev` → sign-in is broken in production embeds.
  - `/?v=<id>&auto=1` starts a download on page load from any external link.
  - `YTDLP_BROWSER` makes yt-dlp read the *server host's* browser cookies (`--cookies-from-browser`), a workstation feature.
  - The sign-in-link flow returns a login token to whoever asks; it opens automatically whenever auth is unconfigured and for any address when `VELO_SIGNIN_LINK=true` (the policy file itself calls it "an account-takeover primitive").
  - `proxyManagementDecision` allows **everyone** to manage egress proxies when auth is off and no DB is set.
  - Extension defaults point to `http://127.0.0.1:8080`.
- **Evidence:** `if (shouldUseOAuthPopup(window.location.hostname, framed)) { await openSignInPopup(providerId);` (`client.ts:70-72`); routeTree contains no `/auth/popup`; `if (!input.authConfigured && !input.databaseConfigured) return { allowed: true };` (`tool-versions.ts:199`).
- **Real-world consequence:** Broken login in embedded contexts, drive-by quota consumption, and several operator switches that turn a public deployment into an open system with one env change — none documented in README.
- **Recommended fix:** Document every flag in an env reference, drop workstation-only flags from production builds, require an explicit env to enable sign-in links, remove `auto=1` or require a user gesture, and serve a production popup route or disable popup mode outside the sandbox.
- **Verification procedure:** `npm run preview`, open `http://127.0.0.1:8081/login` inside an `<iframe>` and click a provider → 404/SPA page in the popup.
- **Status:** CONFIRMED (code)

### ARCH-16 — Hard-wired Grok platform hosts across the codebase
- **Severity:** P2
- **Category:** Undocumented infrastructure coupling
- **Blocks:** Both
- **Affected files:** `src/lib/auth/gate-identity.server.ts:123-149`, `src/lib/auth/preview.ts:24,32`, `src/lib/builder-env.ts:10-20`, `src/lib/preview-embedder-origin.ts`, `src/lib/hybrid-download.ts:205-206,257-285`, `extension/manifest.json:13-25`, `extensions/velo-session/manifest.json:7-17,31-40`, `extensions/velo-session/popup.js:13-33`
- **Description:** Behaviour branches on `grok.com`, `grok.me`, `*.grok-sandbox.com`, `app-builder-testing.com`, `gate.grok.me`, `auth.grok.me`. The gate-identity issuer is derived from the request `Host`/`X-Forwarded-Host`. The `velo-session` extension only injects into tabs on localhost or Grok hosts titled "Velo", so on any custom production domain "Send to Velo tab" cannot deliver cookies; it will also deliver them to *any* grok-hosted app whose title starts with "Velo".
- **Evidence:** `"matches": ["http://localhost/*","http://127.0.0.1/*","https://*.grok-sandbox.com/*","https://*.grok.com/*","https://grok.me/*","https://*.grok.me/*"]` (velo-session manifest); `if (host === "grok.me" || host.endsWith(".grok.me")) issuer = "https://gate.grok.me";` (gate-identity :143-145).
- **Real-world consequence:** The product only fully works on xAI's hosting; an OSS user on their own domain gets a partially broken app; host-header-derived trust decisions are fragile.
- **Recommended fix:** Centralise the public origin in one env (`PUBLIC_ORIGIN`), remove Grok hosts from the release build and extensions, and match extension content scripts to the configured production origin.
- **Verification procedure:** `grep -rn "grok" src extension extensions --include=*.ts --include=*.js --include=*.json | wc -l`.
- **Status:** CONFIRMED

### ARCH-17 — Three independent unbounded `pg` pools per process
- **Severity:** P2
- **Category:** Serverless DB connections
- **Blocks:** Website launch
- **Affected files:** `src/lib/db.ts:96`, `src/lib/auth/server.ts:148-157`, `src/lib/user-proxy-repository-db.server.ts:44-48`
- **Description:** App SQL, Better Auth and the proxy repository each create their own `new Pool({ connectionString })` with default `max` (10). The proxy pool has no `error` listener (the other two do).
- **Evidence:** `poolGlobal.__veloProxyPool__ = new Pool({ connectionString: databaseUrl });` (no `.on("error")`).
- **Real-world consequence:** Up to 30 connections per warm instance → Postgres/Neon connection limits reached quickly under scale-out; an idle-connection drop on the proxy pool emits an unhandled `error` event that can crash the process.
- **Recommended fix:** One shared pool (small `max`, pooled endpoint) exported from `db.ts` and injected into Better Auth and the proxy repository; attach an error handler.
- **Verification procedure:** `grep -rn "new Pool(" src`.
- **Status:** CONFIRMED

### ARCH-18 — Orphaned / unfinished functionality still exposed or shipped
- **Severity:** P2
- **Category:** Unfinished functionality
- **Blocks:** OSS release
- **Affected files:** `src/lib/multiplayer/{index,p2p}.ts`, `src/lib/app-data/*`, `src/routes/api/download.ts`, `src/lib/user-proxy.ts:72-83,112-153` (`listUserProxies`, `testUserProxy`), `scripts/sign-out-plan.mjs`
- **Description:** The WebRTC module polls `/api/rtc`, which does not exist and never existed (`git log --all -- 'src/routes/api/rtc*'` → empty). The `app-data` Grok connector client (Google Drive tools via `connectors.grok.me`) is imported by nothing. `/api/download`, `listUserProxies` and `testUserProxy` have no caller in the UI but are live, unauthenticated (`/api/download`) or authenticated RPC surface. `sign-out-plan.mjs` says it is "used by `src/lib/auth/client.ts`" but `client.ts` does not import it, so its tests test code that does not run.
- **Evidence:** import-graph reachability (auditor script) lists `src/lib/multiplayer/*`, `src/lib/app-data/*` as unreachable from any route; `grep -rn "sign-out-plan" src` → nothing.
- **Real-world consequence:** Attack surface and maintenance cost without product value; contributors are misled about what runs.
- **Recommended fix:** Delete the multiplayer and app-data modules, remove or wire `/api/download` and the two uncalled server functions, and either wire `sign-out-plan` into `client.ts` or delete it with its test. (Item list duplicated in `audit/17-codebase-cleanliness.md`.)
- **Verification procedure:** Re-run the reachability script; `grep -rn "/api/download\"\|listUserProxies\|testUserProxy" src/components src/lib | grep -v test`.
- **Status:** CONFIRMED

### ARCH-19 — Working tree is not a buildable commit
- **Severity:** P2
- **Category:** Release process
- **Blocks:** OSS release
- **Affected files:** `src/lib/transfer-progress.ts` (untracked), importers `src/lib/audio-encoder.ts`, `builder-download.ts`, `bulk-process.ts`, `bypass.ts`, `download-client.ts`, `home-actions.ts`, `hybrid-download.ts` (modified)
- **Description:** Seven modified files import the untracked `transfer-progress.ts`; HEAD contains no reference to it. Committing only the modified files (or releasing HEAD while testing the working tree) yields different programs.
- **Evidence:** `git grep -l "transfer-progress" HEAD -- src` → empty; `grep -rl "transfer-progress" src` → 9 files.
- **Real-world consequence:** A partial commit breaks the build; audit results on the working tree do not describe HEAD.
- **Recommended fix:** Commit the three untracked files together with the 27 modifications (or stash), then re-run typecheck/test/build on a clean clone.
- **Verification procedure:** `git stash -u && npm run typecheck` vs working tree.
- **Status:** CONFIRMED

### ARCH-20 — README claims that the implementation does not meet
- **Severity:** P2
- **Category:** Documentation mismatch
- **Blocks:** OSS release
- **Affected files:** `README.md`
- **Description:**
  - "MIT License" — there is no `LICENSE` file (`ls LICENSE*` → none).
  - "Encrypted Local & Server Vault: Stores cookies safely" — server rows are plaintext unless `VELO_VAULT_KEY` is set (`vault-crypto.ts:129-141`); there is no local vault (cookies are memory-only, `cookie-store.ts`).
  - "Python … optional" — required for every >720p save and absent on the deploy target (ARCH-01).
  - "Build for production and verify with browser smoke tests: `npm run build; node scripts/browser-smoke.mjs`" — the script defaults to `http://127.0.0.1:8080/` (the dev server) and only writes under `/workspace` or cwd (`scripts/browser-smoke-verdict.mjs:37-38`, `scripts/browser-guard.mjs:34-43`); it does not test the build.
  - Project structure lists `ui/ … Dialog` (no such component) and attributes captions to `youtube.server.ts` / the slot throttler to `ytdlp.server.ts` (now `youtube-captions.server.ts`, `download-pool.server.ts`).
  - Two sections numbered "### 5."; no environment-variable, deployment, or Vercel section; the InnerTube client list (5 clients) differs from code (14).
  - Marketing lines ("bypass rate limits", "Throttling Bypass", "PO Token minting to prevent bot-detection blocks") — REQUIRES LEGAL REVIEW (see ARCH-23).
- **Evidence:** as cited.
- **Real-world consequence:** OSS users cannot legally rely on the stated license, and will deploy insecurely following the README.
- **Recommended fix:** Add the LICENSE file (after legal review), an env/deploy section, correct the feature claims.
- **Verification procedure:** `ls LICENSE*`; read README against the cited files.
- **Status:** CONFIRMED

### ARCH-21 — No security headers anywhere; no platform config
- **Severity:** P2
- **Category:** Disabled/missing protections
- **Blocks:** Website launch
- **Affected files:** `server/middleware/grok-pwa.ts`, `vite.config.ts`, (absent) `vercel.json`
- **Description:** Apart from `/api/relay` (`CSP: sandbox`, `nosniff`) no response sets CSP, `frame-ancestors`/`X-Frame-Options`, HSTS, `Referrer-Policy` or `Permissions-Policy`. The preview bridge deliberately supports being framed.
- **Evidence:** `grep -rniE "x-frame-options|frame-ancestors|strict-transport|content-security-policy" src server scripts vite.config.ts` → only `src/routes/api/relay.ts:26`.
- **Real-world consequence:** Clickjacking of the cookie-import and Tools pages, no mitigation layer for XSS or for the third-party script (ARCH-06).
- **Recommended fix:** Add a header middleware (or `vercel.json` headers) with a strict CSP, `frame-ancestors 'none'` (or an explicit allowlist), HSTS.
- **Verification procedure:** `curl -sI http://127.0.0.1:8081/` after `npm run preview`.
- **Status:** CONFIRMED (code)

### ARCH-22 — No test/build CI; yt-dlp version not pinned in the repo
- **Severity:** P2
- **Category:** Build/release infrastructure
- **Blocks:** Both
- **Affected files:** `.github/workflows/auto-update.yml`, `scripts/auto-update.mjs:262-330`
- **Description:** The only workflow is a weekly dependency updater with `contents: write` / `pull-requests: write`; no workflow runs typecheck/test/lint/build on PRs. The workflow installs `yt-dlp` unpinned via pip; nothing in the repo (no `requirements.txt`/`pyproject.toml`) records the Python dependency, so the yt-dlp "update" part cannot produce a diff and production runs whatever yt-dlp the host has.
- **Evidence:** `run: python3 -m pip install --user "yt-dlp[default,curl-cffi]"`; `ls requirements* pyproject*` → none.
- **Real-world consequence:** Regressions merge unchecked; extraction behaviour differs per host.
- **Recommended fix:** Add a CI workflow (npm ci, typecheck, test, lint, build); add a pinned `requirements.txt` (with hashes) used by the image and by the updater.
- **Verification procedure:** `ls .github/workflows`.
- **Status:** CONFIRMED

### ARCH-23 — Design goal is circumvention of YouTube technical measures
- **Severity:** P1
- **Category:** REQUIRES LEGAL REVIEW (technical description only)
- **Blocks:** Both
- **Affected files:** `src/lib/po-token.server.ts` (BotGuard execution & token minting), `src/lib/nsig.ts`, `src/lib/stream-unlock.ts`, `src/lib/socks-pool.server.ts`, `src/lib/bypass*.ts`, `src/lib/ytdlp-auth.ts:358-413` (research notes on Invidious/Piped/Cobalt/Turnstile), `README.md` §4-5, `extension/README.md` ("official Google Chrome Extension")
- **Description:** TECHNICAL FINDING: the architecture's central purpose is to defeat YouTube's bot-detection (running BotGuard to mint proof-of-origin tokens), throttling (`n` parameter), IP binding (routing through rotating third-party proxies) and to operate on users' Google session cookies server-side. The extension README brands itself "official Google Chrome Extension". The auditor is not a lawyer; these facts are listed so that counsel can assess ToS, anti-circumvention and trademark exposure before either release.
- **Evidence:** `REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"` + `GenerateIT` flow (`po-token.server.ts:27,256-278`); README headings quoted in the brief.
- **Real-world consequence:** REQUIRES LEGAL REVIEW.
- **Recommended fix:** Legal review before OSS publication or public launch; remove "official Google" wording regardless.
- **Verification procedure:** n/a (legal).
- **Status:** CONFIRMED (technical facts)

### ARCH-24 — Whole-file buffering in the browser; in-memory mux
- **Severity:** P3
- **Category:** Scalability limit
- **Blocks:** Neither
- **Affected files:** `src/lib/hybrid-net.ts:59-70`, `src/lib/mux-client.ts:20-28`, `src/lib/download-client.ts:60-69`
- **Description:** Every path reads the full response into a `Blob` before saving; the mediabunny mux uses a `BufferTarget` with in-memory fast-start and is capped at ~15 % of `deviceMemory` (a `ponytail:` note acknowledges the ceiling). The File System Access writable is opened but written in one shot.
- **Evidence:** as cited.
- **Real-world consequence:** 4K / long files fail or crash tabs on phones and low-RAM devices; no resume.
- **Recommended fix:** Stream to the picker writable (`response.body.pipeTo(writable)`), use fragmented MP4 output for browser muxing.
- **Verification procedure:** Save a >1.5 GB preset on a 4 GB device profile.
- **Status:** CONFIRMED (code)

### ARCH-25 — `/tmp`-based caches sized near typical serverless limits
- **Severity:** P3
- **Category:** Filesystem writes
- **Blocks:** Neither
- **Affected files:** `src/lib/download-pool.server.ts:15-18` (400 MB mux cache), `src/lib/ytdlp.server.ts:128` (per-download tmp dirs), `src/lib/socks-pool.server.ts:22-23`
- **Description:** The mux cache (up to 400 MB) plus concurrent yt-dlp working dirs (each up to a full 1080p/4K pair + merged output) live in `os.tmpdir()`. On serverless `/tmp` is small and per-instance (size **NOT VERIFIED** for this plan).
- **Evidence:** `const CACHE_MAX_BYTES = 400 * 1024 * 1024;`.
- **Real-world consequence:** ENOSPC failures under concurrency; cache hit rate near zero across instances.
- **Recommended fix:** Size caches from available disk, or move to object storage / drop the cache on serverless.
- **Verification procedure:** Concurrent 4K saves on a host with a 512 MB tmpfs.
- **Status:** NOT VERIFIED (platform)

### ARCH-26 — Health endpoint checks only the database
- **Severity:** P3
- **Category:** Observability
- **Blocks:** Neither
- **Affected files:** `src/routes/api/health.ts`
- **Description:** `/api/health` reports DB reachability only; the extraction dependencies (Python/yt-dlp probe, BotGuard mint, InnerTube reachability) that actually break are not reported, and `pglite` counts as healthy (ARCH-03).
- **Evidence:** `checks: { database: { source: dbSource, ...db } }`.
- **Real-world consequence:** Monitors stay green while every download fails.
- **Recommended fix:** Add a `?deep=1` extraction check using the existing `ensurePython()` probe and cached mint status; treat `pglite` in production as degraded.
- **Verification procedure:** `curl /api/health?deep=1` on a host without Python → 200.
- **Status:** CONFIRMED

---

## Not verified / out of scope

- No live Vercel deployment was available: availability of `python3`/`curl`/`npm`/`node`-on-PATH in the Vercel Node runtime, function duration and streaming/body limits, `/tmp` size and multi-instance behaviour are NOT VERIFIED (ARCH-01, -02, -07, -11, -25).
- The broker's rejection of non-sandbox callbacks for the preview client is inferred from `preview.ts` comments, not tested.
- No live YouTube traffic was generated by this auditor.
- Security specifics (secret exposure, SSRF, XSS, auth bypass) are only described where they are architectural; see the security audit files. License/ToS/trademark conclusions are out of scope (REQUIRES LEGAL REVIEW).
- Test suite, typecheck and build health were not re-run by this auditor (owned by other auditors); ESLint was run read-only for the cleanliness report.
