# 13 — Privacy & Data Protection Audit (prefix PRIV-)

Auditor: **privops** (privacy engineer + SRE). Date: 2026-09-23. Target: working tree of `C:\Users\PC\orca\velo` (branch `main`, HEAD `81cbd95` + 27 modified / 3 untracked files). The uncommitted diffs I checked (`history-store.ts`, `download-client.ts`, `session-status.ts`, …) do not change any data flow cited below.

## Scope & method

- Read every migration (`migrations/*.sql`), the vault (`src/lib/vault.ts`, `src/lib/vault-crypto.ts`), cookie/HAR parsers (`src/lib/cookies.ts`, `src/lib/har.ts`), every browser-storage call site (`grep -rn "localStorage|sessionStorage|indexedDB|chrome.storage|document.cookie"`), the yt-dlp cookie temp-file path (`src/lib/ytdlp.server.ts`), the proxy and relay paths (`socks-pool.server.ts`, `cors-relays.ts`, `user-proxy.server.ts`, `routes/api/relay.ts`), auth (`src/lib/auth/*`, Better Auth 1.6.33 in `node_modules`), both Chrome extensions (`extension/`, `extensions/velo-session/`, and the shipped `public/extensions/velo-session.zip`, which I unzipped and diffed: identical apart from CRLF), and every server `console.*` call.
- Fetched the injected third-party script once (`curl https://grok.com/grok-app-builder/extensions.js`, 14,545 bytes, sha256 `97ed1434…`) to see what it currently does. I sent no traffic to YouTube.
- I did not run the app, did not deploy, and did not change any source.
- I state technical facts only. Where a law or platform policy is involved the item is marked **REQUIRES LEGAL REVIEW**. I am not a lawyer.

## Summary table

| ID | Sev | Title | Blocks |
|---|---|---|---|
| PRIV-01 | P0 | No privacy policy, terms, cookie/storage notice, or third-party disclosure anywhere, for an app that collects Google session credentials | Both |
| PRIV-02 | P0 | Vault stores Google session cookies in **plaintext** unless `VELO_VAULT_KEY` is set (warn-only), yet the README says "Encrypted … safely" | Both |
| PRIV-03 | P0 | Extension "Send to Velo" hands the Google session to **any** `*.grok.me` / `*.grok.com` / localhost tab whose *title* starts with "Velo". It also passively records every YouTube `Cookie` header | Both |
| PRIV-04 | P1 | Over-collection: the vault keeps **every** `.youtube.com` and `.google.com` cookie (a full Google-account session), has no TTL, and sends the decrypted jar to browser JS on every page load | Both |
| PRIV-05 | P1 | A mutable third-party script (`grok.com/grok-app-builder/extensions.js`) runs on every page, same-origin with the vault, with no SRI or CSP | Website launch |
| PRIV-06 | P1 | No account deletion or data export. `youtube_vault` has no FK or cascade to `user`, and nothing ever deletes data | Both |
| PRIV-07 | P1 | Shared `dev-user` vault: with auth off and no `DATABASE_URL`, every visitor reads and overwrites the same Google session | OSS release |
| PRIV-08 | P1 | Identity data goes to xAI's broker (`auth.grok.me`, default shared `grok_preview` client) and to the Grok gate. This is not disclosed | Website launch |
| PRIV-09 | P1 | Undisclosed third parties get user IPs and viewing activity: CORS relays (corsfix, allorigins) straight from the browser, plus free anonymous SOCKS proxies | Website launch |
| PRIV-10 | P2 | Every signed-in user's Google session goes out through operator-configured global proxies. This risks Google locking accounts, and users are not told | Website launch |
| PRIV-11 | P2 | Log line records the raw Better Auth session token (bearer plugin accepts unsigned tokens) | Both |
| PRIV-12 | P2 | Session credentials land on the OS clipboard and in Downloads (bookmarklet, both extensions, HAR/cookies.txt export) | Both |
| PRIV-13 | P2 | Persistent guest identifier plus browser storage inventory. Watch history, watch list and media copies stay on shared devices after sign-out | Website launch |
| PRIV-14 | P2 | Platform request logs record viewing history per IP (`/api/download?id=`, `/api/relay?url=<signed googlevideo URL>`) | Website launch |
| PRIV-15 | P2 | Session IP/UA and the OAuth `idToken` (email, name) are stored unencrypted with no retention; `verification` rows grow forever | Both |
| PRIV-16 | P3 | No age or children policy for an app that asks for Google account credentials | Website launch |
| PRIV-17 | P3 | Dead code with third-party data paths ships in the OSS tree (`multiplayer/p2p.ts` STUN, `app-data` → `connectors.grok.me`) | OSS release |

---

## Data inventory

Legend: **Enc** = encrypted at rest. **Del** = user can delete it themselves. **AcctDel** = removed on account deletion. No account-deletion feature exists (PRIV-06), so that column is "n/a — none" everywhere.

