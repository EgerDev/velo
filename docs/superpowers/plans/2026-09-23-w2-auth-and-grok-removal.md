# W2 — Own Sign-in and App-Builder Template Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task names its **Executor** (`.claude/agents/velo-impl-*.md`) and is reviewed by `velo-reviewer` before the next task starts.

**Goal:** Velo authenticates only through its own Better Auth instance with the project's own Google OAuth client, every trace of the hosted app-builder platform is gone from the shipped tree, and a production server refuses to start when required configuration is missing.

**Architecture:**
- `src/lib/env.server.ts` (contract C1) is the one reader of server configuration. `server/plugins/env.ts`, a Nitro plugin, runs it before the node-server entry listens, so a misconfigured production boot exits non-zero instead of answering 500 on every route.
- `src/lib/auth/auth-config.server.ts` turns that config into Better Auth options. Google is the only provider, `baseURL = VELO_PUBLIC_ORIGIN`, cookies are `__Host-velo.*`, and loopback origins are trusted only outside production. It is pure, so it is unit-tested.
- Deleted: the platform broker, gate identity, bearer tokens, popup, email/password, the PWA/branding injector, the preview bridge, the env wrapper, the connectors and the sandbox files. `migrations/0006_google_only_auth.sql` removes the accounts the deleted providers created.

**Tech Stack:** TanStack Start + Vite 8 + Nitro `3.0.260610-beta` (`node-server`), Better Auth `1.6.33` (built-in `google` social provider, Kysely/pg adapter), PostgreSQL 16 (CI) / PGLite (dev and unit tests), `node:test`, the C6 HTTP harness.

**Spec:** `docs/superpowers/plans/2026-09-23-00-roadmap.md` (D4, D7, Global Constraints, C1, C6, C9), the W1 plan's Hand-off (`docs/superpowers/plans/2026-09-23-w1-foundation.md`), the W0/W1 SDD ledgers, and the audit entries listed in § Audit coverage (`audit/*.md`).

---

## Contract change requests

Task 1 applies all three to the roadmap, in its own commit, before any dependent work.

1. **C1: the dev default of `VELO_PUBLIC_ORIGIN` follows `VELO_DEV_PORT`.** This is the pending W1 request (W1 plan § Hand-off; W1 ledger Task 1).
   - Today C1 says `dev: "http://localhost:8080"`. With `VELO_DEV_PORT=8097` that origin is wrong, and Better Auth rejects sign-in with "Invalid origin".
   - New dev default: `` `http://localhost:${Number(VELO_DEV_PORT) || 8080}` ``, the same expression `vite.config.ts` uses for the port. It is exported as `devOrigin(source?)`, an additive export.
   - The default is still 8080, so the change is compatible.
2. **C1: `EnvError` semantics, stated precisely.** Additive or clarifying only; nothing is renamed.
   - `missing` lists every required variable that is missing **or invalid**:
     - `BETTER_AUTH_SECRET` shorter than 32 characters;
     - `VELO_PUBLIC_ORIGIN` that is not a bare `https://` origin, where `http://` is allowed only on a loopback host.
   - `missing` also names `BETTER_AUTH_TRUSTED_ORIGINS` or `BETTER_AUTH_SECRETS` when either is set in production. Better Auth reads both straight from `process.env`, past C1. The first would widen the trusted origins beyond `VELO_PUBLIC_ORIGIN`, which breaks C9. The second would replace `BETTER_AUTH_SECRET`.
   - The message is `Missing or invalid required environment variables: A, B`, with names only and never a value.
   - `loadServerEnv()` runs in `server/plugins/env.ts` before the server listens. That plugin sets `NODE_ENV=production`, because the built server is production whatever the shell says.
3. **C1 fields: none removed.** No C1 field is tied only to a removed feature:
   - `VELO_PROXY_SECRET_KEY` and `VELO_PROXY_SECRET_KEY_PREVIOUS` serve user proxies, which stay. W3 wires them;
   - `VELO_EXTENSION_IDS` serves W6;
   - `SENTRY_DSN` serves W5;
   - `VELO_EGRESS_PROXY` serves W4a;
   - `YTDLP_PYTHON` serves W4a/W5.

   W2 parses them but does not consume them (see Hand-off).

**Decisions applied.** These are readings of the controller decisions, recorded so the reviewer can check them. None is a contract change.
- **Controller decision 6 (dev-user) is read as "delete it outright".** The decision's third sentence says that with Google unconfigured in dev, per-user features answer 401. So no condition is left in which the shared `dev-user` resolves, and `requireUserId` has no fallback in any environment. `removed-auth.test.ts` pins it.
- **Controller decision 7 (HTTP test envs) gets one refinement, and it adds no escape hatch.**
  - Suites that need a working database (auth, health `ok`) use `VELO_TEST_DATABASE_URL` and skip locally without it.
  - Suites that only need a booted server (boot refusal, health `503`, input guards, harness self-tests, branding, login page) pass a well-formed `DATABASE_URL` that points at a closed port (`postgres://velo-test@127.0.0.1:1/unreachable`).
  - Both kinds run the real production build in production mode. The refinement keeps the W1 health-503 and guard tests running on every developer machine.
- **`.vercel` in `.gitignore` and the eslint ignores stays for W7.** An old checkout can still hold `.vercel/output`, the Vercel bundle that contained the leaked preview secret (W0-T5). The ignores stop it from ever being committed or linted. W7 removes them at release.
- **`jose` stays in `package.json`.** Gate identity was its only direct import. But the exact root pin `6.2.9` is the version Better Auth resolves (`better-auth` → `jose ^6.1.3`), and W1 kept that pin deliberately. `npm uninstall jose` also rewrites unrelated lockfile entries on npm 11.6 (verified). Do not touch the dependency or the lockfile.
- **`isMainModule` moves with `projectRoot`, as decided, even though its last caller (`check-auth-invariant.mjs`) is deleted.** W7 may drop it if it is still unused.

## Preconditions

- **W0 and W1 are merged.** Roadmap merge order: W0 → W1 → W2.
- **Work in the worktree `C:\Users\PC\orca\velo-w2`**, branch `hardening/w2-auth`, HEAD `79e3099`, `node_modules` installed. `.gitattributes` is `* text=auto eol=lf`, so every "replace exactly" anchor below is LF text. Run commands in **Git Bash** from the worktree root. Use `MSYS_NO_PATHCONV=1` for any command whose argument starts with `/`.
- **The code as W1 left it, where it matters here:**
  - `src/lib/auth/server.ts` federates to the platform broker through `genericOAuth` (`GROK_AUTH_*`) and registers `bearer()`, `gateIdentitySessions()` and email/password.
  - The same file calls `assertAuthConfiguredForProduction` (`auth-boot-policy.ts`) at module scope. That throw fires when the SSR bundle loads on the first request, so the server listens and answers 500 everywhere. The 500 was reproduced in the scratch build: `/api/health` → `{"status":500,"unhandled":true,"message":"HTTPError"}`.
  - `tests/http/{health,harness,api-guards}.test.mjs` boot with `BASE_ENV = { VITE_AUTH_ENABLED: "false" }`.
  - `eslint.config.mjs` exempts `gate-session.server.ts` and `verify.server.ts` from `no-console` (marked `W2`).
  - `package.json` `dev`/`build`/`build:dev`/`preview` run through `scripts/with-app-env.mjs`, and `check:auth` exists.
  - `vite.config.ts` registers `authPopupPlugin`, `appEnvPlugin` and `grokPwaPlugin`, and sets `nitro({ preset: "node-server", serverDir: "./server" })`.
- **Ports and tools.**
  - Occupied ports: 8080, 8081, 8123, 55432. Tests use `PORT=0`. The only fixed port in this plan is `VELO_DEV_PORT=8097`, for the manual dev check in Task 5.
  - Node 25.2.1 on the host (`>=24.15.0`). Docker is **not** required.
- **Database-backed HTTP tests.**
  - `tests/http/auth.test.mjs` and the health-`ok` test need `VELO_TEST_DATABASE_URL`. They skip locally without it, and CI's `verify` job always sets it.
  - Optional: a Postgres-wire database with no Docker, **outside the repo**. PGLite behind a socket was used to verify this plan:
    ```bash
    S="$TEMP/velo-pgsock"; mkdir -p "$S" && cd "$S" && npm init -y >/dev/null && npm i @electric-sql/pglite-socket --no-audit --no-fund
    cat > server.mjs <<'EOF'
    import { PGlite } from "@electric-sql/pglite";
    import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
    const db = await PGlite.create();
    await new PGLiteSocketServer({ db, port: Number(process.argv[2]), host: "127.0.0.1", maxConnections: 50 }).start();
    console.log("listening", process.argv[2]);
    EOF
    node server.mjs 55499 &   # then, from the worktree:
    DATABASE_URL=postgres://postgres@127.0.0.1:55499/postgres npm run db:migrate
    export VELO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55499/postgres
    ```
    Stop it afterwards with `taskkill //PID <pid> //F` (find the pid with `netstat -ano | grep :55499`). CI's Postgres 16 is authoritative.

## Global Constraints

Copied from the roadmap. Every task's requirements include these.

- **Node:** `>=24.15.0` (`engines`, `.nvmrc` = `24`).
- **Untrusted JavaScript:** the server never executes JavaScript fetched from a third party (D7/C5). No task may add or improve bot-detection or throttle circumvention.
- **Egress:** after W2, no host containing `grok` may appear in `src/`, `server/`, `scripts/`, `packages/` or `public/`, enforced by a CI check (Task 11).
- **Credentials:** YouTube cookies are never persisted server-side, never logged, never returned in a response.
- **Logging:** server code logs only through `log` from `src/lib/log.server.ts`. `no-console` is an error in server code. W2 deletes both W1 exemptions and widens the rule to server-only modules without the `.server` suffix (Task 4).
- **Config:** production boot calls `loadServerEnv()`, and a missing required variable exits with a non-zero code. Dev defaults exist only when `NODE_ENV !== "production"`, and the built server always runs as production.
- **Tests:**
  - every P0/P1 fix lands with a regression test written first and seen failing;
  - never weaken, skip or delete a test to go green. A test of a feature this plan deletes goes with the feature, and the task says so;
  - unit tests are `src/**/*.test.ts` and `scripts/**/*.test.mjs` (`npm test`). They import with relative `.ts` paths, never `@/`.
  - HTTP tests are `tests/http/*.test.mjs` (`npm run test:http`, after `npm run build`). They boot with `NODE_ENV=production` and the env from `tests/http/env.mjs`.
- **Lint:** every rule is `error`, and `npm run lint` must exit 0 with 0 warnings.
- **Commits:**
  - Conventional Commits, one commit per task, on `hardening/w2-auth`;
  - each commit message ends with the trailer of the model that executed it: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` for opus tasks, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` for sonnet tasks;
  - PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Windows + Linux:** every script works on both. There are no `/tmp` or `/dev/null` literals in Node code. Test output assertions accept `\r\n` (Windows prints it).
- **Copy rule:** user-facing text never promises what the code doesn't do. Sign-in copy names Google only.
- **No production escape hatch:** nothing added here lets production run without the five required variables.

## Review Focus

These five inputs are the most likely to bite. Each is pinned by a test in the task that owns it.

1. **`npm start` on a host where `NODE_ENV` is unset**, the default in Node and in most process managers.
   - Before this plan the build treated that as development: a random secret, trusted loopback origins, and Better Auth's rate limiter off. Verified: the scratch build listened with no configuration at all.
   - Expected: the built server is production anyway and refuses to boot unconfigured.
   - Test: Task 3, `health.test.mjs` "the built server is production even with NODE_ENV=(unset)" and "=development".
2. **A leftover `BETTER_AUTH_TRUSTED_ORIGINS` or `BETTER_AUTH_SECRETS`** from an old deploy. Better Auth reads both behind our back.
   - Expected: production refuses to boot and names them, never their values.
   - Test: Task 2, "production refuses Better Auth's own origin and secret overrides".
3. **A developer on `VELO_DEV_PORT=8097` who opens `http://127.0.0.1:8097`**, the address Vite prints.
   - Expected: sign-in is trusted on both loopback spellings of that port, and production never trusts a loopback origin.
   - Tests: Task 4 unit test "development also trusts the local dev server on its configured port"; Task 4 HTTP tests "a cookie-bearing auth POST from http://localhost:8080 is refused" and "a callbackURL on … is refused".
4. **A session token that leaked through a log, replayed as `Authorization: Bearer …` or as an unsigned cookie** (PRIV-11).
   - Expected: both are ignored.
   - Test: Task 4 HTTP tests "the same token as a bearer header is ignored" and "an unsigned session cookie is ignored".
5. **An old device or copied cookie after a new sign-in, and IP/User-Agent recorded per login.** The copy says "We do not keep a login log". Before W2 that promise held only on the email and popup paths, where `isolateOwnSession` ran; the redirect OAuth path never ran it.
   - Expected: every new session stores no IP or UA, and ends the person's other sessions.
   - Test: Task 4 unit test "a new session stores no IP or user agent and ends the person's other sessions".

---

## File Structure

| Path | Status | Responsibility | Task |
|---|---|---|---|
| `docs/superpowers/plans/2026-09-23-00-roadmap.md` | modify (C1 block) | contract change requests 1–3 | 1 |
| `src/lib/env.server.ts`, `src/lib/env.server.test.ts` | create | C1 loader, `EnvError`, `devOrigin`, `serverEnv` | 2 |
| `server/plugins/env.ts` | create | boot-time config check, `NODE_ENV=production` | 3 |
| `tests/http/env.mjs` | create | shared production test env (`PROD_ENV`, `NO_DB_URL`, `NEEDS_DB`, `dbEnv`, `TEST_ORIGIN`) | 3, 4 |
| `tests/http/health.test.mjs` | replace | boot refusal matrix, health 503/200 | 3 |
| `tests/http/harness.test.mjs`, `tests/http/api-guards.test.mjs` | modify | boot with `PROD_ENV` | 3, 4 |
| `vite.config.ts` | modify | serverDir comment (3), drop `authPopupPlugin` (4), `grokPwaPlugin` (7), `appEnvPlugin` + renames (8) | 3, 4, 7, 8 |
| `src/lib/auth/auth-config.server.ts` (+ `.test.ts`) | create | Better Auth options from env, `sessionHooks`, `SESSION_COOKIE_PREFIX` | 4 |
| `src/lib/auth/{server,verify.server,middleware}.ts` | replace | Google-only Better Auth, cookie-only session resolution | 4 |
| `src/lib/auth/removed-auth.test.ts` | create | regression guards for every removed sign-in path | 4, 5, 6 |
| `src/lib/auth/{gate-identity.server,gate-identity.test,gate-session.server,popup.server,email-password,auth-boot-policy,server-config.test}.ts`, `src/lib/rate-window{,.test}.ts` | delete | broker, gate, popup, password, W0 per-request policy | 4 |
| `src/lib/{session-token,session-isolation,session-isolation.test,guest-limit.server,db}.ts`, `src/lib/auth/isolation.server.ts`, `src/routes/api/auth/$.ts`, `eslint.config.mjs` | modify | bearer out, cookie in, `log`, lint glob | 4 |
| `tests/http/auth.test.mjs` | create | Google flow, cookies, origins, no password, no bearer | 4 |
| `src/lib/auth/{client,use-current-user,gates,provider}.tsx?`, `src/lib/guest-id.ts`, `src/routes/login.tsx`, `src/lib/capture-auth-token.ts` | modify | cookie-only client, no flag, no dev user | 5 |
| `src/lib/auth/{providers,oauth-popup,oauth-popup.test}.ts`, `src/lib/{session-isolation,session-isolation.test,session-token}.ts` | delete | broker list, popup, superseded one-login fn | 5 |
| `src/lib/auth/status.ts`, `src/lib/auth-errors{,.test}.ts` (renamed from `capture-auth-token`), `src/routes/login.tsx`, `tests/http/login-page.test.mjs` | create/rename/replace | "sign-in unavailable" state, Google-only copy | 6 |
| PWA/branding/bridge/QA tooling (list in Task 7), `README.md` (3 lines), `tests/http/branding.test.mjs` | delete/modify/create | no third-party script, no platform chrome | 7 |
| env wrapper/check:auth/sandbox files (list in Task 8), `scripts/project-root{,.test}.mjs`, `AGENTS.md`, `package.json` (scripts), `.gitignore`, `.gitattributes`, `scripts/package-contract.test.mjs` | delete/create/replace/modify | direct Vite scripts, contributor note | 8 |
| `src/lib/app-data/`, `src/lib/multiplayer/`, `migrations/auth/`, `scripts/sign-out-plan{,.test}.mjs`, `scripts/{migrate,migration-plan}.mjs`, `scripts/migration-plan.test.mjs`, `src/lib/db.ts` (comment) | delete/modify/replace | connectors, dead template modules | 9 |
| `migrations/0006_google_only_auth.sql`, `scripts/google-only-auth-migration.test.mjs` | create | drop auth rows of removed providers | 10 |
| `scripts/grok-host-policy.test.mjs`, `src/lib/{builder.server,download-pool.server,db}.ts` (comments) | create/modify | platform-host CI gate | 11 |
| `docs/architecture.md` | modify | auth, config and template sections match the code | 12 |

---

### Task 1: Contract change requests to C1 (roadmap text)

**Executor:** velo-impl-sonnet-high
**Covers:** — (contract; enables INST-04 dev-port follow-up, WEB-12)

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-00-roadmap.md` (the C1 code block only)

**Interfaces:**
- Produces: the C1 text that Tasks 2–4 implement: `devOrigin(source?)`, `EnvError.missing` = missing or invalid names, the refusal of the Better Auth overrides, and the plugin location.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'VELO_PUBLIC_ORIGIN: string;              // required in production, e.g. "https://velo.example"; dev: "http://localhost:8080"' -- docs/superpowers/plans/2026-09-23-00-roadmap.md
  git grep -c -F 'export class EnvError extends Error { readonly missing: string[]; }' -- docs/superpowers/plans/2026-09-23-00-roadmap.md
  git grep -c -F 'export function loadServerEnv(source?: NodeJS.ProcessEnv): ServerEnv; // throws EnvError in production when required vars missing' -- docs/superpowers/plans/2026-09-23-00-roadmap.md
  ```
  Expected: each prints `…roadmap.md:1`. If any count differs, STOP.

- [ ] **Step 2: Replace the `VELO_PUBLIC_ORIGIN` line.** Replace exactly
  ```
    VELO_PUBLIC_ORIGIN: string;              // required in production, e.g. "https://velo.example"; dev: "http://localhost:8080"
  ```
  with
  ```
    VELO_PUBLIC_ORIGIN: string;              // required in production: a bare https origin (http only on loopback), e.g. "https://velo.example"; dev: `http://localhost:${Number(VELO_DEV_PORT) || 8080}`
  ```

- [ ] **Step 3: Replace the `EnvError` and `loadServerEnv` lines.** Replace exactly
  ```
  export class EnvError extends Error { readonly missing: string[]; }
  export function loadServerEnv(source?: NodeJS.ProcessEnv): ServerEnv; // throws EnvError in production when required vars missing
  ```
  with
  ```
  export class EnvError extends Error { readonly missing: string[]; } // every missing OR invalid name, never a value; message "Missing or invalid required environment variables: A, B"
  export function loadServerEnv(source?: NodeJS.ProcessEnv): ServerEnv; // throws EnvError in production when a required var is missing or invalid, or BETTER_AUTH_TRUSTED_ORIGINS / BETTER_AUTH_SECRETS is set (Better Auth reads both directly, past C1/C9)
  export function devOrigin(source?: NodeJS.ProcessEnv): string; // `http://localhost:${Number(VELO_DEV_PORT) || 8080}`: the dev default above, same expression as vite.config.ts
  ```

- [ ] **Step 4: Add the boot sentence.** Directly after the line `export function serverEnv(): ServerEnv; // memoized loadServerEnv(process.env)` and the closing ```` ``` ```` of that code block, insert this paragraph (one blank line before and after):
  ```
  Production boot runs `loadServerEnv()` in `server/plugins/env.ts`, a Nitro plugin that the node-server entry evaluates before it listens, so an `EnvError` exits the process non-zero. The plugin sets `NODE_ENV=production` first: the built server is production even when the shell leaves `NODE_ENV` unset. No C1 field is tied only to a feature W2 removes, so none is dropped.
  ```

- [ ] **Step 5: Verify.** Run:
  ```bash
  git grep -c -F 'Number(VELO_DEV_PORT) || 8080' -- docs/superpowers/plans/2026-09-23-00-roadmap.md
  git grep -c -F 'Production boot runs `loadServerEnv()` in `server/plugins/env.ts`' -- docs/superpowers/plans/2026-09-23-00-roadmap.md
  git diff --stat
  ```
  Expected: `…roadmap.md:2`, then `…roadmap.md:1`, then only the roadmap changed. Run `npm test`: 0 failures (docs only).

- [ ] **Step 6: Commit**
  ```bash
  git add docs/superpowers/plans/2026-09-23-00-roadmap.md
  git commit -m "docs(roadmap): C1 dev origin follows VELO_DEV_PORT; EnvError names missing or invalid vars

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: C1 server env loader

**Executor:** velo-impl-opus-high
**Covers:** ARCH-04 (secret required ≥ 32 chars in production), ARCH-05 (explicit config), M-08 (config part), WEB-12 (origin config)

**Files:**
- Create: `src/lib/env.server.ts`
- Test: `src/lib/env.server.test.ts`

**Interfaces:**
- Produces:
  - `type ServerEnv`, exactly as in C1;
  - `class EnvError extends Error { readonly missing: string[] }`;
  - `loadServerEnv(source?: NodeJS.ProcessEnv): ServerEnv`;
  - `serverEnv(): ServerEnv`, memoized;
  - `devOrigin(source?: NodeJS.ProcessEnv): string`.
- The module imports only `node:crypto`, so tests import it as `./env.server.ts` or `../env.server.ts`.

- [ ] **Step 1: Verify the file doesn't exist yet.** Run `git ls-files src/lib/env.server.ts` → no output. If a file exists, STOP.

- [ ] **Step 2: Write the failing test.** Create `src/lib/env.server.test.ts`:
  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import { EnvError, devOrigin, loadServerEnv, serverEnv } from "./env.server.ts";

  const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "VELO_PUBLIC_ORIGIN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

  const PROD = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://velo:pw@db.internal:5432/velo",
    BETTER_AUTH_SECRET: "s".repeat(32),
    VELO_PUBLIC_ORIGIN: "https://velo.example",
    GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-secret-value",
  } as NodeJS.ProcessEnv;

  function envError(source: NodeJS.ProcessEnv): EnvError {
    try {
      loadServerEnv(source);
    } catch (err) {
      assert.ok(err instanceof EnvError, `expected EnvError, got ${String(err)}`);
      return err;
    }
    assert.fail("loadServerEnv did not throw");
  }

  test("production with nothing set names all five required variables", () => {
    const err = envError({ NODE_ENV: "production" });
    assert.deepEqual(err.missing, REQUIRED);
    assert.equal(err.name, "EnvError");
    assert.equal(err.message, `Missing or invalid required environment variables: ${REQUIRED.join(", ")}`);
  });

  test("each required variable is reported on its own, and blank counts as missing", () => {
    for (const name of REQUIRED) {
      assert.deepEqual(envError({ ...PROD, [name]: undefined }).missing, [name]);
      assert.deepEqual(envError({ ...PROD, [name]: "   " }).missing, [name]);
    }
  });

  test("the error names variables and never carries a value", () => {
    const err = envError({ ...PROD, BETTER_AUTH_SECRET: "short-secret-value", GOOGLE_CLIENT_ID: "" });
    assert.deepEqual(err.missing, ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID"]);
    for (const value of ["short-secret-value", "google-secret-value", "db.internal", "pw@", "velo.example"]) {
      assert.doesNotMatch(`${err.message} ${JSON.stringify(err)} ${err.stack}`, new RegExp(value.replace(/\./g, "\\.")));
    }
  });

  test("BETTER_AUTH_SECRET needs at least 32 characters in production", () => {
    assert.deepEqual(envError({ ...PROD, BETTER_AUTH_SECRET: "s".repeat(31) }).missing, ["BETTER_AUTH_SECRET"]);
    assert.equal(loadServerEnv({ ...PROD, BETTER_AUTH_SECRET: "s".repeat(32) }).BETTER_AUTH_SECRET, "s".repeat(32));
  });

  test("VELO_PUBLIC_ORIGIN must be a bare https origin, or http on loopback", () => {
    for (const bad of [
      "velo.example",
      "http://velo.example",
      "https://velo.example/app",
      "https://velo.example/?x=1",
      "https://user:pw@velo.example",
      "ftp://velo.example",
    ]) {
      assert.deepEqual(envError({ ...PROD, VELO_PUBLIC_ORIGIN: bad }).missing, ["VELO_PUBLIC_ORIGIN"], bad);
    }
    assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "https://velo.example/" }).VELO_PUBLIC_ORIGIN, "https://velo.example");
    assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "https://Velo.Example:8443" }).VELO_PUBLIC_ORIGIN, "https://velo.example:8443");
    assert.equal(loadServerEnv({ ...PROD, VELO_PUBLIC_ORIGIN: "http://127.0.0.1:3000" }).VELO_PUBLIC_ORIGIN, "http://127.0.0.1:3000");
  });

  test("production refuses Better Auth's own origin and secret overrides", () => {
    const err = envError({ ...PROD, BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example", BETTER_AUTH_SECRETS: "1:x" });
    assert.deepEqual(err.missing, ["BETTER_AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_SECRETS"]);
    assert.doesNotMatch(err.message, /evil\.example|1:x/);
    assert.doesNotThrow(() => loadServerEnv({ BETTER_AUTH_TRUSTED_ORIGINS: "http://x.test" }));
  });

  test("a complete production config loads with parsed lists and defaults", () => {
    const env = loadServerEnv({ ...PROD, VELO_ADMIN_EMAILS: " A@X.io, ,b@y.io ", VELO_EXTENSION_IDS: "abc, def" });
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.DATABASE_URL, PROD.DATABASE_URL);
    assert.deepEqual(env.VELO_ADMIN_EMAILS, ["a@x.io", "b@y.io"]);
    assert.deepEqual(env.VELO_EXTENSION_IDS, ["abc", "def"]);
    assert.equal(env.LOG_LEVEL, "info");
    assert.equal(env.VELO_EGRESS_PROXY, undefined);
    assert.equal(env.YTDLP_PYTHON, process.platform === "win32" ? "python" : "python3");
  });

  test("development never throws and gets local defaults", () => {
    for (const nodeEnv of [undefined, "development", "test", "staging"]) {
      const env = loadServerEnv({ NODE_ENV: nodeEnv });
      assert.equal(env.NODE_ENV, nodeEnv === "test" ? "test" : "development");
      assert.equal(env.DATABASE_URL, undefined);
      assert.equal(env.GOOGLE_CLIENT_ID, undefined);
      assert.equal(env.VELO_PUBLIC_ORIGIN, "http://localhost:8080");
      assert.match(env.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
    }
  });

  test("the dev signing secret is stable across loads in one process", () => {
    assert.equal(loadServerEnv({}).BETTER_AUTH_SECRET, loadServerEnv({}).BETTER_AUTH_SECRET);
    assert.equal(loadServerEnv({ BETTER_AUTH_SECRET: "dev-override" }).BETTER_AUTH_SECRET, "dev-override");
  });

  test("the dev origin follows VELO_DEV_PORT like vite.config.ts", () => {
    assert.equal(devOrigin({ VELO_DEV_PORT: "8097" }), "http://localhost:8097");
    assert.equal(devOrigin({ VELO_DEV_PORT: "not-a-port" }), "http://localhost:8080");
    assert.equal(devOrigin({}), "http://localhost:8080");
    assert.equal(loadServerEnv({ VELO_DEV_PORT: "8097" }).VELO_PUBLIC_ORIGIN, "http://localhost:8097");
    assert.equal(
      loadServerEnv({ VELO_DEV_PORT: "8097", VELO_PUBLIC_ORIGIN: "https://tunnel.example" }).VELO_PUBLIC_ORIGIN,
      "https://tunnel.example",
    );
  });

  test("LOG_LEVEL accepts the four levels, case-insensitively, else info", () => {
    assert.equal(loadServerEnv({ LOG_LEVEL: "DEBUG" }).LOG_LEVEL, "debug");
    assert.equal(loadServerEnv({ LOG_LEVEL: "verbose" }).LOG_LEVEL, "info");
  });

  test("serverEnv() is memoized", () => {
    assert.equal(serverEnv(), serverEnv());
  });
  ```

