# Velo — Architecture

> Audience: developers who have never seen this repository.
> Scope: branch `hardening/w2-auth` as of 2026-09-24, at `d808bc6` plus the commit that brings
> this file up to date (W0, W1 and W2 of the hardening roadmap applied; W3 to W8 not yet).
> Method: read from source. Every statement cites the file it comes from. Where behaviour depends on
> the hosting platform and could not be tested, it is marked **NOT VERIFIED**.

---

## 1. What the product does

Velo is a single-page web app (plus two browser extensions) that:

1. **Resolves a YouTube URL / search / playlist** into metadata, formats (itags), caption tracks,
   chapters and "presets" (1080p, 720p, audio, …) — `src/lib/youtube.server.ts`, `src/lib/youtube.ts`.
2. **Downloads a file** to the user's disk, trying a ladder of server-side and browser-side paths
   (InnerTube direct, yt-dlp subprocess, free public SOCKS5 proxies, public CORS relays,
   operator-configured proxies) and, when needed, **muxes video+audio in the browser** with
   `mediabunny` — `src/lib/download-client.ts`, `src/lib/builder-download.ts`,
   `src/lib/hybrid-download.ts`, `src/lib/ytdlp.server.ts`.
3. **Transcript studio**: fetches captions (InnerTube timedtext, then yt-dlp), shows a
   click-to-seek reader, exports TXT/SRT/VTT/JSON, NLE markers (Resolve CSV, FCPXML, EDL,
   Audacity) and AI prompt templates — `src/lib/youtube-captions.server.ts`, `src/lib/transcript.ts`,
   `src/lib/nle-export.ts`.
4. **Bulk queue**: extracts links from pasted text/playlists, runs 1–3 concurrent downloads with
   staggered starts, exports yt-dlp shell scripts / URL lists / JSON manifests —
   `src/lib/bulk-download.ts`, `src/lib/bulk-queue-run.ts`, `src/lib/bulk-process.ts`.
5. **Channel watch**: reads a channel's public Atom feed through `/api/feed` and keeps a local
   watch list — `src/routes/api/feed.ts`, `src/lib/watch-feed.ts`, `src/lib/watch-store.ts`.
6. **Audio studio**: re-encodes a downloaded audio stream in the browser with `ffmpeg.wasm`
   (profiles, loudness normalisation, cover art) — `src/lib/audio-encoder.ts`,
   `src/lib/audio-profiles.ts`.
7. **Session credential vault**: users import their Google/YouTube cookies (Netscape, JSON, HAR,
   or via the `velo-session` extension); signed-in users can store them server-side
   (AES-256-GCM only if `VELO_VAULT_KEY` is set) and they are forwarded to yt-dlp —
   `src/lib/cookies.ts`, `src/lib/vault.ts`, `src/lib/vault-crypto.ts`.
8. **Tools tab (operator console)**: shows installed vs latest `youtubei.js`, `bgutils-js`,
   `yt-dlp`; lets an operator run `npm install` / `pip install` on the live server; manages
   operator HTTP/SOCKS5 egress proxies with a durable validation history —
   `src/lib/tool-updates*.ts`, `src/lib/user-proxy*.ts`, `src/lib/proxy-*.ts`.

Other features visible in the UI: SponsorBlock segments (browser → `sponsor.ajay.app`), HAR import
diagnostics, thumbnail extractor, time-range "clip" command generator, keyboard shortcuts,
command palette (`cmdk`).

The repo was scaffolded from the **Grok App Builder** template. W2 removed its platform glue: the auth broker, gate identity, PWA/branding injector, preview bridge, dev-server plugins, sandbox scripts and connectors. The template-derived code that remains awaits licensing review (W9).

---

## 2. Repository map

```
AGENTS.md                 short note for coding agents (points to the hardening roadmap)
vite.config.ts            Vite 8 + TanStack Start + Nitro (node-server preset, build/preview only) + dev-only PGLite bootstrap
server/plugins/           Nitro plugin env.ts: forces NODE_ENV=production and validates the config before the server listens
scripts/                  migrate/test/update tooling and repository policy tests
migrations/               SQL schema (applied to DATABASE_URL by `npm run db:migrate`, or on first use to the dev PGLite)
public/                   static assets (favicon; the velo-session extension zip + unpacked copy were removed in W0-T3)
extension/                "Velo" Chrome MV3 extension (in-page buttons, queue, transcript popup) — not packaged/served
extensions/velo-session/  "Velo YouTube Session" MV3 extension (cookie exporter) — source only, no longer served; stays until W6
src/routes/               TanStack file routes: /, /login, /api/*
src/components/           React UI
src/lib/                  everything else (client libs, *.server.ts server modules, tests *.test.ts)
```

Server-only modules follow the `*.server.ts` naming convention; files without it may be bundled
for the browser, which is why many server functions `await import()` their server dependencies
inside the handler (`src/lib/tool-updates.ts:9-13`).

---

## 3. Frontend architecture

### 3.1 Routes

| Route | File | Purpose |
|---|---|---|
| `/` | `src/routes/index.tsx` | The whole app. Tabs ("modes"): single, bulk, transcript, watch, tools (tools only when signed in, `index.tsx:35`). |
| `/login` | `src/routes/login.tsx` | "Continue with Google" (Better Auth social sign-in, full-page redirect); "Sign-in is not set up" when the Google credentials are absent (development only); OAuth failures arrive as `?error=<code>`. |
| document shell | `src/routes/__root.tsx` | `<AuthProvider>` (sonner toaster), favicon and stylesheet links. |
| router | `src/router.tsx` | `getRouter()` with `AppErrorComponent` / `AppNotFound`. |

Query-string flags read by `/` (`index.tsx:49-80`): `tab=bulk|transcript|watch|tools`, `batch=<ids>`,
`v|url|q=` (deep link → immediate lookup), `preset=`, `lang=`, `auto=1` (**auto-starts a download
after lookup**, `index.tsx:101-105`), `cookie_sync=1` (opens the cookie importer). These are the
extension ↔ app contract.