| # | Category | What | Why | Where stored | Who receives it (third parties) | Retention | In logs? | Enc | Del | AcctDel | Shared w/ 3rd parties |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Google/YouTube session cookies (vault)** | Full Netscape jar: every `.youtube.com` **and `.google.com`** cookie from the import (SID, HSID, SSID, SAPISID, `__Secure-1PSID`, `__Secure-3PSID`, LOGIN_INFO, VISITOR_INFO1_LIVE, DATASYNC_ID, …) plus a count | yt-dlp / InnerTube signed-in extraction (1080p+, age/members) | DB `youtube_vault.cookies` (text), `cookie_count`, `updated_at` (`migrations/0002_youtube_vault.sql`). Key `user_id` has **no FK** | YouTube/Google (server-side requests from the Vercel/operator IP); operator proxies (PRIV-10). **Not** sent via free SOCKS (verified `ytdlp.server.ts:178` `cookiePath: proxy && !trustedProxy ? undefined : cookiePath`, and the pool loop runs only `if (!loggedIn)` `:257`) | Indefinite. No TTL; overwritten on re-import | No (no `console.*` prints cookie values; `vault-crypto.ts` logs only a "key not set" warning) | **Only if `VELO_VAULT_KEY` set** (AES-256-GCM, `vault-crypto.ts:129-142`); otherwise plaintext | Yes: "clear" → `clearVault` (`vault.ts:48-55`) | n/a — none | YouTube/Google; operator proxy vendor (TLS-tunnelled) |
| 2 | Same cookies, in transit and in memory | Decrypted jar | Sent by the client to the server on every download | Browser: zustand memory (`cookie-store.ts`, **not** persisted; legacy `localStorage["velo-yt-cookies"]` is scrubbed `cookie-store.ts:14-20`). Server: POST bodies to `/api/ytdlp` (`routes/api/ytdlp.ts:9`) and `/api/builder` (`builder.ts:9`), ≤400 KB | The injected grok.com script can read it (PRIV-05) | Tab lifetime | No (POST body, never the query string) | TLS only | Clear button | n/a | PRIV-05 |
| 3 | Same cookies, on server disk | `cookies.txt` for yt-dlp | `--cookies` argument | `mkdtemp(tmpdir()/velo-ytdl-*)` (0700 dir) → `cookies.txt` (`ytdlp.server.ts:128,144-147`) | — | Removed after the response streams (`:346`) or on error (`:307`); crash leftovers swept after 30 min (`ytdlp-python.server.ts:22-47`) | No | No | No | n/a | No |
| 4 | Cookies in the browser extensions | Session-named cookies; **the full raw `Cookie` header of the latest YouTube/googlevideo request** | Extract / "Send to Velo" / HAR | `chrome.storage.session["veloLastHar"]` plus an in-memory `capturedPairs` Map (`extensions/velo-session/background.js:84-120`). The listener is **always on** once the extension is installed | Any matching grok/localhost tab (PRIV-03); clipboard; Downloads | Browser session | Extension console only (`extension/background.js:308` logs the error object) | No | Uninstall only | n/a | PRIV-03 |
| 5 | HAR uploads | Whole HAR file. It can hold cookies, `authorization` headers, PO tokens, URLs and data from **other sites** | Pull cookies / PO tokens / playback URLs out of it | Parsed **client-side only** (`cookie-import.tsx:130-145`, `har.ts`). Cookies are filtered to youtube/google/googlevideo hosts (`har.ts:174-195`) and then saved to the vault (row 1). The derived report (video IDs, PO tokens, header flags) lives in zustand memory (`har-store.ts`) | Nothing else leaves the browser. The rest of the HAR is never uploaded (verified: only `har.cookies.netscape` goes to `saveVault`) | Tab lifetime | No | n/a | Clear button clears `useHarStore` | n/a | No |
| 6 | Account identity | name, email, emailVerified, image URL, OAuth `sub` (`account.accountId`), provider | Sign-in | DB `user`, `account` (`migrations/0001_auth.sql`) | xAI broker `auth.grok.me` + upstream Google/X (PRIV-08) | Indefinite | `userId` and OAuth `sub` in `gate-session.server.ts` error logs (`:232`, `:275-279`, `:298-301`) | No (plain columns) | No | n/a — none | xAI |
| 7 | OAuth tokens | access/refresh token; **idToken** | Better Auth federation | DB `account.accessToken`/`refreshToken`: encrypted (`encryptOAuthTokens: true`, `server.ts:205`, key = `BETTER_AUTH_SECRET`). **`idToken` is stored plaintext.** Better Auth 1.6.33 `oauth2/link-account.mjs:37,53,90` writes `idToken: account.idToken` without `setTokenUtil` | — | Indefinite | No | access/refresh yes; idToken **no** | No | n/a | No |
| 8 | Sessions | session token, expiry, **ipAddress, userAgent** | Auth | DB `session` (`0001_auth.sql`); cookies `__Host-grok-auth.session_token`/`session_data`/`account_data`/`dont_remember` (`server.ts:234-245`); live-preview bearer in `sessionStorage["grok-auth.bearer-token"]` (`auth/client.ts:12-27`) | — | Better Auth default expiry. Rows are cleaned lazily | **Token logged in one error path** (PRIV-11) | No | Sign-out ends the session | n/a | No |
| 9 | Sign-in links | email → `verification` row (hashed value) | Operator sign-in links (`VELO_SIGNIN_LINK*`) | DB `verification`; in-memory `attempts` Map keyed `email:<addr>` / `ip:<addr>` (`sign-in-link.ts:23-46`) | — | `verification` "only grows as unused link requests expire in place" (`migrations/0003…sql` header) | No | hashed value | No | n/a | No |
| 10 | IP addresses | Client IP | Rate limits | In-memory `buckets` / `ipBuckets` Maps (`guest-limit.server.ts:39-42`), bounded and evicted; DB `session.ipAddress`; Vercel request logs (PRIV-14) | CORS relays and YouTube see the **browser** IP (PRIV-09); grok.com deployer sees it (PRIV-05) | Memory: minutes. DB: indefinite. Platform logs: plan-dependent (NOT VERIFIED) | Not in app logs | No | No | n/a | Yes, see PRIV-09 |
| 11 | Operator/admin emails | `VELO_ADMIN_EMAILS`, `VELO_SIGNIN_LINK_EMAILS` | Operator gate | Env vars; compared to `user.email` (`operator-gate.server.ts:28-35`) | — | Deploy config | No | — | — | — | No |
| 12 | Guest identifier | Random 22-char id | Per-browser quota bucket | `localStorage["velo-guest-id"]` (`guest-id.ts:52-70`); sent as `x-velo-guest` on every download | — | Forever (never rotated) | No | No | Clear site data | n/a | No |
| 13 | Download/watch history ("Recent") | title, author, thumbnail, duration, URL, itag, preset, ext, timestamp (max 40) | Recent shelf | `localStorage["velo-history:<owner>"]` with owner `u:<userId>` or `guest`, plus `velo-session-owner` (`history-store.ts:38-43,75-80`) | Thumbnails load from `i.ytimg.com` (browser IP → Google) | Until cleared. **Survives sign-out** | No | No | Per-item remove / clear | n/a | No (local only, verified: no server fn persists history) |
| 14 | Downloaded media copies | Media blobs (≤4 items / ≤180 MB) | Instant re-save | IndexedDB `velo-media`/`files`, keyed `<owner>:<videoId>:<itag>` (`media-cache.ts:3-6,26-28`); `navigator.storage.persist()` requested (`:101`) | — | LRU. **Survives sign-out** | No | No | Remove / clear (`media-cache.ts:255,274`) | n/a | No |
| 15 | Channel watch list | channelId, title, lastSeenMs, addedAt | Feed watcher | `localStorage["velo-watch"]` (`watch-store.ts:19,50-56`) | `/api/feed` fetches the channel feed from YouTube via the server | Until removed | No | No | Per-channel remove | n/a | YouTube (server-side) |
| 16 | Draft URL / UI state | Pasted URL; tools-check timestamp; preview bridge flag | UX | `sessionStorage["velo-draft-url"]` (`home-draft.ts:11`); `localStorage["velo-tools-checked"]`, `…-behind` (`mode-tabs.tsx:16-22`); `sessionStorage["__grokPreviewBridgeInstalled"]` | — | Session / forever | No | No | Clear site data | n/a | No |
| 17 | Extension settings & queue | Server URL, presets; queued video IDs/titles/thumbnails | Extension features | `chrome.storage.sync["settings"]` (**synced to the user's Google account** by Chrome), `chrome.storage.local["velo_queue"]` (`extension/background.js:14-16,243-274`) | Google (Chrome Sync) | Until cleared | No | No | Queue clear | n/a | Google (Sync) |
| 18 | User proxy credentials | Full proxy URL including `user:pass` | Operator egress routes | DB `velo_proxy.url_encrypted` (AES-GCM; key `VELO_VAULT_KEY` **or fallback `BETTER_AUTH_SECRET`**, `vault-crypto.ts:82-90`); `credential_fingerprint` HMAC; masked labels in `velo_proxy_event`/`…_validation_result` (`migrations/0005…sql`) | Proxy vendor | Proxy: until deleted. Runs 30 d, events 180 d (`proxy-run-service.server.ts:80`) | Redacted in yt-dlp stderr (`ytdlp-auth.ts:769-777`) | Yes | Operator delete | n/a | Proxy vendor |
| 19 | Free-SOCKS cache files | Live/dead SOCKS hop URLs (can include `user:pass@` for `VELO_SOCKS_PROXY`) | Pool reuse | `tmpdir()/velo-socks-good.json`, `velo-socks-dead.json`, mode 0600 (`socks-pool.server.ts:22-23,44-46`) | — | 15-min dead marks; instance lifetime | No | No | — | n/a | No |
| 20 | Server mux cache | Muxed media for anonymous (no-cookie) saves only | Coalesce identical saves | `tmpdir()/velo-mux-cache` (≤4 items / 400 MB / 10 min, `download-pool.server.ts:15-18`). Signed-in saves bypass it (`ytdlp.server.ts:319-349`) | — | 10 min | No | No | — | n/a | No |
| 21 | Video IDs / URLs requested | What the user watches or downloads | Core function | Request URLs (logs, PRIV-14) | YouTube; CORS relays (browser IP + Origin, PRIV-09); free SOCKS operators (server IP); SponsorBlock gets only a **4-char SHA-256 prefix** (`sponsorblock.ts:39-64`, privacy-preserving) | — | Platform logs | — | — | — | Yes |
| 22 | Page views | IP, Referer, project id | Remix pill | — | `grok.com` (script load) and `app-builder-deployer.grok.com/rest/app-deployer/v1/projects/<id>/remix-eligibility` (current script, `credentials:"omit"`) | xAI-controlled | — | — | — | — | xAI |

Other destinations checked: fonts are self-hosted via `@fontsource/*` (no Google Fonts). ffmpeg.wasm core is bundled through Vite `?url` imports (`audio-encoder.ts:74-85`, no CDN). npm/PyPI registries are called only by the operator Tools tab (`tool-updates.server.ts:41-57`). yt-dlp is run with `--remote-components ejs:github` (`ytdlp-auth.ts:546`, `ytdlp-meta.server.ts:121,227`), so it fetches solver code from GitHub at runtime. Vercel hosts everything (logs, functions).
**No analytics, telemetry, crash reporting, session recording or ad tech was found.** `grep -rnoiE "posthog|sentry|gtag|googletagmanager|mixpanel|hotjar|clarity.ms|datadog|@vercel/analytics|speed-insights|google-analytics|fullstory|logrocket"` returned nothing relevant. `react-scan` is a devDependency and is never imported in `src/`. The only third-party script is the grok.com pill (PRIV-05).

---

## Findings

### PRIV-01 — No privacy policy, terms, cookie/storage notice, or third-party disclosure anywhere, for an app that collects Google session credentials
- **Severity:** P0
- **Category:** Transparency / legal basis (REQUIRES LEGAL REVIEW)
- **Blocks:** Both
- **Affected files:** repo-wide; `README.md:67-72`; `src/routes/` (only `index.tsx`, `login.tsx`); `extensions/velo-session/manifest.json`; `extension/manifest.json`
- **Description:** The app asks users for the most sensitive credential they own, a live Google-account session. It stores that credential server-side, sends it to Google from third-party IPs, and routes traffic through anonymous third parties. There is no privacy policy, no terms of service, no cookie/storage disclosure, no statement of retention, no controller identity or contact, and no mention of the third parties (xAI broker, grok.com script, corsfix, allorigins, proxifly/jsDelivr, GitHub, Vercel, proxy vendors). Neither extension ships a privacy policy, even though both read cookies with the `cookies` permission.
- **Evidence:** `grep -rniE "privacy|terms of (service|use)|gdpr|cookie (banner|consent)|consent" src README.md extension extensions public` matches only `video-panel.tsx:385` and `sponsorblock.ts:4`, both code comments about SponsorBlock hash prefixes. Routes are only `/`, `/login` and `/api/*` (`src/routeTree.gen.ts`). No `docs/` content (empty), no LICENSE.
- **Real-world consequence:** TECHNICAL FINDING: users cannot make an informed decision. REQUIRES LEGAL REVIEW: GDPR Art. 12-14 (transparency), Art. 6 (lawful basis), Art. 28 (processor agreements with Vercel/Neon/xAI), Art. 44+ (transfers), CCPA/CPRA notice-at-collection. Chrome Web Store User Data Policy requires a privacy policy and a prominent disclosure for extensions that handle authentication data. It also has to be judged whether collecting third-party (Google) session credentials is permitted under Google's Terms at all.
- **Recommended fix:** Before any public launch, publish a Privacy Policy and Terms reachable from every page and from both extensions. Cover every row of the inventory above: categories, purpose, retention, recipients, transfers, user rights, contact. Put an explicit, just-in-time consent step in front of the cookie import ("you are giving this service your Google login; it can act as you on Google"). Get legal sign-off.
- **Verification procedure:** A `/privacy` and a `/terms` route exist and are linked in the footer and the import dialog; the extension listing has a privacy URL; legal review is signed off.
- **Status:** CONFIRMED

### PRIV-02 — Vault stores Google session cookies in plaintext unless `VELO_VAULT_KEY` is set (warn-only), while the README says "Encrypted … safely"
- **Severity:** P0
- **Category:** Encryption at rest / misleading claim
- **Blocks:** Both
- **Affected files:** `src/lib/vault-crypto.ts:22-26,129-142`; `src/lib/vault.ts:36`; `README.md:72`
- **Description:** `encryptCookies` returns the plaintext when `VELO_VAULT_KEY` is unset and logs one `console.warn`. Nothing refuses to start, nothing checks this in production, and no README or env docs mention `VELO_VAULT_KEY`. Proxy secrets, by contrast, throw `ProxyVaultKeyError` in production (`:85`), so the protection is inconsistent. README line 72: "**Encrypted Local & Server Vault**: Stores cookies safely with strict per-user database isolation."
- **Evidence:**
  ```ts
  // vault-crypto.ts:129-141
  export function encryptCookies(plaintext: string): string {
    const key = resolveKey();
    if (!key) { if (!warnedMissingKey) { … console.warn("vault-crypto: VELO_VAULT_KEY is not set — vault cookies will be stored unencrypted. …") } return plaintext; }
  ```
  `grep -n VELO_VAULT_KEY README.md` gives no output.
- **Real-world consequence:** Any DB read access (leaked Neon credentials, a compromised backup, a Neon support session, SQL injection elsewhere) hands over live Google sessions for every user, which means account takeover of Gmail, Drive and YouTube. The README claim is false for a default deploy.
- **Recommended fix:** Fail closed. In production (`NODE_ENV=production` or `DATABASE_URL` set), throw on `encryptCookies`/`decryptCookies` without a key, as the proxy path does. Document `VELO_VAULT_KEY` and keep it in a different secret store from `DATABASE_URL` where possible. Add a one-shot migration that re-encrypts legacy plaintext rows. Correct the README.
- **Verification procedure:** With `DATABASE_URL` set and `VELO_VAULT_KEY` unset, `saveVault` must error. `select count(*) from youtube_vault where cookies not like 'v1:gcm:%'` must return 0.
- **Status:** CONFIRMED

### PRIV-03 — Extension "Send to Velo" hands the Google session to any `*.grok.me` / `*.grok.com` / localhost tab whose *title* starts with "Velo". It also passively records every YouTube `Cookie` header
- **Severity:** P0
- **Category:** Credential exfiltration / extension over-reach
- **Blocks:** Both (the extension ships from `public/extensions/velo-session.zip` and the unpacked copy under `public/`)
- **Affected files:** `extensions/velo-session/popup.js:13-53,66-83`; `extensions/velo-session/content.js:1-15`; `extensions/velo-session/background.js:107-130`; `extensions/velo-session/manifest.json` (content script matches `https://*.grok.com/*`, `https://*.grok.me/*`, `http://localhost/*`); same code in `public/extensions/velo-session/*` and the zip (verified identical, CRLF only)
- **Description:** `sendToVelo` queries **all tabs**. It picks every tab whose hostname is localhost/127.0.0.1/grok.com/`*.grok.com`/grok.me/`*.grok.me`/`*.grok-sandbox.com` **and** whose `document.title` is `"Velo"` or starts with `"Velo "`, then messages each one. The content script `postMessage`s `{netscape, header, count}` to that page's own origin. Every Grok App Builder app is hosted on `*.grok.me`, and any other party can set `document.title = "Velo"`, so any such app, or any local dev server, that is open while the user clicks Send receives the user's SID/HSID/SSID/APISID/SAPISID/LOGIN_INFO. Separately, `attachCapture` registers a `webRequest.onBeforeSendHeaders` listener at service-worker start. From then on it records the **full, unfiltered** `Cookie` header of every request to `*.youtube.com`, `*.googlevideo.com` and `*.youtube-nocookie.com` into `chrome.storage.session`, whether or not the user ever uses the feature. "Capture HAR" then sends that unfiltered header (`sendToVelo(\`Cookie: ${response.header}\`)`) with the same broad targeting. The page-side listener (`cookie-import.tsx:172-177`) auto-saves whatever arrives into the server vault.
- **Evidence:**
  ```js
  // popup.js:25-45
  function isVeloTab(tab) { … if (!isVeloHost(host)) return false; const title = (tab.title || "").trim(); return title === "Velo" || title.startsWith("Velo "); }
  async function sendToVelo(netscape) { const tabs = await chrome.tabs.query({}); const targets = tabs.filter(isVeloTab); … await chrome.tabs.sendMessage(tab.id, { type: "velo-inject-session", netscape });
  ```
  ```js
  // background.js:107-123 — always-on capture
  chrome.webRequest.onBeforeSendHeaders.addListener((details) => { const cookie = details.requestHeaders?.find(h => h.name.toLowerCase()==="cookie"); … rememberCapture({ url: details.url, header: cookie.value, at: Date.now() }); …
  ```
- **Real-world consequence:** One click can deliver a user's Google session to an unrelated third-party app. Chrome Web Store review would very likely reject passive cookie-header surveillance without disclosure (REQUIRES LEGAL/POLICY REVIEW).
- **Recommended fix:** Pin the target to one exact, user-configured origin (e.g. `https://velo.example`), checked against `tab.url` and never the title. Narrow the content-script `matches` to that origin. Attach the `webRequest` listener only while the user has asked for a capture, remove it afterwards, and filter to the session cookie names. Drop the `tabs` permission if the targeting no longer needs it.
- **Verification procedure:** Open a page on another `*.grok.me` app (or `http://localhost:5555`) with `<title>Velo x</title>` and a `message` listener, then click Send. Nothing must arrive. After install with no user action, `chrome.storage.session.get("veloLastHar")` must be empty after browsing YouTube.
- **Status:** CONFIRMED (by code reading; not executed in a browser)

### PRIV-04 — Over-collection: the vault keeps every `.youtube.com` and `.google.com` cookie (a full Google-account session), has no TTL, and sends the decrypted jar to browser JS on every page load
- **Severity:** P1
- **Category:** Data minimisation / retention
- **Blocks:** Both
- **Affected files:** `src/lib/cookies.ts:38-47,75-80,124-137`; `src/lib/har.ts:174-195`; `src/lib/vault.ts:10-24`; `src/components/cookie-import.tsx:92-111`; `migrations/0002_youtube_vault.sql`
- **Description:** `parseCookieImport` filters by **domain only** (`if (cookie.domain && !isYoutubeDomain(cookie.domain)) continue;`, `cookies.ts:131`), and `isYoutubeDomain` accepts `google.com` and `*.google.com`. So a normal "export cookies" file puts accounts.google.com / mail.google.com cookies into the vault, and nothing filters by cookie name. Rows never expire (`updated_at` is written but never read for retention). `loadVault` decrypts and returns the whole jar to the browser whenever a signed-in user loads the page (`cookie-import.tsx:102-106`). The client then sends it back in each download POST (`/api/ytdlp`, `/api/builder`), even though the server could read the vault itself. The decrypted credential therefore sits in page JS memory for the whole session, where any injected script can reach it (PRIV-05).
- **Evidence:** `cookies.ts:43-44` `host === "google.com" || host.endsWith(".google.com")`. `vault.ts:23` `return { ...vault, cookies: decryptCookies(vault.cookies) };`
- **Real-world consequence:** Theft of the vault or of the page context is not "YouTube access". It is full Google-account access. Old sessions stay stored long after the user stops using the app.
- **Recommended fix:** Keep only the cookie names yt-dlp/InnerTube actually need (the `SESSION_COOKIE_NAMES` set already listed in `ytdlp-auth.ts:15` / extension `background.js:2-12`, plus VISITOR_INFO1_LIVE). Store `.youtube.com` only. Never return the jar to the client: resolve it server-side from `context.userId` in `/api/ytdlp` and `/api/builder`. Add a TTL (for example, purge rows with `updated_at < now() - interval '30 days'`) and show the user when the credential was stored.
- **Verification procedure:** Import a real browser export. `decryptCookies(row.cookies)` must contain no `.google.com` lines and only allow-listed names. `loadVault` must return metadata only.
- **Status:** CONFIRMED

### PRIV-05 — A mutable third-party script (`grok.com/grok-app-builder/extensions.js`) runs on every page, same-origin with the vault, with no SRI or CSP
- **Severity:** P1
- **Category:** Third-party data sharing / supply chain
- **Blocks:** Website launch
- **Affected files:** `scripts/grok-pwa-shared.mjs:203,230-243`; `server/middleware/grok-pwa.ts:45-56,112-115`; `AGENTS.md` ("Never strip it")
- **Description:** Every HTML response gets `<script src="https://grok.com/grok-app-builder/extensions.js" data-project-id=… defer>`, injected by Nitro middleware in production. There is no `integrity=` attribute and no CSP (`grep -rn Content-Security-Policy` finds only `/api/relay`'s `sandbox`). The script runs with full origin privileges on the page that holds the decrypted Google cookie jar in memory (PRIV-04). It can call `loadVault` same-origin with the user's `__Host-` session cookie riding along. Today's version (fetched 2026-09-23, 14,545 B, sha256 `97ed1434…`) only makes `fetch(DEPLOYER_ORIGIN + "/rest/app-deployer/v1/projects/<id>/remix-eligibility", {credentials:"omit"})`. That still hands xAI every visitor's IP, User-Agent and Referer/Origin on every page view. The content can change at any time without a deploy.
- **Evidence:** `grep -oE "(fetch|sendBeacon|document\.cookie|localStorage|postMessage)"` on the fetched file finds `1 fetch`. The file lists endpoints `app-builder-deployer.grok.com` and `grok.com`.
- **Real-world consequence:** TECHNICAL FINDING: an undisclosed third party gets page-view data today, and could take any user's Google session tomorrow through a script change or a grok.com compromise. REQUIRES LEGAL REVIEW: whether xAI is a processor or a third-party recipient.
- **Recommended fix:** For a public, credential-handling site, remove the injector. It is template branding, not product functionality, and AGENTS.md is a sandbox contract, not a requirement for this product. If it has to stay: self-host a pinned copy with SRI, add a strict CSP (`script-src 'self'`), and keep it off any page that loads the vault.
- **Verification procedure:** `curl -s https://<prod>/ | grep -c grok-app-builder` must be 0, or the tag must carry `integrity=` and the response must carry a CSP.
- **Status:** CONFIRMED

### PRIV-06 — No account deletion or data export. `youtube_vault` has no FK or cascade to `user`, and nothing ever deletes data
- **Severity:** P1
- **Category:** Data subject rights / retention (REQUIRES LEGAL REVIEW)
- **Blocks:** Both
- **Affected files:** `src/lib/auth/server.ts:187-262` (no `user.deleteUser`); `migrations/0002_youtube_vault.sql` (`user_id text primary key`, no `references`); `migrations/0001_auth.sql`
- **Description:** Better Auth's `deleteUser` endpoint is off by default and not enabled. No UI or server function deletes a user, exports their data, or lists what is stored. If an operator deletes a `user` row by hand, `session`/`account` cascade but `youtube_vault` keeps the Google cookies, because there is no FK. Users can clear their own vault (`clearVault`), but not their identity rows, session IP/UA history, or `verification` rows.
- **Evidence:** `grep -rn "deleteUser\|delete from \"user\"\|deleteAccount" src` matches only `deleteUserProxy`. The migration says `user_id text primary key,` with no FK.
- **Real-world consequence:** TECHNICAL: orphaned credentials and unbounded retention. REQUIRES LEGAL REVIEW: GDPR Art. 15/17/20, CCPA deletion/access rights.
- **Recommended fix:** Enable `user: { deleteUser: { enabled: true } }` with a UI. In the same transaction, delete `youtube_vault` rows (add `references "user"("id") on delete cascade` in a new migration, keeping in mind that dev-user rows are not real users). Add a "download my data" server function. Document retention periods.
- **Verification procedure:** Create a user, import cookies, delete the account. `select count(*) from youtube_vault where user_id=$id` must be 0, and the same for `session` and `account`.
- **Status:** CONFIRMED

### PRIV-07 — Shared `dev-user` vault: with auth off and no `DATABASE_URL`, every visitor reads and overwrites the same Google session
- **Severity:** P1
- **Category:** Cross-user data exposure
- **Blocks:** OSS release (self-hosters who set `VITE_AUTH_ENABLED=false` and expose the app)
- **Affected files:** `src/lib/auth/verify.server.ts:96-109`; `src/lib/auth/use-current-user.ts:16-24,44`; `src/lib/vault.ts:10-55`; `src/components/cookie-import.tsx:92-111`
- **Description:** `requireUserId()` returns the constant `"dev-user"` for **every** request when auth is disabled and no DB URL is set. On the client, `useCurrentUser` returns `DEV_USER`, so the import UI is enabled, and on mount `loadVault()` fetches and decrypts the single `dev-user` row. Visitor A imports their Google cookies. Visitor B, on the same server instance/process (PGLite is per-process), gets A's jar in their browser, can download as A, and can overwrite or clear it. The fail-closed guard only covers the "DATABASE_URL set" case.
- **Evidence:** `verify.server.ts:97-105`: `if (!authConfigured && !gateIdentityEnabled()) { if (databaseConfigured) throw …; return DEV_USER_ID; }`
- **Real-world consequence:** On a self-hosted "personal" instance reachable from the internet, anyone who visits takes the operator's Google session.
- **Recommended fix:** When auth is off, disable the vault server functions entirely (throw) and keep cookies in tab memory only. Or bind the no-auth mode to loopback requests only.
- **Verification procedure:** Run with `VITE_AUTH_ENABLED=false`, no `DATABASE_URL`. Save cookies in browser 1, open browser 2. `loadVault` must fail or return null.
- **Status:** CONFIRMED (code path; not executed)

### PRIV-08 — Identity data goes to xAI's broker (`auth.grok.me`, default shared `grok_preview` client) and to the Grok gate. This is not disclosed
- **Severity:** P1
- **Category:** Third-party processor (REQUIRES LEGAL REVIEW)
- **Blocks:** Website launch
- **Affected files:** `src/lib/auth/server.ts:79-86,160-181`; `src/lib/auth/preview.ts`; `src/lib/auth/gate-identity.server.ts`; `src/lib/auth/gate-session.server.ts`
- **Description:** Sign-in is federated through xAI's broker (`GROK_AUTH_ISSUER` default, `/api/auth/oauth2/*`), which then federates to Google or X. When `GROK_AUTH_CLIENT_ID/SECRET` are unset, auth is **on by default** and uses the shared preview client with its committed secret (see the security reports). With `GROK_PROJECT_ID` set, visitor identity arrives as an `x-grok-identity` JWT from xAI's gate. So xAI sees every sign-in to this app (and every page view, via PRIV-05). The user's email, name and profile image are copied into `user`.
- **Evidence:** `server.ts:83-86` `const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID; … export const authConfigured = !authDisabled && Boolean(grokClientId && grokClientSecret);`, scopes `["openid","profile","email"]` (`:173`).
- **Real-world consequence:** An undisclosed identity intermediary. The operator likely has no DPA with xAI for this use.
- **Recommended fix:** For a public launch, use a first-party OAuth client (a Google OAuth app owned by the operator) or a disclosed IdP. Remove the preview-client fallback in production. Disclose the flow in the privacy policy.
- **Verification procedure:** On a prod deploy, the OAuth `authorize` redirect goes to the operator's own client and never to the `grok_preview` client id.
- **Status:** CONFIRMED

### PRIV-09 — Undisclosed third parties get user IPs and viewing activity: CORS relays (corsfix, allorigins) straight from the browser, plus free anonymous SOCKS proxies
- **Severity:** P1
- **Category:** Third-party data sharing
- **Blocks:** Website launch
- **Affected files:** `src/lib/cors-relays.ts:12-24`; `src/lib/bypass.ts:364-370`; `src/lib/hybrid-net.ts:100`; `src/routes/api/relay.ts:60-63`; `src/lib/socks-pool.server.ts:20,101-120`
- **Description:** In the browser "unlock" and hybrid paths, the **user's browser** fetches `https://proxy.corsfix.com/?<youtube url>` and `https://api.allorigins.win/raw?url=<youtube url>` directly. Those operators receive the user's IP, User-Agent, Origin/Referer (the Velo origin) and the exact video being watched. Server-side, `/api/relay` falls back to the same relays, and downloads and metadata go through anonymous free SOCKS proxies from `cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main`. That leaks server-side video IDs to unknown operators, though I verified it does not leak cookies (the pool hop is only used `if (!loggedIn)`, `ytdlp.server.ts:257`, and `cookiePath` is dropped for untrusted proxies, `:178`).
- **Evidence:** See the code quotes in the files above. `PUBLIC_RELAYS` = corsfix, allorigins.
- **Real-world consequence:** Viewing behaviour tied to IP goes to anonymous operators with no privacy terms. Free SOCKS operators can also tamper with plain-HTTP traffic (all traffic here is HTTPS, and TLS verification is intact: `grep rejectUnauthorized|no-check-certificate` finds nothing).
- **Recommended fix:** Remove the public CORS relays from the browser path, or at least disclose them and make them opt-in per user. Prefer the operator's own relay. Disclose the SOCKS pool, or replace it with a contracted provider.
- **Verification procedure:** Browser network log during an "unlock" save shows no requests to corsfix/allorigins unless the user opted in.
- **Status:** CONFIRMED

### PRIV-10 — Every signed-in user's Google session goes out through operator-configured global proxies. This risks Google locking accounts, and users are not told
- **Severity:** P2
- **Category:** Third-party sharing / user harm
- **Blocks:** Website launch
- **Affected files:** `src/lib/ytdlp.server.ts:172-180,195-225`; `src/lib/user-proxy.server.ts:69-95`; `src/lib/youtube-client.server.ts:47-58`; `migrations/0004_user_proxies.sql` (no `user_id`: proxies are global)
- **Description:** `velo_proxy` is one operator-wide list. Authenticated InnerTube clients use `fetch: proxiedFetch`, and yt-dlp runs mark operator proxies `trustedProxy`, so **every user's cookies** reach Google from the operator's proxy exit IPs (datacenter or residential vendor, any country). TLS protects the contents from the proxy vendor, but Google sees account logins from shared, changing third-party IPs.
- **Evidence:** `ytdlp.server.ts:175-178` comment: "A user-configured (trusted) proxy may carry the session … Pool-SOCKS hops keep the strict no-cookie rule."
- **Real-world consequence:** Users' Google accounts can get "suspicious sign-in" challenges, lockouts or YouTube bot flags. The proxy vendor learns traffic metadata. Neither is disclosed. REQUIRES LEGAL REVIEW (Google ToS, user consent).
- **Recommended fix:** Disclose in the import dialog. Offer per-user opt-out. Prefer a consistent egress IP per user.
- **Verification procedure:** The import dialog text names the proxy egress. A per-user toggle exists and is honoured in `muxOne`.
- **Status:** CONFIRMED

### PRIV-11 — Log line records the raw Better Auth session token (bearer plugin accepts unsigned tokens)
- **Severity:** P2
- **Category:** Secrets in logs
- **Blocks:** Both
- **Affected files:** `src/lib/auth/gate-session.server.ts:59-63`; `src/lib/auth/server.ts:258` (`bearer()` without `requireSignature`)
- **Description:** When the signed Set-Cookie does not parse back to a value, the code logs `cookiePreview: signedCookie.slice(0, 120)`. The header starts with `__Host-grok-auth.session_token=` (31 chars) followed by the 32-char raw token, so the full token falls inside the first 120 chars. Better Auth 1.6.33's bearer plugin accepts an **unsigned** token and signs it itself (`node_modules/better-auth/dist/plugins/bearer/index.mjs:35-37`: `if (options?.requireSignature) return; decodedToken = … serializeSignedCookie("", token, c.context.secret)`). Anyone who can read the logs can therefore hijack that session with `Authorization: Bearer <token>`.
- **Evidence:** Code quoted above.
- **Real-world consequence:** Vercel log access (team members, log drains, third-party log vendors) is enough for session hijack. Narrow, but a real credential leak.
- **Recommended fix:** Log only `{ length: signedCookie.length, name: sessionTokenName }`. Set `bearer({ requireSignature: true })`.
- **Verification procedure:** `grep -n "cookiePreview" src` returns nothing. A bearer request with an unsigned token gets 401.
- **Status:** CONFIRMED (code path; not triggered live)

### PRIV-12 — Session credentials land on the OS clipboard and in Downloads (bookmarklet, both extensions, HAR/cookies.txt export)
- **Severity:** P2
- **Category:** Credential handling on the endpoint
- **Blocks:** Both
- **Affected files:** `src/components/session-guide.tsx:51` (bookmarklet `navigator.clipboard.writeText(json)` of `document.cookie`, or a `prompt()` fallback); `extension/popup.js:549-561` (copies the session cookie header, then opens `?cookie_sync=1`); `extensions/velo-session/popup.js:71-73,85-106` (clipboard + `chrome.downloads` of `youtube-session.har` / `youtube-cookies.txt`)
- **Description:** The recommended flows put live Google session cookies on the system clipboard. Windows clipboard history and cloud clipboard sync, macOS Universal Clipboard, and clipboard-reading apps can all see it, and it is never cleared. The flows also write plaintext cookie files to the Downloads folder.
- **Evidence:** Code lines cited above.
- **Real-world consequence:** Credentials spread to places the user does not think of as sensitive and that outlive the session.
- **Recommended fix:** Prefer the direct extension→page channel (once PRIV-03 is fixed). Clear the clipboard after paste (`navigator.clipboard.writeText("")` on successful import). Warn before file export.
- **Verification procedure:** After a successful import the clipboard no longer holds cookies. The UI warns before any `.har`/`.txt` export.
- **Status:** CONFIRMED

### PRIV-13 — Persistent guest identifier plus browser storage inventory. Watch history, watch list and media copies stay on shared devices after sign-out
- **Severity:** P2
- **Category:** Terminal-equipment storage / shared-device privacy (REQUIRES LEGAL REVIEW for ePrivacy Art. 5(3))
- **Blocks:** Website launch
- **Affected files:** `src/lib/guest-id.ts:52-83`; `src/lib/history-store.ts:38-43,354-372`; `src/lib/media-cache.ts:3-6,101`; `src/lib/watch-store.ts:19`
- **Description:** The app sets a permanent random id in `localStorage` and sends it on every download (`x-velo-guest`). It also keeps per-account history shelves (`velo-history:u:<userId>`), up to 180 MB of downloaded media in IndexedDB (and requests persistent storage), and the watch list, all of which stay after sign-out. Isolation is by owner key, so the next user of the browser does not *see* them, but they remain on disk, and the key contains the user id. Only Better Auth's auth cookies are set as HTTP cookies (strictly necessary). No storage disclosure exists.
- **Evidence:** Inventory rows 12-17.
- **Real-world consequence:** On shared or kiosk machines, a previous user's viewing history and media files remain. Whether a consent banner is needed for the guest id and the media cache is a legal question.
- **Recommended fix:** Offer "sign out and clear this device" that wipes `velo-history:*`, `velo-watch`, the IndexedDB `velo-media` store and `velo-guest-id`. Disclose the storage in the cookie/storage section of the policy.
- **Verification procedure:** After "sign out & clear", `Object.keys(localStorage)` has no `velo-*` keys and `indexedDB.databases()` has no `velo-media`.
- **Status:** CONFIRMED

### PRIV-14 — Platform request logs record viewing history per IP (`/api/download?id=`, `/api/relay?url=<signed googlevideo URL>`)
- **Severity:** P2
- **Category:** Logging / retention
- **Blocks:** Website launch
- **Affected files:** `src/routes/api/download.ts:10-11`; `src/routes/api/relay.ts:45`; `src/routes/api/captions.ts:12-14`; `src/routes/api/bypass.ts:10-11`
- **Description:** These GET endpoints carry the video id (and for `/api/relay`, full signed googlevideo URLs) in the query string. Vercel request logs keep path + query + client IP, which builds a per-IP viewing history outside any app-level retention control. Cookies are correctly kept out of query strings (`builder.ts:44` explicitly rejects GET with a session).
- **Evidence:** `grep -rn "searchParams.get" src/routes/api/*.ts` (see those lines).
- **Real-world consequence:** Viewing history is kept by a sub-processor for however long the Vercel plan retains logs (NOT VERIFIED; depends on plan and drains).
- **Recommended fix:** Move identifiers to POST bodies, or document log retention and minimise drains. Do not forward `/api/relay` query strings to external log drains.
- **Verification procedure:** Review the Vercel log retention setting and any configured drains. Confirm the policy states them.
- **Status:** CONFIRMED (code). Retention: NOT VERIFIED

### PRIV-15 — Session IP/UA and the OAuth `idToken` (email, name) are stored unencrypted with no retention; `verification` rows grow forever
- **Severity:** P2
- **Category:** Retention / encryption
- **Blocks:** Both
- **Affected files:** `migrations/0001_auth.sql` (`session.ipAddress`, `userAgent`; `account.idToken`); `node_modules/better-auth/dist/oauth2/link-account.mjs:37,53,90`; `migrations/0003_verification_value_idx.sql` (header comment)
- **Description:** Better Auth records the client IP and UA per session. `encryptOAuthTokens` covers access and refresh tokens only. The id-token JWT (email, name, picture, sub) is written in clear. The migration notes that `verification` "only grows as unused link requests expire in place". No cleanup job exists for any of these tables.
- **Evidence:** Code and SQL cited above.
- **Real-world consequence:** Unbounded personal-data retention in the DB and in backups.
- **Recommended fix:** A scheduled purge (Vercel cron → server function) of expired `session` and `verification` rows. Drop `idToken` after sign-in, or null it via a `databaseHooks.account.create.before` hook. Document the retention period.
- **Verification procedure:** `select count(*) from verification where "expiresAt" < now() - interval '1 day'` returns 0 after the cron runs.
- **Status:** CONFIRMED

### PRIV-16 — No age or children policy for an app that asks for Google account credentials
- **Severity:** P3
- **Category:** Children's data (REQUIRES LEGAL REVIEW: COPPA, GDPR Art. 8)
- **Blocks:** Website launch
- **Affected files:** repo-wide
- **Description:** There is no age gate and no statement of minimum age. YouTube itself has many under-18 users (and supervised under-13 accounts).
- **Evidence:** No age or child terms: `grep -rniE "age limit|under 13|children|coppa" src README.md` matches nothing relevant.
- **Real-world consequence:** A legal exposure question.
- **Recommended fix:** State a minimum age in the Terms. Consider refusing supervised-account cookies.
- **Verification procedure:** The Terms contain an age clause.
- **Status:** CONFIRMED

### PRIV-17 — Dead code with third-party data paths ships in the OSS tree (`multiplayer/p2p.ts` STUN, `app-data` → `connectors.grok.me`)
- **Severity:** P3
- **Category:** Hygiene / latent data flows
- **Blocks:** OSS release
- **Affected files:** `src/lib/multiplayer/p2p.ts:93` (`stun.l.google.com`, `stun.cloudflare.com`); `src/lib/app-data/client.server.ts:18-50` (`connectors.grok.me` with `GROK_CONNECTOR_ACCESS_TOKEN`)
- **Description:** Neither module is imported outside its own folder (`grep -rln multiplayer src | grep -v src/lib/multiplayer` gives nothing, and the same for app-data). If anyone wires them up, they add WebRTC IP exposure to peers and STUN operators, and data forwarding to xAI's connector service.
- **Evidence:** grep results above.
- **Real-world consequence:** A future contributor could add a data flow nobody has disclosed. Readers of the OSS code are confused about what it does.
- **Recommended fix:** Delete both directories.
- **Verification procedure:** `ls src/lib/multiplayer src/lib/app-data` shows neither exists.
- **Status:** CONFIRMED

---

## Not verified / out of scope

- Deployed behaviour: I ran no live deploy. Vercel log retention, log drains, Neon region/PITR/backups, and whether production sets `VELO_VAULT_KEY`, `DATABASE_URL` and `GROK_AUTH_CLIENT_*` are all NOT VERIFIED.
- Whether Chrome Web Store / AMO listings exist for either extension, and their disclosures: NOT VERIFIED.
- `extensions.js` was analysed as of 2026-09-23. It is mutable, and future content cannot be verified.
- What xAI's broker and gate log or retain: out of scope and not knowable from this repo.
- Legal conclusions (lawful basis, Google ToS, DMCA, ePrivacy consent, COPPA, CCPA "sale/share"): REQUIRES LEGAL REVIEW. This report states technical facts only.
- Security depth on the same surfaces (committed OAuth secret, operator gate, SSRF, installer RCE) is covered by the security auditors and only cross-referenced here.