- [ ] **Step 3: Run it and see it fail.** Run `node --experimental-strip-types --test src/lib/env.server.test.ts`.
  Expected: FAIL, `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/lib/env.server.ts'`.

- [ ] **Step 4: Implement.** Create `src/lib/env.server.ts`:
  ```ts
  /**
   * Server configuration (roadmap contract C1). The one place server code reads
   * its environment from.
   *
   * Production (`NODE_ENV=production`) fails closed: every required variable that
   * is missing or invalid is collected, and `loadServerEnv` throws one `EnvError`
   * naming all of them — names only, never values. `server/plugins/env.ts` calls
   * it before the server listens, so a misconfigured deploy exits instead of
   * serving. Development and test get defaults instead; none of them exists in
   * production.
   */
  import { randomBytes } from "node:crypto";

  export type ServerEnv = {
    NODE_ENV: "development" | "test" | "production";
    DATABASE_URL: string | undefined;
    BETTER_AUTH_SECRET: string;
    VELO_PUBLIC_ORIGIN: string;
    GOOGLE_CLIENT_ID: string | undefined;
    GOOGLE_CLIENT_SECRET: string | undefined;
    VELO_ADMIN_EMAILS: string[];
    VELO_EGRESS_PROXY: string | undefined;
    VELO_PROXY_SECRET_KEY: string | undefined;
    VELO_PROXY_SECRET_KEY_PREVIOUS: string | undefined;
    VELO_EXTENSION_IDS: string[];
    SENTRY_DSN: string | undefined;
    LOG_LEVEL: "debug" | "info" | "warn" | "error";
    YTDLP_PYTHON: string;
  };

  /** Thrown when production config is incomplete. `missing` holds every missing or invalid name. */
  export class EnvError extends Error {
    readonly missing: string[];
    constructor(missing: string[]) {
      super(`Missing or invalid required environment variables: ${missing.join(", ")}`);
      this.name = "EnvError";
      this.missing = missing;
    }
  }

  const MIN_SECRET_LENGTH = 32;
  /**
   * Better Auth reads these straight from the environment, past this file: the
   * first widens the trusted origins beyond VELO_PUBLIC_ORIGIN (C9), the second
   * replaces BETTER_AUTH_SECRET. Production refuses to boot with either set.
   */
  const BETTER_AUTH_OVERRIDES = ["BETTER_AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_SECRETS"];
  const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
  const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

  /** Trimmed value, or undefined when unset or blank. */
  function read(source: NodeJS.ProcessEnv, key: string): string | undefined {
    const value = source[key]?.trim();
    return value ? value : undefined;
  }

  function list(value: string | undefined, lower = false): string[] {
    return (value ?? "")
      .split(",")
      .map((entry) => (lower ? entry.trim().toLowerCase() : entry.trim()))
      .filter(Boolean);
  }

  /**
   * An origin: scheme + host (+ port), nothing else. https, or http on a
   * loopback host (a local production build). Returns undefined when invalid.
   */
  function parseOrigin(value: string | undefined): string | undefined {
    if (!value) return undefined;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
    if (!secure || url.username || url.password || url.search || url.hash) return undefined;
    if (url.pathname !== "/") return undefined;
    return url.origin;
  }

  /** The local dev origin. Follows `VELO_DEV_PORT` exactly as `vite.config.ts` does. */
  export function devOrigin(source: NodeJS.ProcessEnv = process.env): string {
    return `http://localhost:${Number(source.VELO_DEV_PORT) || 8080}`;
  }

  const secretGlobal = globalThis as typeof globalThis & { __veloDevAuthSecret__?: string };

  /** Dev-only signing secret that survives HMR re-evaluation (sessions stay valid until restart). */
  function devSecret(): string {
    secretGlobal.__veloDevAuthSecret__ ??= randomBytes(32).toString("hex");
    return secretGlobal.__veloDevAuthSecret__;
  }

  export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
    const rawNodeEnv = read(source, "NODE_ENV");
    const NODE_ENV = rawNodeEnv === "production" || rawNodeEnv === "test" ? rawNodeEnv : "development";
    const production = NODE_ENV === "production";
    const missing: string[] = [];

    const DATABASE_URL = read(source, "DATABASE_URL");
    if (production && !DATABASE_URL) missing.push("DATABASE_URL");

    let BETTER_AUTH_SECRET = read(source, "BETTER_AUTH_SECRET");
    if (production && (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < MIN_SECRET_LENGTH)) {
      missing.push("BETTER_AUTH_SECRET");
    }
    BETTER_AUTH_SECRET ??= production ? "" : devSecret();

    let VELO_PUBLIC_ORIGIN = parseOrigin(read(source, "VELO_PUBLIC_ORIGIN"));
    if (!VELO_PUBLIC_ORIGIN) {
      if (production) missing.push("VELO_PUBLIC_ORIGIN");
      VELO_PUBLIC_ORIGIN = production ? "" : devOrigin(source);
    }

    const GOOGLE_CLIENT_ID = read(source, "GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = read(source, "GOOGLE_CLIENT_SECRET");
    if (production && !GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
    if (production && !GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
    if (production) missing.push(...BETTER_AUTH_OVERRIDES.filter((name) => read(source, name)));

    if (production && missing.length > 0) throw new EnvError(missing);

    const level = read(source, "LOG_LEVEL")?.toLowerCase();
    return {
      NODE_ENV,
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      VELO_PUBLIC_ORIGIN,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      VELO_ADMIN_EMAILS: list(read(source, "VELO_ADMIN_EMAILS"), true),
      VELO_EGRESS_PROXY: read(source, "VELO_EGRESS_PROXY"),
      VELO_PROXY_SECRET_KEY: read(source, "VELO_PROXY_SECRET_KEY"),
      VELO_PROXY_SECRET_KEY_PREVIOUS: read(source, "VELO_PROXY_SECRET_KEY_PREVIOUS"),
      VELO_EXTENSION_IDS: list(read(source, "VELO_EXTENSION_IDS")),
      SENTRY_DSN: read(source, "SENTRY_DSN"),
      LOG_LEVEL: LOG_LEVELS.find((name) => name === level) ?? "info",
      YTDLP_PYTHON: read(source, "YTDLP_PYTHON") ?? (process.platform === "win32" ? "python" : "python3"),
    };
  }

  let memo: ServerEnv | undefined;

  /** `loadServerEnv(process.env)`, computed once per process. */
  export function serverEnv(): ServerEnv {
    memo ??= loadServerEnv(process.env);
    return memo;
  }
  ```

- [ ] **Step 5: Run the test and the gates.** Run:
  ```bash
  node --experimental-strip-types --test src/lib/env.server.test.ts
  npm run typecheck && npm run lint && npm test
  ```
  Expected: 12 tests pass, then typecheck clean, lint exit 0, `npm test` 0 failures.

- [ ] **Step 6: Commit**
  ```bash
  git add src/lib/env.server.ts src/lib/env.server.test.ts
  git commit -m "feat(config): add C1 server env loader with fail-closed production validation

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Refuse to boot in production without configuration

**Executor:** velo-impl-opus-high
**Covers:** M-08 (boot exits on missing config; matrix test), ARCH-04 (no random secret in production), W0 ledger minors "lazy prod failure" and "source-text wiring test", W1 hand-off (boot hook, harness test envs)

**Files:**
- Create: `server/plugins/env.ts`, `tests/http/env.mjs`
- Replace: `tests/http/health.test.mjs`
- Modify: `tests/http/harness.test.mjs`, `tests/http/api-guards.test.mjs`, `vite.config.ts` (one comment)

**Interfaces:**
- Consumes: `loadServerEnv` (Task 2); `startServer`, `buildChildEnv` (C6).
- Produces, in `tests/http/env.mjs`:
  - `TEST_ORIGIN = "https://velo.test"`;
  - `PROD_ENV`, a frozen object with fake but valid `BETTER_AUTH_SECRET`, `VELO_PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
  - `NO_DB_URL`, a well-formed URL to a closed port;
  - `DB_URL` = `VELO_TEST_DATABASE_URL ?? ""`;
  - `NEEDS_DB`, a skip reason or `false` (always `false` in CI);
  - `dbEnv()`, which returns `{ ...PROD_ENV, DATABASE_URL: DB_URL }` and asserts `DB_URL` is set.

  Every later HTTP test boots with these.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'const BASE_ENV = { VITE_AUTH_ENABLED: "false" };' -- tests/http/harness.test.mjs tests/http/api-guards.test.mjs tests/http/health.test.mjs
  git grep -c -F 'const server = await startServer({ env: BASE_ENV });' -- tests/http/harness.test.mjs
  git grep -c -F "// buildChildEnv's unit test above covers the full allowlist (VELO_*, TRUST_*, ...)." -- tests/http/harness.test.mjs
  git grep -c -F 'server = await startServer({ env: BASE_ENV });' -- tests/http/api-guards.test.mjs
  git grep -c -F '            // Auto-registers server/middleware/* (the PWA install page +' -- vite.config.ts
  git ls-files server/plugins
  ```
  Expected: `api-guards.test.mjs:1`, `harness.test.mjs:1`, `health.test.mjs:1`; then `harness.test.mjs:2`; `harness.test.mjs:1`; `api-guards.test.mjs:1`; `vite.config.ts:1`; and no output for `server/plugins`. If any differ, STOP.

- [ ] **Step 2: Create the shared test env.** Create `tests/http/env.mjs`:
  ```js
  // Production configuration for the HTTP suites (roadmap C1). Every value is
  // fake but well-formed, so the built server boots in real production mode and
  // nothing reaches Google. `NO_DB_URL` points at a closed port: suites that only
  // need a booted server use it; suites that need a working database take
  // VELO_TEST_DATABASE_URL (CI always sets it) and skip locally without one.
  import assert from "node:assert/strict";

  export const TEST_ORIGIN = "https://velo.test";

  export const PROD_ENV = Object.freeze({
    BETTER_AUTH_SECRET: "test-only-not-a-secret-0123456789abcdef",
    VELO_PUBLIC_ORIGIN: TEST_ORIGIN,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-only-google-client-secret",
    // Until Task 4 removes the platform broker, production boot needs its flag off.
    VITE_AUTH_ENABLED: "false",
  });

  /** Well-formed, never reachable: port 1 on loopback refuses every connection. */
  export const NO_DB_URL = "postgres://velo-test@127.0.0.1:1/unreachable";

  export const DB_URL = process.env.VELO_TEST_DATABASE_URL ?? "";

  /** `skip` value for suites that need a working database. CI never skips. */
  export const NEEDS_DB =
    !DB_URL && !process.env.CI ? "needs a migrated Postgres: set VELO_TEST_DATABASE_URL (CI always does)" : false;

  /** Production env with the test database; fails loudly in CI when the URL is missing. */
  export function dbEnv() {
    assert.ok(DB_URL, "VELO_TEST_DATABASE_URL must be set in CI");
    return { ...PROD_ENV, DATABASE_URL: DB_URL };
  }
  ```

- [ ] **Step 3: Write the failing boot tests.** Replace the whole content of `tests/http/health.test.mjs` with:
  ```js
  import assert from "node:assert/strict";
  import { spawnSync } from "node:child_process";
  import { fileURLToPath } from "node:url";
  import { after, before, describe, test } from "node:test";
  import { buildChildEnv, startServer } from "./harness.mjs";
  import { DB_URL, NEEDS_DB, NO_DB_URL, PROD_ENV, dbEnv } from "./env.mjs";

  const ENTRY = fileURLToPath(new URL("../../.output/server/index.mjs", import.meta.url));
  const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "VELO_PUBLIC_ORIGIN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const FULL_ENV = { ...PROD_ENV, DATABASE_URL: NO_DB_URL };

  /** Boots the built server synchronously; a correct refusal exits long before the timeout. */
  function boot(childEnv) {
    return spawnSync(process.execPath, [ENTRY], { env: childEnv, encoding: "utf8", timeout: 20_000 });
  }
  const prodEnv = (env) => buildChildEnv(process.env, env);

  describe("production boot refuses incomplete configuration", () => {
    test("no configuration: exits non-zero before listening and names all five variables, no values", () => {
      const run = boot(prodEnv({ BETTER_AUTH_SECRET: "too-short-secret-value" }));
      const output = `${run.stdout}${run.stderr}`;
      assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
      assert.notEqual(run.status, 0);
      assert.match(output, new RegExp(`EnvError: Missing or invalid required environment variables: ${REQUIRED.join(", ")}\\r?\\n`));
      assert.doesNotMatch(output, /Listening on/);
      assert.doesNotMatch(output, /too-short-secret-value/);
    });

    for (const name of REQUIRED) {
      test(`missing only ${name}: exits non-zero and names exactly that variable`, () => {
        const run = boot(prodEnv({ ...FULL_ENV, [name]: "" }));
        assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
        assert.notEqual(run.status, 0);
        assert.match(`${run.stdout}${run.stderr}`, new RegExp(`required environment variables: ${name}\\r?\\n`));
      });
    }

    for (const nodeEnv of [undefined, "development"]) {
      test(`the built server is production even with NODE_ENV=${nodeEnv ?? "(unset)"}`, () => {
        const env = prodEnv({});
        if (nodeEnv) env.NODE_ENV = nodeEnv;
        else delete env.NODE_ENV;
        const run = boot(env);
        assert.equal(typeof run.status, "number", `killed by ${run.signal}; the server must exit on its own`);
        assert.notEqual(run.status, 0);
        assert.match(`${run.stdout}${run.stderr}`, /EnvError: Missing or invalid required environment variables: DATABASE_URL/);
      });
    }

    test("startServer rejects with the EnvError output", async () => {
      await assert.rejects(
        startServer({ env: {} }),
        /server exited before it was ready:[\s\S]*EnvError: Missing or invalid required environment variables: DATABASE_URL/,
      );
    });
  });

  describe("GET /api/health with the database down", () => {
    let server;
    before(async () => {
      server = await startServer({ env: FULL_ENV });
    });
    after(() => server?.stop());

    test("answers 503 degraded with a fixed detail and no-store", async () => {
      const res = await fetch(`${server.baseUrl}/api/health`);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
      const body = await res.json();
      assert.equal(body.status, "degraded");
      assert.equal(body.checks.database.ok, false);
      assert.equal(body.checks.database.detail, "database unreachable");
    });

    test("leaks no path, stack, driver message or connection string", async () => {
      const text = await (await fetch(`${server.baseUrl}/api/health?deep=1`)).text();
      assert.doesNotMatch(text, /ENOENT|ECONNREFUSED|\.output|node_modules|[A-Za-z]:\\|\bat \w+ \(|postgres:\/\/|velo-test@/i);
    });
  });

  describe("GET /api/health against a migrated Postgres", () => {
    let server;
    before(async () => {
      if (NEEDS_DB) return;
      server = await startServer({ env: dbEnv() });
    });
    after(() => server?.stop());

    test("deep check is 200 ok and never echoes the connection string", { skip: NEEDS_DB }, async () => {
      const res = await fetch(`${server.baseUrl}/api/health?deep=1`);
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const body = JSON.parse(text);
      assert.equal(body.status, "ok");
      assert.equal(body.checks.database.ok, true);
      assert.doesNotMatch(text, new RegExp(new URL(DB_URL).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  });
  ```
  This is the W1 hand-off's spec change, not a weakening. The old "without a database" block asserted a 503. That state is now a refused boot, and it is asserted above for every required variable. The W1 503 assertions keep running, against a database that is down.

- [ ] **Step 4: Point the harness self-tests at the production env.** In `tests/http/harness.test.mjs`:
  1. Replace exactly
     ```js
     import { HARNESS_ENV_ALLOWLIST, buildChildEnv, startServer } from "./harness.mjs";

     // W2 removes the Grok auth flag; until then production boot needs it off.
     const BASE_ENV = { VITE_AUTH_ENABLED: "false" };
     ```
     with
     ```js
     import { HARNESS_ENV_ALLOWLIST, buildChildEnv, startServer } from "./harness.mjs";
     import { NO_DB_URL, PROD_ENV } from "./env.mjs";

     const BOOT_ENV = { ...PROD_ENV, DATABASE_URL: NO_DB_URL };
     ```
  2. Replace the whole test that starts at `// buildChildEnv's unit test above covers the full allowlist (VELO_*, TRUST_*, ...).` and ends at the `});` directly above `test("stop() kills the server, frees the port and is idempotent", async () => {` with:
     ```js
     // buildChildEnv's unit test above covers the full allowlist (VELO_*, TRUST_*, ...).
     test("an ambient DATABASE_URL never reaches the server: production boot reports it missing", async () => {
       const saved = process.env.DATABASE_URL;
       process.env.DATABASE_URL = "postgres://must-not-be-used@127.0.0.1:1/none";
       try {
         await assert.rejects(
           startServer({ env: PROD_ENV }),
           /EnvError: Missing or invalid required environment variables: DATABASE_URL\r?\n/,
         );
       } finally {
         if (saved === undefined) delete process.env.DATABASE_URL;
         else process.env.DATABASE_URL = saved;
       }
     });

     test("ambient NITRO_PORT/NITRO_HOST leave the server on 127.0.0.1:<ephemeral>", async () => {
       const keys = ["NITRO_PORT", "NITRO_HOST", "VELO_ALLOW_TOOL_INSTALL", "TRUST_CLOUDFLARE"];
       const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
       process.env.NITRO_PORT = "1";
       process.env.NITRO_HOST = "0.0.0.0";
       process.env.VELO_ALLOW_TOOL_INSTALL = "1";
       process.env.TRUST_CLOUDFLARE = "1";
       try {
         const server = await startServer({ env: BOOT_ENV });
         try {
           assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
           assert.notEqual(new URL(server.baseUrl).port, "1");
           const body = await (await fetch(`${server.baseUrl}/api/health`)).json();
           assert.equal(body.checks.database.source, "neon");
         } finally {
           await server.stop();
         }
       } finally {
         for (const key of keys) {
           if (saved[key] === undefined) delete process.env[key];
           else process.env[key] = saved[key];
         }
       }
     });

     ```
  3. In the remaining `stop() kills the server…` test, replace `const server = await startServer({ env: BASE_ENV });` with `const server = await startServer({ env: BOOT_ENV });`.

  The intent of the old PGlite test is kept: ambient `NITRO_*` and `DATABASE_URL` never reach the server under test. It is now proven twice. With the ambient `DATABASE_URL` set and none passed, boot reports it missing. And the server still binds to loopback with an ephemeral port.

- [ ] **Step 5: Point the guard tests at the production env.** In `tests/http/api-guards.test.mjs`:
  1. Replace exactly
     ```js
     import { startServer } from "./harness.mjs";

     // W2 removes the Grok auth flag; until then production boot needs it off.
     const BASE_ENV = { VITE_AUTH_ENABLED: "false" };
     ```
     with
     ```js
     import { startServer } from "./harness.mjs";
     import { NO_DB_URL, PROD_ENV } from "./env.mjs";
     ```
  2. Replace `server = await startServer({ env: BASE_ENV });` with `server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });`.

- [ ] **Step 6: Build and see the boot tests fail.** Run `npm run build && node --test tests/http/health.test.mjs`.
  Expected: the 8 boot tests FAIL with `killed by SIGTERM; the server must exit on its own`, because the server listens instead of exiting. Each one waits for its 20 s timeout, about 3 minutes in total. `startServer rejects with the EnvError output` also FAILs (`Missing expected rejection`). The two 503 tests pass.

- [ ] **Step 7: Implement the boot check.** Create `server/plugins/env.ts`:
  ```ts
  import { definePlugin } from "nitro";
  import { loadServerEnv } from "../../src/lib/env.server.ts";

  /**
   * Fail closed at boot (roadmap C1). The node-server entry runs Nitro plugins
   * before it listens, so an `EnvError` here exits the process with a non-zero
   * code instead of serving. (The SSR bundle loads lazily on the first request,
   * which is why this check cannot live at module scope in `src/`.)
   *
   * Only the production build runs this file, and that build is production
   * whatever the shell says: Node never sets NODE_ENV, and a forgotten one must
   * not switch on the development defaults (random secret, loopback origins, no
   * Better Auth rate limit).
   */
  export default definePlugin(() => {
    process.env.NODE_ENV = "production";
    loadServerEnv();
  });
  ```
  In `vite.config.ts`, replace exactly
  ```
              // Auto-registers server/middleware/* (the PWA install page +
              // manifest + head-tag middleware). Nitro v3 defaults serverDir to
              // false, so removing this silently unwires /?install=1 on deploys.
  ```
  with
  ```
              // Auto-registers server/plugins/* — env.ts is the boot-time config
              // check. Nitro v3 defaults serverDir to false, so removing this
              // silently drops that check.
  ```
  Nitro scans `<serverDir>/plugins/**`, and `initNitroPlugins` rethrows a plugin error from `useNitroApp()`, which runs before `serve()`.

- [ ] **Step 8: Run the HTTP suite and the gates.** Run:
  ```bash
  npm run build && npm run test:http
  npm run typecheck && npm run lint && npm test
  ```
  Expected:
  - `test:http` has 0 failures. Locally, only `deep check is 200 ok…` is skipped, with the reason `needs a migrated Postgres…`.
  - The boot tests exit in about 100 ms each.
  - typecheck clean, lint exit 0, `npm test` 0 failures.

  If `VELO_TEST_DATABASE_URL` is available, also run `VELO_TEST_DATABASE_URL=… npm run test:http`: 0 skipped, 0 failed.

- [ ] **Step 9: Check boot by hand (evidence for the reviewer).** Run `node .output/server/index.mjs; echo "exit=$?"` in a shell without the five variables.
  Expected: stderr shows `EnvError: Missing or invalid required environment variables: DATABASE_URL, BETTER_AUTH_SECRET, VELO_PUBLIC_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET`, with no `Listening on` line, and `exit=1`.

- [ ] **Step 10: Commit**
  ```bash
  git add server/plugins/env.ts tests/http/env.mjs tests/http/health.test.mjs tests/http/harness.test.mjs tests/http/api-guards.test.mjs vite.config.ts
  git commit -m "feat(config)!: refuse to boot in production without required configuration

  The node-server build now runs loadServerEnv() in a Nitro plugin before it
  listens, forcing NODE_ENV=production; a missing or invalid DATABASE_URL,
  BETTER_AUTH_SECRET, VELO_PUBLIC_ORIGIN, GOOGLE_CLIENT_ID or
  GOOGLE_CLIENT_SECRET exits non-zero naming the variables. HTTP suites boot
  with tests/http/env.mjs.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Google-only server auth; delete the broker, gate, bearer, popup and passwords

**Executor:** velo-impl-opus-high
**Covers:**
- REPO-02 and GH-01 (code side), SEC-03, WEB-09: no platform client in code at all;
- ARCH-05, INST-01 (server side), SEC-06, PRIV-07 (no dev-user), SEC-08, M-16 (email/password removed);
- PRIV-08 (no broker or gate), PRIV-11 (cookiePreview log and bearer gone);
- ARCH-15 (popup), ARCH-16 and CLEAN-12 (auth hosts, loopback origins only outside production);
- WEB-12 (origins follow `VELO_PUBLIC_ORIGIN` and the dev port);
- TEST-12 (gate code and its test deleted);
- CLEAN-02 and CLEAN-15 (auth parts);
- M-08 (auth part);
- the W1/W0 ledger items: trustedOrigins on the dev port, `no-console` exemptions and glob, `verify.server` messages, stale "preview client" comments, and `sign-up` limiter orphaned.

**Files:**
- Create:
  - `src/lib/auth/auth-config.server.ts` and `src/lib/auth/auth-config.server.test.ts`;
  - `src/lib/auth/removed-auth.test.ts`;
  - `tests/http/auth.test.mjs`.
- Replace: `src/lib/auth/server.ts`, `src/lib/auth/verify.server.ts`, `src/lib/auth/middleware.ts`, `src/routes/api/auth/$.ts`.
- Modify:
  - `src/lib/session-token.ts`, `src/lib/session-isolation.ts`, `src/lib/session-isolation.test.ts`;
  - `src/lib/guest-limit.server.ts`, `src/lib/auth/isolation.server.ts`, `src/lib/db.ts`;
  - `eslint.config.mjs`, `vite.config.ts`;
  - `tests/http/env.mjs`, `tests/http/harness.test.mjs`.
- Delete:
  - `src/lib/auth/gate-identity.server.ts`, `src/lib/auth/gate-identity.test.ts`, `src/lib/auth/gate-session.server.ts`;
  - `src/lib/auth/popup.server.ts`, `src/lib/auth/email-password.ts`;
  - `src/lib/auth/auth-boot-policy.ts`, `src/lib/auth/server-config.test.ts`;
  - `src/lib/rate-window.ts`, `src/lib/rate-window.test.ts`.

**Interfaces:**
- Consumes: `serverEnv`, `devOrigin`, `ServerEnv` (Task 2); `PROD_ENV`, `TEST_ORIGIN`, `NEEDS_DB`, `DB_URL`, `dbEnv` (Task 3).
- Produces:
  - from `auth-config.server.ts`:
    - `SESSION_COOKIE_PREFIX = "__Host-velo"`;
    - `trustedOrigins(env: ServerEnv, source?): string[]`;
    - `authSettings(env: ServerEnv, source?): { googleConfigured: boolean; options }`;
    - `sessionHooks(endOtherSessions: (userId: string, keepSessionId: string) => Promise<void>)`;
  - from `server.ts`: `auth`, and `authConfigured: boolean` (Google available);
  - from `verify.server.ts`:
    - `authConfigured`;
    - `UnauthorizedError`;
    - `getSessionUser(headers?: Headers): Promise<VerifiedUser | null>`;
    - `requireUserId(): Promise<string>`, which takes no argument now.
  - `authMiddleware`: server side only, and it sends no `bearerToken` context.
- Removed exports, which Task 5 stops using:
  - `readSessionTokenFromHeaders`;
  - `GATE_*`;
  - `gateIdentitySessions`;
  - `handleAuthPopupRequest`;
  - `emailAndPasswordEnabled`;
  - `assertAuthConfiguredForProduction`;
  - `rateLimited` and `RateState`;
  - `SESSION_TOKEN_COOKIE` and `readSessionToken` from `server.ts`;
  - `DEV_USER_ID`.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'export { readSessionTokenFromHeaders, sessionTokenKey } from "@/lib/session-token";' -- src/lib/session-isolation.ts
  git grep -c -F '    const fromBearer = sessionTokenKey((context as { bearerToken?: string | null }).bearerToken);' -- src/lib/session-isolation.ts
  git grep -c -F 'test("reads the bearer session token from request headers", () => {' -- src/lib/session-isolation.test.ts
  git grep -c -F 'export function readSessionTokenFromHeaders(headers: Headers): string {' -- src/lib/session-token.ts
  git grep -c -F ' * On grok.me the session rides a bearer token (partitioned cookies). Quota and' -- src/lib/guest-limit.server.ts
  git grep -c -F '    const token = readSessionTokenFromHeaders(request.headers);' -- src/lib/guest-limit.server.ts
  git grep -c -F ' * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY' -- src/lib/auth/isolation.server.ts
  git grep -c -F '      console.error("[db] idle client error", err);' -- src/lib/db.ts
  git grep -c -F '    console.error("[db] PGLite bootstrap failed:", err);' -- src/lib/db.ts
  git grep -c -F '      // W2 deletes/rewrites these two Grok-gate auth files; remove both lines then.' -- eslint.config.mjs
  git grep -c -F ' * Live-preview OAuth popup — handled HERE so the agent never has to create a' -- vite.config.ts
  git grep -c -F '    authPopupPlugin(),' -- vite.config.ts
  git grep -c -F '  // Until Task 4 removes the platform broker, production boot needs its flag off.' -- tests/http/env.mjs
  git grep -c -F '    GROK_AUTH_SECRET: "ambient",' -- tests/http/harness.test.mjs
  git grep -c -F '    VITE_AUTH_ENABLED: "false",' -- tests/http/harness.test.mjs
  ```
  Expected: every line prints `<file>:1`. If any differ, STOP.

- [ ] **Step 2: Write the failing unit tests.** Create `src/lib/auth/auth-config.server.test.ts`:
  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import { loadServerEnv } from "../env.server.ts";
  import { authSettings, sessionHooks, trustedOrigins } from "./auth-config.server.ts";

  const PROD = loadServerEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://velo@db/velo",
    BETTER_AUTH_SECRET: "s".repeat(32),
    VELO_PUBLIC_ORIGIN: "https://velo.example",
    GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-secret",
  });

  test("production trusts only the public origin — never a loopback dev origin", () => {
    assert.deepEqual(trustedOrigins(PROD, { VELO_DEV_PORT: "8097" }), ["https://velo.example"]);
    assert.deepEqual(authSettings(PROD).options.trustedOrigins, ["https://velo.example"]);
  });

  test("development also trusts the local dev server on its configured port", () => {
    assert.deepEqual(trustedOrigins(loadServerEnv({}), {}), ["http://localhost:8080", "http://127.0.0.1:8080"]);
    const dev = loadServerEnv({ VELO_DEV_PORT: "8097" });
    assert.deepEqual(trustedOrigins(dev, { VELO_DEV_PORT: "8097" }), ["http://localhost:8097", "http://127.0.0.1:8097"]);
    const tunnel = loadServerEnv({ VELO_PUBLIC_ORIGIN: "https://tunnel.example" });
    assert.deepEqual(trustedOrigins(tunnel, {}), ["https://tunnel.example", "http://localhost:8080", "http://127.0.0.1:8080"]);
  });

  test("Google is the only sign-in method, on the public origin", () => {
    const { googleConfigured, options } = authSettings(PROD);
    assert.equal(googleConfigured, true);
    assert.equal(options.baseURL, "https://velo.example");
    assert.equal(options.secret, "s".repeat(32));
    assert.equal(options.onAPIError.errorURL, "https://velo.example/login");
    assert.deepEqual(Object.keys(options.socialProviders), ["google"]);
    assert.deepEqual(options.socialProviders.google, {
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "google-secret",
      prompt: "select_account",
    });
    assert.equal("emailAndPassword" in options, false);
  });

  test("account linking trusts no provider, so linking always needs Google's verified email", () => {
    const { accountLinking } = authSettings(PROD).options.account;
    assert.equal(accountLinking.enabled, true);
    const trusted: unknown = (accountLinking as { trustedProviders?: unknown }).trustedProviders;
    assert.ok(trusted === undefined || (Array.isArray(trusted) && trusted.length === 0), `trustedProviders: ${String(trusted)}`);
  });

  test("without Google credentials (development) sign-in is simply unavailable", () => {
    const { googleConfigured, options } = authSettings(loadServerEnv({ GOOGLE_CLIENT_ID: "only-the-id" }));
    assert.equal(googleConfigured, false);
    assert.deepEqual(options.socialProviders, {});
  });

  test("session cookies are __Host-velo.*, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", () => {
    const { advanced } = authSettings(PROD).options;
    assert.equal(advanced.cookiePrefix, "__Host-velo");
    assert.equal(advanced.useSecureCookies, false);
    assert.deepEqual(advanced.defaultCookieAttributes, { secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    assert.equal("crossSubDomainCookies" in advanced, false);
  });

  test("a new session stores no IP or user agent and ends the person's other sessions", async () => {
    const ended: Array<[string, string]> = [];
    const hooks = sessionHooks(async (userId, keep) => {
      ended.push([userId, keep]);
    });
    const row = { id: "s1", userId: "u1", token: "t", ipAddress: "203.0.113.9", userAgent: "UA/1" };
    assert.deepEqual(await hooks.session.create.before(row), {
      data: { id: "s1", userId: "u1", token: "t", ipAddress: null, userAgent: null },
    });
    await hooks.session.create.after(row);
    assert.deepEqual(ended, [["u1", "s1"]]);
  });
  ```
  Create `src/lib/auth/removed-auth.test.ts`. It carries the W0-T2 and W0-T4 regression guards, which move here from the two test files this task deletes:
  ```ts
  // Regression guards for removed sign-in paths (W0-T2, W0-T4, W2). Each one was
  // an account-takeover or third-party-identity path; none may come back.
  import assert from "node:assert/strict";
  import { existsSync, readFileSync } from "node:fs";
  import { test } from "node:test";

  const here = (path: string) => new URL(path, import.meta.url);
  const source = (path: string) => readFileSync(here(path), "utf8");

  test("the committed preview OAuth client stays deleted (W0-T2)", () => {
    assert.equal(existsSync(here("./preview.ts")), false);
    assert.doesNotMatch(source("./server.ts"), /PREVIEW_CLIENT_SECRET|PREVIEW_CLIENT_ID/);
  });

  test("the copy-paste sign-in link stays deleted (W0-T4)", () => {
    assert.equal(existsSync(here("../sign-in-link.ts")), false);
    assert.equal(existsSync(here("../sign-in-link-policy.ts")), false);
  });

  test("the platform broker, gate identity, popup and email/password modules stay deleted (W2)", () => {
    for (const file of [
      "./email-password.ts",
      "./gate-identity.server.ts",
      "./gate-session.server.ts",
      "./popup.server.ts",
      "./auth-boot-policy.ts",
    ]) {
      assert.equal(existsSync(here(file)), false, file);
    }
  });

  test("the auth server registers no broker, bearer or password plugin", () => {
    const server = `${source("./server.ts")}\n${source("./auth-config.server.ts")}`;
    assert.doesNotMatch(server, /genericOAuth|bearer\(|emailAndPassword|gateIdentity|oneTimeToken|magicLink/);
  });

  test("no shared dev-user fallback exists in any environment", () => {
    for (const file of ["./verify.server.ts", "./middleware.ts"]) {
      assert.doesNotMatch(source(file), /dev-user|DEV_USER/, file);
    }
  });
  ```

- [ ] **Step 3: Write the failing HTTP test.** Create `tests/http/auth.test.mjs`:
  ```js
  // Sign-in is Google through Velo's own Better Auth instance, and nothing else
  // (roadmap D4). Needs a migrated Postgres: Better Auth stores OAuth state and
  // sessions there.
  import assert from "node:assert/strict";
  import { createHmac, randomUUID } from "node:crypto";
  import { after, before, describe, test } from "node:test";
  import pg from "pg";
  import { startServer } from "./harness.mjs";
  import { DB_URL, NEEDS_DB, PROD_ENV, TEST_ORIGIN, dbEnv } from "./env.mjs";

  describe("auth: Google only, __Host- cookies, no bearer, no password", { skip: NEEDS_DB }, () => {
    let server;
    let db;
    const userId = `test-${randomUUID()}`;
    const token = randomUUID().replace(/-/g, "");

    before(async () => {
      server = await startServer({ env: dbEnv() });
      db = new pg.Client({ connectionString: DB_URL });
      await db.connect();
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, 'Test User', $2, true, now(), now())`,
        [userId, `${userId}@example.test`],
      );
      await db.query(
        `insert into "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
         values ($1, $2, $3, now() + interval '1 hour', now(), now())`,
        [randomUUID(), token, userId],
      );
    });

    after(async () => {
      await db?.query(`delete from "user" where id = $1`, [userId]);
      await db?.end();
      await server?.stop();
    });

    // Better Auth rate-limits /sign-in/* to 3 per 10 s per client IP, which it
    // reads from X-Forwarded-For by default. One documentation-range address per
    // request keeps these tests out of each other's bucket.
    let requests = 0;
    const post = (path, body, headers = {}) =>
      fetch(`${server.baseUrl}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN,
          "x-forwarded-for": `198.51.100.${++requests}`,
          ...headers,
        },
        body: JSON.stringify(body),
        redirect: "manual",
      });

    test("Google sign-in starts at accounts.google.com with the project's client and callback", async () => {
      const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const url = new URL(JSON.parse(text).url);
      assert.equal(url.origin, "https://accounts.google.com");
      assert.equal(url.searchParams.get("client_id"), PROD_ENV.GOOGLE_CLIENT_ID);
      assert.equal(url.searchParams.get("redirect_uri"), `${TEST_ORIGIN}/api/auth/callback/google`);
      assert.equal(url.searchParams.get("prompt"), "select_account");
    });

    test("the OAuth state cookie is __Host-velo.state: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain", async () => {
      const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-velo.state="));
      assert.ok(cookie, `no __Host-velo.state cookie in ${JSON.stringify(res.headers.getSetCookie())}`);
      assert.match(cookie, /;\s*Secure/i);
      assert.match(cookie, /;\s*HttpOnly/i);
      assert.match(cookie, /;\s*SameSite=Lax/i);
      assert.match(cookie, /;\s*Path=\/(;|$)/i);
      assert.doesNotMatch(cookie, /;\s*Domain=/i);
    });

    // Production trusts VELO_PUBLIC_ORIGIN only: never a loopback dev origin (CLEAN-12).
    for (const untrusted of ["https://evil.example", "http://localhost:8080", "http://127.0.0.1:8080"]) {
      test(`a cookie-bearing auth POST from ${untrusted} is refused`, async () => {
        const res = await post(
          "/sign-in/social",
          { provider: "google", callbackURL: "/" },
          { origin: untrusted, cookie: "__Host-velo.session_data=x" },
        );
        assert.equal(res.status, 403);
        assert.equal((await res.json()).code, "INVALID_ORIGIN");
      });

      test(`a callbackURL on ${untrusted} is refused`, async () => {
        const res = await post("/sign-in/social", { provider: "google", callbackURL: `${untrusted}/` });
        assert.equal(res.status, 403);
        assert.equal((await res.json()).code, "INVALID_CALLBACK_URL");
      });
    }

    test("email/password sign-up and sign-in are disabled", async () => {
      const creds = { email: "someone@example.test", password: "correct horse battery staple", name: "x" };
      const signUp = await post("/sign-up/email", creds);
      assert.equal(signUp.status, 400);
      assert.equal((await signUp.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
      assert.equal(signUp.headers.getSetCookie().length, 0);
      const signIn = await post("/sign-in/email", creds);
      assert.equal(signIn.status, 400);
      assert.equal((await signIn.json()).code, "EMAIL_PASSWORD_DISABLED");
    });

    test("the removed broker providers are unknown", async () => {
      for (const provider of ["grok-google", "grok-x", "twitter"]) {
        const res = await post("/sign-in/social", { provider, callbackURL: "/" });
        assert.notEqual(res.status, 200, provider);
      }
      const generic = await post("/sign-in/oauth2", { providerId: "grok-google", callbackURL: "/" });
      assert.equal(generic.status, 404);
    });

    test("an OAuth callback failure lands on Velo's sign-in page with an error code", async () => {
      const res = await fetch(`${server.baseUrl}/api/auth/callback/google?state=forged&code=x`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), `${TEST_ORIGIN}/login?error=state_mismatch`);
    });

    test("a signed session cookie resolves the user", async () => {
      const signature = createHmac("sha256", PROD_ENV.BETTER_AUTH_SECRET).update(token).digest("base64");
      const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
        headers: { cookie: `__Host-velo.session_token=${encodeURIComponent(`${token}.${signature}`)}` },
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json())?.user?.id, userId);
    });

    test("the same token as a bearer header is ignored (bearer plugin removed)", async () => {
      const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      assert.equal(await res.json(), null);
    });

    test("an unsigned session cookie is ignored", async () => {
      const res = await fetch(`${server.baseUrl}/api/auth/get-session`, {
        headers: { cookie: `__Host-velo.session_token=${token}` },
      });
      assert.equal(await res.json(), null);
    });
  });
  ```
  The cookie signature is `base64(HMAC-SHA256(secret, token))`, URL-encoded as `token.signature`. That is better-call's `signCookieValue`, verified against Better Auth 1.6.33.

- [ ] **Step 4: Run the tests and see them fail.** Run:
  ```bash
  node --experimental-strip-types --test src/lib/auth/auth-config.server.test.ts src/lib/auth/removed-auth.test.ts
  ```
  Expected:
  - `auth-config.server.test.ts` FAILs with `ERR_MODULE_NOT_FOUND … auth-config.server.ts`;
  - `removed-auth.test.ts` FAILs on "the platform broker … stay deleted" (`./email-password.ts`), "registers no broker, bearer or password plugin" and "no shared dev-user fallback";
  - the two W0 guards pass.

  With a database, `npm run build && VELO_TEST_DATABASE_URL=… node --test tests/http/auth.test.mjs` FAILs:
  - `Google sign-in starts…` returns 404 with `PROVIDER_NOT_FOUND`;
  - `email/password … disabled` returns 200 with a session;
  - the cookie tests see `__Host-grok-auth.*` or no cookie.

  Without a database the suite reports 1 skipped.

- [ ] **Step 5: Create the auth config.** Create `src/lib/auth/auth-config.server.ts`:
  ```ts
  /**
   * Better Auth settings derived from the server env (roadmap C1, C9). Pure, so
   * the security-relevant choices are unit-tested without a database.
   *
   * Google (Better Auth's built-in social provider, the project's own OAuth
   * client) is the only sign-in method: no email/password, no bearer tokens, no
   * third-party broker. Sessions ride `__Host-` cookies: Secure, HttpOnly,
   * SameSite=Lax, Path=/ and no Domain, so no sibling subdomain can set or read
   * them.
   */
  import { devOrigin, type ServerEnv } from "../env.server.ts";

  /** Better Auth cookie prefix: every auth cookie is `__Host-velo.<name>`. */
  export const SESSION_COOKIE_PREFIX = "__Host-velo";

  /**
   * Origins allowed to make credentialed auth requests: the public origin, plus
   * the local dev server (both loopback spellings) outside production only.
   */
  export function trustedOrigins(env: ServerEnv, source: NodeJS.ProcessEnv = process.env): string[] {
    if (env.NODE_ENV === "production") return [env.VELO_PUBLIC_ORIGIN];
    const local = devOrigin(source);
    return [...new Set([env.VELO_PUBLIC_ORIGIN, local, local.replace("//localhost:", "//127.0.0.1:")])];
  }

  export function authSettings(env: ServerEnv, source: NodeJS.ProcessEnv = process.env) {
    const google =
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Always show the account chooser, so a shared browser never signs in silently.
            prompt: "select_account" as const,
          }
        : undefined;
    return {
      /** False only in development without Google credentials: sign-in is then unavailable. */
      googleConfigured: google !== undefined,
      options: {
        baseURL: env.VELO_PUBLIC_ORIGIN,
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: trustedOrigins(env, source),
        // OAuth failures land on Velo's sign-in page with `?error=<code>`, not on
        // Better Auth's built-in error page.
        onAPIError: { errorURL: `${env.VELO_PUBLIC_ORIGIN}/login` },
        socialProviders: google ? { google } : {},
        account: {
          encryptOAuthTokens: true,
          // No `trustedProviders`: a trusted provider skips Better Auth's
          // emailVerified check when linking, so linking to an existing user
          // always needs Google to report the email as verified.
          accountLinking: { enabled: true },
        },
        // Short-lived signed `session_data` cookie so session reads skip the database.
        session: { cookieCache: { enabled: true, maxAge: 300 } },
        advanced: {
          // Better Auth's automatic prefix is `__Secure-`, which allows a Domain
          // attribute. `__Host-` is set through the prefix below instead.
          useSecureCookies: false,
          cookiePrefix: SESSION_COOKIE_PREFIX,
          defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/" },
        },
      },
    };
  }

  type SessionRow = { id: string; userId: string; ipAddress?: string | null; userAgent?: string | null };

  /**
   * Session privacy and the one-login policy. A session never records the IP
   * address or user agent (Velo keeps no login log), and a new sign-in ends the
   * person's other sessions, so an old device or a copied cookie cannot stay
   * signed in.
   */
  export function sessionHooks(endOtherSessions: (userId: string, keepSessionId: string) => Promise<void>) {
    return {
      session: {
        create: {
          before: async <S extends SessionRow>(session: S) => ({
            data: { ...session, ipAddress: null, userAgent: null },
          }),
          after: async (session: SessionRow) => {
            await endOtherSessions(session.userId, session.id);
          },
        },
      },
    };
  }
  ```

- [ ] **Step 6: Replace the auth server.** Replace the whole content of `src/lib/auth/server.ts` with:
  ```ts
  /**
   * Velo's Better Auth instance (server-only; never import it from client code —
   * it pulls in `pg` and the auth secret). Settings live in `auth-config.server.ts`
   * and come from `serverEnv()`; production boot has already validated them
   * (`server/plugins/env.ts`).
   *
   * Postgres when `DATABASE_URL` is set (always, in production). Development
   * without it uses the embedded PGLite database through a Kysely dialect, so
   * auth rows live in the same database as app data.
   *
   * The client uses `@/lib/auth/client`; components read the user through
   * `@/lib/auth/use-current-user`; server functions get a verified id from
   * `@/lib/auth/middleware`.
   */
  import { betterAuth } from "better-auth";
  import { tanstackStartCookies } from "better-auth/tanstack-start";
  import { Pool } from "pg";
  import { ensureDbReady, getPglite, getSql } from "../db";
  import { serverEnv } from "../env.server";
  import { log } from "../log.server";
  import { authSettings, sessionHooks } from "./auth-config.server";
  import { pgliteDialect } from "./pglite-dialect";

  // Start (and share) PGLite bootstrap as soon as the auth module loads in dev.
  void ensureDbReady();

  const env = serverEnv();
  const settings = authSettings(env);

  /** True when Google sign-in is available. Always true in production. */
  export const authConfigured = settings.googleConfigured;

  const database = env.DATABASE_URL
    ? authPool(env.DATABASE_URL)
    : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

  function authPool(connectionString: string): Pool {
    const pool = new Pool({ connectionString });
    // Neither Better Auth nor Kysely attaches an `error` listener to a pool handed
    // to them, and an idle client dropped by the server emits one. Unhandled, that
    // is a process-level crash rather than a connection the pool simply replaces.
    pool.on("error", (err) => {
      log.error("auth.db_idle_client_error", { err });
    });
    return pool;
  }

  export const auth = betterAuth({
    ...settings.options,
    database,
    databaseHooks: sessionHooks(async (userId, keepSessionId) => {
      const sql = await getSql();
      await sql`delete from "session" where "userId" = ${userId} and id <> ${keepSessionId}`;
    }),
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. Keep it last.
    plugins: [tanstackStartCookies()],
  });
  ```

- [ ] **Step 7: Replace session resolution and the middleware.** Replace the whole content of `src/lib/auth/verify.server.ts` with:
  ```ts
  import { getRequest } from "@tanstack/react-start/server";
  import { auth, authConfigured } from "./server";

  /**
   * Server-side session resolution (server-only).
   *
   * Velo runs its own Better Auth at same-origin `/api/auth/*`, so the session
   * cookie rides every request to this app — server functions, API routes and
   * SSR loaders alike. Never trust a client-supplied user id, only the result of
   * this verification.
   *
   * There is no shared or fallback user in any environment. Without Google
   * credentials (development only: production refuses to boot) nobody can sign
   * in, so every per-user feature answers 401.
   */

  /** Re-export so callers can branch on it without importing `server.ts`. */
  export { authConfigured };

  /**
   * Thrown by `requireUserId` when the caller has no valid session. Carries
   * `status: 401`; the message is a stable contract — match
   * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
   */
  export class UnauthorizedError extends Error {
    readonly status = 401;
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }

  export type VerifiedUser = { id: string; email: string | null };

  /**
   * The signed-in user for `headers` (default: the current request's), or `null`
   * when nobody is signed in or sign-in is unavailable.
   */
  export async function getSessionUser(headers?: Headers): Promise<VerifiedUser | null> {
    if (!authConfigured) return null;
    const source = headers ?? getRequest()?.headers;
    if (!source) return null;
    const session = await auth.api.getSession({ headers: source });
    if (!session?.user) return null;
    return { id: session.user.id, email: session.user.email ?? null };
  }

  /**
   * The current user's verified id for a server function, or `UnauthorizedError`.
   * Prefer `authMiddleware` (`./middleware`), which calls this for you.
   */
  export async function requireUserId(): Promise<string> {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    return user.id;
  }
  ```
  Replace the whole content of `src/lib/auth/middleware.ts` with:
  ```ts
  import { createMiddleware } from "@tanstack/react-start";

  /**
   * Auth middleware for server functions — the standard way to get the caller's
   * verified user id. The session cookie is same-origin and rides along
   * automatically; nothing is forwarded from the client.
   *
   * Use it on every server function that touches per-user data, and scope every
   * query by `context.userId`. Signed out → `UnauthorizedError` (401, see
   * `verify.server.ts`); a scripted cross-site request → `CrossSiteRequestError`
   * (403, see `isolation.server.ts`).
   */
  export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
    // ONLY import `*.server` modules here. This file also ships to the client,
    // and a non-`.server` path would pull `@tanstack/react-start/server` (Node
    // `AsyncLocalStorage`) into the browser bundle.
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { requireUserId } = await import("./verify.server");
    // Reject scripted cross-site/sibling requests before touching per-user data.
    assertSameSiteRequest();
    const userId = await requireUserId();
    return next({ context: { userId } });
  });
  ```
  Replace the whole content of `src/routes/api/auth/$.ts` with the code below. The per-IP sign-up limiter guarded `/sign-up/email`, which no longer exists. Better Auth's own production limiter covers `/sign-in/*`, and its IP source is W5's (see Hand-off).
  ```ts
  import { createFileRoute } from "@tanstack/react-router";
  import { auth } from "@/lib/auth/server";

  export const Route = createFileRoute("/api/auth/$")({
    server: {
      handlers: {
        GET: ({ request }) => auth.handler(request),
        POST: ({ request }) => auth.handler(request),
      },
    },
  });
  ```

- [ ] **Step 8: Move the session-cookie readers off the bearer.**
  1. In `src/lib/session-token.ts`, delete the whole `readSessionTokenFromHeaders` function, from `export function readSessionTokenFromHeaders(headers: Headers): string {` through its closing `}`, plus the blank line before it. `sessionTokenKey` stays. Task 5 deletes the file.
  2. In `src/lib/session-isolation.ts`:
     - replace exactly
       ```ts
       import { readSessionTokenFromHeaders, sessionTokenKey } from "@/lib/session-token";

       export { readSessionTokenFromHeaders, sessionTokenKey } from "@/lib/session-token";
       ```
       with
       ```ts
       import { sessionTokenKey } from "@/lib/session-token";
       ```
     - replace exactly
       ```ts
           const { getCookie, getRequest } = await import("@tanstack/react-start/server");
           const { getSql } = await import("@/lib/db");
           const request = getRequest();
           const fromHeader = request ? readSessionTokenFromHeaders(request.headers) : "";
           const fromCookie = sessionTokenKey(getCookie("__Host-grok-auth.session_token"));
           // The RPC transport never sends an Authorization header and, in the live
           // preview, no session cookie reaches the server either — the session rides
           // the bearer that authMiddleware forwards in context. Without this the whole
           // handler silently no-ops in exactly the tri-mode env it exists for.
           const fromBearer = sessionTokenKey((context as { bearerToken?: string | null }).bearerToken);
           const token = fromHeader || fromCookie || fromBearer;
       ```
       with
       ```ts
           const { getCookie } = await import("@tanstack/react-start/server");
           const { getSql } = await import("@/lib/db");
           const { SESSION_COOKIE_PREFIX } = await import("@/lib/auth/auth-config.server");
           const token = sessionTokenKey(getCookie(`${SESSION_COOKIE_PREFIX}.session_token`));
       ```
     - Task 5 deletes this server function, because `sessionHooks` now does its job for every sign-in.
  3. In `src/lib/session-isolation.test.ts`:
     - replace `import { readSessionTokenFromHeaders, sessionTokenKey } from "./session-token.ts";` with `import { sessionTokenKey } from "./session-token.ts";`;
     - delete the whole test `test("reads the bearer session token from request headers", () => { … });` and the blank line before it. It tested the bearer reader deleted above.
  4. In `src/lib/guest-limit.server.ts`, make three changes:
     - replace ` * guest id (x-velo-guest / cookie) so 100 grok.me tabs on one NAT are not one` with ` * guest id (x-velo-guest / cookie) so many browsers behind one NAT are not one`;
     - replace exactly
       ```ts
        * On grok.me the session rides a bearer token (partitioned cookies). Quota and
        * cookie gates must read Authorization from the download request itself.
        */
       import { readSessionTokenFromHeaders } from "./session-token.ts";
       ```
       with
       ```ts
        * Quota and cookie gates read the session cookie from the download request itself.
        */
       ```
     - replace exactly
       ```ts
       /** Resolve the signed-in person from this download request’s bearer (grok.me iframe). */
       export async function userIdFromDownloadRequest(request: Request): Promise<string | null> {
         const { getSessionUser } = await import("@/lib/auth/verify.server");
         try {
           const token = readSessionTokenFromHeaders(request.headers);
           return (await getSessionUser(token || undefined))?.id ?? null;
       ```
       with
       ```ts
       /** Resolve the signed-in person from this download request’s session cookie. */
       export async function userIdFromDownloadRequest(request: Request): Promise<string | null> {
         const { getSessionUser } = await import("@/lib/auth/verify.server");
         try {
           return (await getSessionUser(request.headers))?.id ?? null;
       ```
  5. In `src/lib/auth/isolation.server.ts`, make three comment replacements:
     - replace exactly
       ```
        * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
        * UNTRUSTED, and a `SameSite=Lax` session cookie IS sent on same-site
        * subrequests — so without this, a malicious sibling could make a SCRIPTED
        * (fetch/XHR/form-POST) request to this app's server functions and ride this
        * app's session cookie.
       ```
       with
       ```
        * A `SameSite=Lax` session cookie IS sent on same-site subrequests, so any
        * page on a sibling subdomain of Velo's site could otherwise make a SCRIPTED
        * (fetch/XHR/form-POST) request to this app's server functions and ride the
        * session cookie.
       ```
     - replace exactly
       ```
        * top-level GET navigations (how the OAuth callback and normal page loads
        * arrive). Every cross-site / same-site *scripted* request is rejected.
        * Together with `__Host-` cookies and Better Auth's `trustedOrigins`, this
        * closes the sibling-tenant attack surface. Enforced at the `authMiddleware`
        * chokepoint (see `middleware.ts`).
       ```
       with
       ```
        * top-level GET navigations (how the Google OAuth callback and normal page
        * loads arrive). Every cross-site / same-site *scripted* request is rejected.
        * Together with `__Host-` cookies and Better Auth's `trustedOrigins`, this
        * closes the sibling-subdomain attack surface. Enforced at the
        * `authMiddleware` chokepoint (see `middleware.ts`).
       ```
     - replace `  // A top-level GET navigation (e.g. the broker's OAuth callback redirect) is` with `  // A top-level GET navigation (e.g. Google's OAuth callback redirect) is`.

     The Fetch-Metadata check itself is unchanged, as decision 9 requires.

- [ ] **Step 9: Server logging and lint.**
  1. In `src/lib/db.ts`:
     - replace `import { pendingMigrations } from "../../scripts/migration-plan.mjs";` with
       ```ts
       import { pendingMigrations } from "../../scripts/migration-plan.mjs";
       import { log } from "./log.server.ts";
       ```
     - replace `      console.error("[db] idle client error", err);` with `      log.error("db.idle_client_error", { err });`;
     - replace `    console.error("[db] PGLite bootstrap failed:", err);` with `    log.error("db.pglite_bootstrap_failed", { err });`.
  2. In `eslint.config.mjs`, replace exactly
     ```js
         // Server code logs through `log` (src/lib/log.server.ts), which redacts secrets.
         files: ["src/**/*.server.ts", "src/routes/**"],
         ignores: [
           // W2 deletes/rewrites these two Grok-gate auth files; remove both lines then.
           "src/lib/auth/gate-session.server.ts",
           "src/lib/auth/verify.server.ts",
         ],
         rules: { "no-console": "error" },
     ```
     with
     ```js
         // Server code logs through `log` (src/lib/log.server.ts), which redacts secrets.
         // Server-only modules without the `.server` suffix are listed by name.
         files: ["src/**/*.server.ts", "src/routes/**", "src/lib/auth/server.ts", "src/lib/db.ts", "server/**"],
         rules: { "no-console": "error" },
     ```
     `src/lib/vault-crypto.ts` is the one other server-only module without the suffix. W3 deletes its only `console.warn`, which is in `encryptCookies`, a vault function D2 removes, and then adds the file (see Hand-off).
  3. In `vite.config.ts`:
     - delete the whole `authPopupPlugin` function: from the `/**` line directly above ` * Live-preview OAuth popup — handled HERE so the agent never has to create a` through the function's closing `}` line, plus the blank line after it. The next remaining line must be `// Dev binds loopback by default; VELO_DEV_HOST / VELO_DEV_PORT override it`;
     - replace exactly
       ```
           pgliteBootstrapPlugin(),
           // Before tanstackStart so /auth/popup never falls through to the SPA.
           authPopupPlugin(),
       ```
       with
       ```
           pgliteBootstrapPlugin(),
       ```
  4. In `tests/http/env.mjs`, delete these two lines:
     ```
       // Until Task 4 removes the platform broker, production boot needs its flag off.
       VITE_AUTH_ENABLED: "false",
     ```
  5. In `tests/http/harness.test.mjs` (the `buildChildEnv` unit test), replace the now-meaningless flag keys:
     - `    GROK_AUTH_SECRET: "ambient",` → `    GOOGLE_CLIENT_SECRET: "ambient",`;
     - `    VITE_AUTH_ENABLED: "true",` → `    LOG_LEVEL: "debug",`;
     - `  const overrides = { VITE_AUTH_ENABLED: "false", ` → `  const overrides = { LOG_LEVEL: "warn", `;
     - `    VITE_AUTH_ENABLED: "false",`, the expected-output line, → `    LOG_LEVEL: "warn",`.

     The assertion is the same: an ambient non-allowlisted key is dropped, and the test's override wins.

- [ ] **Step 10: Delete the removed server paths.** Run:
  ```bash
  git rm src/lib/auth/gate-identity.server.ts src/lib/auth/gate-identity.test.ts src/lib/auth/gate-session.server.ts \
    src/lib/auth/popup.server.ts src/lib/auth/email-password.ts src/lib/auth/auth-boot-policy.ts \
    src/lib/auth/server-config.test.ts src/lib/rate-window.ts src/lib/rate-window.test.ts
  ```
  Where each deleted test's intent goes:
  - `server-config.test.ts`: the preview-secret guard moved to `removed-auth.test.ts`, and the production-refusal intent is now Task 3's boot matrix;
  - `rate-window.test.ts`: the sign-in-link guard moved to `removed-auth.test.ts`, and the limiter it tested had no caller left;
  - `gate-identity.test.ts`: the gate code it tested is deleted (TEST-12).

  Do **not** touch `jose` in `package.json` or the lockfile (see § Decisions applied).

- [ ] **Step 11: Run the tests and the gates.** Run:
  ```bash
  node --experimental-strip-types --test src/lib/auth/auth-config.server.test.ts src/lib/auth/removed-auth.test.ts
  npm run typecheck && npm run lint && npm test
  npm run build && npm run test:http
  ```
  Expected: 6 + 5 unit tests pass; typecheck clean; lint exit 0; `npm test` 0 failures; `test:http` 0 failures, with `auth: Google only…` skipped locally unless the database is set.
  With a database: `VELO_TEST_DATABASE_URL=… npm run test:http`, 0 skipped and 0 failed. `auth.test.mjs` passes 14 tests.
  At this point the login page still shows the old buttons and the email form, and they no longer work. Task 5 rewrites the client.

- [ ] **Step 12: Verify nothing of the removed paths remains server-side.** Run:
  ```bash
  git grep -n -E "genericOAuth|bearer\(|emailAndPassword|GROK_AUTH|GROK_PROJECT|x-grok-identity|__Host-grok-auth|gateIdentity|handleAuthPopupRequest|auth-boot-policy|rate-window|readSessionTokenFromHeaders|DEV_USER_ID|dev-user" -- src/lib/auth/server.ts src/lib/auth/verify.server.ts src/lib/auth/middleware.ts src/lib/auth/auth-config.server.ts src/routes src/lib/guest-limit.server.ts src/lib/session-isolation.ts vite.config.ts eslint.config.mjs tests/http
  git grep -n "VITE_AUTH_ENABLED" -- tests/http
  ```
  Expected: no output from either.

- [ ] **Step 13: Commit**
  ```bash
  git add -A src/lib/auth src/lib/session-token.ts src/lib/session-isolation.ts src/lib/session-isolation.test.ts \
    src/lib/guest-limit.server.ts src/lib/db.ts src/routes/api/auth eslint.config.mjs vite.config.ts tests/http
  git status --short   # only this task's files; the git rm deletions are already staged
  git commit -m "feat(auth)!: sign in with the project's own Google OAuth client only

  Better Auth now uses its built-in google provider with GOOGLE_CLIENT_ID/SECRET,
  baseURL = VELO_PUBLIC_ORIGIN and trustedOrigins = [VELO_PUBLIC_ORIGIN] (plus
  the dev origin outside production). Removed: the app-builder broker, gate
  identity, bearer plugin, dev popup, email/password, the shared dev user and
  the per-request boot policy. Cookies are __Host-velo.*; sessions store no IP
  or user agent and a new sign-in ends the user's other sessions.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Cookie-only auth client; no flag, no popup, no dev user

**Executor:** velo-impl-opus-high
**Covers:** INST-01 (client flag), SEC-06 / PRIV-07 (client dev user), ARCH-15 (framed popup), ARCH-16 (popup host), TEST-09 (auth default is now a tested property, not a skipped one), CLEAN-02 / CLEAN-15 (client auth comments), W0 ledger "stale preview-client comments"

**Files:**
- Replace: `src/lib/auth/client.ts`, `src/lib/auth/use-current-user.ts`, `src/routes/login.tsx`.
- Modify:
  - `src/lib/auth/gates.tsx`, `src/lib/auth/provider.tsx`, `src/lib/guest-id.ts`;
  - `src/lib/capture-auth-token.ts`;
  - `src/lib/auth/removed-auth.test.ts`.
- Delete: `src/lib/auth/providers.ts`, `src/lib/auth/oauth-popup.ts`, `src/lib/auth/oauth-popup.test.ts`, `src/lib/session-isolation.ts`, `src/lib/session-isolation.test.ts`, `src/lib/session-token.ts`.

**Interfaces:**
- Consumes: `auth` via `/api/auth/*` (Task 4). `sessionHooks` now does what `isolateOwnSession` did (Task 4).
- Produces:
  - `authClient`;
  - `signInWithGoogle(opts?: { callbackURL?: string; errorCallbackURL?: string }): Promise<void>`;
  - `signOut(): Promise<void>`;
  - `useCurrentUserState(): { user: AppUser | null; isPending: boolean }`, where `AppUser` no longer has `isDevFallback`.
- Removed exports: `authEnabled`, `signIn`, `getBearerToken`, `withAuthHeaders`, `GROK_PROVIDERS`, `DEV_USER`, `isolateOwnSession`, `sessionTokenKey`, `captureAuthToken`, `emailAuthFetchOptions`.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'import { authEnabled, signOut } from "./client";' -- src/lib/auth/gates.tsx
  git grep -c -F '      {authEnabled && (' -- src/lib/auth/gates.tsx
  git grep -c -F ' * With auth on, visitors are signed out until they authenticate — in the sandbox' -- src/lib/auth/gates.tsx
  git grep -c -F ' * Minimal signed-in identity chip + sign-out. Restyle freely (see the' -- src/lib/auth/gates.tsx
  git grep -c -F 'import { withAuthHeaders } from "@/lib/auth/client";' -- src/lib/guest-id.ts
  git grep -c -F '  const headers = withAuthHeaders(init);' -- src/lib/guest-id.ts
  git grep -c -F ' * its `useSession()` works standalone — so this is a passthrough today. It'"'"'s' -- src/lib/auth/provider.tsx
  git grep -c -F 'export type AuthErrorInfo = {' -- src/lib/capture-auth-token.ts
  git grep -c -F '    "./email-password.ts",' -- src/lib/auth/removed-auth.test.ts
  git grep -c -F '  for (const file of ["./verify.server.ts", "./middleware.ts"]) {' -- src/lib/auth/removed-auth.test.ts
  ```
  Expected: every line prints `<file>:1`. If any differ, STOP.

- [ ] **Step 2: Write the failing guards.** In `src/lib/auth/removed-auth.test.ts`, make three changes:
  1. Replace `    "./email-password.ts",` with
     ```ts
         "./providers.ts",
         "./oauth-popup.ts",
         "./email-password.ts",
     ```
  2. Replace `  for (const file of ["./verify.server.ts", "./middleware.ts"]) {` with `  for (const file of ["./verify.server.ts", "./middleware.ts", "./use-current-user.ts", "./client.ts"]) {`.
  3. Append:
     ```ts

     test("the client keeps no session token in script-readable storage", () => {
       const client = source("./client.ts");
       assert.doesNotMatch(client, /sessionStorage|localStorage|Bearer|set-auth-token|genericOAuthClient/);
       assert.equal(existsSync(here("../session-isolation.ts")), false);
     });
     ```

- [ ] **Step 3: Run the guards and see them fail.** Run `node --experimental-strip-types --test src/lib/auth/removed-auth.test.ts`.
  Expected: FAIL on:
  - `./providers.ts`;
  - `dev-user|DEV_USER` in `./use-current-user.ts`;
  - `sessionStorage` in `client.ts`.

- [ ] **Step 4: Replace the client.** Replace the whole content of `src/lib/auth/client.ts` with:
  ```ts
  import { createAuthClient } from "better-auth/react";

  /**
   * Better Auth client for Velo's own `/api/auth/*`. The session is an HttpOnly
   * `__Host-` cookie: nothing about it is readable or stored by page script.
   */
  export const authClient = createAuthClient();

  /** Start Google sign-in: a full-page redirect to Google, then back to `callbackURL`. */
  export async function signInWithGoogle(
    opts: { callbackURL?: string; errorCallbackURL?: string } = {},
  ): Promise<void> {
    if (typeof window === "undefined") throw new Error("Sign-in needs a browser.");
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: opts.callbackURL ?? "/",
      errorCallbackURL: opts.errorCallbackURL ?? "/login?error=oauth",
    });
    if (error) throw new Error(error.message || "Sign-in failed.");
  }

  export async function signOut(): Promise<void> {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message || "Sign-out failed.");
    if (typeof window !== "undefined") window.location.assign("/");
  }
  ```
  Replace the whole content of `src/lib/auth/use-current-user.ts` with:
  ```ts
  import { useMemo } from "react";
  import { authClient } from "./client";

  /** Normalized signed-in user shape used across the app. */
  export type AppUser = {
    id: string;
    displayName: string | null;
    primaryEmail: string | null;
    profileImageUrl: string | null;
  };

  /** `useCurrentUserState()` result: the user plus the session-loading flag. */
  export type CurrentUserState = {
    /** The user — `null` BOTH while the session loads and when signed out. */
    user: AppUser | null;
    /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
    isPending: boolean;
  };

  /**
   * Current user + loading state, from Better Auth `useSession()` →
   * `/api/auth/get-session` (session cookie). `user` is `null` while the session
   * resolves (`isPending: true`) and when signed out (`isPending: false`).
   *
   * Protect a route by waiting out `isPending` before acting on `user` —
   * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
   * every hard reload:
   *
   *   import { RedirectToSignIn } from "@/lib/auth/gates";
   *   const { user, isPending } = useCurrentUserState();
   *   if (isPending) return null;              // still resolving — don't redirect yet
   *   if (!user) return <RedirectToSignIn />;  // definitely signed out
   */
  export function useCurrentUserState(): CurrentUserState {
    const { data, isPending } = authClient.useSession();
    const { id, name, email, image } = data?.user ?? {};
    // Memoized on the fields, not the session object: a fresh `user` literal
    // every render re-fires any effect that depends on it (the cookie vault load
    // looped on exactly that).
    const user = useMemo<AppUser | null>(
      () =>
        id
          ? {
              id,
              displayName: name ?? null,
              primaryEmail: email ?? null,
              profileImageUrl: image ?? null,
            }
          : null,
      [id, name, email, image],
    );
    return { user, isPending };
  }

  /**
   * Convenience view of `useCurrentUserState().user` for display (e.g.
   * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
   * for redirects/guards use `useCurrentUserState()` and check `isPending`.
   */
  export function useCurrentUser(): AppUser | null {
    return useCurrentUserState().user;
  }
  ```

- [ ] **Step 5: Gates, provider, guest id.**
  1. In `src/lib/auth/gates.tsx`:
     - replace `import { authEnabled, signOut } from "./client";` with `import { signOut } from "./client";`;
     - replace exactly
       ```
        * Auth state components — plain wrappers around `useCurrentUserState()`.
        *
        * With auth on, visitors are signed out until they authenticate — in the sandbox
        * live preview too, which does real sign-in. The shared dev user appears only
        * when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
        * While the session is still resolving, gates that care about signed-out state
        * render nothing so there's no signed-out flash on hard reload.
       ```
       with
       ```
        * Auth state components — plain wrappers around `useCurrentUserState()`.
        *
        * Visitors are signed out until they sign in with Google. While the session is
        * still resolving, gates that care about signed-out state render nothing so
        * there's no signed-out flash on hard reload.
       ```
     - replace `/** Where \`RedirectToSignIn\` sends signed-out visitors. Create this route. */` with `/** Where \`RedirectToSignIn\` sends signed-out visitors. */`;
     - replace `/** Render children only when a user is present (real session, or the disabled-auth dev user). */` with `/** Render children only when a user is signed in. */`;
     - replace exactly
       ```
       /**
        * Minimal signed-in identity chip + sign-out. Restyle freely (see the
        * `design-ui` skill). Sign-out is only shown when auth is enabled (the
        * disabled-auth dev user has nothing to sign out of).
        */
       ```
       with `/** Signed-in identity chip + sign-out. */`;
     - replace exactly
       ```tsx
             {authEnabled && (
               <button
                 type="button"
                 disabled={signingOut}
                 onClick={() => {
                   setSigningOut(true);
                   // Success navigates away; on failure re-enable so it can be retried.
                   void signOut().catch(() => setSigningOut(false));
                 }}
                 className="cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline"
               >
                 {signingOut ? "Signing out…" : "Sign out"}
               </button>
             )}
       ```
       with
       ```tsx
             <button
               type="button"
               disabled={signingOut}
               onClick={() => {
                 setSigningOut(true);
                 // Success navigates away; on failure re-enable so it can be retried.
                 void signOut().catch(() => setSigningOut(false));
               }}
               className="cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline"
             >
               {signingOut ? "Signing out…" : "Sign out"}
             </button>
       ```
  2. In `src/lib/auth/provider.tsx`, replace exactly
     ```
      * Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
      * its `useSession()` works standalone — so this is a passthrough today. It's
      * kept as the single, stable mount point for any future client-side providers
      * (e.g. a toast or theme provider) without churning the root shell.
     ```
     with
     ```
      * Better Auth's React client (`@/lib/auth/client`) needs no context provider —
      * its `useSession()` works standalone — so this only mounts the app-wide toaster.
     ```
  3. In `src/lib/guest-id.ts`:
     - delete the line `import { withAuthHeaders } from "@/lib/auth/client";` and the blank line after it;
     - replace `/** Stable per-browser id so 100 guests on one grok.me NAT are not one quota bucket. */` with `/** Stable per-browser id so many guests behind one NAT are not one quota bucket. */`;
     - replace `/** Auth bearer + per-browser guest id for every download fetch. */` with `/** Per-browser guest id for every download fetch (the session rides its cookie). */`;
     - replace `  const headers = withAuthHeaders(init);` with `  const headers = new Headers(init);`.
  4. In `src/lib/capture-auth-token.ts`, delete everything above the line `export type AuthErrorInfo = {`. That removes `BEARER_KEY`, `storeBearer`, `captureAuthToken` and `emailAuthFetchOptions`. The error table is unchanged here; Task 6 rewrites it.

- [ ] **Step 6: Replace the login page with the Google-only minimum.** Task 6 adds the "not set up" state and new copy. Replace the whole content of `src/routes/login.tsx` with:
  ```tsx
  import { useState } from "react";
  import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
  import { signInWithGoogle } from "@/lib/auth/client";
  import { useCurrentUserState } from "@/lib/auth/use-current-user";
  import { describeAuthError, describeOAuthSearch, type AuthErrorInfo } from "@/lib/capture-auth-token";
  import { Button } from "@/components/ui/button";
  import { Wordmark } from "@/components/wordmark";
  import { GUEST } from "@/lib/guest-copy";

  type LoginSearch = { error?: string; error_description?: string };

  export const Route = createFileRoute("/login")({
    validateSearch: (search: Record<string, unknown>): LoginSearch => ({
      error: typeof search.error === "string" ? search.error : undefined,
      error_description: typeof search.error_description === "string" ? search.error_description : undefined,
    }),
    component: Login,
  });

  function Login() {
    const search = Route.useSearch();
    const { user, isPending } = useCurrentUserState();
    const [error, setError] = useState<AuthErrorInfo | null>(
      describeOAuthSearch(search.error, search.error_description),
    );
    const [busy, setBusy] = useState(false);

    if (!isPending && user) return <Navigate to="/" />;

    async function handleGoogle() {
      setError(null);
      setBusy(true);
      try {
        // Success leaves this page for Google; nothing after this line runs then.
        await signInWithGoogle({ callbackURL: "/", errorCallbackURL: "/login" });
      } catch (err) {
        setError(describeAuthError(err instanceof Error ? err.message : ""));
        setBusy(false);
      }
    }

    return (
      <main className="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
        <a
          href="#signin"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-fg"
        >
          Skip to sign in
        </a>
        <div id="signin" className="mx-auto w-full max-w-md">
          <Wordmark />
          <h1 className="mt-10 font-display text-3xl leading-[var(--leading-display)] tracking-[var(--tracking-display)] text-fg sm:text-4xl">
            Sign in
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">{GUEST.login}</p>

          {error ? (
            <div className="panel mt-6 px-4 py-4" role="alert" aria-live="assertive">
              <p className="text-sm text-danger">{error.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{error.detail}</p>
              <p className="mt-1 text-xs text-fg">{error.action}</p>
            </div>
          ) : null}

          <div className="mt-8">
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full gap-2"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void handleGoogle()}
            >
              <GoogleMark />
              {busy ? "Opening Google…" : "Continue with Google"}
            </Button>
          </div>

          <Link to="/" className="mt-10 block text-sm text-muted">
            {GUEST.continueGuest}
          </Link>
        </div>
      </main>
    );
  }

  function GoogleMark() {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    );
  }
  ```
  `errorCallbackURL: "/login"` is deliberate. Better Auth appends `?error=<code>` itself, and the old `/login?error=oauth` produced a duplicate `error` parameter.

- [ ] **Step 7: Delete the removed client paths.** Run:
  ```bash
  git rm src/lib/auth/providers.ts src/lib/auth/oauth-popup.ts src/lib/auth/oauth-popup.test.ts \
    src/lib/session-isolation.ts src/lib/session-isolation.test.ts src/lib/session-token.ts
  ```
  Why each goes:
  - `oauth-popup.test.ts` tested the `*.grok-sandbox.com` popup predicate, which is deleted.
  - `session-isolation.test.ts` tested `sessionTokenKey`, which had no caller once `isolateOwnSession` was gone.
  - `isolateOwnSession` itself was superseded by `sessionHooks`, which Task 4 unit-tests and which now runs on every sign-in, not only on the email and popup paths.

- [ ] **Step 8: Run the tests and the gates.** Run:
  ```bash
  node --experimental-strip-types --test src/lib/auth/removed-auth.test.ts
  npm run typecheck && npm run lint && npm test
  npm run build && npm run test:http
  ```
  Expected: 6 tests pass; typecheck clean; lint exit 0; `npm test` 0 failures; `test:http` 0 failures.

- [ ] **Step 9: Verify by grep.** Run:
  ```bash
  git grep -n -E "authEnabled|VITE_AUTH_ENABLED|GROK_PROVIDERS|getBearerToken|withAuthHeaders|set-auth-token|sessionStorage\.(get|set)Item\(BEARER|isDevFallback|DEV_USER|isolateOwnSession|shouldUseOAuthPopup|genericOAuthClient|signIn\.oauth2|signIn\.email|signUp\.email|emailAuthFetchOptions|captureAuthToken|__Host-grok" -- src
  ```
  Expected: no output.

- [ ] **Step 10: Check dev by hand (evidence for the reviewer).**
  1. Run `VELO_DEV_PORT=8097 GOOGLE_CLIENT_ID=dev-id GOOGLE_CLIENT_SECRET=dev-secret npm run dev` in the background and wait for `Local:`.
  2. Run:
     ```bash
     curl -s -X POST http://127.0.0.1:8097/api/auth/sign-in/social -H "content-type: application/json" -H "origin: http://127.0.0.1:8097" -H "cookie: a=b" -d '{"provider":"google","callbackURL":"/"}'
     curl -s -X POST http://127.0.0.1:8097/api/auth/sign-in/social -H "content-type: application/json" -H "origin: http://localhost:8080" -H "cookie: a=b" -d '{"provider":"google","callbackURL":"/"}'
     ```
     Expected:
     - the first returns a `url` whose `redirect_uri` is `http%3A%2F%2Flocalhost%3A8097%2Fapi%2Fauth%2Fcallback%2Fgoogle`: trustedOrigins follow the dev port;
     - the second returns `{"message":"Invalid origin","code":"INVALID_ORIGIN"}`.
  3. Stop the dev server: `taskkill //PID <pid> //T //F`, finding the pid with `netstat -ano | grep ":8097 "`.

- [ ] **Step 11: Commit**
  ```bash
  git add -A src/lib/auth src/lib/guest-id.ts src/lib/capture-auth-token.ts src/routes/login.tsx
  git status --short   # only this task's files; the git rm deletions are already staged
  git commit -m "feat(auth): cookie-only auth client with a single Google sign-in

  The client no longer stores a bearer token, opens a popup, reads the
  VITE_AUTH_ENABLED flag or invents a dev user; /login offers Continue with
  Google and nothing else. isolateOwnSession is gone: Better Auth's session
  hooks now end other sessions and drop IP/user agent on every sign-in.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Login page: "sign-in unavailable" state and Google-only copy

**Executor:** velo-impl-opus-medium
**Covers:** WEB-12 (product-level error copy that doesn't name the auth library), W0 ledger "dead OAuth buttons in dev", SEC-08 (UI part), Copy rule

**Files:**
- Create: `src/lib/auth/status.ts`, `tests/http/login-page.test.mjs`
- Rename + replace: `src/lib/capture-auth-token.ts` → `src/lib/auth-errors.ts`, `src/lib/capture-auth-token.test.ts` → `src/lib/auth-errors.test.ts`
- Replace: `src/routes/login.tsx`
- Modify: `src/lib/auth/removed-auth.test.ts` (one assertion)

**Interfaces:**
- Consumes: `authConfigured` from `verify.server.ts` (Task 4); `signInWithGoogle` (Task 5).
- Produces:
  - `getSignInStatus`, a GET server fn returning `{ google: boolean }`;
  - `describeAuthError(raw: string): AuthErrorInfo`;
  - `describeOAuthSearch(error?, description?): AuthErrorInfo | null`;
  - the type `AuthErrorInfo`.
- `friendlyAuthError` and `messageForOAuthSearch` are dropped: they had no caller.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'import { describeAuthError, describeOAuthSearch, type AuthErrorInfo } from "@/lib/capture-auth-token";' -- src/routes/login.tsx
  git grep -n "friendlyAuthError\|messageForOAuthSearch" -- src ':!src/lib/capture-auth-token.ts' ':!src/lib/capture-auth-token.test.ts'
  git grep -c -F '  assert.equal(existsSync(here("../session-isolation.ts")), false);' -- src/lib/auth/removed-auth.test.ts
  ```
  Expected: `login.tsx:1`; no output; `removed-auth.test.ts:1`. If any differ, STOP.

- [ ] **Step 2: Rename the error module, then write the failing tests.**
  1. Run:
     ```bash
     git mv src/lib/capture-auth-token.ts src/lib/auth-errors.ts
     git mv src/lib/capture-auth-token.test.ts src/lib/auth-errors.test.ts
     ```
  2. Replace the whole content of `src/lib/auth-errors.test.ts` with the code below. The old cases for email, password, pop-up and X describe features Tasks 4–5 deleted, so they go with those features. The OAuth cases are kept and extended.
     ```ts
     import assert from "node:assert/strict";
     import { test } from "node:test";
     import { describeAuthError, describeOAuthSearch } from "./auth-errors.ts";

     test("maps Google OAuth failures for the login page", () => {
       assert.equal(describeAuthError("access_denied").code, "access_denied");
       assert.equal(describeAuthError("state_mismatch").code, "state_mismatch");
       assert.equal(describeAuthError("please_restart_the_process").code, "state_mismatch");
       assert.equal(describeAuthError("redirect_uri_mismatch").code, "oauth_config");
       assert.equal(describeAuthError("oauth_provider_not_found").code, "oauth_config");
       assert.equal(describeAuthError("temporarily_unavailable").code, "oauth_server");
       assert.equal(describeAuthError("Too many requests. Please try again later.").code, "rate_limited");
       assert.equal(describeAuthError("Invalid origin").code, "origin");
       assert.equal(describeAuthError("INVALID_CALLBACK_URL").code, "origin");
       assert.equal(describeAuthError("Failed to fetch").code, "network");
     });

     test("unknown failures never echo the raw message", () => {
       const info = describeAuthError("Error: connect ECONNREFUSED 10.0.0.5:5432 at pg.Client");
       assert.equal(info.code, "unknown");
       assert.doesNotMatch(`${info.title} ${info.detail} ${info.action}`, /ECONNREFUSED|10\.0\.0\.5|pg\./);
     });

     test("sign-in copy names only Google: no email, password, X, pop-up, broker or library", () => {
       const samples = [
         "access_denied",
         "state_mismatch",
         "redirect_uri_mismatch",
         "server_error",
         "Too many requests",
         "Invalid origin",
         "Failed to fetch",
         "something else",
       ];
       for (const raw of samples) {
         const { title, detail, action } = describeAuthError(raw);
         assert.doesNotMatch(`${title} ${detail} ${action}`, /email|password|\bX\b|pop-?up|broker|Better Auth|Grok/i, raw);
       }
     });

     test("maps OAuth callback search params", () => {
       assert.equal(describeOAuthSearch(undefined), null);
       assert.equal(describeOAuthSearch("access_denied")?.code, "access_denied");
       assert.equal(describeOAuthSearch("oauth", "server_error")?.code, "oauth_server");
     });
     ```
  3. Create `tests/http/login-page.test.mjs`:
     ```js
     // /login offers Google sign-in and nothing else (roadmap D4, SEC-08).
     import assert from "node:assert/strict";
     import { after, before, describe, test } from "node:test";
     import { startServer } from "./harness.mjs";
     import { NO_DB_URL, PROD_ENV } from "./env.mjs";

     describe("the sign-in page", () => {
       let server;
       before(async () => {
         server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });
       });
       after(() => server?.stop());

       test("offers Google only: no email or password form", async () => {
         const res = await fetch(`${server.baseUrl}/login`);
         const html = await res.text();
         assert.equal(res.status, 200);
         assert.match(html, /Continue with Google/);
         assert.doesNotMatch(html, /type="password"|type="email"|Create an account|Sign in with email/);
       });
     });
     ```
  4. In `src/lib/auth/removed-auth.test.ts`, replace `  assert.equal(existsSync(here("../session-isolation.ts")), false);` with
     ```ts
       assert.equal(existsSync(here("../session-isolation.ts")), false);
       assert.equal(existsSync(here("../capture-auth-token.ts")), false);
     ```

- [ ] **Step 3: Run the error tests and see them fail.** Run `node --experimental-strip-types --test src/lib/auth-errors.test.ts`.
  Expected: FAIL.
  - `please_restart_the_process` is `unknown`, not `state_mismatch`.
  - `oauth_provider_not_found` maps to `oauth` instead of `oauth_config`.
  - `Too many requests…` is `unknown`.
  - The copy test fails on `Try again, or use email.`
  - The unknown case echoes the raw message.

- [ ] **Step 4: Rewrite the error table.** Replace the whole content of `src/lib/auth-errors.ts` with:
  ```ts
  /**
   * Sign-in error copy for the login page. Sign-in is Google only, through a
   * full-page redirect; failures arrive either as a thrown message (the request
   * that starts sign-in) or as `?error=<code>` on `/login` (the OAuth callback).
   */
  export type AuthErrorInfo = {
    code: string;
    title: string;
    detail: string;
    action: string;
  };

  const AUTH_ERRORS: Array<{ test: (message: string) => boolean; info: AuthErrorInfo }> = [
    {
      test: (m) => m.includes("access_denied") || m.includes("access denied"),
      info: {
        code: "access_denied",
        title: "Permission declined",
        detail: "Google did not share your account with Velo.",
        action: "Try again and approve the Google prompt. Downloads still work as a guest.",
      },
    },
    {
      test: (m) => m.includes("state") || m.includes("please_restart"),
      info: {
        code: "state_mismatch",
        title: "Sign-in expired",
        detail: "The hand-off from Google took too long or came from another tab.",
        action: "Start again from this page.",
      },
    },
    {
      test: (m) =>
        m.includes("redirect_uri") ||
        m.includes("invalid_client") ||
        m.includes("unauthorized_client") ||
        m.includes("provider_not_found") ||
        m.includes("provider not found"),
      info: {
        code: "oauth_config",
        title: "Google sign-in is misconfigured",
        detail: "Google rejected this site's sign-in settings.",
        action: "Tell the site operator. Downloads still work as a guest.",
      },
    },
    {
      test: (m) => m.includes("temporarily_unavailable") || m.includes("server_error"),
      info: {
        code: "oauth_server",
        title: "Google had a problem",
        detail: "Google returned a server error.",
        action: "Wait a moment, then try again.",
      },
    },
    {
      test: (m) => m.includes("too many") || m.includes("rate") || m.includes("429"),
      info: {
        code: "rate_limited",
        title: "Too many attempts",
        detail: "Sign-in is paused for a few seconds.",
        action: "Wait ten seconds, then try again.",
      },
    },
    {
      test: (m) => m.includes("invalid origin") || m.includes("invalid_origin") || m.includes("callback_url"),
      info: {
        code: "origin",
        title: "Open Velo from its own address",
        detail: "Sign-in only works on the address this site is configured for.",
        action: "Go to the site's main address and sign in there.",
      },
    },
    {
      test: (m) => m.includes("failed to fetch") || m.includes("network"),
      info: {
        code: "network",
        title: "Could not reach Velo",
        detail: "The sign-in request did not get through.",
        action: "Check your connection, then try again.",
      },
    },
  ];

  export function describeAuthError(raw: string): AuthErrorInfo {
    const message = raw.toLowerCase();
    for (const row of AUTH_ERRORS) {
      if (row.test(message)) return row.info;
    }
    return {
      code: "unknown",
      title: "Sign-in failed",
      detail: "Google sign-in did not finish.",
      action: "Try again. Downloads still work as a guest.",
    };
  }

  /** The OAuth callback's `?error=` / `?error_description=` pair, or null when absent. */
  export function describeOAuthSearch(error: string | undefined, description?: string): AuthErrorInfo | null {
    if (!error && !description) return null;
    return describeAuthError([error, description].filter(Boolean).join(" "));
  }
  ```

- [ ] **Step 5: Add the status server fn and the final login page.** Create `src/lib/auth/status.ts`:
  ```ts
  import { createServerFn } from "@tanstack/react-start";

  /**
   * Whether Google sign-in is available on this server. Always true in
   * production (boot requires the Google credentials); false in development
   * until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
   */
  export const getSignInStatus = createServerFn({ method: "GET" }).handler(async () => {
    const { authConfigured } = await import("./verify.server");
    return { google: authConfigured };
  });
  ```
  Then edit `src/routes/login.tsx` in three places. The rest of the file (the error panel, the guest link, `GoogleMark`) stays as Task 5 wrote it.
  1. Replace the import line `import { describeAuthError, describeOAuthSearch, type AuthErrorInfo } from "@/lib/capture-auth-token";` with these two lines:
     ```tsx
     import { getSignInStatus } from "@/lib/auth/status";
     import { describeAuthError, describeOAuthSearch, type AuthErrorInfo } from "@/lib/auth-errors";
     ```
  2. In the route definition, replace `  component: Login,` with:
     ```tsx
       loader: () => getSignInStatus(),
       component: Login,
     ```
     and directly after `  const search = Route.useSearch();` add the line `  const { google } = Route.useLoaderData();`.
  3. Replace the button block, the whole `<div className="mt-8">` that holds the `<Button …>` with `Continue with Google`, with:
     ```tsx
             {google ? (
               <div className="mt-8">
                 <Button
                   type="button"
                   variant="secondary"
                   className="h-12 w-full gap-2"
                   disabled={busy}
                   aria-busy={busy}
                   onClick={() => void handleGoogle()}
                 >
                   <GoogleMark />
                   {busy ? "Opening Google…" : "Continue with Google"}
                 </Button>
               </div>
             ) : (
               <div className="panel mt-8 px-4 py-4" role="status">
                 <p className="text-sm text-fg">Sign-in is not set up on this server.</p>
                 <p className="mt-1 text-xs leading-relaxed text-muted">
                   Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart the server.
                 </p>
               </div>
             )}
     ```
  The "not set up" panel can only appear in development: production boot requires the Google credentials.

- [ ] **Step 6: Run the tests and the gates.** Run:
  ```bash
  node --experimental-strip-types --test src/lib/auth-errors.test.ts src/lib/auth/removed-auth.test.ts
  npm run typecheck && npm run lint && npm test
  npm run build && node --test tests/http/login-page.test.mjs && npm run test:http
  ```
  Expected: 4 + 6 tests pass; gates clean; the `login-page` test passes; `test:http` 0 failures.

- [ ] **Step 7: Check dev by hand.** Run `VELO_DEV_PORT=8097 npm run dev` **without** the Google variables, then `curl -s http://localhost:8097/login | grep -a -o "Continue with Google\|not set up"`.
  Expected: `not set up`. Then restart with `GOOGLE_CLIENT_ID=dev-id GOOGLE_CLIENT_SECRET=dev-secret` and repeat: expected `Continue with Google`. Stop the server the same way as in Task 5 Step 10.

- [ ] **Step 8: Commit**
  ```bash
  git add -A src/lib/auth-errors.ts src/lib/auth-errors.test.ts src/lib/auth/status.ts src/lib/auth/removed-auth.test.ts \
    src/routes/login.tsx tests/http/login-page.test.mjs
  git status --short   # the two git mv renames are already staged
  git commit -m "feat(login): say when sign-in is not set up; Google-only error copy

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Delete the branding injector, preview bridge, platform-host detection and template QA tooling

**Executor:** velo-impl-sonnet-high
**Covers:** PRIV-05, WEB-03, ARCH-06, SUP-02 (third-party script); ARCH-16 (bridge and builder hosts); CLEAN-02, CLEAN-12 (`/workspace` paths in QA tooling); LIC-03, REPO-05 (template assets and code)

**Files:**
- Delete:
  - `scripts/grok-pwa-plugin.mjs`, `scripts/grok-pwa-plugin.test.mjs`, `scripts/grok-pwa-shared.mjs`, `scripts/grok-pwa-shared.d.mts`, `scripts/install-page.html`;
  - `server/middleware/grok-pwa.ts`, `server/virtual-grok-og-identity.d.ts`, and `public/__grok/` (all 8 files);
  - `src/components/preview-host-bridge.tsx`, `src/lib/preview-host-bridge.ts`, `src/lib/preview-embedder-origin.ts`, `src/lib/preview-embedder-origin.test.ts`;
  - `scripts/browser-smoke.mjs`, `scripts/browser-smoke-verdict.mjs`, `scripts/browser-smoke-verdict.test.mjs`, `scripts/browser-guard.mjs`, `scripts/brand-check.mjs`, `scripts/brand-check.test.mjs`, `scripts/preview-thumbnail.mjs`;
  - `src/lib/og/site.json`.
- Modify: `vite.config.ts`, `src/routes/__root.tsx`, `src/lib/builder-env.ts`, `src/lib/builder-env.test.ts`, `src/lib/builder-save.ts`, `src/lib/hybrid-download.ts`, `README.md` (3 places)
- Create: `tests/http/branding.test.mjs`

**Interfaces:**
- `builder-env.ts` keeps only `safeDownloadName`. Removed: `isGrokHost`, `isSandboxHost`, `isBuilderPreview`.
- The browser-smoke family goes because it imports `brand-check.mjs`, which imports `grok-pwa-shared.mjs`. It also hard-codes `/workspace` paths (CLEAN-12), and its auth-invariant half (`check-auth-invariant.mjs`) is deleted in Task 8. W8's Playwright e2e replaces it.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F 'import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";' -- vite.config.ts
  git grep -c -F '    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.' -- vite.config.ts
  git grep -c -F 'import { PreviewHostBridge } from "@/components/preview-host-bridge";' -- src/routes/__root.tsx
  git grep -c -F '      { rel: "manifest", href: "/__grok/manifest.webmanifest" },' -- src/routes/__root.tsx
  git grep -c -F '        <PreviewHostBridge />' -- src/routes/__root.tsx
  git grep -c -F 'export function safeDownloadName(name: string): string {' -- src/lib/builder-env.ts
  git grep -c -F '  const preview = framed || isBuilderPreview();' -- src/lib/builder-save.ts
  git grep -c -F '  const builderFirst =' -- src/lib/hybrid-download.ts
  git grep -c -F '    patchStep(steps, "relay", { status: "skip", detail: "skipped in Grok preview — CDN links navigate the iframe" }, onSteps);' -- src/lib/hybrid-download.ts
  git grep -c -F 'node scripts/browser-smoke.mjs' -- README.md
  git grep -n "browser-smoke\|brand-check\|browser-guard\|preview-thumbnail\|grok-pwa\|preview-host-bridge\|preview-embedder-origin\|og/site" -- src scripts server vite.config.ts package.json tests | grep -v -E "^scripts/(browser-smoke|brand-check|browser-guard|preview-thumbnail|grok-pwa|check-auth-invariant)|^src/lib/preview-|^src/components/preview-host-bridge|^server/middleware"
  ```
  Expected: each count prints `:1`. The last command prints only:
  - `src/routes/__root.tsx:3:import { PreviewHostBridge } from "@/components/preview-host-bridge";`;
  - `vite.config.ts:…:import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";`.

  If anything else appears, STOP.

- [ ] **Step 2: Write the failing test.** Create `tests/http/branding.test.mjs`:
  ```js
  // The app-builder platform's branding injector is gone: no third-party script,
  // no platform manifest, no install tutorial (PRIV-05, WEB-03, ARCH-06, SUP-02).
  import assert from "node:assert/strict";
  import { after, before, describe, test } from "node:test";
  import { startServer } from "./harness.mjs";
  import { NO_DB_URL, PROD_ENV } from "./env.mjs";

  describe("no platform branding in served pages", () => {
    let server;
    before(async () => {
      server = await startServer({ env: { ...PROD_ENV, DATABASE_URL: NO_DB_URL } });
    });
    after(() => server?.stop());

    for (const path of ["/", "/login", "/?install=1&platform=ios"]) {
      test(`${path} loads no third-party script and names no platform`, async () => {
        const res = await fetch(`${server.baseUrl}${path}`);
        const html = await res.text();
        assert.equal(res.status, 200);
        assert.doesNotMatch(html, /grok\.com|grok\.me|grok-app-builder|__grok|Created with Grok/i);
        for (const src of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
          assert.ok(src[1].startsWith("/"), `third-party script ${src[1]}`);
        }
      });
    }

    test("the platform manifest path is gone", async () => {
      assert.equal((await fetch(`${server.baseUrl}/__grok/manifest.webmanifest`)).status, 404);
    });
  });
  ```

- [ ] **Step 3: Run it and see it fail.** Run `npm run build && node --test tests/http/branding.test.mjs`.
  Expected: FAIL.
  - Each page matches `grok.com` / `grok-app-builder`, from the injected `https://grok.com/grok-app-builder/extensions.js`.
  - The manifest path answers 200.

- [ ] **Step 4: Remove the plugin, the bridge and the platform links.**
  1. In `vite.config.ts`:
     - delete these two lines. The first of the two `// @ts-expect-error JS plugin alongside the TS vite config` lines is the one directly above the import:
       ```
       // @ts-expect-error JS plugin alongside the TS vite config
       import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
       ```
     - delete these two lines:
       ```
           // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
           grokPwaPlugin(),
       ```
  2. In `src/routes/__root.tsx`, delete these four lines:
     ```
     import { PreviewHostBridge } from "@/components/preview-host-bridge";
     ```
     ```
           { rel: "manifest", href: "/__grok/manifest.webmanifest" },
           { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
     ```
     ```
             <PreviewHostBridge />
     ```
  3. In `src/lib/builder-env.ts`, delete everything above the line `export function safeDownloadName(name: string): string {`. That removes `isGrokParent`, `isGrokHost`, `isSandboxHost` and `isBuilderPreview`.
  4. Replace the whole content of `src/lib/builder-env.test.ts` with the code below. The deleted tests covered the platform-host predicates removed in item 3; the `safeDownloadName` test is kept verbatim.
     ```ts
     import assert from "node:assert/strict";
     import { test } from "node:test";
     import { safeDownloadName } from "./builder-env.ts";

     test("safeDownloadName strips path characters and stays short", () => {
       assert.equal(safeDownloadName("nice.mp4"), "nice.mp4");
       assert.equal(safeDownloadName("a/b\\c:d*.mp4"), "a_b_c_d_.mp4");
       assert.equal(safeDownloadName(""), "video");
       assert.ok(safeDownloadName("x".repeat(400)).length <= 180);
     });
     ```
  5. In `src/lib/builder-save.ts`, make four replacements:
     - `import { isBuilderPreview, safeDownloadName } from "@/lib/builder-env";` → `import { safeDownloadName } from "@/lib/builder-env";`;
     - replace exactly
       ```
        * Must run in the same tick as the click. Grok’s preview iframe drops the
        * user-gesture if we `await` a download first, then the Save picker is blocked
        * and `<a download>` may navigate the iframe instead of saving.
       ```
       with
       ```
        * Must run in the same tick as the click. The browser drops the user gesture
        * if we `await` a download first, and then the Save picker is blocked.
       ```
     - ` * Save without navigating the Grok preview. Prefer the picker opened at click;` → ` * Save without navigating the app away. Prefer the picker opened at click;`;
     - `  const preview = framed || isBuilderPreview();` → `  const preview = framed;`.
  6. In `src/lib/hybrid-download.ts`, make four edits:
     - delete the line `import { isBuilderPreview, isSandboxHost } from "@/lib/builder-env";`;
     - delete these two lines:
       ```
         const builderFirst =
           isBuilderPreview() || (typeof window !== "undefined" && isSandboxHost(window.location.hostname));
       ```
     - replace `  if (!silentVideo && !builderFirst) {` with `  if (!silentVideo) {`;
     - replace exactly
       ```
         } else if (silentVideo) {
           patchStep(steps, "relay", { status: "skip", detail: "video-only — yt-dlp muxes audio" }, onSteps);
         } else {
           patchStep(steps, "relay", { status: "skip", detail: "skipped in Grok preview — CDN links navigate the iframe" }, onSteps);
         }
       ```
       with
       ```
         } else {
           patchStep(steps, "relay", { status: "skip", detail: "video-only — yt-dlp muxes audio" }, onSteps);
         }
       ```
  7. In `README.md`, make three edits:
     - replace `| **Testing** | Node.js native test runner (\`node --test\`), Playwright smoke tests |` with `| **Testing** | Node.js native test runner (\`node --test\`), HTTP black-box tests against the built server |`;
     - delete the line `│   ├── browser-smoke.mjs            # Automated Playwright desktop & mobile render test`;
     - replace exactly
       ````
       Build for production and verify with browser smoke tests:

       ```bash
       npm run build
       node scripts/browser-smoke.mjs
       ```
       ````
       with
       ````
       Build for production and run the HTTP black-box tests against the built server:

       ```bash
       npm run build
       npm run test:http
       ```
       ````
       This is a minimal edit to W7's README, so the file never documents a deleted script.

- [ ] **Step 5: Delete the files.** Run:
  ```bash
  git rm scripts/grok-pwa-plugin.mjs scripts/grok-pwa-plugin.test.mjs scripts/grok-pwa-shared.mjs scripts/grok-pwa-shared.d.mts \
    scripts/install-page.html server/middleware/grok-pwa.ts server/virtual-grok-og-identity.d.ts \
    src/components/preview-host-bridge.tsx src/lib/preview-host-bridge.ts src/lib/preview-embedder-origin.ts \
    src/lib/preview-embedder-origin.test.ts scripts/browser-smoke.mjs scripts/browser-smoke-verdict.mjs \
    scripts/browser-smoke-verdict.test.mjs scripts/browser-guard.mjs scripts/brand-check.mjs scripts/brand-check.test.mjs \
    scripts/preview-thumbnail.mjs src/lib/og/site.json
  git rm -r public/__grok
  ```
  The deleted tests (`grok-pwa-plugin`, `browser-smoke-verdict`, `brand-check`, `preview-embedder-origin`) covered only the deleted template code.

- [ ] **Step 6: Run the tests and the gates.** Run:
  ```bash
  npm run typecheck && npm run lint && npm test
  npm run build && npm run test:http
  git grep -n -E "grokPwa|grok-pwa|PreviewHostBridge|preview-host-bridge|preview-embedder|isBuilderPreview|isSandboxHost|isGrokHost|builderFirst|__grok|virtual:grok|browser-smoke|brand-check|browser-guard|preview-thumbnail|og/site\.json" -- src scripts server public vite.config.ts README.md tsconfig.json
  ls public
  ```
  Expected: gates clean; `test:http` 0 failures, and the `branding` tests pass. The grep prints nothing. `ls public` prints only `favicon.svg`.

- [ ] **Step 7: Commit**
  ```bash
  git add -A vite.config.ts src/routes/__root.tsx src/lib/builder-env.ts src/lib/builder-env.test.ts src/lib/builder-save.ts \
    src/lib/hybrid-download.ts README.md tests/http/branding.test.mjs scripts server public src/components src/lib
  git commit -m "refactor!: remove the app-builder branding injector, preview bridge and QA tooling

  No page loads grok.com/grok-app-builder/extensions.js any more; the platform
  manifest, install tutorial, Grok assets, preview postMessage bridge,
  platform-host detection and the /workspace-bound smoke tooling are deleted.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 8: Delete the env wrapper, `check:auth` and sandbox files; replace AGENTS.md

**Executor:** velo-impl-sonnet-high
**Covers:** OSS-04 (AGENTS.md); INST-01 (the `.grok/app-env.json` wrapper); INST-04 (direct Vite scripts; W1 deferral); TEST-09 (the skipped auth-default tests go with the wrapper); TEST-10 (`check:auth`); CLEAN-02, CLEAN-12 (`startup.sh`, `.node_modules.lock`, `app-builder:` names); REPO-05 / LIC-03 (AGENTS.md); W1 ledger "0.0.0.0 in AGENTS.md/startup.sh"

**Files:**
- Create: `scripts/project-root.mjs`, `scripts/project-root.test.mjs`
- Replace: `AGENTS.md`
- Modify:
  - `scripts/auto-update.mjs`, `scripts/auto-update-plan.test.mjs`, `scripts/migration-plan.test.mjs` (one import line each);
  - `package.json` (scripts only), `vite.config.ts`, `.gitignore`, `eslint.config.mjs`, `.gitattributes`;
  - `scripts/package-contract.test.mjs`.
- Delete: `scripts/app-env-plugin.mjs`, `scripts/with-app-env.mjs`, `scripts/with-app-env.test.mjs`, `scripts/check-auth-invariant.mjs`, `scripts/check-auth-invariant.test.mjs`, `startup.sh`, `.node_modules.lock`

**Interfaces:**
- Produces:
  - `projectRoot(): string`;
  - `isMainModule(moduleUrl: string): boolean`, from `scripts/project-root.mjs`, moved verbatim from `with-app-env.mjs`.
- `package.json` scripts: `dev` = `vite dev`, `build` = `vite build`, `build:dev` = `vite build --mode development`, `preview` = `vite preview`. There is no `check:auth` script any more.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -n 'from "./with-app-env.mjs"' -- scripts
  git grep -c -F '    "dev": "node scripts/with-app-env.mjs vite dev",' -- package.json
  git grep -c -F '    "check:auth": "node scripts/check-auth-invariant.mjs",' -- package.json
  git grep -c -F 'import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";' -- vite.config.ts
  git grep -c -F '    name: "app-builder:pglite-bootstrap",' -- vite.config.ts
  git grep -c -F '        console.error("[app-builder] DB bootstrap failed:", err);' -- vite.config.ts
  git grep -c -F '.grok/' -- .gitignore
  git grep -c -F '      ".grok/**",' -- eslint.config.mjs
  git grep -c -F '# CRLF startup.sh (the revive entrypoint) dies with "set: Illegal option -".' -- .gitattributes
  git grep -c -F 'test("lint fails on any warning", () => {' -- scripts/package-contract.test.mjs
  ```
  Expected: the first command prints exactly these six lines. The three files that survive are `auto-update-plan.test.mjs`, `auto-update.mjs` and `migration-plan.test.mjs`. The other three are deleted in this task.
  ```
  scripts/auto-update-plan.test.mjs:17:import { projectRoot } from "./with-app-env.mjs";
  scripts/auto-update.mjs:51:import { projectRoot } from "./with-app-env.mjs";
  scripts/check-auth-invariant.mjs:26:import { isMainModule, mergeAppEnv, projectRoot, readAppEnv } from "./with-app-env.mjs";
  scripts/check-auth-invariant.test.mjs:15:import { projectRoot } from "./with-app-env.mjs";
  scripts/migration-plan.test.mjs:14:import { projectRoot } from "./with-app-env.mjs";
  scripts/with-app-env.test.mjs:14:} from "./with-app-env.mjs";
  ```
  Every other command prints `:1`. If any differ, STOP.

- [ ] **Step 2: Write the failing tests.**
  1. In `scripts/package-contract.test.mjs`, replace `test("lint fails on any warning", () => {` with:
     ```js
     test("dev and build run Vite directly: no env wrapper, no auth-invariant check", () => {
       assert.equal(pkg.scripts.dev, "vite dev");
       assert.equal(pkg.scripts.build, "vite build");
       assert.equal(pkg.scripts["check:auth"], undefined);
       assert.doesNotMatch(JSON.stringify(pkg.scripts), /with-app-env|check-auth-invariant/);
     });

     test("lint fails on any warning", () => {
     ```
  2. Create `scripts/project-root.test.mjs`:
     ```js
     import assert from "node:assert/strict";
     import { existsSync } from "node:fs";
     import { join } from "node:path";
     import { test } from "node:test";
     import { isMainModule, projectRoot } from "./project-root.mjs";

     test("projectRoot is the repository root", () => {
       assert.ok(existsSync(join(projectRoot(), "package.json")));
       assert.ok(existsSync(join(projectRoot(), "scripts", "project-root.mjs")));
     });

     test("isMainModule is false for a module node was not started with", () => {
       assert.equal(isMainModule(new URL("./auto-update.mjs", import.meta.url).href), false);
     });
     ```

- [ ] **Step 3: Run them and see them fail.** Run `node --test scripts/package-contract.test.mjs scripts/project-root.test.mjs`.
  Expected: FAIL.
  - `dev and build run Vite directly…` fails with `'node scripts/with-app-env.mjs vite dev' !== 'vite dev'`.
  - `project-root.test.mjs` fails with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Move `projectRoot` and `isMainModule` first.** Create `scripts/project-root.mjs`:
  ```js
  // @ts-check
  import { realpathSync } from "node:fs";
  import { dirname } from "node:path";
  import { fileURLToPath } from "node:url";

  /** The repository root (this file lives in `<root>/scripts/`). */
  export function projectRoot() {
    return dirname(dirname(fileURLToPath(import.meta.url)));
  }

  /**
   * Whether `moduleUrl` is the script node was asked to run.
   *
   * Both sides are resolved through symlinks: node realpaths `import.meta.url`
   * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
   * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
   * @param {string} moduleUrl
   */
  export function isMainModule(moduleUrl) {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
      return realpathSync(entry) === fileURLToPath(moduleUrl);
    } catch {
      return false;
    }
  }
  ```
  In `scripts/auto-update.mjs`, `scripts/auto-update-plan.test.mjs` and `scripts/migration-plan.test.mjs`, replace `import { projectRoot } from "./with-app-env.mjs";` with `import { projectRoot } from "./project-root.mjs";`.

- [ ] **Step 5: Scripts, Vite config, ignores.**
  1. In `package.json`, change only these five script lines:
     - `    "dev": "node scripts/with-app-env.mjs vite dev",` → `    "dev": "vite dev",`;
     - `    "build": "node scripts/with-app-env.mjs vite build",` → `    "build": "vite build",`;
     - `    "build:dev": "node scripts/with-app-env.mjs vite build --mode development",` → `    "build:dev": "vite build --mode development",`;
     - `    "preview": "node scripts/with-app-env.mjs vite preview",` → `    "preview": "vite preview",`;
     - delete the line `    "check:auth": "node scripts/check-auth-invariant.mjs",`.

     Do not touch dependencies or the lockfile. npm runs scripts with `node_modules/.bin` on `PATH`, so bare `vite` works on Windows too. That makes the W1 INST-04 deferral moot.
  2. In `vite.config.ts`:
     - delete these two lines. They are now the only remaining `@ts-expect-error` pair:
       ```
       // @ts-expect-error JS plugin alongside the TS vite config
       import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
       ```
     - delete these two lines:
       ```
           // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
           appEnvPlugin(),
       ```
     - replace `    name: "app-builder:pglite-bootstrap",` with `    name: "velo:pglite-bootstrap",`;
     - replace `        console.error("[app-builder] DB bootstrap failed:", err);` with `        console.error("[velo] DB bootstrap failed:", err);`.
  3. In `.gitignore`, delete the line `.grok/`. Keep `.vercel/` and `.vercel`: W7 removes them (see § Decisions applied).
  4. In `eslint.config.mjs`, delete the line `      ".grok/**",`. Keep `".vercel/**",`.
  5. In `.gitattributes`, replace exactly
     ```
     # LF everywhere, whatever core.autocrlf says: the deploy target is Linux, and a
     # CRLF startup.sh (the revive entrypoint) dies with "set: Illegal option -".
     ```
     with
     ```
     # LF everywhere, whatever core.autocrlf says: the deploy target (the container)
     # is Linux, and plan anchors are LF text.
     ```

- [ ] **Step 6: Replace AGENTS.md.** Replace the whole content of `AGENTS.md` with:
  ```markdown
  # Notes for coding agents

  Velo is a TanStack Start app (React 19, Vite, Nitro `node-server`) with Better
  Auth (Google sign-in) on PostgreSQL. It is being hardened for an open-source
  release. The plan of record is
  [`docs/superpowers/plans/2026-09-23-00-roadmap.md`](docs/superpowers/plans/2026-09-23-00-roadmap.md):
  read its Global Constraints and Shared Contract before changing code. Where this
  file and the roadmap disagree, the roadmap wins.

  ## How work is done

  - Every change follows a task in a plan under `docs/superpowers/plans/`: one
    task, one Conventional Commit, and a regression test written first and seen
    failing.
  - Gates before a commit: `npm run typecheck && npm run lint && npm test`. After
    a server change, also `npm run build && npm run test:http`.
  - `npm run dev` serves `http://localhost:8080` on loopback (`VELO_DEV_HOST` and
    `VELO_DEV_PORT` override it). Sign-in needs `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET`; without them it is unavailable and per-user features
    answer 401.
  - `npm start` runs the production build and refuses to boot without
    `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters),
    `VELO_PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
    (`src/lib/env.server.ts`).

  ## Invariants

  - Server code reads configuration through `serverEnv()` and logs only through
    `log` (`src/lib/log.server.ts`). Never log or return cookies, tokens or raw
    error messages.
  - Every server function that touches per-user data uses `authMiddleware` and
    scopes its queries by `context.userId`. There is no shared or fallback user.
  - Migrations in `migrations/` are forward-only: never edit an applied file, add
    the next numbered one.
  - The server never executes third-party JavaScript (no `eval`, `new Function`
    or `vm`).
  - Changes to auth, cookies, subprocesses, headers or crypto get an independent
    review before merge.
  ```

- [ ] **Step 7: Delete the files.** Run:
  ```bash
  git rm scripts/app-env-plugin.mjs scripts/with-app-env.mjs scripts/with-app-env.test.mjs \
    scripts/check-auth-invariant.mjs scripts/check-auth-invariant.test.mjs startup.sh .node_modules.lock
  ```
  Where the deleted tests' intent goes:
  - `with-app-env.test.mjs` and `check-auth-invariant.test.mjs` tested the wrapper and the invariant, which are deleted. They include the two skip-gated "auth off" tests (TEST-09) and the junction tests that created a junction into the checkout. The auth default they tried to assert is now a tested property: Task 2 (dev and production defaults) and Task 4 (Google only).
  - `projectRoot` and `isMainModule` keep a test in `project-root.test.mjs`.

- [ ] **Step 8: Run the tests and the gates.** Run:
  ```bash
  node --test scripts/package-contract.test.mjs scripts/project-root.test.mjs
  npm run typecheck && npm run lint && npm test
  npm run build && npm run test:http
  git grep -n -E "with-app-env|app-env-plugin|appEnvPlugin|__app-env|check-auth-invariant|check:auth|startup\.sh|node_modules\.lock|\.grok/|app-builder:|\[app-builder\]|Grok Build|/workspace" -- . ':!audit' ':!docs'
  git grep -n "0\.0\.0\.0" -- AGENTS.md
  ```
  Expected: tests pass; gates clean; `test:http` 0 failures. The first grep prints only the two `scripts/package-contract.test.mjs` assertion lines that name `check:auth`, `with-app-env` and `check-auth-invariant`. The second prints nothing.

- [ ] **Step 9: Commit**
  ```bash
  git add -A scripts package.json vite.config.ts .gitignore eslint.config.mjs .gitattributes AGENTS.md
  git status --short   # the git rm deletions are already staged
  git commit -m "chore!: remove the app-builder env wrapper, check:auth and sandbox files; replace AGENTS.md

  dev/build/preview run Vite directly; projectRoot/isMainModule move to
  scripts/project-root.mjs. AGENTS.md is now a short note that points agents to
  the hardening roadmap instead of the sandbox contract.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 9: Delete the platform connectors, the multiplayer module, the template auth-schema copy and the preview sign-out planner

**Executor:** velo-impl-sonnet-high
**Covers:** PRIV-17, ARCH-18 (connectors; also multiplayer and `sign-out-plan`), TEST-13 (connector tests), CLEAN-02 (`app-data`, `multiplayer`, `migrations/auth/`), ARCH-16 (`connectors.grok.me`)

These modules were checked before deletion:
- `src/lib/app-data/` calls `connectors.grok.me` with `GROK_CONNECTOR_ACCESS_TOKEN`. It serves only the platform, and nothing outside the folder imports it.
- `src/lib/multiplayer/` has no platform host, but nothing imports it. It polls `/api/rtc`, which never existed. CLEAN-02 lists it as template residue and PRIV-17 asks for its removal.
- `scripts/sign-out-plan.mjs` models the live-preview bearer sign-out and has no caller (ARCH-18).
- `migrations/auth/0001_auth.sql` is the template's never-applied "auth opt-in" copy.

**Files:**
- Delete: `src/lib/app-data/` (6 files), `src/lib/multiplayer/` (2 files), `migrations/auth/0001_auth.sql`, `scripts/sign-out-plan.mjs`, `scripts/sign-out-plan.test.mjs`
- Replace: `scripts/migration-plan.test.mjs`
- Modify: `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `src/lib/db.ts` (comments only)

- [ ] **Step 1: Verify nothing else imports the modules, and verify anchors.** Run:
  ```bash
  git grep -n "app-data\|multiplayer\|sign-out-plan\|migrations/auth" -- src scripts server tests vite.config.ts package.json | grep -v -E "^src/lib/(app-data|multiplayer)/|^scripts/sign-out-plan"
  git grep -c -F ' * Deploy-time database migrator (node-postgres, `pg`).' -- scripts/migrate.mjs
  git grep -c -F '  // files are tracked in _migrations. The glob does not descend, so the opt-in' -- src/lib/db.ts
  git grep -c -F ' * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:' -- scripts/migration-plan.mjs
  git grep -c -F ' * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.' -- scripts/migration-plan.mjs
  ```
  Expected: the first command prints only comment and test lines about `migrations/auth` in `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `scripts/migration-plan.test.mjs` and `src/lib/db.ts`. No import of `app-data`, `multiplayer` or `sign-out-plan` may appear. Every count prints `:1`. If any differ, STOP.

- [ ] **Step 2: Write the failing test.** Replace the whole content of `scripts/migration-plan.test.mjs` with the code below. The three removed tests checked the template's copy-on-opt-in mechanism for `migrations/auth/`, which is deleted in Step 4. The other cases are kept, and their fixture paths no longer name the deleted directory.
  ```js
  import assert from "node:assert/strict";
  import { readdirSync } from "node:fs";
  import { join } from "node:path";
  import { test } from "node:test";
  import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";
  import { projectRoot } from "./project-root.mjs";

  test("_migrations keys on basename, not path", () => {
    assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
    assert.equal(migrationName("migrations/sub/0001_auth.sql"), "0001_auth.sql");
    assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
  });

  test("a file already applied does not re-apply", () => {
    assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
  });

  test("pending migrations are returned in name order", () => {
    assert.deepEqual(
      pendingMigrations(
        ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
        ["0001_a.sql"],
      ),
      [
        { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
        { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
      ],
    );
  });

  test("non-.sql entries are dropped", () => {
    assert.equal(isMigrationFile("auth"), false);
    assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
  });

  test("migrations/ holds only numbered .sql files (no template copies in subdirectories)", () => {
    const entries = readdirSync(join(projectRoot(), "migrations"));
    assert.deepEqual(entries.filter((entry) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry)), []);
  });
  ```

- [ ] **Step 3: Run it and see it fail.** Run `node --test scripts/migration-plan.test.mjs`.
  Expected: FAIL on `migrations/ holds only numbered .sql files…`, with actual `[ 'auth' ]`.

- [ ] **Step 4: Delete the files and fix the comments.** Run:
  ```bash
  git rm -r src/lib/app-data src/lib/multiplayer migrations/auth
  git rm scripts/sign-out-plan.mjs scripts/sign-out-plan.test.mjs
  ```
  `app-data.test.ts` (TEST-13) and `sign-out-plan.test.mjs` tested only the deleted modules.
  1. In `scripts/migrate.mjs`, replace exactly
     ```
      * Deploy-time database migrator (node-postgres, `pg`).
      *
      * Runs during `npm run build` — on every Vercel deploy — applying pending files
      * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
      * recorded in a `_migrations` table, so it runs once and is safe to re-run.
      *
      * The read is non-recursive, so the opt-in auth schema under migrations/auth/
      * is not applied to an app that never asked for sign-in.
      *
      * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
      * the same files at startup instead (see src/lib/db.ts).
     ```
     with
     ```
      * Database migrator (node-postgres, `pg`). Runs as its own step
      * (`npm run db:migrate`), never inside `npm run build`, applying pending files
      * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
      * recorded in a `_migrations` table, so it runs once and is safe to re-run.
      *
      * No DATABASE_URL -> skip; the dev PGLite fallback applies the same files at
      * startup instead (see src/lib/db.ts).
     ```
  2. In `src/lib/db.ts`, replace exactly
     ```
       // files are tracked in _migrations. The glob does not descend, so the opt-in
       // auth schema under migrations/auth/ stays out. Runs once per module instance
     ```
     with
     ```
       // files are tracked in _migrations. The glob does not descend into
       // subdirectories. Runs once per module instance
     ```
  3. In `scripts/migration-plan.mjs`:
     - replace exactly
       ```
        * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
        * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
        *
        * Applied files are keyed by BASENAME, so the same file applies once no matter
        * which directory it is globbed from. That is what makes the auth schema safe to
        * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
        * a database that already has `0001_auth.sql` will not re-run it.
        *
        * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
        * out of scope for both until it is copied up.
       ```
       with
       ```
        * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
        * (`npm run db:migrate`, `readdir`) and `src/lib/db.ts` (dev PGLite,
        * `import.meta.glob`).
        *
        * Applied files are keyed by BASENAME and recorded in `_migrations`, so each
        * file applies exactly once. Neither applier descends into subdirectories.
       ```
     - replace ` * Non-\`.sql\` entries (a \`readdir\` also yields \`migrations/auth/\`) are dropped.` with ` * Non-\`.sql\` entries are dropped.`.

- [ ] **Step 5: Run the tests and the gates.** Run:
  ```bash
  node --test scripts/migration-plan.test.mjs
  npm run typecheck && npm run lint && npm test
  git grep -n -E "app-data|multiplayer|GROK_CONNECTOR|connectors\.|sign-out-plan|migrations/auth|VITE_STUN_URLS" -- src scripts server tests vite.config.ts package.json
  ```
  Expected: 5 tests pass; gates clean; the grep prints nothing.

- [ ] **Step 6: Commit**
  ```bash
  git add scripts/migrate.mjs scripts/migration-plan.mjs scripts/migration-plan.test.mjs src/lib/db.ts
  git status --short   # the git rm deletions are already staged
  git commit -m "chore: remove platform connectors, multiplayer module and template auth schema copy

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 10: Migration 0006 keeps only Google identities

**Executor:** velo-impl-opus-high
**Covers:** decision 10; W0 ledger "purge leftover `velo-link:*` verification rows and link-minted sessions" (now automatic on migrate); SEC-08 (password accounts); PRIV-08 (broker accounts)

**Files:**
- Create: `migrations/0006_google_only_auth.sql`, `scripts/google-only-auth-migration.test.mjs`

**Interfaces:**
- Consumes: `projectRoot` (Task 8), `isMigrationFile`, `migrations/0001`–`0005` (unchanged, never edited).
- Produces: a database where `account.providerId` is only `google`, and with no sessions, no verification rows, no users without an account, and no `youtube_vault` rows without a user.

- [ ] **Step 1: Verify the preconditions.** Run `ls migrations`.
  Expected exactly:
  ```
  0001_auth.sql
  0002_youtube_vault.sql
  0003_verification_value_idx.sql
  0004_user_proxies.sql
  0005_proxy_operations.sql
  ```
  Also run `git log --oneline -1 -- migrations/0001_auth.sql migrations/0002_youtube_vault.sql migrations/0003_verification_value_idx.sql migrations/0004_user_proxies.sql migrations/0005_proxy_operations.sql`. The applied files must not change in this task. If a `0006_*` already exists, STOP.

- [ ] **Step 2: Write the failing test.** Create `scripts/google-only-auth-migration.test.mjs`:
  ```js
  // 0006_google_only_auth.sql: only Google identities survive the removal of the
  // platform broker, gate identity and email/password (roadmap D4).
  import assert from "node:assert/strict";
  import { readdirSync, readFileSync } from "node:fs";
  import { join } from "node:path";
  import { test } from "node:test";
  import { PGlite } from "@electric-sql/pglite";
  import { isMigrationFile } from "./migration-plan.mjs";
  import { projectRoot } from "./project-root.mjs";

  const MIGRATION = "0006_google_only_auth.sql";
  const dir = join(projectRoot(), "migrations");
  const sql = (name) => readFileSync(join(dir, name), "utf8");

  async function databaseBefore() {
    const db = new PGlite();
    await db.waitReady;
    for (const name of readdirSync(dir).filter(isMigrationFile).sort()) {
      if (name >= MIGRATION) break;
      await db.exec(sql(name));
    }
    return db;
  }

  async function seed(db) {
    const users = ["google-only", "broker-only", "broker-and-google", "password-only", "gate-only"];
    for (const id of users) {
      await db.query(
        `insert into "user" (id, name, email, "emailVerified") values ($1, $1, $1 || '@example.test', false)`,
        [id],
      );
      await db.query(
        `insert into "session" (id, token, "userId", "expiresAt", "updatedAt") values ($1, $1, $1, now() + interval '1 day', now())`,
        [id],
      );
      await db.query(`insert into youtube_vault (user_id, cookies) values ($1, 'jar')`, [id]);
    }
    const accounts = [
      ["google-only", "google"],
      ["broker-only", "grok-google"],
      ["broker-and-google", "grok-x"],
      ["broker-and-google", "google"],
      ["password-only", "credential"],
      ["gate-only", "grok-gate"],
    ];
    for (const [userId, providerId] of accounts) {
      await db.query(
        `insert into "account" (id, "accountId", "providerId", "userId", "updatedAt") values ($1, $1, $2, $3, now())`,
        [`${userId}:${providerId}`, providerId, userId],
      );
    }
    await db.query(
      `insert into "verification" (id, identifier, value, "expiresAt") values ('v1', 'velo-link:x', 'x', now() + interval '1 hour')`,
    );
  }

  const ids = async (db, query) => (await db.query(query)).rows.map((row) => Object.values(row)[0]).sort();

  test("only Google identities survive; sessions, verifications and orphaned cookie jars go", async () => {
    const db = await databaseBefore();
    await seed(db);
    await db.exec(sql(MIGRATION));
    assert.deepEqual(await ids(db, `select id from "user"`), ["broker-and-google", "google-only"]);
    assert.deepEqual(await ids(db, `select distinct "providerId" from "account"`), ["google"]);
    assert.deepEqual(await ids(db, `select id from "session"`), []);
    assert.deepEqual(await ids(db, `select id from "verification"`), []);
    assert.deepEqual(await ids(db, `select user_id from youtube_vault`), ["broker-and-google", "google-only"]);
    await db.close();
  });

  test("the migration is a no-op on an empty database", async () => {
    const db = await databaseBefore();
    await db.exec(sql(MIGRATION));
    assert.deepEqual(await ids(db, `select id from "user"`), []);
    await db.close();
  });
  ```

- [ ] **Step 3: Run it and see it fail.** Run `node --test scripts/google-only-auth-migration.test.mjs`.
  Expected: FAIL, `ENOENT: no such file or directory, open '…migrations/0006_google_only_auth.sql'`.

- [ ] **Step 4: Write the migration.** Create `migrations/0006_google_only_auth.sql`:
  ```sql
  -- Google (Better Auth's `google` provider, the project's own OAuth client) is
  -- now the only sign-in method. Removed with it: the app-builder platform's
  -- broker (providers `grok-google`, `grok-x`), its gate identity (`grok-gate`)
  -- and email/password (`credential`).
  --
  -- No live account is migrated: broker and gate accounts only ever existed on
  -- preview deployments, and password accounts were never email-verified. So:
  --   - every session ends (the session cookie is also renamed to __Host-velo.*);
  --   - pending verification rows (OAuth state, spent sign-in links) are dropped;
  --   - accounts of the removed providers are deleted;
  --   - users left without a sign-in method are deleted, with the YouTube cookie
  --     jars stored under their ids (youtube_vault has no foreign key).
  -- No table becomes unused: `verification` holds Google OAuth state.
  delete from "session";
  delete from "verification";
  delete from "account" where "providerId" <> 'google';
  delete from "user" u where not exists (select 1 from "account" a where a."userId" = u."id");
  delete from youtube_vault v where not exists (select 1 from "user" u where u."id" = v.user_id);
  ```
  `0001_auth.sql` always precedes it: it lives in `migrations/`, not in the deleted opt-in copy. So `"user"`, `"account"`, `"session"`, `"verification"` and `youtube_vault` exist on every database this runs on. It needs no `to_regclass` guard.

- [ ] **Step 5: Run the tests and the gates.** Run:
  ```bash
  node --test scripts/google-only-auth-migration.test.mjs scripts/migration-plan.test.mjs
  npm run typecheck && npm run lint && npm test
  ```
  Expected: 2 + 5 tests pass, and the gates are clean. With a database:
  ```bash
  DATABASE_URL=… npm run db:migrate    # prints: applied 0006_google_only_auth.sql
  DATABASE_URL=… npm run db:migrate    # prints: up to date
  ```
  CI's `verify` job runs the same pair against Postgres 16.

- [ ] **Step 6: Commit**
  ```bash
  git add migrations/0006_google_only_auth.sql scripts/google-only-auth-migration.test.mjs
  git commit -m "feat(db): migration 0006 keeps only Google identities

  Ends every session, drops verification rows (OAuth state and spent sign-in
  links), deletes accounts of the removed providers, users left without one,
  and their orphaned youtube_vault rows. No live accounts to migrate: broker
  accounts were preview-only.

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 11: The platform-host gate

**Executor:** velo-impl-sonnet-high
**Covers:** the roadmap Global Constraint (Egress: no host containing `grok`, enforced in CI); ARCH-16 (verification); CLEAN-02 (last template comments); CLEAN-15 (`todos` example in `db.ts`)

**Files:**
- Create: `scripts/grok-host-policy.test.mjs`
- Modify: `src/lib/builder.server.ts`, `src/lib/download-pool.server.ts`, `src/lib/db.ts` (comments only)

**Interfaces:** none. `npm test` runs the policy test, as does CI's `unit (ubuntu-24.04)` and `unit (windows-2025)`.

- [ ] **Step 1: Verify anchors.** Run:
  ```bash
  git grep -c -F ' * Grok Builder media pipe: YouTube bytes never leave this origin.' -- src/lib/builder.server.ts
  git grep -c -F ' * Caps yt-dlp/ffmpeg so a Grok sandbox cannot OOM when many people Save at once.' -- src/lib/download-pool.server.ts
  git grep -c -F ' * Active backend: real **Neon** when `DATABASE_URL` is set (deployed / configured' -- src/lib/db.ts
  git grep -c -F 'select * from todos where id' -- src/lib/db.ts
  ```
  Expected: `:1`, `:1`, `:1`, `:2`. If any differ, STOP.

- [ ] **Step 2: Write the policy test.** Create `scripts/grok-host-policy.test.mjs`:
  ```js
  // Roadmap Global Constraint (Egress): after W2 no host containing "grok" — nor
  // the platform's staging domain — appears in src/, server/, scripts/,
  // packages/ or public/. Keep literal hosts out of this file too: the samples
  // below are assembled at runtime.
  import assert from "node:assert/strict";
  import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
  import { join } from "node:path";
  import { test } from "node:test";
  import { projectRoot } from "./project-root.mjs";

  const ROOTS = ["src", "server", "scripts", "packages", "public"];
  const TLD = "(?:com|me|net|org|io|ai|dev|app|co)";
  const FORBIDDEN = [
    new RegExp(`[a-z0-9-]*grok[a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}\\b`, "i"),
    new RegExp(`app-builder-testing\\.${TLD}\\b`, "i"),
  ];

  function forbiddenHost(text) {
    for (const pattern of FORBIDDEN) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  }

  test("the host patterns catch the platform's hosts and nothing Velo uses", () => {
    const g = "grok";
    const staging = ["app", "builder", "testing"].join("-");
    for (const host of [`${g}.com`, `auth.${g}.me`, `abc.${g}-sandbox.com`, `app-builder.${g}.com`, `gate.${staging}.com`]) {
      assert.ok(forbiddenHost(`fetch("https://${host}/x")`), host);
    }
    for (const text of ["www.youtube.com", "accounts.google.com", `"${g}-google" provider id`, `${g}-auth.session_token`, "ChatGPT / Claude / Grok"]) {
      assert.equal(forbiddenHost(text), null, text);
    }
  });

  test("no platform host in src/, server/, scripts/, packages/ or public/", () => {
    const hits = [];
    for (const root of ROOTS) {
      const dir = join(projectRoot(), root);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { recursive: true })) {
        const file = join(dir, String(entry));
        if (!statSync(file).isFile()) continue;
        const host = forbiddenHost(readFileSync(file, "utf8"));
        if (host) hits.push(`${join(root, String(entry))}: ${host}`);
      }
    }
    assert.deepEqual(hits, []);
  });
  ```
  The "ChatGPT / Claude / Grok" prompt-template copy in the transcript UI names the AI assistant, not a host, and it stays. `extension/` and `extensions/` still hold platform hosts. They are outside the roadmap's five roots, and W6 deletes them.

- [ ] **Step 3: Prove the gate is not vacuous.** Tasks 4–9 already removed every host, so it passes on this branch; check it against the pre-W2 tree. Run:
  ```bash
  node --test scripts/grok-host-policy.test.mjs
  git worktree add ../velo-w2-pre 79e3099
  cp scripts/grok-host-policy.test.mjs scripts/project-root.mjs ../velo-w2-pre/scripts/
  node --test ../velo-w2-pre/scripts/grok-host-policy.test.mjs
  git worktree remove --force ../velo-w2-pre
  ```
  Expected:
  - the first run passes both tests;
  - the pre-W2 run FAILs with 19 hits, starting with `'src\\lib\\builder-env.test.ts: grok.me'`, `'src\\lib\\builder-env.ts: grok.com'` and `'src\\lib\\guest-id.ts: grok.me'` (Windows separators). They include `src\\lib\\auth\\server.ts: grok-sandbox.com` and `src\\lib\\auth\\gate-identity.test.ts: app-builder-testing.com`;
  - the worktree is removed. It never had `node_modules` and holds no junction.

- [ ] **Step 4: Fix the last template comments.**
  1. In `src/lib/builder.server.ts`, replace exactly
     ```
      * Grok Builder media pipe: YouTube bytes never leave this origin.
      * The preview iframe cannot follow googlevideo.com (IP-bound, no download attr).
     ```
     with
     ```
      * Server media pipe: the browser gets YouTube media from this origin only,
      * because googlevideo.com URLs are bound to the server's IP.
     ```
  2. In `src/lib/download-pool.server.ts`, replace ` * Caps yt-dlp/ffmpeg so a Grok sandbox cannot OOM when many people Save at once.` with ` * Caps yt-dlp/ffmpeg so the server cannot run out of memory when many people Save at once.`.
  3. In `src/lib/db.ts`:
     - replace exactly
       ```
       /**
        * Active backend: real **Neon** when `DATABASE_URL` is set (deployed / configured
        * sandbox), otherwise a local embedded **PGLite** (Postgres compiled to WASM) so
        * the app has a working database even with nothing configured — the live preview
        * included. Swap in Neon later by just setting `DATABASE_URL`; no code changes.
        */
       ```
       with
       ```
       /**
        * Active backend: Postgres when `DATABASE_URL` is set (always, in production —
        * boot refuses to start without it), otherwise, in development only, an
        * embedded **PGLite** (Postgres compiled to WASM). The `"neon"` label is the
        * health check's historical name for the Postgres path.
        */
       ```
     - in the `Sql` interface comment, replace both occurrences of `select * from todos where id` with `select * from velo_proxy where id`.

- [ ] **Step 5: Run the tests and the gates.** Run:
  ```bash
  npm run typecheck && npm run lint && npm test
  git grep -n -i "grok" -- src server scripts public | grep -v -E "ChatGPT / (Claude / )?Grok|scripts/grok-host-policy.test.mjs|scripts/google-only-auth-migration.test.mjs|src/lib/auth-errors.test.ts"
  ```
  Expected: gates clean, and the grep prints nothing. The excluded lines are:
  - the product's AI-prompt copy;
  - this gate;
  - the migration test's provider ids (`grok-google`, `grok-x`, `grok-gate`);
  - the copy test's `Grok` negative match.

- [ ] **Step 6: Commit**
  ```bash
  git add scripts/grok-host-policy.test.mjs src/lib/builder.server.ts src/lib/download-pool.server.ts src/lib/db.ts
  git commit -m "test: forbid app-builder platform hosts in shipped source

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 12: `docs/architecture.md` matches the new auth and config

**Executor:** velo-impl-opus-medium
**Covers:** Copy rule for system docs (ARCH-05's "fix the comments/docs" and CLEAN-02 residue in docs). The broader §2/§5 rewrite stays with W7 (W1 hand-off).

**Files:**
- Modify: `docs/architecture.md` only

- [ ] **Step 1: Verify anchors.** Each of these must print `docs/architecture.md:1`:
  ```bash
  for a in 'The repo was scaffolded from the **Grok App Builder** template. Large parts of the platform glue' \
    'AGENTS.md                 Grok Build sandbox contract' 'startup.sh                Grok sandbox "revive" script' \
    'server/middleware/        Nitro global middleware' 'scripts/                  build/migrate/test/update tooling + Grok template helpers' \
    'public/                   static assets incl. __grok/ PWA icons' '| `/login` | `src/routes/login.tsx` | OAuth buttons (broker providers)' \
    '| document shell | `src/routes/__root.tsx` | `<PreviewHostBridge/>`' '| bearer token (framed/preview auth) |' \
    '| `/api/auth/$` | GET/POST | Better Auth |' 'Dev-server only (Vite `apply:"serve"` plugins, `vite.config.ts`): `/auth/popup` (OAuth popup for' \
    '`authMiddleware` (`src/lib/auth/middleware.ts`) = Fetch-Metadata same-site check' '| `session-isolation.ts` | `isolateOwnSession` | POST | `authMiddleware` |' \
    '`migrations/auth/0001_auth.sql` is a byte-identical template copy that is never applied.' '### 4.5 Auth modes' \
    '| Sign-up rate map |' '| Gate JWKS cache |' '| Preview auth secret / proxy key fallback |' \
    '`github.com` (yt-dlp EJS remote component), `auth.grok.me` (OAuth broker), `gate.grok.me` /' \
    '**`https://grok.com/grok-app-builder/extensions.js`** (injected on every HTML page by the PWA' '### 4.10 Multiplayer / P2P WebRTC module' \
    '| `BETTER_AUTH_URL` |' '| `VITE_AUTH_ENABLED` |' '| `GROK_AUTH_ISSUER` |' '| `GROK_PROJECT_ID` |' '| `GROK_GATE_ORIGIN` |' \
    '| `VITE_PUBLIC_HOSTNAME`' '| `VITE_STUN_URLS` |' '| `GROK_CONNECTORS_URL`' '| `BROWSER_ALLOW_EXTERNAL_HOST`' \
    '1. `/login` → email+password (`authClient.signUp.email`) or broker OAuth → `isolateOwnSession`.' \
    '`cookiesNeedSession` checks the session (cookie or bearer)' '| `BETTER_AUTH_SECRET` | `auth/server.ts:190`' '| `DATABASE_URL` | `db.ts`, `auth/server.ts`'; do
    git grep -c -F -- "$a" -- docs/architecture.md || echo "MISSING: $a"; done
  ```
  If any line prints `MISSING` or a count other than 1, STOP.

- [ ] **Step 2: Rewrite the sections.** Keep every other line as it is. The changes, by section:
  1. **§1, the last paragraph.** Replace the three lines starting `The repo was scaffolded from the **Grok App Builder** template.` with:
     > The repo was scaffolded from the **Grok App Builder** template. W2 removed its platform glue: the auth broker, gate identity, PWA/branding injector, preview bridge, dev-server plugins, sandbox scripts and connectors. The template-derived code that remains awaits licensing review (W9).
  2. **§2, repository map.**
     - `AGENTS.md` row → `AGENTS.md                 short note for coding agents (points to the hardening roadmap)`.
     - Delete the `startup.sh` row.
     - `server/middleware/` row → `server/plugins/           Nitro plugin env.ts: forces NODE_ENV=production and validates the config before the server listens`.
     - `scripts/` row → `scripts/                  migrate/test/update tooling and repository policy tests`.
     - `public/` row → `public/                   static assets (favicon; the velo-session extension zip + unpacked copy were removed in W0-T3)`.
  3. **§3.1 routes.**
     - `/login` row → ``| `/login` | `src/routes/login.tsx` | "Continue with Google" (Better Auth social sign-in, full-page redirect); "Sign-in is not set up" when the Google credentials are absent (development only); OAuth failures arrive as `?error=<code>`. |``.
     - Document-shell row → ``| document shell | `src/routes/__root.tsx` | `<AuthProvider>` (sonner toaster), favicon and stylesheet links. |``.
  4. **§3.3 client state.** Delete the `bearer token (framed/preview auth)` row. In §3.4, in the `**Hybrid race** (escalation)` row, delete the sentence `Relay leg is skipped inside Grok previews.`: Task 7 removed that skip.
  5. **§4.1 HTTP routes.**
     - `/api/auth/$` row → ``| `/api/auth/$` | GET/POST | Better Auth | Better Auth's built-in production limiter: `/sign-in/*` 3 per 10 s per client IP, in memory, IP from `X-Forwarded-For` (W5 sets the trusted IP source) | Better Auth handler: Google sign-in (`/sign-in/social`, `/callback/google`), `get-session`, `sign-out` |``.
     - Replace the `Dev-server only (Vite …` paragraph, all four lines through `(server/middleware/grok-pwa.ts).`, with:
       > The dev server adds no routes. The production build boots through `server/plugins/env.ts`, which sets `NODE_ENV=production` and exits non-zero when `loadServerEnv()` (`src/lib/env.server.ts`) reports missing or invalid configuration.
  6. **§4.2 server functions.**
     - Replace the four-line `authMiddleware (…) = Fetch-Metadata same-site check …` paragraph with:
       > `authMiddleware` (`src/lib/auth/middleware.ts`) = Fetch-Metadata same-site check (`isolation.server.ts`) + `requireUserId` (`verify.server.ts`): the verified user of the `__Host-velo.session_token` cookie, else `UnauthorizedError` (401). There is no shared or fallback user in any environment.
     - Replace the `session-isolation.ts` row with ``| `session-isolation.ts` | removed in W2 — its one-login policy runs in Better Auth's session hooks (`auth-config.server.ts`) | — | — |``.
     - After the `proxyManagementGate …` sentence (it ends `auth on → operator gate.`), append this sentence:
       > Since W2 the "auth not configured" branches of both gates are unreachable: `authMiddleware` answers 401 first when Google is not configured. W4a removes them with the runtime installer.
  7. **§4.4 data stores and migrations.**
     - After the `0005_proxy_operations.sql` item, add `` `0006_google_only_auth.sql` `` (W2: ends every session, drops verification rows, deletes accounts of the removed providers, users left without one and their `youtube_vault` rows).
     - Delete the sentence `` `migrations/auth/0001_auth.sql` is a byte-identical template copy that is never applied. ``.
  8. **§4.5 auth modes.** Replace the whole table, from the header row through the `**Sign-in link**` row, with:
     ```markdown
     | Mode | Condition | Behaviour |
     |---|---|---|
     | **Google (production)** | always: boot requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Better Auth `google` social provider, `baseURL = VELO_PUBLIC_ORIGIN`, redirect URI `${VELO_PUBLIC_ORIGIN}/api/auth/callback/google`, `prompt=select_account`; `trustedOrigins = [VELO_PUBLIC_ORIGIN]`. Cookies `__Host-velo.*` (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain), 5-min `session_data` cookie cache. Sessions store no IP or user agent, and a new sign-in ends the user's other sessions. OAuth errors redirect to `/login?error=<code>`. Config: `src/lib/auth/auth-config.server.ts`. |
     | **Google (development)** | `GOOGLE_*` set | as above on `http://localhost:${VELO_DEV_PORT ‖ 8080}`; `trustedOrigins` adds the `localhost` and `127.0.0.1` dev origins; the secret is a random per-process value unless `BETTER_AUTH_SECRET` is set. |
     | **Sign-in unavailable (development)** | `GOOGLE_*` unset | no provider; `/login` says sign-in is not set up; every `authMiddleware` function answers 401. |

     Removed in W2: the app-builder broker (`genericOAuth`), gate identity JWT, `bearer()` plugin, preview popup and email/password. Removed in W0: the committed preview client and the sign-in link.
     ```
  9. **§4.6 in-process state.**
     - Delete the `Sign-up rate map` and `Gate JWKS cache` rows.
     - Replace the `Preview auth secret / proxy key fallback` row with ``| Dev auth secret (dev only) / proxy key fallback | `env.server.ts`, `vault-crypto.ts` | random per process when unset outside production; W3 moves the proxy key to `VELO_PROXY_SECRET_KEY` |``.
     - Add the row ``| Better Auth rate-limit counters | `better-auth` (memory) | per process |``.
  10. **§4.8 external services.**
      - In the server list, replace ``, `auth.grok.me` (OAuth broker), `gate.grok.me` /`` through ``(only in dead `app-data` code),`` with ``, `oauth2.googleapis.com` and `www.googleapis.com/oauth2/v3/certs` (Google sign-in token exchange and ID-token keys),``.
      - In the browser list, replace ``**`https://grok.com/grok-app-builder/extensions.js`** (injected on every HTML page by the PWA`` through ``(only in the unused multiplayer module).`` with `` `accounts.google.com` (Google sign-in). ``.
  11. **§4.10.** Replace the heading and its paragraph with:
      ```markdown
      ### 4.10 Multiplayer / P2P WebRTC module

      Deleted in W2 (template residue: nothing imported it and `/api/rtc` never existed).
      ```
  12. **§5 build and deploy.** In the first bullet, replace
      ```
      - `npm run build` → `scripts/with-app-env.mjs` (merges `VITE_*` keys from `.grok/app-env.json`
        — the file does not exist in this repo) → `vite build` → Nitro `vercel` preset →
      ```
      with `- \`npm run build\` → \`vite build\` → Nitro \`vercel\` preset →`. W7 corrects the rest of that bullet, where the preset is stale since W1. In the Vite plugins bullet, delete ``, `authPopupPlugin` (dev), `appEnvPlugin` (dev), `grokPwaPlugin` (all: manifest, install page,`` and the continuation ``  head injection, `virtual:grok-og-identity`)``, so that it lists `pgliteBootstrapPlugin` (dev), tailwind, `tanstackStart`, nitro and React. The rest of §5 is W7's.
  13. **§6 environment variables.**
      - `DATABASE_URL` row → ``| `DATABASE_URL` | `env.server.ts`, `db.ts`, `auth/server.ts`, `user-proxy-repository-db.server.ts`, `scripts/migrate.mjs` | **yes in production (boot exits without it)** | dev: in-memory PGLite | yes |``.
      - `BETTER_AUTH_SECRET` row → ``| `BETTER_AUTH_SECRET` | `env.server.ts` → `auth-config.server.ts`; `vault-crypto.ts` (proxy key fallback until W3) | **yes in production, ≥ 32 chars** | dev: random per process | yes |``.
      - Replace the `BETTER_AUTH_URL`, `VITE_AUTH_ENABLED`, `GROK_AUTH_ISSUER`, `GROK_AUTH_CLIENT_ID / GROK_AUTH_CLIENT_SECRET`, `GROK_PROJECT_ID` and `GROK_GATE_ORIGIN` rows with these four:
        ```markdown
        | `VELO_PUBLIC_ORIGIN` | `env.server.ts` → Better Auth `baseURL` / `trustedOrigins` (C9) | **yes in production**: a bare `https://` origin (`http://` only on loopback) | dev: `http://localhost:${VELO_DEV_PORT ‖ 8080}` | no |
        | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `env.server.ts` → `auth-config.server.ts` | **yes in production** | dev: unset → sign-in unavailable | secret: yes |
        | `BETTER_AUTH_TRUSTED_ORIGINS` / `BETTER_AUTH_SECRETS` | read by Better Auth itself | **must be unset in production** (boot refuses) | — | — |
        | `VELO_DEV_PORT` / `VELO_DEV_HOST` | `vite.config.ts`, `env.server.ts` (`devOrigin`) | no | `8080` / `127.0.0.1` | no |
        ```
      - Delete the `VITE_PUBLIC_HOSTNAME…`, `VITE_STUN_URLS`, `GROK_CONNECTORS_URL…` and `BROWSER_ALLOW_EXTERNAL_HOST…` rows.
      - In the `NODE_ENV` row, replace `` `vault-crypto.ts`, `proxy-fetch.server.ts`, `proxy-transport.server.ts`, `app-data` `` with `` `env.server.ts`, `vault-crypto.ts`, `proxy-fetch.server.ts`, `proxy-transport.server.ts` ``, and its default column `—` with `forced to production by the built server`.
  14. **§7.2.**
      - Step 1 → ``1. `/login` → "Continue with Google" → Google → `/api/auth/callback/google` → `/` (the session hooks end the user's other sessions).``.
      - In step 3, replace `` `cookiesNeedSession` checks the session (cookie or bearer)`` with `` `cookiesNeedSession` checks the session cookie``.

- [ ] **Step 3: Verify.** Run:
  ```bash
  grep -n -i "grok" docs/architecture.md
  grep -n -E "VITE_AUTH_ENABLED|dev-user|DEV_USER|email\+password|genericOAuth \(|bearer token|__Host-grok|/auth/popup|isolateOwnSession\b.*POST|app-env|check-auth" docs/architecture.md
  npm test
  ```
  Expected:
  - The first grep prints only the §1 history sentence and the §4.9 extension lines. The extensions still hold platform hosts until W6, and the doc describes them truthfully.
  - The second grep prints nothing. The "Removed in W2 …" sentence says `bearer()` and `email/password`, which neither pattern matches.
  - `npm test` 0 failures.

- [ ] **Step 4: Commit**
  ```bash
  git add docs/architecture.md
  git commit -m "docs(architecture): describe Google-only auth, the boot config check and the template removal

  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 13: [OWNER] Create the Google OAuth client and set the production environment

**Executor:** repository owner (agents prepare, never perform)
**Covers:** PRIV-08 (first-party client), SEC-03 / REPO-02 (own client replaces the platform's), M-08 (production env)

Only the owner can do this: it needs a Google Cloud account, the production domain and the secret store. Nothing here goes into the repository.

- [ ] **Google Cloud project.** Go to https://console.cloud.google.com/ and create or select a project named `Velo`.
- [ ] **Branding (consent screen).** Go to *Google Auth Platform → Branding* (older consoles: *APIs & Services → OAuth consent screen*):
  - App name: `Velo`;
  - User support email and developer contact email: yours;
  - App domain / home page: `https://<your domain>`, the exact value of `VELO_PUBLIC_ORIGIN`;
  - Privacy policy and terms: `https://<your domain>/privacy` and `/terms`. W8 publishes those pages, and W9 supplies the text. Until then, leave the app in *Testing* (next step);
  - Authorized domains: the registrable domain of `VELO_PUBLIC_ORIGIN`, for example `velo.example`.
- [ ] **Audience.**
  - User type: *External*.
  - Publishing status: keep *Testing* and add the test users' Google accounts until the privacy policy is live, then press *Publish app*.
  - Only the non-sensitive scopes are used, so Google needs brand verification, not a security review.
- [ ] **Data access (scopes).** Add exactly `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. These are what Better Auth's Google provider requests (`openid email profile`).
- [ ] **Production client.** Go to *Clients → Create client*:
  - Application type: *Web application*;
  - Name: `Velo production`;
  - Authorized JavaScript origins: none needed (sign-in is a server redirect);
  - Authorized redirect URIs: exactly `${VELO_PUBLIC_ORIGIN}/api/auth/callback/google`, for example `https://velo.example/api/auth/callback/google`, with no trailing slash;
  - Save. Copy the *Client ID* and *Client secret* straight into the secret store, never into chat, issues or a file in the repo.
- [ ] **Local development client.** Create a second Web client, `Velo local dev`:
  - Authorized redirect URI: `http://localhost:8080/api/auth/callback/google`. Add `http://localhost:<port>/api/auth/callback/google` for each `VELO_DEV_PORT` you use.
  - Open the dev app at `http://localhost:<port>`, not `127.0.0.1`: the OAuth state cookie is per host.
  - Keep its secret on your machine only (`GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm run dev`). A separate client keeps the production secret off laptops.
- [ ] **Production environment.** Set these in the host's secret store:
  - `DATABASE_URL=postgres://…`, the production Postgres;
  - `BETTER_AUTH_SECRET`, generated once with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. That gives 64 hex characters, and at least 32 are required. Rotating it signs everyone out;
  - `VELO_PUBLIC_ORIGIN=https://<your domain>`: no path and no trailing slash;
  - `GOOGLE_CLIENT_ID=<production client id>` and `GOOGLE_CLIENT_SECRET=<production client secret>`.

  With Fly.io (the D1 reference target; W5 writes `fly.toml`), run `fly secrets set DATABASE_URL=… BETTER_AUTH_SECRET=… GOOGLE_CLIENT_SECRET=…` for the secrets. `VELO_PUBLIC_ORIGIN` and `GOOGLE_CLIENT_ID` are not secret; put them in `[env]`.
- [ ] **Remove obsolete variables** from every deployment and CI secret store:
  - remove `GROK_AUTH_ISSUER`, `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `GROK_PROJECT_ID`, `GROK_GATE_ORIGIN`, `GROK_CONNECTORS_URL`, `GROK_CONNECTOR_ACCESS_TOKEN`, `VITE_AUTH_ENABLED`, `VITE_PROJECT_ID`, `VITE_PUBLIC_HOSTNAME`, `VITE_OG_SERVICE_URL` and `BETTER_AUTH_URL`;
  - `BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_SECRETS` must be absent, or boot refuses.
- [ ] **Roll out, then migrate.** Migrations are backward-compatible and run as a separate, approved step *before* the new code serves. This release is the exception: `0006` is data-only, so run it right *after* the W2 code is live, so the old code cannot recreate broker rows in the gap. Deploy the W2 release first, then run `DATABASE_URL=… npm run db:migrate` against production. It prints `applied 0006_google_only_auth.sql`, which signs everyone out and deletes platform-brokered accounts.
- [ ] **Verify.**
  - `curl -s https://<domain>/api/health?deep=1` returns `"status":"ok"`.
  - `/login` shows *Continue with Google*. The Google chooser names *Velo*. After sign-in you land on `/`, signed in.
  - In the browser dev tools, the cookies are `__Host-velo.session_token` and `__Host-velo.session_data`, both *Secure* and *HttpOnly*, `SameSite=Lax`, with no Domain.
  - A deploy with one variable removed exits at boot, and its log names that variable.

---

## Audit coverage

Every owned ID. "Covered" means fixed by the named task, with its test.

| Audit ID | Resolution |
|---|---|
| REPO-02 | W0-T2 removed the secret. Task 4 removed all platform-client code, so there is nothing left that could fall back to any shared client, pinned by `removed-auth.test.ts`. Task 13 moves production to its own client. Rotation: W0-T6 [OWNER]. The history rewrite is optional hygiene: **DEFERRED — owner decision** (see W0-T6 and `audit/02` recommended fix 3) |
| SEC-03 | Task 4 (no broker client at all); Task 3 (boot refuses without the project's own Google client) |
| GH-01 (code side) | Task 4 (the `server.ts` fallback path is gone with the broker). The GitHub-side settings: W0-T6 / W1-T10 [OWNER] |
| ARCH-04 | Tasks 2–3 (`BETTER_AUTH_SECRET` required, ≥ 32 chars, and boot exits; no random secret in production, even with `NODE_ENV` unset). Proxy key decoupling from `BETTER_AUTH_SECRET`: **Hand-off W3** (it owns `vault-crypto.ts`; C1 names `VELO_PROXY_SECRET_KEY`) |
| ARCH-05 | Task 2 (explicit config), Task 4 (no preview client, no email/password, Google only), Task 5 (no `VITE_AUTH_ENABLED`), Task 8 (no `.grok/app-env.json`), Task 12 (docs) |
| ARCH-15 | Task 4/5 (popup and its dev-only route removed; framed sign-in is a normal redirect). The sign-in link is W0-T4. `proxyManagementDecision` "everyone when auth off + no DB" is unreachable after Task 4, because `authMiddleware` answers 401 first; the dead branch is deleted with the runtime installer: **Hand-off W4a**. `?auto=1`: **Hand-off W8** (UX; user gesture). `YTDLP_BROWSER`: **Hand-off W4a** (server hardening). Extension defaults: **Hand-off W6** |
| ARCH-16 | Tasks 4, 5, 7, 9 (all platform hosts in `src/`, `server/`, `scripts/`, `public/`), Task 11 (CI gate). The extensions' manifests and popups: **Hand-off W6** |
| INST-01 | Task 4 (no preview client and nothing to fall back to), Task 5 (no client flag), Task 8 (no app-env wrapper); Task 3/2 (fresh clone: dev has explicit defaults, sign-in off until Google is set) |
| WEB-09 | W0-T2 (secret removed), Task 4 (no platform client compiled into the bundle), Task 7 (branding test on the built output) |
| WEB-12 | Tasks 2 and 4 (`trustedOrigins` = `VELO_PUBLIC_ORIGIN`, plus the dev port outside production; verified on port 8097), Task 6 (product copy, never "Better Auth"). Better Auth's rate-limit IP source (`advanced.ipAddress.ipAddressHeaders`): **Hand-off W5** (C8 decides which header is trustworthy) |
| SEC-06 | Task 4 (no `dev-user` in any environment; per-user functions answer 401 without a session), Task 5 (no client `DEV_USER`); `removed-auth.test.ts` |
| SEC-08 | Task 4 (email/password disabled; HTTP test: sign-up and sign-in 400), Task 6 (no password UI), Task 10 (password accounts deleted) |
| PRIV-07 | Task 4/5 (no shared dev user, so no shared vault row can be read); the vault itself is removed in W3 |
| PRIV-08 | Task 4 (no broker, no gate JWT), Task 10 (broker and gate accounts deleted), Task 13 (first-party client). Disclosure of Google as the identity provider in the privacy policy: **Hand-off W8/W9** |
| PRIV-05 | Task 7 (injector deleted; `branding.test.mjs`). CSP: **Hand-off W4a** |
| WEB-03 | Task 7. CSP / SRI policy for any future third-party script: **Hand-off W4a** |
| ARCH-06 | Task 7 |
| SUP-02 | Task 7. The extension `postMessage` channel it also mentions: **Hand-off W6** |
| PRIV-11 | Task 4 (`gate-session.server.ts` with its `cookiePreview` log deleted; `bearer()` removed, and the HTTP test shows a bearer token and an unsigned cookie are ignored) |
| PRIV-17 | Task 9 (`app-data` and `multiplayer` deleted) |
| TEST-09 | Task 8 (the skip-gated auth-default tests go with the wrapper); the default is now asserted without skips by Task 2 (dev and production env) and Task 4 (Google only, no dev user). `npm test` reports 0 skipped in `scripts/` |
| TEST-10 | Task 8 (`check:auth`, its script and its test deleted) |
| TEST-12 | Task 4 (gate code and `gate-identity.test.ts` deleted; the replacement session behaviour is tested in `auth-config.server.test.ts` and `auth.test.mjs`) |
| TEST-13 | Task 9 (connectors part). `ipv4-bind.test.ts` global TLS disable: **Hand-off W4b** (W1 deferral stands) |
| OSS-04 | Task 8 (AGENTS.md replaced by a short, accurate contributor-agent note). Full CONTRIBUTING: **Hand-off W7** |
| CLEAN-02 (template parts) | Tasks 4, 5, 7, 8, 9, 11. Package name `app-builder-workspace`: **Hand-off W7** (M-33, W1 hand-off) |
| CLEAN-12 | Task 4 (loopback origins only outside production; HTTP test), Task 7 (`/workspace` QA tooling deleted), Task 8 (`startup.sh`). Extension `127.0.0.1:8080` defaults: **Hand-off W6** |
| CLEAN-15 | Tasks 4/5 (auth comments, "skill" references, `Dev User` placeholder), Task 11 (`db.ts` `todos` example). The `migrations/0001_auth.sql` header comment ("Sign in with Grok", skills) stays: applied migrations are immutable (**accepted — forward-only rule**) |
| LIC-03 / REPO-05 | Tasks 7–9 (Grok logo and install art, branding injector, `install-page.html`, AGENTS.md, broker code and connectors removed). Licensing sign-off on the remaining template-derived code: **W9** (counsel) |
| ARCH-18 (connectors part) | Task 9 (also `multiplayer` and `sign-out-plan`). `/api/download`, `listUserProxies` and `testUserProxy`: **Hand-off W4a/W7** |
| M-08 (auth and config parts) | Tasks 2–4 (matrix test: each missing variable → non-zero exit). `VELO_VAULT_KEY`: **W3**; health-on-PGLite in production: done by W1 |
| M-16 | Task 4 (email/password disabled, which the audit's fix allows as an alternative to verification). The shared throttle: **W5** (C8) |

Ledger and hand-off items (W0 and W1 → W2):

| Item | Resolution |
|---|---|
| W1 hand-off: delete the two `W2` `no-console` ignores | Task 4 |
| W1 T3 minor: `no-console` glob misses server-only files without `.server` | Task 4 (glob lists `auth/server.ts`, `db.ts`, `server/**`); `vault-crypto.ts`: **Hand-off W3** |
| W1 hand-off: remove `VITE_AUTH_ENABLED` from the HTTP tests | Tasks 3–4 |
| W1 hand-off: flip health's no-DB block to boot refusal; `api-guards`/`harness` env | Task 3 |
| W1 hand-off: delete `check:auth`, its script and test; the gate tests; the connector tests; `with-app-env.mjs` | Tasks 8, 4, 9, 8 |
| W1 hand-off: move `projectRoot`/`isMainModule` first | Task 8 |
| W1 hand-off: delete `startup.sh` (0.0.0.0) | Task 8 |
| W1 hand-off / final review: boot hook before listen, proven by `startServer` rejecting | Task 3 |
| W1 contract change request: C1 dev origin follows `VELO_DEV_PORT` | Task 1 |
| W1 T1 minor: `trustedOrigins` hard-code `:8080` | Task 4 (verified on port 8097, Task 5 Step 10) |
| W1 T1 minor: stale `.vercel` refs in eslint ignores/.gitignore | **Kept deliberately — Hand-off W7** (see § Decisions applied) |
| W1 T1 minor: 0.0.0.0 in AGENTS.md/startup.sh | Task 8 |
| W1 T1 minor: non-numeric `VELO_DEV_PORT` falls back to 8080 | Kept consistent: `devOrigin` uses the same expression as `vite.config.ts`, so auth and the dev server never disagree. Not changed |
| W0 T2 minor: stale "baked preview client" comments (`verify.server.ts`, `use-current-user.ts`) | Tasks 4, 5 (both files rewritten) |
| W0 T2 minor: production throw surfaces lazily via `AppErrorComponent` | Task 3 (boot-time exit; the per-request policy is deleted in Task 4) |
| W0 T4 minor: purge `velo-link:*` verification rows and link-minted sessions | Task 10 (0006 deletes every session and verification row on migrate); owner step in Task 13 |
| W0 final minors 5–7: lazy prod failure, `verify.server.ts` messages, dead OAuth buttons in dev | Tasks 3, 4, 6 |
| W0 final minor 8: source-text wiring test → real behaviour | Task 3 (the HTTP boot matrix replaces `server.ts enforces the production boot policy`) |

## Hand-off

- **W3:**
  - Move the proxy key in `vault-crypto.ts` to `serverEnv().VELO_PROXY_SECRET_KEY` (and `_PREVIOUS`). Decide whether it is required in production, since C1 says "when user proxies are enabled". Stop falling back to `BETTER_AUTH_SECRET` (ARCH-04 remainder).
  - Once `encryptCookies` and its `console.warn` are deleted with the vault, add `src/lib/vault-crypto.ts` to the `no-console` glob in `eslint.config.mjs`, or rename it `.server.ts`.
  - `youtube_vault` rows of deleted users are already gone (0006). The table itself goes in W3.
- **W4a:**
  - CSP and security headers. Nothing third-party remains to allow; keep it that way (PRIV-05/WEB-03 remainder).
  - Delete the unreachable "auth not configured" branches of `operatorDecision` and `proxyManagementDecision` (`tool-versions.ts`) together with `tool-updates` (runtime installs).
  - `YTDLP_BROWSER` (ARCH-15).
  - `/api/download`, `listUserProxies`, `testUserProxy` (ARCH-18 remainder, or W7).
  - `pythonBin()` still reads `VELO_PYTHON`/`PYTHON_BIN`, while C1 names `YTDLP_PYTHON`: migrate the reader to `serverEnv().YTDLP_PYTHON`, or amend C1.
  - `requireSameOrigin` HTTP tests can boot with `tests/http/env.mjs` (`PROD_ENV`, `TEST_ORIGIN`). A request whose `Origin` must equal `VELO_PUBLIC_ORIGIN` uses `TEST_ORIGIN`.
  - `requireSameOrigin` must exempt `/api/auth/*`: Google's OAuth callback arrives as a cross-site top-level GET; Better Auth's own origin and state checks cover that route.
  - Behavioural HTTP tests: a per-user endpoint answers 401 without a session and 403 for `Sec-Fetch-Site: same-site` (SEC-06). W8 owns them if W4a ships without them.
- **W3 / W4a / W5 (C1 readers):** these server modules still read `process.env` directly instead of `serverEnv()`. Each moves to `serverEnv()` in the workstream that rewrites it:
  - `vault-crypto.ts` (`VELO_VAULT_KEY[_PREVIOUS]`, `BETTER_AUTH_SECRET`, `NODE_ENV`) → W3, above;
  - `tool-updates.ts` and `operator-gate.server.ts` (`VELO_ADMIN_EMAILS`, `VELO_ALLOW_TOOL_INSTALL`, `DATABASE_URL`) → W4a, with the runtime installs;
  - `ytdlp-auth.ts` (`YTDLP_BROWSER`, and `pythonBin()` reading `VELO_PYTHON`/`PYTHON_BIN`) → W4a, above;
  - `socks-pool.server.ts` (`VELO_SOCKS_PROXY`/`ALL_PROXY`) → W4a, replaced by `VELO_EGRESS_PROXY`;
  - `guest-limit.server.ts` (`TRUST_CLOUDFLARE`) → W5 (C8, `VELO_TRUST_PROXY`);
  - `log.server.ts` (`LOG_LEVEL`), `db.ts` and `user-proxy-repository-db.server.ts` (`DATABASE_URL`) → W5. `log.server.ts` must not call `serverEnv()` at import: anything that runs before the boot plugin would memoise the development defaults;
  - `NODE_ENV`-only test-override guards in `proxy-fetch.server.ts` and `proxy-transport.server.ts` → whichever of W4a/W5 touches them. `tool-updates.server.ts` spreads `process.env` into a child process; that goes with the runtime installs (W4a), not into `serverEnv()`.
- **W4b:** no new work. Anchor note: W2-T7 removed the `builderFirst` branch in `src/lib/hybrid-download.ts`, around the POT minting W4b deletes.
- **W5:**
  - Better Auth's built-in rate limiter (active in production) reads the client IP from `X-Forwarded-For` by default. Without a proxy that is spoofable. Behind a proxy that appends, it collapses to one shared bucket.
    - Set `advanced.ipAddress.ipAddressHeaders` in `auth-config.server.ts` from `VELO_TRUST_PROXY` (C8), for example `["fly-client-ip"]` for `fly`.
    - Update `tests/http/auth.test.mjs`, whose `X-Forwarded-For` rotation depends on the default.
    - This covers WEB-12's rate-limit part and relates to SEC-09.
  - Route Better Auth's logger through `log` (C4).
  - The container sets `NODE_ENV=production`; the plugin forces it anyway.
  - Migration order in the deploy runbook: migrations are backward-compatible and run as a separate, approved step *before* the new code serves. This release is the exception: `0006` is data-only, so run it right *after* the W2 code is live, so the old code cannot recreate broker rows in the gap. (Task 13).
- **W6:**
  - `extension/` and `extensions/` still contain platform hosts (`*.grok-sandbox.com`, `*.grok.com`, `grok.me`), outside the Task 11 gate's roots. W6 deletes them.
  - `packages/extension/` is already inside the gate.
- **W7:**
  - README env documentation: `VELO_PUBLIC_ORIGIN`, `GOOGLE_*`, `BETTER_AUTH_SECRET`, the local dev client (Task 13), and optionally `.env.example`.
  - Rename the package from `app-builder-workspace` (CLEAN-02).
  - Remove `.vercel` from `.gitignore` and eslint ignores at release.
  - The rest of `docs/architecture.md` §2/§5 (W1 hand-off).
  - Drop the `playwright` devDependency if W8 uses `@playwright/test` only; `browser-smoke` was its last user.
  - `isMainModule` has no caller after W2 (moved per the controller's decision): delete it if still unused.
  - The `dbSource` label `"neon"` (health API field, so a contract decision).
  - Full CONTRIBUTING (OSS-04).
- **W8:**
  - The privacy policy names Google as the identity provider and lists the session data kept: no IP or user agent (PRIV-08).
  - `?auto=1` drive-by download (ARCH-15).
  - A real PWA manifest and touch icon if wanted: the platform ones are gone.
  - Visual and a11y polish of `/login`.
  - Behavioural HTTP tests: a per-user endpoint answers 401 without a session and 403 for `Sec-Fetch-Site: same-site` (SEC-06), if W4a has not added them.
  - PRIV-13: per-user history (`u:<userId>` keys) stays in localStorage after sign-out.
- **W9:** legal sign-off on the template-derived code that remains (LIC-03/REPO-05); the optional history-rewrite decision (REPO-02).
- **Every later HTTP test:** boot with `tests/http/env.mjs`, using `PROD_ENV` plus `NO_DB_URL` when no database is needed, or `dbEnv()` with `{ skip: NEEDS_DB }`. The built server refuses any other production boot.
- **Files W2 touches outside its obvious ownership** (minimal, listed for the reviewer):
  - `README.md`: 3 lines, Task 7;
  - `src/lib/hybrid-download.ts`, `src/lib/builder-save.ts`: platform-host branches, Task 7;
  - `src/lib/db.ts`: `log` plus comments, Tasks 4, 9 and 11;
  - `src/lib/builder.server.ts`, `src/lib/download-pool.server.ts`: comments, Task 11;
  - `scripts/migrate.mjs`, `scripts/migration-plan.mjs`: comments, Task 9;
  - `docs/superpowers/plans/2026-09-23-00-roadmap.md`: C1, Task 1;
  - `docs/architecture.md`: Task 12.

## Self-review

1. **Spec coverage.** Each decision maps to a task:
   - decision 1 (own OAuth; `baseURL`; `trustedOrigins` plus dev origin) → Task 4;
   - decision 2 (no email/password) → Tasks 4, 6 and 10;
   - decision 3 (delete lists) → Tasks 4, 5, 7, 8 and 9. `app-data` and `multiplayer` were verified first (Task 9 preamble), and `projectRoot`/`isMainModule` are moved before the wrapper goes (Task 8 Step 4);
   - decision 4 (C1 CCR first, own commit; fields; the required five; names only) → Tasks 1–2;
   - decision 5 (boot hook) → Task 3. Verified in a scratch build: exit 1 before listening. The HTTP tests reject with the `EnvError` output, and the W0 `auth-boot-policy` is deleted in Task 4 with its intent kept;
   - decision 6 → Tasks 4–5 (read as "deleted outright", § Decisions applied);
   - decision 7 → Task 3 (`tests/http/env.mjs`, `NEEDS_DB` skip, CI never skips; the `VITE_AUTH_ENABLED` removal is in Task 4);
   - decision 8 → Task 4;
   - decision 9 (cookies, Fetch-Metadata kept; no `trustedProviders`, since a trusted provider skips Better Auth's `emailVerified` check on link — final-review ruling) → Task 4;
   - decision 10 → Task 10;
   - AGENTS.md note → Task 8;
   - Grok-host gate → Task 11;
   - [OWNER] → Task 13.

   Every audit ID and every ledger line appears in § Audit coverage.
2. **Placeholder scan.** There is no TBD, TODO or "similar to". The only `<…>` values are owner-supplied (domain, client id and secret, a pid to kill), and the test-failure expectations quote real messages.
3. **Type consistency.**
   - `loadServerEnv`/`serverEnv`/`devOrigin`/`EnvError` (Task 2) are used unchanged in Tasks 3–4.
   - `authSettings(env, source?)`, `trustedOrigins(env, source?)`, `sessionHooks(fn)` and `SESSION_COOKIE_PREFIX` (Task 4) match their tests and their single consumers.
   - `getSessionUser(headers?)` (Task 4) matches `guest-limit.server.ts`, and `requireUserId()` (no argument) matches `middleware.ts`.
   - `signInWithGoogle` (Task 5) matches `login.tsx`. `getSignInStatus` (Task 6) matches the loader.
   - `PROD_ENV`/`NO_DB_URL`/`NEEDS_DB`/`dbEnv`/`TEST_ORIGIN` (Task 3) match every HTTP test.
4. **Review Focus.** Each of the five lines has its test in the owning task: Task 3 (`NODE_ENV` unset/dev), Task 2 (Better Auth overrides), Task 4 unit and HTTP (dev port, loopback), Task 4 HTTP (bearer, unsigned cookie), Task 4 unit (`sessionHooks`).
5. **Verified by experiment**, in a scratch copy of `79e3099` (`git archive`, its own `npm ci`, no junctions) with every task applied in order and each state checked:
   - the Nitro plugin exits 1 before `Listening on`. Without it, a module-scope throw answered 500 on `/api/health`, and the built server with `NODE_ENV` unset listened with no configuration at all.
   - the final state gives:
     - `tsc` clean and `eslint --max-warnings 0` clean;
     - `npm test`: 102 `scripts` tests and 534 TS tests, 0 failures, 0 skipped in `scripts/`;
     - `npm run build` succeeds;
     - `npm run test:http`: 37 tests (1 skipped) without a database, and 51/51 against a PGLite-socket Postgres.
   - Better Auth 1.6.33 facts confirmed:
     - the redirect URI is `${VELO_PUBLIC_ORIGIN}/api/auth/callback/google`;
     - the `__Host-velo.state` cookie carries `Secure; HttpOnly; SameSite=Lax; Path=/` with no Domain;
     - the origin check runs only on cookie-bearing POSTs, while `callbackURL` is always checked (hence the two HTTP tests per origin);
     - sign-up/sign-in email answer 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` / `EMAIL_PASSWORD_DISABLED`;
     - a bearer token and an unsigned cookie resolve no session;
     - `/sign-in/*` is rate-limited 3/10 s on `X-Forwarded-For`;
     - a forged callback state redirects to `/login?error=state_mismatch`;
     - Better Auth reads `BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_SECRETS` from the environment.
   - Dev on `VELO_DEV_PORT=8097`:
     - `127.0.0.1:8097` is trusted, and `redirect_uri` is `localhost:8097`;
     - `localhost:8080` is refused;
     - `/login` shows "not set up" without the Google variables and "Continue with Google" with them.
   - Migration 0006 applies once and re-runs as "up to date".
   - `npm uninstall jose` rewrote unrelated lockfile entries (`@emnapi/*`, `"peer": true`), so the dependency is kept.
   - The host gate reports 19 hits on the pre-W2 tree and 0 after Task 10.
   - All 91 single-line anchors quoted in Tasks 1–11 were checked with `git grep -c -F` against `79e3099` (first touch) or against the scratch state after the preceding task.
