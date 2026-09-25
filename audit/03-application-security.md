# 03 — Application Security (SEC-)

Auditor: appsec (Principal AppSec). Repo: `C:\Users\PC\orca\velo` @ working tree
(HEAD `81cbd95`). Audited the working tree.

## Scope & method

Manual review of every API route (`src/routes/api/*`), all ~35 `createServerFn`
handlers, the auth stack (`src/lib/auth/*`, `sign-in-link*`, `session-*`,
`operator-gate.server`, `guest-limit.server`), the download/extraction path
(`ytdlp*.server`, `bypass.server`, `builder.server`, `download-pool.server`,
`socks-pool.server`, `proxy-*`, `user-proxy*`), the server-side JS execution
(`po-token.server`, `youtube-client.server`, `nsig`), parsers (`cookies`, `har`),
the relays (`relay.ts`, `cors-relays`), the two Chrome extensions, `preview-host-bridge`,
and the Vite/Nitro/PWA plumbing. Confirmations used a local dev server on
**127.0.0.1:8097** (auth on, allowlist set) and **:8098** (auth off); both were
killed after testing. Live YouTube was not hit. No source/config/git was modified.

Ordering note: findings are the reviewer's; "CONFIRMED" means reproduced locally
or proven by direct code path. Nothing here is production-ready.

## Summary table