### 3.2 Main components

| Component | Role |
|---|---|
| `home-layout.tsx` | header (`app-header.tsx`, `account-chip.tsx`), history rail, command palette, mode tabs |
| `home-single.tsx` → `video-panel.tsx` (1 935 lines) | video details, preset picker, formats/captions/chapters/SponsorBlock/pipeline/trimmer/thumbnail sections, embedded `transcript-viewer.tsx` and `audio-studio.tsx` |
| `save-stage.tsx`, `step-log.tsx` | download progress & per-path step log |
| `home-modes.tsx` | switches to `bulk-downloader.tsx`(→`bulk-view.tsx`), `transcript-studio.tsx`(→`transcript-view.tsx`→form/reader/sidebar), `watch-panel.tsx`, `tools-panel.tsx`(→`proxy-tools-card.tsx`) |
| `cookie-import.tsx`, `session-guide.tsx`, `har-report.tsx` | cookie vault UI, per-browser export guides, bookmarklets, extension download link |
| `ui/*` | small shadcn-style primitives (button, badge, input, skeleton; `separator.tsx` is unused) |

Two separate transcript UIs exist: `transcript-viewer.tsx` (inside the video panel) and the
`transcript-studio` tree (Transcript tab).

### 3.3 Client state

| Store | File | Persistence |
|---|---|---|
| history (per-account "shelves") | `src/lib/history-store.ts` (zustand `persist`, key `velo-history`) | localStorage |
| watch list | `src/lib/watch-store.ts` (zustand `persist`) | localStorage |
| cookie jar | `src/lib/cookie-store.ts` | memory only; the legacy `velo-yt-cookies` key is actively scrubbed (`cookie-store.ts:14-20`); sent to the server only when signed in (`cookiesForDownload`, :46-49) |
| HAR diagnostics | `src/lib/har-store.ts` | memory |
| draft URL | `src/lib/home-draft.ts` | sessionStorage |
| guest id | `src/lib/guest-id.ts` (`velo-guest-id`) | localStorage; sent as `x-velo-guest` header |
| downloaded media ("Recent") | `src/lib/media-cache.ts` (IndexedDB `velo-media`/`files`, ≤4 items / 180 MB, owner-scoped) | IndexedDB, `navigator.storage.persist()` requested |
| tools badge | `mode-tabs.tsx`, `use-tools-badge.ts` | localStorage timestamp |

### 3.4 Client-side download / mux pipelines

All pipelines end in `saveMediaBlob()` (`src/lib/builder-save.ts:96`): write to the File System
Access writable opened synchronously on click (`beginBuilderSave`, so framed previews keep the user
gesture), else `<a download>` + `window.open` fallback; the blob is also stored in the IndexedDB
media cache. **Every path buffers the whole file in browser memory as a `Blob`** (`readBlob`,
`src/lib/hybrid-net.ts:59`); the browser mux additionally holds a full in-memory MP4
(`Mp4OutputFormat({ fastStart: "in-memory" })`, `src/lib/mux-client.ts`) and refuses files larger than
~15 % of device RAM (`download-client.ts:60-69`).

