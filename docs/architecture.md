# Velo — Architecture

> Audience: developers who have never seen this repository.
> Scope: the working tree as of 2026-09-23 (branch `main`, HEAD `81cbd95` plus 27 modified and 3
> untracked files — note that the working tree imports the untracked `src/lib/transfer-progress.ts`,
> so HEAD and the working tree are not the same program).
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

The repo was scaffolded from the **Grok App Builder** template. Large parts of the platform glue
(auth broker, PWA/OG injector, preview bridge, dev-server plugins, sandbox scripts) are template
code written for `*.grok-sandbox.com` / `*.grok.me` hosting (see §11).

---

## 2. Repository map

```
AGENTS.md                 Grok Build sandbox contract (template artifact — instructions for an AI agent)
startup.sh                Grok sandbox "revive" script (starts `npm run dev` on :8080)
vite.config.ts            Vite 8 + TanStack Start + Nitro (vercel preset) + dev-only plugins
server/middleware/        Nitro global middleware (grok-pwa.ts: PWA manifest, OG/"Created with Grok" head injection)
scripts/                  build/migrate/test/update tooling + Grok template helpers
migrations/               SQL schema (applied at build to DATABASE_URL, or at boot to PGLite)
public/                   static assets incl. __grok/ PWA icons and the velo-session extension (zip + unpacked copy)
extension/                "Velo" Chrome MV3 extension (in-page buttons, queue, transcript popup) — not packaged/served
extensions/velo-session/  "Velo YouTube Session" MV3 extension (cookie exporter) — source of public/extensions/*
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
| `/login` | `src/routes/login.tsx` | OAuth buttons (broker providers), email+password sign-up/sign-in. (The copy-paste "sign-in link" flow was removed in W0-T4.) |
| document shell | `src/routes/__root.tsx` | `<PreviewHostBridge/>`, `<AuthProvider>` (sonner toaster), manifest + `__grok` icon links. |
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
| bearer token (framed/preview auth) | `src/lib/auth/client.ts` (`grok-auth.bearer-token`) | sessionStorage |
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
| **Hybrid race** (escalation) | `hybridFetchBlob` (`src/lib/hybrid-download.ts:175`) | mints POT, then races: same-hop bypass, `POST /api/ytdlp`, and "relay" (`resolvePlayback` server fn → try the googlevideo URL via `proxyFetch` → `/api/relay` → finally `GET /api/bypass`). Relay leg is skipped inside Grok previews. |
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
preset `vercel`) into **one** Vercel Node function `__server.func` (`nodejs24.x`,
`supportsResponseStreaming: true`, no `maxDuration` set — `.vercel/output/functions/__server.func/.vc-config.json`).
All `/api/*`, server functions and SSR share that function and its in-process state.

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
| `/api/auth/$` | GET/POST | Better Auth | sign-up: 8 / 10 min per IP (in-memory) | Better Auth handler (OAuth, email+password, get-session, bearer) |

Dev-server only (Vite `apply:"serve"` plugins, `vite.config.ts`): `/auth/popup` (OAuth popup for
framed previews, `src/lib/auth/popup.server.ts`), `/__app-env` (resolved `VITE_*` env, read by
`scripts/check-auth-invariant.mjs`). Nitro middleware in all environments: `/__grok/manifest.webmanifest`,
`?install=1&platform=ios` tutorial page, HTML head injection (`server/middleware/grok-pwa.ts`).

### 4.2 Server functions (`createServerFn`) — 32 handlers (+1 alias)

`authMiddleware` (`src/lib/auth/middleware.ts`) = Fetch-Metadata same-site check
(`isolation.server.ts`) + `requireUserId` (`verify.server.ts`): real session when auth is
configured; `"dev-user"` when auth is disabled and no `DATABASE_URL`; throws when auth disabled but
`DATABASE_URL` set.

| File | Function | Method | Auth / gate |
|---|---|---|---|
| `resolve-video.ts` | `resolveVideo`, `searchVideos`, `resolvePlaylist`, `resolveBulkVideos` (≤50 ids), `fetchTranscript`, `resolvePlayback`, `decipherCipher`, `mintPoToken` | POST | **none**; per-IP metadata backstop only (`assertMetadataBudget`) |
| `sign-in-link.ts` | removed in W0-T4 (copy-paste sign-in link) | — | — |
| `session-isolation.ts` | `isolateOwnSession` | POST | `authMiddleware` |
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
auth off with DB → denied; auth on → operator gate.

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
  PGLite `.wasm/.data` files are copied into the Vercel function by `pgliteAssetsPlugin`
  (`vite.config.ts:55-79`). Data is lost whenever the process ends.
- Migrations (`migrations/*.sql`, applied by basename, tracked in `_migrations`):
  `0001_auth.sql` (Better Auth `user/session/account/verification`), `0002_youtube_vault.sql`
  (`youtube_vault(user_id, cookies, cookie_count, updated_at)`), `0003_verification_value_idx.sql`,
  `0004_user_proxies.sql` (`velo_proxy`), `0005_proxy_operations.sql` (proxy health columns,
  `velo_proxy_validation_run/_result/_evidence`, `velo_proxy_event`).
  `migrations/auth/0001_auth.sql` is a byte-identical template copy that is never applied.
- Deploy-time: `npm run build` = `vite build && npm run db:migrate` (`package.json:13`) →
  `scripts/migrate.mjs` applies pending files to `DATABASE_URL` inside the build.

### 4.5 Auth modes

| Mode | Condition | Behaviour |
|---|---|---|
| **Disabled / dev user** | `VITE_AUTH_ENABLED=false` | no OAuth; `requireUserId` → `"dev-user"` without DB, throws with DB; client shows `DEV_USER` (`use-current-user.ts:21`). (The sign-in-link flow that auto-opened here was removed in W0-T4.) |
| **Better Auth + Grok broker** | any other value (including **unset** — the default) | `genericOAuth` providers `grok-google`/`grok-x` against `GROK_AUTH_ISSUER` (default `https://auth.grok.me`) using `GROK_AUTH_CLIENT_ID/SECRET` (no fallback: the committed preview client was removed in W0-T2; production throws at boot without them unless `VITE_AUTH_ENABLED=false`). Email+password is **enabled** (`src/lib/auth/email-password.ts:10`, no email verification). Cookies `__Host-grok-auth.*`, 5-min `session_data` cookie cache. Secret = `BETTER_AUTH_SECRET` or a random per-process value (`server.ts:62-65,190`). |
| **Gate identity JWT** | `GROK_PROJECT_ID` set and auth not disabled | Better Auth plugin (`gate-session.server.ts`) on `/get-session`: verifies `x-grok-identity` (EdDSA, `iss` = `GROK_GATE_ORIGIN` or `https://gate.grok.me` / `gate.app-builder-testing.com` derived from Host, `aud=app:<GROK_PROJECT_ID>`, ≤10 min), JWKS from `<issuer>/__gate/identity-key` (5 min cache), then creates/swaps a session for provider `grok-gate`. |
| **Bearer** | always registered | `bearer()` plugin: `Authorization: Bearer <session token>`; the client stores it in sessionStorage when framed (popup flow) and `authMiddleware` forwards it. Download routes read it from the request (`guest-limit.server.ts:335`). |
| **Preview popup** | framed or `*.grok-sandbox.com` (`oauth-popup.ts`) | opens `/auth/popup`, which exists **only in `vite dev`**. |
| **Sign-in link** | — | removed in W0-T4. |

### 4.6 In-process background work, queues and caches

All of the following live in module memory (or `/tmp`) of one server process; on Vercel each warm
instance has its own copy.

| Item | File | Notes |
|---|---|---|
| Download quota buckets (guest/user/ip/meta, token bucket + sliding window, ≤4 000 rows) | `guest-limit.server.ts` | identity: user id → `x-velo-guest`/cookie → IP; IP from `x-vercel-forwarded-for` → `x-real-ip` → last `x-forwarded-for` hop (Cloudflare headers only with `TRUST_CLOUDFLARE=1`) |
| Sign-up rate map | `routes/api/auth/$.ts` (via `rate-window.ts`) | |
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
| Gate JWKS cache | `gate-identity.server.ts` | |
| Preview auth secret / proxy key fallback | `auth/server.ts`, `vault-crypto.ts` | random per process when env unset |

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
`github.com` (yt-dlp EJS remote component), `auth.grok.me` (OAuth broker), `gate.grok.me` /
`gate.app-builder-testing.com` (JWKS), `connectors.grok.me` (only in dead `app-data` code),
Postgres host from `DATABASE_URL`.

Browser: this origin, `proxy.corsfix.com`, `api.allorigins.win`, `*.googlevideo.com`,
`sponsor.ajay.app` (SponsorBlock), `i.ytimg.com`, `www.youtube.com` embeds,
**`https://grok.com/grok-app-builder/extensions.js`** (injected on every HTML page by the PWA
middleware), `og.grok.me` (OG placeholder image URL in meta tags), STUN
`stun.l.google.com`/`stun.cloudflare.com` (only in the unused multiplayer module).

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
location.origin)` → `cookie-import.tsx:170-177` (`source:"velo-extension"`). Shipped as
`public/extensions/velo-session.zip` (download link in `session-guide.tsx:19`) and also as an
unpacked copy under `public/extensions/velo-session/` (identical to the source modulo line endings).

### 4.10 Multiplayer / P2P WebRTC module

`src/lib/multiplayer/{index,p2p}.ts` implements a full-mesh WebRTC room ("perfect negotiation")
signalled by polling `/api/rtc`. **Nothing imports it and `/api/rtc` has never existed in git
history** — it is Grok-template residue (`p2p.ts:1-18` refers to a "multiplayer-p2p skill").

---

## 5. Build & deploy

- `npm run build` → `scripts/with-app-env.mjs` (merges `VITE_*` keys from `.grok/app-env.json`
  — the file does not exist in this repo) → `vite build` → Nitro `vercel` preset →
  `.vercel/output/` (`static/` ≈35 MB incl. `ffmpeg-core.wasm` 32 MB; `functions/__server.func/`
  ≈34 MB incl. PGLite wasm) → `npm run db:migrate`.
- Vite plugins (`vite.config.ts`): `pgliteBootstrapPlugin` (dev), `pgliteAssetsPlugin` (build),
  `authPopupPlugin` (dev), `appEnvPlugin` (dev), `grokPwaPlugin` (all: manifest, install page,
  head injection, `virtual:grok-og-identity`), tailwind, `tanstackStart`, `nitro({preset:"vercel",
  serverDir:"./server"})` for build/preview, React. `ssr.external`: `youtubei.js, bgutils-js,
  jsdom, @electric-sql/pglite`.
- No `vercel.json`: no `maxDuration`, memory, region, headers or cron are configured.
- Dev: `npm run dev` → `vite dev --host 0.0.0.0 --port 8080` (strict); preview on `127.0.0.1:8081`.
- CI: only `.github/workflows/auto-update.yml` (weekly `npm run update:deps`, opens a PR). No
  test/typecheck/build workflow.

## 6. Environment variables

| Name | Used in | Required? | Default | Secret? |
|---|---|---|---|---|
| `DATABASE_URL` | `db.ts`, `auth/server.ts`, `verify.server.ts`, `operator-gate.server.ts`, `user-proxy-repository-db.server.ts`, `scripts/migrate.mjs` | **yes for any real deployment** | unset → in-memory PGLite | yes |
| `BETTER_AUTH_SECRET` | `auth/server.ts:190`, `vault-crypto.ts:83` (proxy key fallback) | **yes** | random per process | yes |
| `BETTER_AUTH_URL` | `auth/server.ts:94` | yes on any non-`*.grok-sandbox.com` host | dynamic base URL over `*.grok-sandbox.com` + loopback, fallback `http://localhost:8080` | no |
| `VITE_AUTH_ENABLED` | `auth/server.ts`, `auth/client.ts`, `gate-identity.server.ts`, `check-auth-invariant.mjs` | no | unset = **auth on**; only `"false"` disables | no (inlined into client) |
| `GROK_AUTH_ISSUER` | `auth/server.ts:80` | no | `https://auth.grok.me` | no |
| `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET` | `auth/server.ts:81-82` | yes for working OAuth | hard-coded preview client | secret: yes |
| `GROK_PROJECT_ID` | `gate-identity.server.ts` | no | unset → gate identity off | no |
| `GROK_GATE_ORIGIN` | `gate-identity.server.ts:124` | no | derived from Host (`gate.grok.me` …) | no |
| `VELO_VAULT_KEY` | `vault-crypto.ts` | **should be** | unset → cookies stored plaintext (warn once) | yes |
| `VELO_VAULT_KEY_PREVIOUS` | `vault-crypto.ts:93` | no | — (proxy credential key rotation) | yes |
| `VELO_ADMIN_EMAILS` | `operator-gate.server.ts`, `tool-updates.ts` | no | nobody is operator | no |
| `VELO_ALLOW_TOOL_INSTALL` | same | no | off (`"1"` = loopback installs with auth off) | no |
| `VELO_SIGNIN_LINK` / `VELO_SIGNIN_LINK_EMAILS` | — | no | removed in W0-T4 (ignored) | no |
| `VELO_PYTHON` / `PYTHON_BIN` | `ytdlp-auth.ts:900`, `scripts/auto-update.mjs` | no | `python3` | no |
| `VELO_SOCKS_PROXY` / `ALL_PROXY` | `socks-pool.server.ts:100` | no | — | may carry credentials |
| `YTDLP_BROWSER` | `ytdlp-auth.ts:484` | no | — (reads the *server host's* browser cookies) | n/a |
| `TRUST_CLOUDFLARE` | `guest-limit.server.ts:122` | no | off | no |
| `NODE_ENV` | `vault-crypto.ts`, `proxy-fetch.server.ts`, `proxy-transport.server.ts`, `app-data` | set by platform | — | no |
| `VITE_PUBLIC_HOSTNAME`, `VITE_PROJECT_ID`, `VITE_OG_SERVICE_URL`, `X_CREATOR`, `X_CREATOR_ID` | `scripts/grok-pwa-*.mjs` | no | OG service `https://og.grok.me` | no |
| `VITE_STUN_URLS` | `multiplayer/p2p.ts` (dead) | no | Google/Cloudflare STUN | no |
| `GROK_CONNECTORS_URL`, `GROK_CONNECTOR_ACCESS_TOKEN` | `app-data/client.server.ts` (dead) | no | — | token: yes |
| `BROWSER_ALLOW_EXTERNAL_HOST`, `BROWSER_SMOKE_BASELINE`, `BROWSER_SMOKE_TIMEOUT_MS`, `PREVIEW_THUMBNAIL_TIMEOUT_MS` | `scripts/browser-*.mjs`, `preview-thumbnail.mjs` | dev tooling | — | no |
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

1. `/login` → email+password (`authClient.signUp.email`) or broker OAuth → `isolateOwnSession`.
2. Cookies arrive by paste/file/HAR or the `velo-session` extension (`postMessage`) →
   `cookie-import.tsx` → `saveVault` (`vault.ts:26`, encrypted only with `VELO_VAULT_KEY`) and the
   in-memory cookie store.
3. Save → same path as 7.1 but the request body carries `cookies`; `/api/builder` →
   `cookiesNeedSession` checks the session (cookie or bearer) → `muxOne` writes
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
between requests; the configured target is Vercel serverless, where none of those assumptions is
guaranteed (**NOT VERIFIED** on a live Vercel deployment by this audit).