| ID | Sev | Title | Blocks |
|----|-----|-------|--------|
| SEC-01 | P0 | Server-side remote JS (BotGuard / nsig) runs in a non-isolating `new Function`, not a VM sandbox | Both |
| SEC-02 | P0 | Copy-paste sign-in link = account-takeover primitive; allowlist gate is reachable and mints sessions for any listed address without proof of ownership | Website launch |
| SEC-03 | P0 | Committed shared OAuth client secret (`PREVIEW_CLIENT_SECRET`) is the silent fallback whenever `GROK_AUTH_CLIENT_*` is unset | Both |
| SEC-04 | P1 | Free anonymous SOCKS proxies fetched from a third-party list and used as download egress | Both |
| SEC-05 | P1 | `/api/*` routes have no CSRF/Origin check (quota burn, server-side traffic amplification via a victim's browser) | Website launch |
| SEC-06 | P1 | Auth-off + no DB ⇒ one shared `dev-user`; every visitor reads/writes the same vault, proxies, history | Website launch |
| SEC-07 | P1 | `/api/relay` + third-party CORS proxies = app-origin proxy for arbitrary YouTube/googlevideo content and header pass-through | Website launch |
| SEC-08 | P1 | Weak password policy (8 chars, no verification) + unverified accounts can immediately sign in | Website launch |
| SEC-09 | P2 | Cross-serverless quota/rate-limit is per-instance in-memory; caps do not hold on Vercel | Website launch |
| SEC-10 | P2 | Operator install gate: auth-off socket-IP path + `VELO_ADMIN_EMAILS` unset semantics | Website launch |
| SEC-11 | P2 | Error messages return raw upstream/`err.message` to clients on several routes | Both |
| SEC-12 | P2 | `po-token.server` mutates process-global `window`/`self`/`document` on the request event loop (self-documented hazard) | Both |
| SEC-13 | P3 | Extension `host_permissions`/`externally_connectable` + `Velo`-title tab targeting; cookie flows are broad | Neither (ext) |
| SEC-14 | P3 | SOCKS/relay egress not filtered for private/metadata IPs (user-proxy path IS filtered; free-SOCKS + relay are not) | Website launch |

---

### SEC-01 — Server-side remote JavaScript runs in a non-isolating `new Function`, not a real sandbox
- **Severity:** P0
- **Category:** Remote code execution surface / unsafe deserialization of code
- **Blocks:** Both
- **Affected files:** `src/lib/po-token.server.ts:232-242`, `src/lib/po-token.server.ts:196-201` (fetches interpreter JS from a YouTube-supplied `interpreterUrl`), `src/lib/youtube-client.server.ts:8` (`Platform.shim.eval = (data) => new Function(data.output)()`)
- **Description:** To mint PO tokens the server downloads YouTube's BotGuard "interpreter" script at runtime (`https:${interpreterUrl}` taken from the homepage's `ytAtN` challenge) and executes it with `new Function("window","self","globalThis","document","location","navigator","yt", script)`. youtubei.js's `Platform.shim.eval` is likewise wired to `new Function(data.output)()` to run player.js signature code. `new Function` does **not** create an isolated realm: the function body runs with full access to Node built-ins (`process`, `require`/`getBuiltinModule`, `child_process`, `fs`) — the parameter names only shadow those identifiers, they do not remove ambient access via `this`/`globalThis`. The jsdom `window` is passed in as an argument, but the executed code is not confined to it. The only thing standing between this app and RCE-on-the-server is that the script is fetched over TLS from Google's CDN. Any compromise of that delivery (a malicious/MITM'd interpreter, a poisoned `bgutils-js`/`youtubei.js` dependency, or YouTube serving hostile bytes) executes attacker JS in the Node process with the app owner's `DATABASE_URL`, `BETTER_AUTH_SECRET`, `VELO_VAULT_KEY`, `XAI_API_KEY` and the whole cookie vault in reach.
- **Evidence:** Confirmed that `new Function` with those exact shadowing parameters does not isolate Node globals — a body reading `(function(){return this})()` reached `process.env` (115 vars) and `process.getBuiltinModule('node:child_process').execSync` from a fresh Node 25 process. The code path at `po-token.server.ts:196` fetches `script` from a URL embedded in fetched HTML and runs it at line 242 inside `withBgWindow`.
- **Real-world consequence:** A single supply-chain or upstream-content compromise turns "mint a bot token" into arbitrary code execution on the server, exposing every secret and every stored Google session cookie. This is the highest-impact surface in the product and it markets itself on doing exactly this ("PO Token minting", "nsig deciphering").
- **Recommended fix:** Run all remote/player JS in a real isolate — `node:vm` with a frozen, built-in-free context at minimum, ideally `isolated-vm` or a separate locked-down worker/subprocess with no env, no network beyond what BotGuard needs, and no module access. The file already documents (`po-token.server.ts:79-90`) that the correct fix is "running the minter in an isolated vm/worker context"; ship that before release. Pin dependency integrity (lockfile + `npm ci`, Subresource-style hash check on the fetched interpreter is not feasible, so isolation is mandatory).
- **Verification procedure:** After the fix, a test body that tries `process`, `require`, `globalThis.process`, `this.constructor.constructor('return process')()` inside the sandbox must throw / return undefined; existing PO-token mint must still succeed against one live video.
- **Status:** CONFIRMED (isolation gap proven locally; full RCE requires a hostile upstream/dependency, so exploitability is conditional — the missing sandbox is the defect).

---

### SEC-02 — Copy-paste sign-in link is an account-takeover primitive; the gate is reachable and mints sessions without proof of address ownership
- **Severity:** P0
- **Category:** Authentication / account takeover
- **Blocks:** Website launch
- **Affected files:** `src/lib/sign-in-link.ts:80-152`, `src/lib/sign-in-link-policy.ts:60-77`, `src/routes/login.tsx:13,67-95`
- **Description:** `requestSignInLink` returns the login token **to the caller** (no email is sent), upserts a `user` row for any named address, and `redeemSignInLink` deletes that user's other sessions and mints a fresh 7-day session (`sign-in-link.ts:144-151`). The module's own header calls it "an account-takeover primitive." It is gated by `signInLinkAvailability`: off if `VELO_SIGNIN_LINK=false`; **on for any address** if `VELO_SIGNIN_LINK=true`; **on for listed addresses** if `VELO_SIGNIN_LINK_EMAILS` is set (in *any* environment, even with OAuth configured); and on for everyone when OAuth is unconfigured. So whenever an operator sets an allowlist (the documented "safe" mode), anyone who can reach the server function can mint a valid session for those exact addresses — including a designated operator/admin address — with no proof they own it. Combined with the operator gate keying on a verified signed-in email (`operator-gate.server.ts`, `tool-versions.ts:209`), minting the admin's session yields operator privileges.
- **Evidence:** On the local server with `VELO_SIGNIN_LINK_EMAILS=admin@example.test`: called `requestSignInLink` for `admin@example.test` via the framework RPC transport (same-origin `Origin` header, no auth) → `200` with `{"path":"/login?link=<token>","expiresMinutes":15}`. Redeemed that token via `redeemSignInLink` → `200` returning a 64-hex session token. Using that session as a bearer, `checkToolUpdates` returned `canUpdate:true` (operator). Tokens shown redacted. Rate limits are per-process in-memory Maps (`sign-in-link.ts:26`, `SIGNUP…` in `api/auth/$.ts:5`).
- **Real-world consequence:** On any deploy that turns on the sign-in link for an allowlisted operator (its intended use), an unauthenticated attacker mints that operator's session and gains the operator console — which can run `npm install` / `pip install` on the server (see SEC-10 and the tool-updates path). Even without operator addresses, `VELO_SIGNIN_LINK=true` grants any-address takeover.
- **Recommended fix:** Do not return login tokens to the caller from a network-reachable endpoint. Either wire a real email transport and deliver the link out-of-band, or remove the feature for any non-local deploy. If kept for local-only, bind it to a loopback socket-IP check like the operator gate, not to an env allowlist. Never let a redeemed link confer operator status.
- **Verification procedure:** With the feature "enabled" for an allowlisted address, an unauthenticated caller must not be able to obtain a usable session token or an operator-capable session.
- **Status:** CONFIRMED.

---

### SEC-03 — Committed shared OAuth client secret is the silent production fallback
- **Severity:** P0
- **Category:** Secrets management / hardcoded credential
- **Blocks:** Both
- **Affected files:** `src/lib/auth/preview.ts:19-21`, `src/lib/auth/server.ts:81-86,165-184`
- **Description:** `PREVIEW_CLIENT_SECRET` (a full 64-hex OAuth client secret for the shared broker `grok_preview` client) is committed in source. `server.ts` uses it as the fallback for `GROK_AUTH_CLIENT_SECRET` (and `PREVIEW_CLIENT_ID` for the id) whenever the env var is unset/empty. `authConfigured` becomes true on the baked secret, so a deploy that forgets to inject per-app `GROK_AUTH_*` silently runs real federated auth on a shared, public, source-committed client credential rather than failing closed.
- **Evidence:** `preview.ts:20-21` holds the literal secret (`8bcdb7…REDACTED`). `server.ts:83` `const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;`. Confirmed the secret is bundled into the production SSR function (`.vercel/output/functions/__server.func/_ssr/server-*.mjs`); it is **not** in the static client bundle (server-side only), but it is public by virtue of being in the repo. Anyone with the repo can act as the `grok_preview` OAuth client against `auth.grok.me`.
- **Real-world consequence:** The secret is burned for every install of this OSS repo; the broker cannot trust the `grok_preview` client. A misconfigured self-host authenticates users against a shared client that any repo reader also holds, enabling token/callback abuse against that client. Publishing the repo is itself the disclosure.
- **Recommended fix:** Remove the secret from source; require `GROK_AUTH_CLIENT_SECRET` and fail closed when unset (do not fall back to a baked secret) for any non-sandbox deploy. Rotate `GROK_PREVIEW_CLIENT_SECRET` in the broker. Treat the current value as compromised.
- **Verification procedure:** Grep the tree for the literal — must be absent. With `GROK_AUTH_CLIENT_SECRET` unset and not in sandbox, `authConfigured` must be false (or boot must refuse), not silently true.
- **Status:** CONFIRMED. (REQUIRES coordination with broker owners to rotate — the broker is out of this repo's scope.)

---

### SEC-04 — Downloads egress through free anonymous SOCKS proxies pulled from a third-party list
- **Severity:** P1
- **Category:** Egress / data exposure / integrity
- **Blocks:** Both
- **Affected files:** `src/lib/socks-pool.server.ts:20,109-124,173+`, `src/lib/ytdlp.server.ts:255-289`
- **Description:** `socks-pool.server` fetches a live list of anonymous public SOCKS5 proxies from `cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main` and routes guest `yt-dlp` download hops through randomly chosen entries. Free public SOCKS nodes are operator-controlled MITM points: they see and can tamper with all traffic routed through them. The code correctly refuses to send the host-browser cookie jar over a pool-SOCKS hop (`ytdlp.server.ts:178`, `ytdlp-auth.ts:534-540` `opts.proxy && !opts.trustedProxy ⇒ no cookies`), which limits credential exposure, but the fetched media bytes, the target video ids, and the server's request patterns still traverse an untrusted third party, and a hostile proxy can return arbitrary bytes as "the video."
- **Evidence:** `socks-pool.server.ts:20 LIST_URL = "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.json"`; `loadList()` merges these into the rotation; `probe()` shells `curl … -x <proxy>`; `ytdlp.server.ts:258-289` runs the client ladder over `takeSocks(1)` hops. No allow/deny on the proxy destination family (see SEC-14).
- **Real-world consequence:** Untrusted infrastructure in the media path; possible serving of attacker-substituted content to users, and the app's server IP/behaviour exposed to arbitrary proxy operators. For an OSS security posture this is a design smell that should be opt-in, off by default.
- **Recommended fix:** Make the free-SOCKS pool strictly opt-in (env flag, default off); document the trust implications; never route anything that could carry credentials through it (already enforced — keep it). Prefer operator-configured proxies only.
- **Verification procedure:** With the flag off, confirm no fetch to the jsdelivr list and no SOCKS hop is attempted.
- **Status:** CONFIRMED (code path); MITM impact is inherent to free-proxy use, not separately reproduced.

---

### SEC-05 — `/api/*` routes have no CSRF/Origin check
- **Severity:** P1
- **Category:** CSRF / SSRF-amplification / denial-of-wallet
- **Blocks:** Website launch
- **Affected files:** `src/routes/api/{download,bypass,builder,ytdlp,unlock,relay,captions,feed}.ts`
- **Description:** The `/api/*` handlers are plain GET/POST with no `Origin`/`Sec-Fetch` check and are not behind `authMiddleware` (which is where `assertSameSiteRequest` lives, `middleware.ts:41-44`). By contrast the `createServerFn` RPC transport IS origin-checked by the framework (see evidence). So any web page can make a victim's browser issue GETs to `/api/download`, `/api/bypass`, `/api/captions`, `/api/feed`, `/api/relay` (and POST `/api/unlock`), spending the victim's guest/user quota and driving server-side subprocesses, jsdom/BotGuard mints, and gigabyte media streaming on the app's dime. The credentialed-cookie POSTs (`/api/ytdlp`, `/api/builder`) require an explicit `cookies` body plus a signed-in bearer to attach a session, and the bearer lives in `sessionStorage` (not auto-sent), so cross-site cookie exfiltration is not achievable this way — the exposure is resource/quota abuse, not vault theft.
- **Evidence:** Framework RPC endpoints returned `403 Forbidden` to a cross-origin `Origin` and `200` only to a same-origin `Origin` (confirmed on `:8097`). The `/api/*` routes answered `curl` with no `Origin` header normally (e.g. `/api/feed`, `/api/ytdlp` returned 400 validation, not 403). No route reads `Origin`/`Sec-Fetch-Site`.
- **Real-world consequence:** Cross-site quota exhaustion and denial-of-wallet: an embedded `<img>`/`fetch` loop on a popular page makes many browsers stream googlevideo bytes and run BotGuard through the app, running up Vercel bandwidth/compute.
- **Recommended fix:** Apply the same `Sec-Fetch-Site`/`Origin` allowlist used by `assertSameSiteRequest` to every `/api/*` handler (reject scripted cross-site requests; allow top-level GET navigations only where a direct download link is intended).
- **Verification procedure:** A cross-site `fetch('/api/download?…')` from another origin must be rejected; a same-origin app request must still work.
- **Status:** CONFIRMED.

---

### SEC-06 — Auth-off + no database serves one shared `dev-user`; all per-user data is world-shared
- **Severity:** P1
- **Category:** Authorization / multi-tenant data separation
- **Blocks:** Website launch
- **Affected files:** `src/lib/auth/verify.server.ts:84-96`, `src/lib/auth/middleware.ts:36-46`, `src/lib/vault.ts:10-55`
- **Description:** With `VITE_AUTH_ENABLED=false` and no `DATABASE_URL`, `requireUserId` returns the constant `DEV_USER_ID = "dev-user"` for every caller (`verify.server.ts:92`). All `authMiddleware`-gated server functions — vault load/save, proxy management, history — then scope by that one id, so every anonymous visitor reads and writes the same rows. `saveVault` stores a live Google session cookie jar (SID/SAPISID); in this mode any visitor can read the previous visitor's saved session credentials. The code does fail *closed* when a `DATABASE_URL` is set with auth off (`verify.server.ts:86-90`), which correctly prevents the worst case on a real DB, and `VITE_AUTH_ENABLED` defaults to on — but the shipped default template (`AGENTS.md`, `email-password.ts` enabling local passwords) and PGLite fallback make the shared-dev-user mode very easy to deploy.
- **Evidence:** On `:8098` (`VITE_AUTH_ENABLED=false`, PGLite): visitor A `saveVault` with a (fake) SID/SAPISID/LOGIN_INFO jar → `200 {count:3}`; a separate request with no cookies and no bearer called `loadVault` → `200` returning the same jar verbatim. So a second visitor reads the first's stored session tokens.
- **Real-world consequence:** If this app is ever exposed publicly in auth-off/PGLite mode, the "Session Credential Vault" is a shared bucket of live Google credentials readable by any visitor.
- **Recommended fix:** Refuse to serve `loadVault`/`saveVault` (and any credential store) in the shared-dev-user mode, or gate the whole app to loopback when auth is off. Never expose credential storage without a verified per-user identity.
- **Verification procedure:** In auth-off mode, `loadVault` from a fresh client must not return another client's data.
- **Status:** CONFIRMED.

---

### SEC-07 — `/api/relay` + third-party CORS proxies: app-origin fetch of YouTube/googlevideo with header pass-through
- **Severity:** P1
- **Category:** Open-proxy-lite / content served from app origin / header injection
- **Blocks:** Website launch
- **Affected files:** `src/routes/api/relay.ts:41-145`, `src/lib/cors-relays.ts:12-24,29-38`
- **Description:** `/api/relay?url=` fetches any `https` URL whose host matches YouTube/googlevideo/ytimg/ggpht/youtube-nocookie (`isRelayTarget`) and streams the body back from the **app's own origin**, and for HTML page targets it additionally fans the request out through third-party CORS proxies `proxy.corsfix.com` and `api.allorigins.win` (`cors-relays.ts:12-24`). It forwards selected upstream headers to the client including `Content-Disposition` and `Content-Type` (`relay.ts:33-37`). The host allowlist is broad: `x.googlevideo.com:8443/admin` and `evil.ytimg.com` are accepted as targets (any subdomain of the allowed suffixes, any path/port). It sets `Content-Security-Policy: sandbox` + `nosniff` which neuters direct navigation, and it does gate media on the download quota — but page/HTML fetches only clear the cheap metadata backstop and are proxied through the two third parties, meaning arbitrary attacker-influenced content from those hosts is retrievable via the app origin, and the third-party proxies see the traffic.
- **Evidence:** `cors-relays.isRelayTarget` returned ALLOW for `https://x.googlevideo.com:8443/admin`, `https://evil.ytimg.com/`, and `https://www.youtube.com/redirect?q=https://evil.test` (the last two also emit third-party relay URLs); it correctly denied `youtube.com@169.254.169.254`, `…youtube.com.evil.test`, and `#`-fragment tricks. Header copy list at `relay.ts:33-37`.
- **Real-world consequence:** The app becomes a limited content relay for the whole `*.ytimg.com`/`*.googlevideo.com`/`*.youtube.com` space served from its own origin, and routes user page-fetch traffic through two external proxy services (privacy/exfiltration surface). `Content-Disposition` pass-through lets an upstream set the download filename.
- **Recommended fix:** Tighten `isRelayTarget` to exact hosts and paths actually needed (e.g. `*.googlevideo.com` videoplayback only); drop the third-party CORS-proxy fan-out or make it opt-in; do not forward upstream `Content-Disposition`; keep the sandbox CSP.
- **Verification procedure:** Confirm non-videoplayback googlevideo paths and non-media ytimg hosts are rejected; confirm no request leaves to corsfix/allorigins by default.
- **Status:** CONFIRMED (allowlist breadth + third-party fan-out in code; reproduced target-matching only).

---

### SEC-08 — Weak password policy and immediate sign-in of unverified accounts
- **Severity:** P1
- **Category:** Authentication
- **Blocks:** Website launch
- **Affected files:** `src/lib/auth/email-password.ts:10`, `src/lib/auth/server.ts:224-226`, Better Auth defaults (`node_modules/better-auth/dist/context/create-context.mjs:185` minPasswordLength 8), `src/routes/api/auth/$.ts:5-22`
- **Description:** Local email/password is enabled (`emailAndPasswordEnabled = true`) with Better Auth defaults: 8-char minimum, no complexity, and `requireEmailVerification` not set, so accounts sign in immediately with an unverified email. The only sign-up throttle is a per-instance in-memory Map keyed on client IP (`api/auth/$.ts`), which does not hold across serverless instances and is bypassable by rotating the platform-attested forwarded IP is not possible on Vercel, but is trivial across warm instances.
- **Evidence:** On `:8097`: sign-up with password `12345678` → `200` with a session token; sign-in of a just-created unverified account → `200 {token…, emailVerified:false}`. Rotating `x-vercel-forwarded-for` across 12 sign-ups all returned `200` (the in-memory limiter tripped only on the *same* IP after 8).
- **Real-world consequence:** Trivial credential-stuffing/spray surface and unlimited unverified account creation; no email ownership proof before an account is usable.
- **Recommended fix:** Raise `minPasswordLength` (≥12) and add breach/complexity checks; require email verification before sign-in for a public deploy; move rate limiting to a shared store (see SEC-09).
- **Verification procedure:** Sign-up with an 8-char password and with an unverified email must be refused per policy.
- **Status:** CONFIRMED.

---

### SEC-09 — Quota and rate limits are per-instance in-memory; they do not hold on Vercel
- **Severity:** P2
- **Category:** Rate limiting / denial-of-wallet
- **Blocks:** Website launch
- **Affected files:** `src/lib/guest-limit.server.ts:39-42,224` (Maps), `src/lib/sign-in-link.ts:26`, `src/routes/api/auth/$.ts:5`, Better Auth rate-limit storage default `memory` (`node_modules/better-auth/dist/context/create-context.mjs:169-174`)
- **Description:** Every quota/rate structure — download token buckets, per-IP backstops, sign-up/sign-in-link throttles, and Better Auth's own limiter — is an in-process Map. On Vercel each warm serverless instance has its own copy, so real limits are (per-instance × instance-count) and reset on cold start. The per-IP backstop itself works within one instance (confirmed same-IP tripped at the configured count; rotating `x-real-ip`/`x-forwarded-for` did **not** reset it because `clientIp` correctly prefers the platform-attested `x-vercel-forwarded-for`/`x-real-ip` and ignores client `cf-*` unless `TRUST_CLOUDFLARE=1`), but fan-out across instances defeats the cap.
- **Evidence:** `guest-limit.server.ts` uses module-level `Map`s; `clientIp` (lines 113-143) prefers `x-vercel-forwarded-for`. Local test: 45 same-IP `/api/feed` requests tripped `429` at the meta cap; rotating `x-real-ip`/`x-forwarded-for` stayed `400` (not reset) — confirming header spoofing does *not* bypass within an instance. The cross-instance gap is architectural.
- **Real-world consequence:** Download/denial-of-wallet caps are much looser in production than intended; the sign-up and sign-in-link throttles are effectively per-instance.
- **Recommended fix:** Back quotas and auth rate limits with a shared store (the existing Postgres, or Vercel KV/Upstash). At minimum document that limits are per-instance and size Vercel concurrency accordingly.
- **Verification procedure:** Under simulated multi-instance load, confirm a single identity cannot exceed N× the intended cap.
- **Status:** CONFIRMED (architectural; header-spoof bypass ruled out locally).

---

### SEC-10 — Operator install gate: auth-off socket-IP path and allowlist semantics
- **Severity:** P2
- **Category:** Authorization / RCE-adjacent (runs npm/pip on the host)
- **Blocks:** Website launch
- **Affected files:** `src/lib/operator-gate.server.ts:15-42`, `src/lib/tool-versions.ts:209-246`, `src/lib/tool-updates.server.ts:183-267`
- **Description:** The Tools tab can run `npm install <pkg>@latest` and `pip install --upgrade` on the live server (`tool-updates.server.ts`). Access: with auth **on**, only verified emails in `VELO_ADMIN_EMAILS` (fails closed when unset — good). With auth **off**, install is allowed only if `VELO_ALLOW_TOOL_INSTALL=1` **and** the socket IP is loopback (`operatorDecision`, `isLoopbackAddress`). The socket-IP check uses `getRequestIP()` (not a forgeable header), which is correct — but on a platform where a same-host proxy fronts the function, loopback can mean "any visitor," a risk the code comments acknowledge. The real amplifier is SEC-02: with auth on and an operator allowlist, the sign-in-link lets an attacker *become* that operator and reach this install path. `assertInstallPkg`/`npmInstallArgs` restrict the package name to a safe charset and fixed argv (no shell), so argv injection is not the issue — the issue is who can trigger installs.
- **Evidence:** `operator-gate.server.ts:18-24` uses `getRequestIP()` when auth off; `tool-versions.ts:218-246` gate logic; `tool-updates.server.ts:135-163` spawns `npm`/`pip` with `spawn(cmd, args)` (no shell). Chained with SEC-02, a minted operator session returned `canUpdate:true` locally.
- **Real-world consequence:** An attacker who reaches the operator role (via SEC-02, or via a mis-fronted loopback deploy) can install arbitrary-versioned packages / trigger network fetches on the server.
- **Recommended fix:** Fix SEC-02 first. For auth-off, prefer disabling install entirely on any non-local deploy; do not rely on loopback socket IP where a proxy may collapse it. Keep `VELO_ADMIN_EMAILS`-unset ⇒ nobody.
- **Verification procedure:** With auth off behind a proxy, a remote visitor must not reach install; with auth on and no allowlist, nobody may install.
- **Status:** CONFIRMED (gate logic + chain with SEC-02).

---

### SEC-11 — Internal error text returned to clients
- **Severity:** P2
- **Category:** Information disclosure
- **Blocks:** Both
- **Affected files:** `src/routes/api/download.ts:52`, `api/ytdlp.ts:55`, `api/builder.ts:34`, `api/bypass.ts:25`, `api/unlock.ts:54`, `api/captions.ts:31`, `api/feed.ts:86`, `src/lib/youtube.server.ts:40-41,157,186`
- **Description:** Several routes return `err.message` (or upstream-derived text) directly in the JSON error body. yt-dlp stderr is redacted for proxy authority before surfacing (`ytdlp-auth.ts:759-777` masks `scheme://authority`), and `/api/health` is deliberately generic (`health.ts:56-58`), which are good. But the generic `err.message` passthrough on the download/metadata routes can still leak internal reasons (client/ladder details, InnerTube errors, file/path fragments) to unauthenticated callers.
- **Evidence:** Each cited route ends its catch with `Response.json({ error: message }, …)` where `message = err instanceof Error ? err.message : <fallback>`.
- **Real-world consequence:** Reconnaissance of the extraction pipeline and occasional path/internal detail leakage; not a direct compromise.
- **Recommended fix:** Return fixed, user-facing strings on public routes; log details server-side keyed by a request id. Keep the existing proxy-authority redaction.
- **Verification procedure:** Trigger each error path; confirm the body carries no internal/host/path detail.
- **Status:** CONFIRMED.

---

### SEC-12 — BotGuard minter mutates process-global `window`/`self`/`document` on the request loop
- **Severity:** P2
- **Category:** Concurrency / correctness with security impact
- **Blocks:** Both
- **Affected files:** `src/lib/po-token.server.ts:66-105,231-278`
- **Description:** `withBgWindow` binds a jsdom window onto `globalThis.window/self/document` for the whole (async) duration of the mint, which the file documents as a "KNOWN CONCURRENCY HAZARD": any other task interleaving during those awaits sees `typeof window !== "undefined"` and can take browser branches or trip server-only guards. This can cause server-only modules to misbehave under concurrency (e.g. a concurrent first `getSql()`), with potential correctness/security consequences (wrong branch taken while a fake `youtube.com` origin is bound).
- **Evidence:** Self-documented at `po-token.server.ts:79-90`; `bindBgWindow()`/`unbindBgWindow()` at 66-77 mutate `g.window/self/document`.
- **Real-world consequence:** Intermittent, hard-to-reproduce wrong-branch execution during PO-token minting under load.
- **Recommended fix:** Same as SEC-01 — run the minter in an isolated vm/worker so process globals are never mutated on the request event loop.
- **Verification procedure:** Under concurrent mint + `getSql()` load, confirm no handler observes a bound browser global.
- **Status:** CONFIRMED (by code + author's own note).

---

### SEC-13 — Chrome extensions: broad permissions and cookie flows
- **Severity:** P3
- **Category:** Extension security / attack surface
- **Blocks:** Neither (extensions ship separately; noted for completeness — see also 15-ai-security for the paste-into-LLM flow)
- **Affected files:** `extension/manifest.json`, `extensions/velo-session/{manifest.json,content.js,background.js,popup.js}`, `src/components/cookie-import.tsx:172-178`
- **Description:** Both MV3 extensions request `cookies` + broad `host_permissions` including `*.grok.com`, `grok.me`, `*.grok-sandbox.com`, localhost, and (velo-session) `webRequest` + `<all youtube>`. The velo-session extension reads HttpOnly YouTube session cookies and captures live `Cookie` headers via `webRequest`, then injects them into any tab whose host is a Velo host **and** whose title is `Velo`/`Velo …` (`popup.js:13-34`), posting them to the page via `window.postMessage(..., window.location.origin)` (`content.js:3-12`). The web app receiver (`cookie-import.tsx:174`) validates `event.origin === window.location.origin`, `source==="velo-extension"`, `type`, and that `netscape` is a string — reasonable. No `externally_connectable` is declared (good; arbitrary sites cannot `runtime.sendMessage` to the extension). Residual risk: title-based tab targeting is spoofable (any page that sets `document.title="Velo"` on a Velo host could receive an injection), and the extensions centralize live Google credentials.
- **Evidence:** Manifests as quoted; `content.js` origin-scoped postMessage; `popup.js` `isVeloHost`/`isVeloTab` title check; receiver origin check at `cookie-import.tsx:174-177`. `public/extensions/velo-session.zip` and unpacked copy are byte-identical to `extensions/velo-session` (`diff -r` clean).
- **Real-world consequence:** Concentrated handling of live session cookies; title/host targeting is a weak trust boundary, though same-origin postMessage + no `externally_connectable` limit web-page-triggered exfiltration.
- **Recommended fix:** Narrow `host_permissions` to what each extension needs; replace title-based targeting with an explicit user action or a nonce handshake; document the credential handling prominently.
- **Verification procedure:** Confirm no site outside the Velo origins can trigger cookie injection or read the posted message.
- **Status:** CONFIRMED (permission/flow review); no web-triggerable exfiltration path found.

---

### SEC-14 — Free-SOCKS and relay egress not filtered for private/metadata IPs
- **Severity:** P3
- **Category:** SSRF (egress side)
- **Blocks:** Website launch
- **Affected files:** `src/lib/socks-pool.server.ts:80-98` (`normalizeSocksUrl` — no address filtering), `src/routes/api/relay.ts` (target host allowlisted to YouTube, so low risk), vs. the good path `src/lib/proxy-transport.server.ts:60-110` / `proxy-fetch.server.ts:47-53`
- **Description:** The **operator/user proxy** path is well-defended: `proxy-transport.server.isForbiddenAddress` blocks RFC1918, loopback, link-local `169.254.0.0/16` (incl. cloud metadata `169.254.169.254`), CGNAT, and IPv6 ULA/link-local, resolving DNS first and checking every answer, and the proxied *target* is restricted to YouTube hosts. By contrast the **free-SOCKS** list (`socks-pool.server.normalizeSocksUrl`) applies no such filter to the proxy endpoint, and env `VELO_SOCKS_PROXY`/`ALL_PROXY` are taken as-is. Because the free-SOCKS destination is always a fixed YouTube/googlevideo URL, this is not a general SSRF, but a malicious list entry pointing at an internal address is not rejected before `curl -x` probes it.
- **Evidence:** `isForbiddenAddress` and its use in `resolveProxyEndpoint` (`proxy-transport.server.ts:69-110`) — solid. `socks-pool.server.normalizeSocksUrl` (80-98) validates only scheme/host/port shape. `probe()` spawns `curl -x <proxy>` (127-135).
- **Real-world consequence:** Limited internal-port probing via a poisoned free-proxy entry; low, because the fetched URL is fixed and no credentials ride these hops.
- **Recommended fix:** Reuse `isForbiddenAddress` for free-SOCKS entries and for `VELO_SOCKS_PROXY`/`ALL_PROXY` before probing/using them.
- **Verification procedure:** A list/env proxy resolving to a private/metadata IP must be dropped before any connection.
- **Status:** CONFIRMED (user-proxy path defended; free-SOCKS path unfiltered).

---

## Positive findings (defenses that hold)
- `assertSameSiteRequest` (`isolation.server.ts`) + `__Host-` cookies + Better Auth `trustedOrigins` close the sibling-tenant scripted-request surface for **server functions** (framework enforces Origin; confirmed 403 cross-origin).
- IDOR/BOLA: vault, user-proxy repository, and proxy-operations queries are all scoped by the verified `context.userId` from `authMiddleware` (`vault.ts`, `user-proxy.ts`, `user-proxy-repository*.server.ts`); no client-supplied id is trusted. The only authorization gap is the shared `dev-user` in auth-off mode (SEC-06).
- Vault cookies are AES-256-GCM at rest when `VELO_VAULT_KEY` is set; proxy secrets require a stable key in production (`vault-crypto.ts:227` throws in prod when unset). Note: with `VELO_VAULT_KEY` unset the vault stores **plaintext** with only a warning (`vault-crypto.ts:271-283`) — acceptable for dev, dangerous if a public deploy forgets it; call it out in deploy docs.
- Parsers `cookies.ts` / `har.ts` handled adversarial ~400 KB inputs (curl/netscape/JSON/HAR shapes) in <11 ms each — no ReDoS/backtracking blowup observed.
- yt-dlp argv is a fixed array via `spawn` (no shell); package names for installs pass `assertInstallPkg`. No `--no-check-certificate`/`rejectUnauthorized:false`/`NODE_TLS_REJECT_UNAUTHORIZED` anywhere.
- yt-dlp stderr redacts `scheme://authority` before surfacing (`ytdlp-auth.ts:772-776`); `/api/health` leaks nothing.
- `preview-host-bridge` validates `event.origin === parentOrigin` and resolves the parent via a real allowlist (`preview-embedder-origin.ts`); path navigation is same-origin-checked.
- Dev-only middleware (`/__app-env`, `/auth/popup`) is `apply:"serve"` and is **absent** from the production server function bundle (verified in `.vercel/output/functions`).
- Cookie temp files for yt-dlp are written under `mkdtemp` and removed in `finally` (`ytdlp.server.ts:128,307`); SOCKS good/dead files are written mode `0o600`.

## Not verified / out of scope
- Full RCE via a hostile BotGuard interpreter or a poisoned `bgutils-js`/`youtubei.js` (SEC-01) was not exploited — only the missing isolation was proven; exploitability depends on upstream/supply-chain compromise.
- Cross-serverless quota behavior (SEC-09) is argued from architecture, not reproduced on real Vercel.
- MITM/content-substitution by a free SOCKS/relay operator (SEC-04/07) is inherent to the design, not separately demonstrated.
- The broker (`auth.grok.me`) side of SEC-03 rotation is out of this repo's control (REQUIRES coordination).
- Legal/ToS implications of "bypass rate limits", proxy use, and storing others' Google cookies → REQUIRES LEGAL REVIEW (see 13-privacy-data).
- No production deploy was tested; all reproduction was against a local dev server on non-standard ports, now stopped.