| Pipeline | Entry | What it does |
|---|---|---|
| **Builder** (first choice) | `downloadViaBuilder` (`src/lib/builder-download.ts:129`) | mints a PO token via the `mintPoToken` server fn, then races **`POST /api/builder`** (server does everything, bytes come back through this origin) against **client same-hop** `fetchSameHopBlob` (`src/lib/bypass.ts:337`). Video-only itags skip the race and use the server only. |
| **Client same-hop ("Velo unlock")** | `fetchSameHopBlob` (`bypass.ts`) | the *browser* fetches the YouTube watch page through `proxy.corsfix.com` / `api.allorigins.win`, extracts `ytInitialPlayerResponse`, asks `POST /api/unlock` (or the `decipherCipher` server fn) to decipher sig/nsig and stamp a PO token, then downloads the media **through the same public relay** (so the relay's IP matches the `ip=` in the URL); HLS fallback stitches segments. |
| **Hybrid race** (escalation) | `hybridFetchBlob` (`src/lib/hybrid-download.ts:175`) | mints POT, then races: same-hop bypass, `POST /api/ytdlp`, and "relay" (`resolvePlayback` server fn → try the googlevideo URL via `proxyFetch` → `/api/relay` → finally `GET /api/bypass`). |
| **Hybrid mux** | `hybridMux` (`src/lib/download-client.ts:71`) | when a preset needs separate video+audio: two `hybridFetchBlob`s in parallel then `muxVideoAudio` (mediabunny, copy-mux, MP4 or WebM). |
| **Audio studio** | `audio-studio.tsx` → `encodeAudio` (`src/lib/audio-encoder.ts:110`) | source from IndexedDB cache or `hybridFetchBlob`; ffmpeg.wasm core (~32 MB `ffmpeg-core.wasm`, bundled as a same-origin asset via `?url`) runs in a module worker, one job at a time. |
| **Muxed fallback prompt** | `runHomeDownload` (`src/lib/home-actions.ts:167-180`) | if a separate-stream preset fails with an "escalate" error, offer itag 22/18 to the user instead of silently downgrading. |

### 3.5 Main download flow (diagram)

```
 user clicks Save (index.tsx → home-actions.runHomeDownload)
        │  beginBuilderSave()  ── opens showSaveFilePicker in the click tick
        ▼
 downloadPresetFile (download-client.ts:157)
        │
        ├─(1)─ downloadViaBuilder ──► server fn mintPoToken ──► po-token.server (BotGuard in jsdom)
        │        │
        │        ├── race ──► POST /api/builder {id,itag,cookies?,pot}
        │        │               cookiesNeedSession → downloadQuotaResponse (in-memory buckets)
        │        │               builder.server.streamBuilderDownload
        │        │                 itag 18/22: youtube-stream.streamYoutubeDownload (InnerTube + nsig + POT,
        │        │                             4 parallel range lanes)   ─► else ▼
        │        │                 ytdlp.server.downloadWithYtdlp
        │        │                   mux cache /tmp/velo-mux-cache (anon only) / coalesce id.itag
        │        │                   acquireYtdlpSlot (4 per process, queue 32, 45 s wait)
        │        │                   muxOne ladder (≤ 8 min budget):
        │        │                     a) operator proxies (DB, trusted: cookies allowed)
        │        │                     b) direct probe (first client) unless "direct blocked" (15 min)
        │        │                     c) up to 3 free SOCKS5 hops (proxifly list, no cookies)
        │        │                     d) direct, remaining clients
        │        │                   → python3 -m yt_dlp … -o /tmp/velo-ytdl-*/media.%(ext)s
        │        │                   ← file streamed back (createReadStream)
        │        │
        │        └── race ──► fetchSameHopBlob (browser) ──► corsfix / allorigins (watch page)
        │                         └► POST /api/unlock (decipher + POT) └► media via same relay
        │
        ├─(2)─ on escalation: single stream → downloadViaHybrid ; A+V preset → hybridMux
        │        hybridFetchBlob race: [same-hop bypass] [POST /api/ytdlp] [resolvePlayback →
        │        googlevideo direct / GET /api/relay → GET /api/bypass (server same-hop via relays)]
        │        hybridMux: 2× hybridFetchBlob → mediabunny muxVideoAudio (in-memory)
        │
        ▼
 saveMediaBlob → picker writable | <a download> ; putCachedMedia (IndexedDB)
 history-store.record(...)
```

---

## 4. Backend architecture

Runtime: TanStack Start SSR + server functions compiled by Nitro 3 (beta `3.0.260610-beta`,
preset `node-server`, `vite.config.ts`) into **one** long-lived Node process,
`.output/server/index.mjs`, started by `npm start`. It listens on `NITRO_PORT ?? PORT` (default
3000) on all interfaces unless `NITRO_HOST`/`HOST` is set. Before it listens, the Nitro plugin
`server/plugins/env.ts` forces `NODE_ENV=production` and calls `loadServerEnv()`, so a missing
required variable exits the process. All `/api/*`, server functions and SSR share that process and
its in-process state.

### 4.1 HTTP API routes (`src/routes/api/*`)

| Route | Method | Auth | Rate control | What it does |
|---|---|---|---|---|
| `/api/builder` | POST (GET → 405) | none; `cookies` requires a valid session (`cookiesNeedSession`) | download bucket, cost 1 | `streamBuilderDownload` (InnerTube for 18/22, else yt-dlp ladder); 503 `code:"queue"` when the yt-dlp pool is full |
| `/api/ytdlp` | POST | as above | download bucket, cost 1 | `downloadWithYtdlp` directly |
| `/api/download` | GET `?id&itag` | none | download bucket | InnerTube stream; on 403/throw falls back to `streamSameHop`. **No caller in the current UI.** |
| `/api/bypass` | GET `?id&itag` | none | download bucket | `streamSameHop` — server fetches watch page and media through corsfix/allorigins |
| `/api/unlock` | POST `{url|signatureCipher|cipher, videoId?, cpn?, pot?}` | none | download bucket | server-side decipher (nsig), optional POT mint, returns unlocked URL + analysis |
| `/api/relay` | GET `?url=` | none | googlevideo host → download bucket; YouTube page hosts → metadata backstop | fetches `https://*.youtube.com|youtube-nocookie|ytimg|ggpht|googlevideo` URLs; page/image hosts additionally fall back to corsfix/allorigins; one redirect hop only if it stays on an allowed host; response gets `CSP: sandbox` + `nosniff` |
| `/api/captions` | GET `?id&lang&vss` | none | metadata backstop | `streamYoutubeCaptions` (InnerTube timedtext → yt-dlp) |
| `/api/feed` | GET `?channelId|channel` | none | metadata backstop | resolves @handle via youtube.com HTML, fetches `feeds/videos.xml`, `Cache-Control: public, max-age=600` |
| `/api/health` | GET `?deep=1` | none | none | DB ping (`select 1`, optional `to_regclass('verification')`), returns `neon`/`pglite` |
| `/api/auth/$` | GET/POST | Better Auth | Better Auth's built-in production limiter: `/sign-in/*` 3 per 10 s per client IP, in memory, IP from `X-Forwarded-For` (W5 sets the trusted IP source) | Better Auth handler: Google sign-in (`/sign-in/social`, `/callback/google`), `get-session`, `sign-out` |

The dev server adds no routes. The production build boots through `server/plugins/env.ts`, which sets `NODE_ENV=production` and exits non-zero when `loadServerEnv()` (`src/lib/env.server.ts`) reports missing or invalid configuration.

### 4.2 Server functions (`createServerFn`) — 29 handlers (+1 alias)

`authMiddleware` (`src/lib/auth/middleware.ts`) = Fetch-Metadata same-site check (`isolation.server.ts`) + `requireUserId` (`verify.server.ts`): the verified user of the `__Host-velo.session_token` cookie, else `UnauthorizedError` (401). There is no shared or fallback user in any environment.

| File | Function | Method | Auth / gate |
|---|---|---|---|
| `resolve-video.ts` | `resolveVideo`, `searchVideos`, `resolvePlaylist`, `resolveBulkVideos` (≤50 ids), `fetchTranscript`, `resolvePlayback`, `decipherCipher`, `mintPoToken` | POST | **none**; per-IP metadata backstop only (`assertMetadataBudget`) |
| `sign-in-link.ts` | removed in W0-T4 (copy-paste sign-in link) | — | — |
| `session-isolation.ts` | removed in W2 — its one-login policy runs in Better Auth's session hooks (`auth-config.server.ts`) | — | — |
| `auth/status.ts` | `getSignInStatus` → `{ google: boolean }` (whether Google sign-in is configured) | GET | **none** (public; the `/login` loader calls it) |
| `vault.ts` | `loadVault`, `saveVault`, `clearVault`, `validateVaultSession` (probes youtube.com with the cookies) | GET/POST | `authMiddleware`, rows scoped by `user_id` |
| `tool-updates.ts` | `checkToolUpdates` | GET | `authMiddleware`; returns `canUpdate` |
| | `updateTool` (`npm install <pkg>@latest --save` / `pip install --upgrade`) | POST | `authMiddleware` + `operatorGate` (duplicated in-file copy) |
| `user-proxy.ts` | `listUserProxies`, `listProxyOperations` | GET | `authMiddleware`; data masked unless `proxyManagementGate` |
| | `addUserProxy`, `removeUserProxy`, `testUserProxy`, `runAllProxyValidations` (=`startProxyValidationRun`), `clearProxyHistory`, `setProxyRouteEnabled`, `reorderProxyRoutes`, `testProxyValidation`, `cancelProxyValidationRun`, `resumeProxyValidationRun` | POST | `authMiddleware` + `proxyManagementGate` |
| | `getProxyValidationRun`, `listProxyHistoryPage` | GET | `authMiddleware` + `proxyManagementGate` |

`operatorGate` (`src/lib/operator-gate.server.ts`, duplicated at `tool-updates.ts:32-61`):
auth configured → user's **verified** email must be in `VELO_ADMIN_EMAILS`; auth not configured →
only if `VELO_ALLOW_TOOL_INSTALL=1` and the socket address is loopback.
`proxyManagementGate` (`tool-versions.ts:194-207`): auth off **and** no DB → allowed for everyone;
auth off with DB → denied; auth on → operator gate. Since W2 the "auth not configured" branches of both gates are unreachable: `authMiddleware` answers 401 first when Google is not configured. W4a removes them with the runtime installer.

`listUserProxies` and `testUserProxy` have no caller in the UI.

### 4.3 Extraction fallback ladder

**Metadata** (`resolveYoutubeVideo`, `src/lib/youtube.server.ts:29`):

1. `getClient()` — one shared `youtubei.js` `Innertube` per process, 4 h TTL, `retrieve_player`,
   `fetch: proxiedFetch` (rides operator HTTP proxies first, then direct —
   `src/lib/user-proxy.server.ts:69`). `Platform.shim.eval = (data) => new Function(data.output)()`
   evaluates YouTube player JS in the server process (`youtube-client.server.ts:8`).
2. Mint a GVS PO token (`mintContentPoToken`).
3. `getBasicInfo` over 14 InnerTube clients in windows of 3
   (`WEB_EMBEDDED, TV_EMBEDDED, TV_SIMPLY, VISIONOS, IOS, MWEB, TV, YTMUSIC, YTMUSIC_ANDROID,
   YTSTUDIO_ANDROID, YTKIDS, WEB_CREATOR, ANDROID, WEB`), POT for web-family clients; first
   `OK`+formats wins; cached 10 min (30 s for degraded answers), 200 entries.
4. If no ≥1080p format: `listYtdlpFormats` (`yt-dlp -J`, takes a pool slot; direct → free SOCKS hop).

**PO token** (`src/lib/po-token.server.ts`): fetch `https://www.youtube.com/`, parse `ytcfg` and the
`ytAtN` BotGuard challenge, download the interpreter script from the URL YouTube names, run it
with `new Function` against a `jsdom` window **bound onto `globalThis.window/self/document`**
while it runs (documented concurrency hazard, :79-90), `BotGuardClient.snapshot`, `POST
https://www.youtube.com/api/jnn/v1/GenerateIT`, `WebPoMinter`; tokens cached 4 h per video/slot
(400 entries); on failure a cold-start token cached 90 s.

**nsig / signature** (`src/lib/nsig.ts`, `youtube-stream.server.ts:157`): `player.decipher` of the
youtubei.js player with a process-wide nsig cache; `stream-unlock.ts` stamps `pot`, `cpn`, strips
`alr`, rewrites to `redirector.googlevideo.com`.

**Media**:
- InnerTube direct (`streamYoutubeDownload`): 2 KB probe, then 4 parallel `range=` lanes for files
  > 8 MB (`orderedParallelStream`), via `proxiedFetch`.
- yt-dlp (`ytdlp.server.ts:118` `muxOne`), argv built by `ytdlpArgv` (`src/lib/ytdlp-auth.ts:505`):
  ```
  <VELO_PYTHON|PYTHON_BIN|python3> -m yt_dlp --no-js-runtimes --js-runtimes node
    [--force-ipv4 | --proxy socks5h://… ]  [--cookies <tmp>/cookies.txt | --cookies-from-browser $YTDLP_BROWSER]
    --add-headers Accept-Language:en-US,en;q=0.9  [--impersonate chrome|safari]
    --remote-components ejs:github
    --extractor-args "youtube:player_client=<c>;player_js_variant=main[;visitor_data=…][;data_sync_id=…][;fetch_pot=never;po_token=<c>.gvs+…,<c>.player+…]"
    --no-playlist --newline --check-formats  <THROTTLE_FLAGS>  --merge-output-format mp4/mkv
    -f <selector e.g. 137+140/137+251/96>  -o <tmpdir>/media.%(ext)s  https://www.youtube.com/watch?v=<id>
  ```
  `THROTTLE_FLAGS` (`throttle.ts`): `--retries 1 --fragment-retries 10 --extractor-retries 3
  --retry-sleep linear=1:4:2 --throttled-rate 100K --http-chunk-size 10M --concurrent-fragments 1
  --socket-timeout 20 --sleep-requests 0.2`. On "requested format is not available" the `-f`
  selector is widened once. Clients: guests `socksClientsForItag` ∪ `visionos, web_embedded,
  tv_simply, android`; cookies `web_embedded, tv_downgraded, web, mweb, web_safari`. Stall timeout
  45 s / 180 s per attempt, 2 attempts, 8 min ladder budget. Failures are classified from stderr
  into retry / next-client / next-socks / stop (`classifyYtdlpFailure`).
- **Cookie rule**: the cookie file and `--cookies-from-browser` are never passed over a free-pool
  SOCKS hop (`ytdlp.server.ts:178`, `ytdlp-auth.ts:537-541`); logged-in sessions skip the free pool
  entirely (`ytdlp.server.ts:242,255`). Operator ("trusted") proxies do carry cookies.
- **SOCKS same-hop** (`src/lib/socks-pool.server.ts`): list from `VELO_SOCKS_PROXY`/`ALL_PROXY`,
  `/tmp/velo-socks-good.json`, and `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/…/socks5/data.json`;
  each candidate probed with `curl -sS -m 7 -x <proxy> https://redirector.googlevideo.com/generate_204`
  (10 in parallel, ≤45 s, keep 6); cache 8 min; dead list 15 min in `/tmp/velo-socks-dead.json`.
- **CORS-relay same-hop** (`bypass.server.ts` server side, `bypass.ts` client side):
  `https://proxy.corsfix.com/?<url>` and `https://api.allorigins.win/raw?url=<url>` fetch the watch
  page **and the media bytes** (`bypass.server.ts:116`).

### 4.4 Data stores & migrations

- `DATABASE_URL` set → `pg` pools (**three separate pools per process**: `src/lib/db.ts:96`,
  `src/lib/auth/server.ts:149`, `src/lib/user-proxy-repository-db.server.ts:47`), labelled "neon".
- Unset → embedded **PGLite** in memory, one instance per process on `globalThis`
  (`db.ts:115-175`), migrations applied at first use via `import.meta.glob("/migrations/*.sql")`;
  Better Auth reaches it through a custom Kysely dialect (`src/lib/auth/pglite-dialect.ts`).
  This is a development fallback only: production boot requires `DATABASE_URL`. In dev,
  `pgliteBootstrapPlugin` (`vite.config.ts`) applies the migrations before the first request.
  The build still ships PGLite (Nitro copies it to `.output/server/_libs/`), but the production
  server never selects it. Data is lost whenever the process ends.
- Migrations (`migrations/*.sql`, applied by basename, tracked in `_migrations`):
  `0001_auth.sql` (Better Auth `user/session/account/verification`), `0002_youtube_vault.sql`
  (`youtube_vault(user_id, cookies, cookie_count, updated_at)`), `0003_verification_value_idx.sql`,
  `0004_user_proxies.sql` (`velo_proxy`), `0005_proxy_operations.sql` (proxy health columns,
  `velo_proxy_validation_run/_result/_evidence`, `velo_proxy_event`), `0006_google_only_auth.sql`
  (W2: ends every session, drops verification rows, deletes accounts of the removed providers,
  users left without one and their `youtube_vault` rows).
- Deploy-time: `npm run build` is `vite build` only and never touches a database.
  `npm run db:migrate` (`scripts/migrate.mjs`) is a separate step that applies pending files to
  `DATABASE_URL`. Migrations are backward-compatible and run as their own approved step before the
  new code serves. The W2 release is the exception: run `0006` (data only) right after the new
  code is live, so the old code cannot recreate broker rows in between (W2 plan, Task 13).

### 4.5 Auth modes

| Mode | Condition | Behaviour |
|---|---|---|
| **Google (production)** | always: boot requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Better Auth `google` social provider, `baseURL = VELO_PUBLIC_ORIGIN`, redirect URI `${VELO_PUBLIC_ORIGIN}/api/auth/callback/google`, `prompt=select_account`; `trustedOrigins = [VELO_PUBLIC_ORIGIN]`. Cookies `__Host-velo.*` (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain), 5-min `session_data` cookie cache. Sessions store no IP or user agent, and a new sign-in ends the user's other sessions. OAuth errors redirect to `/login?error=<code>`. Config: `src/lib/auth/auth-config.server.ts`. |
| **Google (development)** | `GOOGLE_*` set | as above on `http://localhost:${VELO_DEV_PORT ‖ 8080}`; `trustedOrigins` adds the `localhost` and `127.0.0.1` dev origins; the secret is a random per-process value unless `BETTER_AUTH_SECRET` is set. Open the app at `http://localhost:<port>`, not `127.0.0.1`: the OAuth state cookie is host-bound and the callback returns to `localhost`, so a sign-in started on `127.0.0.1` fails. |
| **Sign-in unavailable (development)** | `GOOGLE_*` unset | no provider; `/login` says sign-in is not set up; every `authMiddleware` function answers 401. |

Removed in W2: the app-builder broker (`genericOAuth`), gate identity JWT, `bearer()` plugin, preview popup and email/password. Removed in W0: the committed preview client and the sign-in link.

### 4.6 In-process background work, queues and caches

All of the following live in module memory (or `/tmp`) of one server process; a restart clears
them, and each extra instance behind a load balancer would have its own copy.

| Item | File | Notes |
|---|---|---|
| Download quota buckets (guest/user/ip/meta, token bucket + sliding window, ≤4 000 rows) | `guest-limit.server.ts` | identity: user id → `x-velo-guest`/cookie → IP; IP from `x-vercel-forwarded-for` → `x-real-ip` → last `x-forwarded-for` hop (Cloudflare headers only with `TRUST_CLOUDFLARE=1`). The first two are trusted unconditionally, a Vercel-era assumption: on any other host a client can set them. W5 replaces this (C8, `VELO_TRUST_PROXY`) |
| yt-dlp slot pool (4 concurrent, 32 queued, 45 s) | `download-pool.server.ts` | |
| Mux file cache (4 files / 400 MB / 10 min) + coalescing by `id.itag` | `download-pool.server.ts` → `/tmp/velo-mux-cache` | anonymous downloads only |
| yt-dlp tmp dirs `velo-ytdl-*` swept every 10 min | `ytdlp-python.server.ts` | |
| Python probe, `PySocks`/`curl_cffi` auto-install (runtime `pip install`) | `ytdlp-python.server.ts:100-145` | |
| "direct yt-dlp blocked" bit (15 min) | `ytdlp-python.server.ts` | |
| SOCKS pool cache/in-use set + `/tmp` good/dead files | `socks-pool.server.ts` | |
| InnerTube client (4 h), playable-info cache, nsig cache, format cache | `youtube-client.server.ts`, `nsig.ts`, `ytdlp-meta.server.ts` | |
| BotGuard minter (6 h) + token cache | `po-token.server.ts` | |
| npm/PyPI "latest" cache (10 min), single install lock | `tool-updates.server.ts` | |
| Proxy route list cache, undici `ProxyAgent`s, validation-run abort controllers | `user-proxy-repository.server.ts`, `proxy-fetch.server.ts`, `proxy-run-service.server.ts` | runs leased in DB (`lease_expires_at`, 120 s); cancellation polled every 250 ms |
| Dev auth secret (dev only) / proxy key fallback | `env.server.ts`, `vault-crypto.ts` | random per process when unset outside production; W3 moves the proxy key to `VELO_PROXY_SECRET_KEY` |
| Better Auth rate-limit counters | `better-auth` (memory) | per process |

Module-level side effects on import: `ipv4-bind.server.ts` (listed in `package.json#sideEffects`)
globally replaces `dns.lookup` with an IPv4-only wrapper, disables Happy Eyeballs and installs a
global undici `Agent({ allowH2:false, family:4 })` for the whole process (`ipv4-bind.server.ts:15-63`).

### 4.7 Subprocesses

| Command | Where | argv |
|---|---|---|
| `python3 -m yt_dlp …` | `ytdlp.server.ts` via `run` (`proc-run.server.ts`) and `runCapture` (`ytdlp-proc.server.ts`, `detached: true`, tree-kill) | see §4.3; `-J` for formats; subtitle variant in `ytdlp-meta.server.ts` |
| `python3 -m yt_dlp --version` | `ensurePython` | probe |
| `python3 -c "import socks"` / `"import curl_cffi"` then `python3 -m pip install --quiet PySocks|curl_cffi` | `ytdlp-python.server.ts:115-120` | triggered by any guest download ladder |
| `curl -sS -m 7 -o /dev/null -w %{http_code} -x <socks> https://redirector.googlevideo.com/generate_204` | `socks-pool.server.ts:124-148` | |
| `npm install <youtubei.js|bgutils-js>@latest --no-audit --no-fund --loglevel=error --save` | `tool-updates.server.ts:241` | operator only; `cwd=process.cwd()` |
| `python3 -m pip install --upgrade --no-input yt-dlp [--break-system-packages]` | `tool-updates.server.ts:196-205` | operator only |
| `ffmpeg` | spawned **by yt-dlp** for merges (not by Velo) | |
| `node` | spawned by yt-dlp for the EJS nsig solver (`--js-runtimes node`); the solver is fetched from GitHub (`--remote-components ejs:github`) | |

No shell is used for these; arguments are arrays. The only caller-influenced values are the 11-char
video id, numeric itag, sanitised POT/visitor strings, a validated proxy URL and a temp cookie file.

### 4.8 External services contacted

Server: `www.youtube.com` (pages, InnerTube `/youtubei/v1/*`, `/api/jnn/v1/GenerateIT`,
`/api/timedtext`, `feeds/videos.xml`), `*.googlevideo.com` incl. `redirector.googlevideo.com`,
`i.ytimg.com`/`*.ggpht.com` (relay), the BotGuard interpreter host YouTube names in `ytAtN`
(Google-hosted; value is data-driven), `proxy.corsfix.com`, `api.allorigins.win`,
`cdn.jsdelivr.net` (proxifly list), **arbitrary free SOCKS5 hosts** from that list, operator proxy
hosts, `registry.npmjs.org`, `pypi.org` (+ files.pythonhosted.org during `pip install`),
`github.com` (yt-dlp EJS remote component), `oauth2.googleapis.com` and `www.googleapis.com/oauth2/v3/certs` (Google sign-in token exchange and ID-token keys),
Postgres host from `DATABASE_URL`.

Browser: this origin, `proxy.corsfix.com`, `api.allorigins.win`, `*.googlevideo.com`,
`sponsor.ajay.app` (SponsorBlock), `i.ytimg.com`, `www.youtube.com` embeds,
`accounts.google.com` (Google sign-in).

Extensions: `www.youtube.com/api/timedtext` (popup), the configured Velo origin
(default `http://127.0.0.1:8080`).

### 4.9 Browser extensions

**`extension/` — "Velo – YouTube Downloader & AI Transcript Studio" (MV3, v1.0.0)** — permissions
`activeTab, storage, contextMenus, cookies, clipboardWrite`; hosts YouTube, googlevideo, localhost,
`*.grok-sandbox.com`, `*.grok.com`, `grok.me`. Content script on youtube.com injects buttons; the
background worker keeps a queue in `chrome.storage.local`, builds context menus, and reads
`.youtube.com` session cookies (`getYouTubeSessionCookies`). It talks to the app **only by opening
tabs**: `<origin>/?v=<id>&preset=…&auto=1`, `&tab=transcript`, `?cookie_sync=1` (cookies are copied to
the clipboard, the user pastes). The origin is the first open tab titled "Velo" on a grok/local
host, else `settings.veloServerUrl` (default `http://127.0.0.1:8080`). Not packaged or linked from
the app.

**`extensions/velo-session/` — "Velo YouTube Session" (MV3, v1.1.1, Firefox id
`velo-session@velo.app`)** — permissions `cookies, tabs, clipboardWrite, downloads, webRequest,
storage`. Reads HttpOnly session cookies (`SID, HSID, SSID, APISID, SAPISID, SIDCC, LOGIN_INFO,
__Secure-1/3PAPISID`), observes `Cookie` request headers on youtube/googlevideo via
`webRequest.onBeforeSendHeaders` (HAR capture), and sends a Netscape jar to every open tab titled
"Velo" on localhost/grok hosts via `tabs.sendMessage` → content script → `window.postMessage(…,
location.origin)` → `cookie-import.tsx:170-177` (`source:"velo-extension"`). No longer
distributed: W0-T3 removed `public/extensions/` (the zip and the unpacked copy) and the download
links in `session-guide.tsx`. The source under `extensions/velo-session/` remains until W6.

### 4.10 Multiplayer / P2P WebRTC module

Deleted in W2 (template residue: nothing imported it and `/api/rtc` never existed).

---

## 5. Build & deploy

- `npm run build` is `vite build` only → Nitro `node-server` preset → `.output/`
  (`public/` ≈34 MB incl. `ffmpeg-core.wasm` 32 MB; `server/` ≈18 MB, entry `server/index.mjs`).
  It does not migrate: `npm run db:migrate` is a separate step (§4.4). `npm start` runs
  `node .output/server/index.mjs`.
- Vite plugins (`vite.config.ts`): `pgliteBootstrapPlugin` (dev only), tailwind, `tanstackStart`,
  `nitro({preset:"node-server", serverDir:"./server"})` for build and preview only, React.
  `ssr.external`: `youtubei.js, bgutils-js, jsdom, @electric-sql/pglite`.
- `npm run preview` (`vite preview`, `127.0.0.1:8081`, strict) and `npm run build:dev`
  (`vite build --mode development`) both go through Nitro: the server they serve or produce runs
  the `server/plugins/env.ts` boot check, which forces `NODE_ENV=production`. They need the full
  production configuration (the five required variables, §6), exactly like `npm start`;
  `--mode development` does not bring back the dev defaults.
- Dev: `npm run dev` → `vite dev` on `127.0.0.1:8080` (strict), unless `VELO_DEV_HOST` /
  `VELO_DEV_PORT` override it. No Nitro and no boot check in dev.
- CI (`.github/workflows/`): `ci.yml` runs `npm test` on Ubuntu and Windows, then typecheck,
  lint, build, `db:migrate` twice against Postgres 16 and `test:http` on every PR and push to
  `main`; plus `codeql.yml`, `dependency-review.yml`, `scorecard.yml` and `auto-update.yml`
  (weekly and manual dependency update: a read-only job updates, a separate job opens the PR with
  an App token).

## 6. Environment variables

| Name | Used in | Required? | Default | Secret? |
|---|---|---|---|---|
| `DATABASE_URL` | `env.server.ts`, `db.ts`, `auth/server.ts`, `operator-gate.server.ts`, `user-proxy-repository-db.server.ts`, `scripts/migrate.mjs` | **yes in production (boot exits without it)** | dev: in-memory PGLite | yes |
| `BETTER_AUTH_SECRET` | `env.server.ts` → `auth-config.server.ts`; `vault-crypto.ts` (proxy key fallback until W3) | **yes in production, ≥ 32 chars** | dev: random per process | yes |
| `VELO_PUBLIC_ORIGIN` | `env.server.ts` → Better Auth `baseURL` / `trustedOrigins` (C9) | **yes in production**: a bare `https://` origin (`http://` only on loopback) | dev: `http://localhost:${VELO_DEV_PORT ‖ 8080}` | no |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `env.server.ts` → `auth-config.server.ts` | **yes in production** | dev: unset → sign-in unavailable | secret: yes |
| `BETTER_AUTH_TRUSTED_ORIGINS` / `BETTER_AUTH_SECRETS` | read by Better Auth itself | **must be unset in production** (boot refuses) | — | — |
| `VELO_DEV_PORT` / `VELO_DEV_HOST` | `vite.config.ts`, `env.server.ts` (`devOrigin`) | no | `8080` / `127.0.0.1` | no |
| `VELO_VAULT_KEY` | `vault-crypto.ts` | **should be** | unset → cookies stored plaintext (warn once) | yes |
| `VELO_VAULT_KEY_PREVIOUS` | `vault-crypto.ts:93` | no | — (proxy credential key rotation) | yes |
| `VELO_ADMIN_EMAILS` | `operator-gate.server.ts`, `tool-updates.ts` | no | nobody is operator | no |
| `VELO_ALLOW_TOOL_INSTALL` | same | no | off (`"1"` = loopback installs with auth off) | no |
| `VELO_SIGNIN_LINK` / `VELO_SIGNIN_LINK_EMAILS` | — | no | removed in W0-T4 (ignored) | no |
| `VELO_PYTHON` / `PYTHON_BIN` | `ytdlp-auth.ts:900`, `scripts/auto-update.mjs` | no | `python3` | no |
| `VELO_SOCKS_PROXY` / `ALL_PROXY` | `socks-pool.server.ts:101` | no | — | may carry credentials |
| `YTDLP_BROWSER` | `ytdlp-auth.ts:485` | no | — (reads the *server host's* browser cookies) | n/a |
| `TRUST_CLOUDFLARE` | `guest-limit.server.ts:120` | no | off | no |
| `LOG_LEVEL` | `log.server.ts:39` reads `process.env` directly; `env.server.ts` also parses it into `serverEnv().LOG_LEVEL`, which nothing reads yet | no | `info` (or `debug`, `warn`, `error`) | no |
| `SENTRY_DSN` | `env.server.ts` only: parsed, **not read yet**. W5 wires it (Sentry, roadmap D6) | no | unset | no |
| `VELO_EGRESS_PROXY` | `env.server.ts` only: parsed, **not read yet**. W4a wires it as the single operator egress proxy; today egress uses `VELO_SOCKS_PROXY` / `ALL_PROXY` (above) | no | unset → direct | may carry credentials |
| `VELO_EXTENSION_IDS` | `env.server.ts` only: parsed (comma list), **not read yet**. W6 wires it (extension handshake) | no | `[]` | no |
| `VELO_PROXY_SECRET_KEY` / `VELO_PROXY_SECRET_KEY_PREVIOUS` | `env.server.ts` only: parsed, **not read yet**. W3 wires them; until then the proxy credential key is `VELO_VAULT_KEY` (`_PREVIOUS`), falling back to `BETTER_AUTH_SECRET` (`vault-crypto.ts`) | no | unset | yes |
| `YTDLP_PYTHON` | `env.server.ts` only: parsed, **not read yet**. W4a/W5 wire it; today `pythonBin()` reads `VELO_PYTHON` / `PYTHON_BIN` (above) | no | `python3` (`python` on Windows) | no |
| `NODE_ENV` | `env.server.ts`, `vault-crypto.ts`, `proxy-fetch.server.ts`, `proxy-transport.server.ts` | set by platform | forced to production by the built server | no |
| `CI`, `NO_COLOR`, `npm_config_color`, `npm_execpath` | set for / read by child processes | — | — | no |

There is no `.env.example`; the README documents only `VELO_PYTHON`/`PYTHON_BIN`.

## 7. End-to-end workflows

### 7.1 Look up and save a 1080p video (guest)

1. `index.tsx` → `lookupVideo` (`home-actions.ts:15`) → server fn `resolveVideo`
   (`resolve-video.ts:37`) → `assertMetadataBudget` → `resolveYoutubeVideo` (§4.3) → presets.
2. Save → `runHomeDownload` (`home-actions.ts:87`) → `downloadPresetFile` → `downloadViaBuilder`
   → `mintPoToken` → race `POST /api/builder` vs client same-hop.
3. `/api/builder` (`routes/api/builder.ts`) → quota (`guest-limit.server.ts:358`) →
   `streamBuilderDownload` → itag 137 → `downloadWithYtdlp` → cache/coalesce → slot → `muxOne`
   ladder → `python3 -m yt_dlp -f 137+140/137+251/96 …` (merge by ffmpeg) → `mediaFileResponse`.
4. Browser reads the whole body into a Blob → `saveMediaBlob` → picker / download → IndexedDB
   cache → `history-store.record`.
5. On failure with an "escalate" error → hybrid race / hybrid mux (§3.4); finally the muxed
   22/18 fallback prompt.

### 7.2 Signed-in save with the user's YouTube session

1. `/login` → "Continue with Google" → Google → `/api/auth/callback/google` → `/` (the session hooks end the user's other sessions).
2. Cookies arrive by paste/file/HAR or the `velo-session` extension (`postMessage`) →
   `cookie-import.tsx` → `saveVault` (`vault.ts:26`, encrypted only with `VELO_VAULT_KEY`) and the
   in-memory cookie store.
3. Save → same path as 7.1 but the request body carries `cookies`; `/api/builder` →
   `cookiesNeedSession` checks the session cookie → `muxOne` writes
   `<tmp>/cookies.txt`, uses session clients, operator proxies (with cookies), then direct only;
   the private file is not cached and its tmp dir is removed on stream close
   (`ytdlp.server.ts:337-349`).

### 7.3 Transcript export

`transcript-studio.tsx` / `transcript-viewer.tsx` → `fetchTranscript` server fn
(`resolve-video.ts:85`) → `getTranscriptText` (`youtube-captions.server.ts:139`): InnerTube caption
track (+`tlang`) → yt-dlp subtitles fallback (`ytdlp-meta.server.ts:63`, pool slot, direct→SOCKS)
→ VTT parse → cues → client exports (`transcript.ts`, `transcript-export.ts`, `nle-export.ts`).
Direct caption file download uses `GET /api/captions`.

### 7.4 Operator: add and validate an egress proxy / update yt-dlp

1. Tools tab (signed in) → `checkToolUpdates` → `toolRows` (reads `node_modules/*/package.json`,
   `python3 -m yt_dlp --version`, npm/PyPI registries).
2. `updateTool` → `operatorGate` (`VELO_ADMIN_EMAILS` + verified email) → `npm install … --save`
   or `pip install --upgrade yt-dlp` in the server's working directory.
3. `addUserProxy` → `proxyManagementGate` → `normalizeUserProxy` → encrypted insert into
   `velo_proxy` → staged validator (`proxy-validator.server.ts`: connect, TLS, route probe
   `redirector.googlevideo.com/generate_204`, InnerTube player metadata, media range) →
   verdict + evidence rows. `startProxyValidationRun` runs up to 8 routes per call with a DB lease;
   the UI resumes/cancels via `resume/cancelProxyValidationRun`.
4. From then on `proxiedFetch` (all InnerTube traffic) and the yt-dlp ladder use enabled, eligible
   routes first (`proxy-selector.server.ts`).

## 8. Known architectural constraints (summary)

Detailed findings are in `audit/01-architecture.md`. In short: the design assumes a long-lived
Linux host with Python/yt-dlp/ffmpeg/curl/npm, a writable working directory and shared memory
between requests. The build now matches that: Nitro's `node-server` preset produces one long-lived
Node process (§4, §5). The container that supplies the rest of that host (Python, yt-dlp, ffmpeg)
is W5's work and does not exist yet, so a deployment of this tree is **NOT VERIFIED**.
