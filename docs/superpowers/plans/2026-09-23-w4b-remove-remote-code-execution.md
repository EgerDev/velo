# W4b — Remove Server-Side Execution of Third-Party Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task names its **Executor** (`.claude/agents/velo-impl-*.md`) and is reviewed by `velo-reviewer` before the next task starts.

**Goal:** The server never executes JavaScript fetched from a third party, and the app contains no code whose purpose is to defeat YouTube's bot-detection or anti-throttling measures; every caller degrades to the remaining normal extraction paths or to a fixed-string error.

**Architecture:** This is a deletion workstream (roadmap D7, contract C5). It removes, in dependency order:
- the browser legs that minted PO tokens, raced the same-hop "bypass" and called public CORS relays;
- the BotGuard/PO-token minter (`bgutils-js` + `jsdom` + `new Function` + the global `window` swap) and all PO-token plumbing into InnerTube and yt-dlp;
- `/api/unlock`, `/api/bypass` and the server same-hop layer;
- the youtubei.js evaluator: the client runs with `retrieve_player: false` and no `Platform.shim.eval`, so no player script is downloaded or run and format URLs are used as YouTube sends them;
- nsig/URL "unlocking" and the per-connection throttle-beating parallel stream;
- the process-wide IPv4/dispatcher patch;
- the free SOCKS pool and the public CORS relays.

yt-dlp stays (D7) with its challenge solver taken from the pinned install instead of GitHub at run time, and every child process gets an allow-listed environment (Contract change request 1). The lint ban grows to ESLint core `no-eval`/`no-new-func`/`no-implied-eval` plus a `node:vm` ban, with a lint-probe test.

**Tech Stack:** TypeScript, TanStack Start routes, youtubei.js 18.1 (`retrieve_player: false`), yt-dlp 2026.x (subprocess), ESLint 9 flat config, `node:test` (`--experimental-strip-types`, `module.registerHooks` for "@/" imports), the C6 HTTP harness.

**Spec:** `docs/superpowers/plans/2026-09-23-00-roadmap.md` (D7, Global Constraints "Untrusted JavaScript" and "Egress", Shared Contract C5, W1 hand-off to W4b) plus `audit/03-application-security.md` (SEC-01, SEC-04, SEC-07, SEC-12, SEC-14), `audit/04-supply-chain.md` (SUP-01, SUP-05, SUP-10), `audit/01-architecture.md` (ARCH-08, ARCH-09, ARCH-12, ARCH-23), `audit/13-privacy-data.md` (PRIV-09, PRIV-10), `audit/14-operations.md` (OPS-11), `audit/11-ux-accessibility.md` (UX-05), `audit/06-open-source-readiness.md` (OSS-11), `audit/MASTER_FINDINGS.md` (M-04, M-14).

---

## Contract change requests

1. **yt-dlp's own JavaScript challenge solver (Global Constraint "Untrusted JavaScript" vs D7). Needs an [OWNER] ruling before Task 8 (Task 10, Step 1).**
   - **Conflict.** The constraint says the server never executes third-party JavaScript, "player JS" included. D7 says downloads keep using "pinned yt-dlp with the user's own cookies". Both cannot hold today.
   - **Facts, verified on this machine (yt-dlp 2026.06.09):**
     - `ytdlpArgv` (`src/lib/ytdlp-auth.ts`) and both yt-dlp calls in `src/lib/ytdlp-meta.server.ts` pass `--no-js-runtimes --js-runtimes node --remote-components ejs:github`.
     - With those flags, yt-dlp downloads its challenge-solver script from GitHub's latest release at run time, then runs YouTube's player JS in a `node --permission` child (`yt_dlp/extractor/youtube/jsc/_builtin/node.py`).
     - That child inherits the whole server environment: `run`/`runCapture` spawn with no `env`, and yt-dlp's `Popen` passes none either. Under Node's permission model, `process.env` stays readable, so `DATABASE_URL` and `BETTER_AUTH_SECRET` are one `process.env` read away from player code. That is M-04 in a subprocess.
     - Every cookie-capable yt-dlp client (`web`, `web_safari`, `web_embedded`, `mweb`, `tv`, `tv_downgraded`) has `REQUIRE_JS_PLAYER=True` (`yt_dlp/extractor/youtube/_base.py`).
     - With `--no-js-runtimes`, a live `-F` on `dQw4w9WgXcQ` with Velo's forced `player_client=web_embedded` printed `Only images are available`. yt-dlp's own JS-less default (`android_vr`) listed 1080p formats, but it does not support cookies. Downloads from this host 403 either way, so that part is host-IP dependent and was not measured.
     - With `--js-runtimes node` and **no** `--remote-components`, yt-dlp solved the challenges with the solver from the installed `yt-dlp-ejs` package (`[jsc:node] Solving JS challenges using node`, itag 137 listed).
   - **Proposal (Task 8 implements it).** Amend the constraint to:
     > "The server process never executes third-party JavaScript. The one exception is the pinned yt-dlp's bundled challenge solver (`yt-dlp-ejs`, installed with hashes by W5), which runs in yt-dlp's own `node --permission` child. yt-dlp and every other child process get an allow-listed environment without secrets (`childEnv()` in `src/lib/proc-run.server.ts`), and nothing downloads solver code at run time."

     Counsel (W9) still decides whether yt-dlp's challenge solving may stay; it is signature/nsig deciphering done by a third-party tool.
   - **Alternative (strict reading).** Remove `--js-runtimes node` as well, and stop forcing web clients so yt-dlp falls back to `android_vr`/`android`/`ios`. This loses every signed-in (cookie) download and most web-client formats. If the owner picks this, Task 8 is re-planned before it runs. Tasks 1–7 and 9 do not depend on the choice.
2. **C5's error fallback (compatible clarification).** C5 lets callers "return `apiError("upstream_failed", 502)`", but C2's `apiError` is created in W4a, which merges after W4b. W4b keeps each route's existing `Response.json({ error }, { status })` shape, and every new message it writes is a fixed string. W4a converts all of them to `apiError`.

   Proposed C5 wording: "… or return a fixed-string error, which W4a converts to `apiError("upstream_failed", 502)`."
3. **C5's dependency sentence (compatible clarification).** "`bgutils-js` and `jsdom` leave the dependencies if nothing else uses them." Nothing else uses `bgutils-js`, so it is removed. `jsdom` is still imported by two unit tests (`src/lib/use-keyboard-shortcuts.test.ts`, `src/lib/proxy-confirmation-focus.test.ts`), so it moves to `devDependencies` rather than being removed (Task 3). The production bundle no longer contains it.

## Preconditions

- **Merged before this workstream:** W0, W1 and W2. The roadmap merge order is W0 → W1 → W2 → **W4b** → W3 → W4a …
  - W2 does not own any file this plan edits, but it removes the Grok scaffolding next to some of them. At execution time, W2 may have changed or removed:
    - `builderFirst`/`isBuilderPreview`/`isSandboxHost` in `src/lib/hybrid-download.ts`;
    - `BASE_ENV` in `tests/http/api-guards.test.mjs`;
    - `vite.config.ts` plugins;
    - `package.json` scripts;
    - Grok wording in `README.md`.
  - Every task starts with an anchor check. An anchor that no longer matches means STOP and report; never guess.
  - The anchors below were verified with `git grep -c -F` against the W1 head in `../velo-w2` (for Task 1), and against a scratch copy with the preceding tasks applied (for the others).
- **Code state this plan assumes (the W1 head, commit `79e3099`, plus W2).** Two lines carry `// eslint-disable-next-line no-restricted-syntax -- W4b deletes this code path (C5) and this line`:
  - `src/lib/po-token.server.ts` (above `const vm = new Function(`);
  - `src/lib/youtube-client.server.ts` (above `Platform.shim.eval = …`).

  `reportUnusedDisableDirectives` is `"error"`, so each disappears with its code (Tasks 2 and 5).
- **Workspace.**
  - Work in the worktree `../velo-w4b` on branch `hardening/w4b-remove-remote-code-execution`, created from `main` with `superpowers:using-git-worktrees`.
  - Files are LF (`.gitattributes`). Commands are for Git Bash from the worktree root.
  - Prefix greps whose pattern starts with `/` with `MSYS_NO_PATHCONV=1`.
- **Ports.** Never 8080/8081/8123/55432. The HTTP harness picks ephemeral ports.
- **HTTP tests** need a prior `npm run build`. If W2 made production boot require `DATABASE_URL` and no local Postgres is available, run `npm run test:http` with `VELO_TEST_DATABASE_URL` set. If you cannot, say so in the task report; CI's `verify` job runs them against Postgres. Docker is not required locally.
- **No network.** No step needs YouTube or any third-party host. The failing-first HTTP inputs are ones the old handlers rejected before any upstream fetch.

## Global Constraints

Copied from the roadmap; every task includes these.

- **Untrusted JavaScript:** the server never executes JavaScript fetched from a third party (player JS, the BotGuard interpreter or anything else); `new Function`, `eval` and `vm.*` are forbidden in `src/`, enforced by a lint rule once W4b removes the existing uses; the circumvention features stay off (D7). The yt-dlp exception is Contract change request 1.
- **D7:** no task adds, adapts, relocates or improves PO-token/BotGuard minting, signature/nsig deciphering, throttle bypass or bot-detection evasion. If a normal feature silently depended on one, it degrades, and the loss goes in "Behaviour changes".
- **Egress:**
  - no free/public proxy lists and no public CORS relays (corsfix, allorigins, …);
  - server egress goes direct or through the single operator-configured `VELO_EGRESS_PROXY` (wiring it is W4a, see Hand-off);
  - the user-proxy feature keeps its existing SSRF filter.
- **Credentials:** YouTube cookies are never persisted server-side, never logged and never returned in a response. yt-dlp cookie files stay in `mkdtemp`.
- **Logging:** server code logs only through `log` from `src/lib/log.server.ts`; `no-console` is an error in `src/**/*.server.ts` and `src/routes/**`.
- **Tests:**
  - every P0/P1 fix lands with a regression test written first and seen failing;
  - never weaken, skip or delete a test to go green. A test is deleted only together with the code it tests, and each such deletion is listed in its task;
  - unit tests are `src/**/*.test.ts` with relative `.ts` imports (the `@/` alias is mapped with `module.registerHooks` where a module under test uses it); HTTP tests are `tests/http/*.test.mjs`.
- **Lint:** every rule is `error`; `npm run lint` exits 0 with `--max-warnings 0`.
- **Commits:**
  - Conventional Commits, one commit per task, on `hardening/w4b-remove-remote-code-execution`;
  - every message ends with the executing model's trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` for opus tasks, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` for sonnet tasks;
  - PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Windows + Linux:** every command works in Git Bash on Windows and on Linux. No `/tmp`, `/dev/null` or `python3` literals in Node code.
- **Copy rule:** user-facing text never promises what the code doesn't do ("encrypted", "official Google", "bypass"), and features are described neutrally.

## Review Focus

The five inputs most likely to bite, each pinned by a test in its owning task:

1. **A save whose every leg is skipped.** Example: a video-only itag with an audio pair while the relay leg is disabled. Deleting the always-present same-hop leg means the browser race can start with zero legs. Expected: the save fails at once with a fixed message and never hangs. Test: Task 1, `hybrid-download.test.ts` "a race with no runnable leg rejects instead of hanging".
2. **A format that only carries a `signatureCipher`** (no plain `url`). With no player, nothing may decipher it. Expected: a fixed "not available as a direct download" error, with no evaluator call and no empty-URL fetch. Test: Task 5, `youtube-stream.server.test.ts`.
3. **An old browser tab or bundle** that still calls `/api/unlock` or `/api/bypass`, or still sends `pot`. Expected: 404 for the routes, `pot` ignored by the zod schemas, and no crash. Test: Task 4, `api-guards.test.mjs` ("… is 404 (route deleted)", three cases).
4. **A deployment whose environment carries secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NODE_OPTIONS`), including Windows-cased keys (`Path`).** Expected: no yt-dlp/ffmpeg/pip child sees a secret, and `Path`/`SystemRoot` still pass. Tests: Task 8, `proc-run.server.test.ts` and `ytdlp-proc.server.test.ts`.
5. **Eval smuggled back through an alias the old selectors missed** (`(0, eval)(…)`, `globalThis.Function(…)`, `import("node:vm")`, `process.getBuiltinModule("node:vm")`). Expected: lint fails. Test: Task 5, `scripts/eval-ban.test.mjs`. One known ceiling: `setTimeout(someVariable)` with a string variable needs the type-aware `@typescript-eslint/no-implied-eval`, which this repo does not run.

---

## File Structure

| Path | Status | Responsibility | Task |
|---|---|---|---|
| `src/lib/bypass.ts` | delete | browser same-hop unlock chain (public relays, `/api/unlock`) | 1 |
| `src/lib/hybrid-download.ts` | modify | browser race: only "yt-dlp on the server" and "Velo relay"; zero-leg guard | 1 |
| `src/lib/builder-download.ts` | modify | server save without a PO-token mint or same-hop race | 1, 9 |
| `src/lib/hybrid-net.ts` | modify | `proxyFetch` goes only to `/api/relay` | 1 |
| `src/lib/hybrid-ytdlp.ts` | modify | no `pot` in the `/api/ytdlp` body | 1 |
| `src/lib/remote-code-policy.test.ts` | create, then extend per task | W4b policy assertions | 1–9 |
| `src/lib/hybrid-net.test.ts`, `src/lib/hybrid-download.test.ts` | create | relay-only fetch, zero-leg race, `readBlob` short body | 1 |
| `src/lib/bypass.test.ts` | modify (T1), then delete (T4) | tests of deleted code | 1, 4 |
| `src/lib/po-token.server.ts` | delete | BotGuard minter | 2 |
| `src/lib/resolve-video.ts` | modify | drop `mintPoToken` (T2) and `decipherCipher` (T4) | 2, 4 |
| `src/lib/youtube-client.server.ts` | modify | no mint (T2); no evaluator, `retrieve_player: false` (T5); no ipv4 import (T6) | 2, 5, 6 |
| `src/lib/youtube-stream.server.ts` | modify (T2, T4), then replace (T5) | plain format URLs, single-connection stream | 2, 4, 5 |
| `src/lib/ytdlp.server.ts`, `src/lib/ytdlp-meta.server.ts` | modify | no PO token (T2), no SOCKS (T7), no remote solver (T8) | 2, 7, 8 |
| `src/lib/ytdlp-auth.ts` (+ test) | modify | no PO-token args (T2), no research table (T3), no remote solver (T8), neutral hints (T9) | 2, 3, 8, 9 |
| `src/lib/builder.server.ts`, `src/routes/api/{builder,ytdlp}.ts` | modify | no `pot` field | 2 |
| `package.json`, `package-lock.json` | modify | drop `bgutils-js`, `jsdom` → devDependencies (T3), drop `sideEffects` (T6) | 3, 6 |
| `src/lib/tool-versions.ts`, `scripts/auto-update{,-plan}.mjs`, `.github/{dependabot.yml,workflows/auto-update.yml}`, `vite.config.ts` | modify | drop `bgutils-js`/`jsdom` references | 3 |
| `src/routes/api/{unlock,bypass}.ts`, `src/lib/bypass.server.ts`, `src/lib/bypass-parse.ts` | delete | decipher/unlock route, same-hop server relay | 4 |
| `src/routes/api/download.ts` | modify | no same-hop fallback | 4 |
| `src/routeTree.gen.ts` | regenerate (build) | route tree without the two routes | 4 |
| `tests/http/api-guards.test.mjs` | modify | deleted routes answer 404 | 4 |
| `src/lib/nsig.ts`, `src/lib/stream-unlock.ts`, `src/lib/parallel-stream.ts` (+ their tests) | delete | nsig cache, URL "unlock", per-connection throttle lanes | 5 |
| `src/lib/hls.ts`, `src/lib/hls.test.ts` | create | the HLS parser moved out of `stream-unlock.ts` verbatim | 5 |
| `src/lib/{iso-bmff,mpeg-ts}.test.ts` | modify (import path only) | use `./hls.ts` | 5 |
| `eslint.config.mjs` | modify | core eval rules + `node:vm` ban | 5 |
| `scripts/eval-ban.test.mjs` | create | lint probe for every banned form | 5 |
| `src/lib/youtube-client.server.test.ts`, `src/lib/youtube-stream.server.test.ts` | create | no evaluator; plain URLs; no global patching (T6) | 5, 6 |
| `src/lib/ipv4-bind.server.ts`, `src/lib/ipv4-bind.test.ts` | delete | process-wide DNS/dispatcher patch | 6 |
| `src/lib/youtube-copy.ts`, `src/lib/youtube.ts` | modify | drop dead `IPV6_TROUBLESHOOT` (T6); neutral copy (T9) | 6, 9 |
| `src/lib/socks-pool.server.ts`, `src/lib/socks-pool.test.ts` | delete | free SOCKS pool from `proxifly@main` | 7 |
| `src/lib/{proxy-selector.server,user-proxy.server,ytdlp-meta-routing,ytdlp-python.server,user-proxy-parse}.ts` (+ tests) | modify | no `free_socks` route kind, no PySocks | 7 |
| `src/lib/cors-relays.ts` (+ test), `src/routes/api/relay.ts` | modify | no public CORS relays | 7 |
| `src/lib/proc-run.server.ts`, `src/lib/ytdlp-proc.server.ts` (+ tests) | modify / create test | `childEnv()` allow-list for every child | 8 |
| UI + copy files (Task 9 list), `README.md` | modify | neutral wording | 9 |

Deleted code: about 3,300 lines, plus about 1,000 lines of tests that go with it. A scratch prototype of all nine tasks came to 85 files, +1,009/−4,346.

---
### Task 1: Browser download ladder without BotGuard, same-hop or public-relay legs

**Executor:** velo-impl-opus-high (rewires the download ladders)
**Covers:** SEC-01 (browser entry points), ARCH-09 (browser part), PRIV-09 (browser relays), M-14 (browser part), SEC-07 (browser fan-out)

**Files:**
- Delete: `src/lib/bypass.ts`
- Modify: `src/lib/hybrid-download.ts`, `src/lib/builder-download.ts`, `src/lib/hybrid-net.ts`, `src/lib/hybrid-ytdlp.ts`, `src/lib/bypass.test.ts` (drop the `readAll` test; its code is deleted, and the same test moves to `readBlob` below)
- Create: `src/lib/remote-code-policy.test.ts`, `src/lib/hybrid-net.test.ts`, `src/lib/hybrid-download.test.ts`

**Interfaces:**
- Produces:
  - `export function raceFirstBlob(steps: HybridStep[], emit: StepHandler | undefined, attempts: { id: string; run: (signal: AbortSignal) => Promise<Blob> }[], parent?: AbortSignal): Promise<Blob>`. Newly exported for tests; it rejects at once when `attempts` is empty.
  - `proxyFetch(url, init?)` only fetches `/api/relay?url=…`; it throws `Velo relay <status>[ block-page]` otherwise.
  - `ytdlpBlob(videoId, itag, cookies?, signal?)` loses its `pot` parameter.
  - `hybridFetchBlob`/`downloadViaHybrid` keep their signatures; the `downloadViaBypass` alias is deleted (nothing imports it).
- Consumes: nothing from other W4b tasks. After this task, `mintPoToken` (server fn), `/api/unlock`, `/api/bypass` and `publicRelayUrls` have no browser caller; Tasks 2, 4 and 7 delete them.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F 'import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";' -- src/lib/hybrid-download.ts
git grep -c -F 'const { fetchSameHopBlob } = await import("@/lib/bypass");' -- src/lib/hybrid-download.ts src/lib/builder-download.ts
git grep -c -F 'export { downloadViaHybrid as downloadViaBypass };' -- src/lib/hybrid-download.ts
git grep -c -F 'function raceBlobs(' -- src/lib/builder-download.ts
git grep -c -F 'export function stampClientPot(url: string, pot: string | null | undefined): string {' -- src/lib/hybrid-net.ts
git grep -c -F 'export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {' -- src/lib/hybrid-net.ts
git grep -c -F 'body: JSON.stringify({ id: videoId, itag, cookies: cookies || "", pot: pot || "" }),' -- src/lib/hybrid-ytdlp.ts
git grep -n -E 'from "@/lib/bypass"|import\("@/lib/bypass"\)|downloadViaBypass|stampClientPot' -- src ':!src/lib/bypass.ts' ':!src/lib/hybrid-net.ts'
```
Expected: `src/lib/hybrid-download.ts:1`, then `src/lib/builder-download.ts:1` and `src/lib/hybrid-download.ts:1`, then `:1` for each of the next five commands. The last grep prints exactly 5 lines: the two `fetchSameHopBlob` imports (`builder-download.ts`, `hybrid-download.ts`), `stampClientPot` twice in `hybrid-download.ts` (import and call), and the `downloadViaBypass` export. Anything else: STOP.

- [ ] **Step 2: Write the failing tests.**

Create `src/lib/remote-code-policy.test.ts`:
```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Roadmap D7/C5 (W4b): no BotGuard minting, server-side deciphering, same-hop
// bypass or third-party egress. Each task of W4b adds the assertions for the
// code it deletes; they fail if any of it comes back.
const here = (path: string) => new URL(path, import.meta.url);
const source = (path: string) => readFileSync(here(path), "utf8");

test("the browser download ladder mints no PO token and takes no same-hop, unlock or public-relay leg", () => {
  assert.equal(existsSync(here("./bypass.ts")), false);
  for (const file of ["./hybrid-download.ts", "./builder-download.ts", "./hybrid-net.ts", "./hybrid-ytdlp.ts"]) {
    assert.doesNotMatch(
      source(file),
      /mintPoToken|fetchSameHopBlob|\/api\/bypass|\/api\/unlock|stampClientPot|publicRelayUrls|\bpot\b/,
      file,
    );
  }
});
```

Create `src/lib/hybrid-net.test.ts`:
```ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hybrid-net.ts is browser code: its "@/" imports need mapping onto src/, and
// guest-id drags in the auth client, which a unit test must not load.
const STUBS: Record<string, string> = {
  "@/lib/guest-id": "export function downloadHeaders(headers) { return headers ?? {}; }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in STUBS) return { url: `velo-stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("velo-stub:")) {
      return { format: "module", source: STUBS[url.slice("velo-stub:".length)] ?? "export {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
// proxyFetch arms its header timer with window.setTimeout.
(globalThis as { window?: unknown }).window ??= globalThis;

async function withFetch<T>(
  answer: (url: string) => Response,
  run: (seen: string[]) => Promise<T>,
): Promise<T> {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return answer(String(input));
  }) as typeof fetch;
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}

test("proxyFetch asks only this app's /api/relay, never a public CORS relay", async () => {
  const { proxyFetch } = await import("./hybrid-net.ts");
  const page = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  await withFetch(
    () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    async (seen) => {
      const res = await proxyFetch(page);
      assert.equal(res.status, 200);
      assert.deepEqual(seen, [`/api/relay?url=${encodeURIComponent(page)}`]);
    },
  );
});

test("proxyFetch rejects a relay block page for googlevideo media", async () => {
  const { proxyFetch } = await import("./hybrid-net.ts");
  const media = "https://r1---sn-abc.googlevideo.com/videoplayback?itag=18";
  await withFetch(
    () => new Response("<html>blocked</html>", { status: 200, headers: { "content-type": "text/html" } }),
    async (seen) => {
      await assert.rejects(proxyFetch(media), /Velo relay 200 block-page/);
      assert.equal(seen.length, 1);
    },
  );
});

function bodyOf(parts: Uint8Array[], contentLength?: number): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) controller.close();
      else controller.enqueue(parts[i++]!);
    },
  });
  const headers: Record<string, string> = { "content-type": "video/mp4" };
  if (contentLength != null) headers["content-length"] = String(contentLength);
  return new Response(body, { headers });
}

test("readBlob rejects a body that closes short of its content-length", async () => {
  const { readBlob } = await import("./hybrid-net.ts");
  const short = bodyOf([new Uint8Array(1000), new Uint8Array(500)], 2500);
  await assert.rejects(readBlob(short), /ended early — got 1500 of 2500 bytes/);
  const a = new Uint8Array(3).fill(1);
  const b = new Uint8Array(2).fill(2);
  const full = await readBlob(bodyOf([a, b], 5));
  assert.equal(full.size, 5);
  assert.equal(full.type, "video/mp4");
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), new Uint8Array([1, 1, 1, 2, 2]));
  const unknown = await readBlob(bodyOf([new Uint8Array(7)]));
  assert.equal(unknown.size, 7);
});
```

Create `src/lib/hybrid-download.test.ts`:
```ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hybrid-download.ts is browser code: map "@/" onto src/ and stub the modules
// that pull in server functions, the auth client or IndexedDB.
const STUBS: Record<string, string> = {
  "@/lib/guest-id": "export function downloadHeaders(headers) { return headers ?? {}; }",
  "@/lib/resolve-video": "export async function resolvePlayback() { throw new Error('stub'); }",
  "@/lib/builder-save": "export async function saveMediaBlob() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in STUBS) return { url: `velo-stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("velo-stub:")) {
      return { format: "module", source: STUBS[url.slice("velo-stub:".length)] ?? "export {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test("a race with no runnable leg rejects instead of hanging", async () => {
  const { raceFirstBlob } = await import("./hybrid-download.ts");
  const outcome = await Promise.race([
    raceFirstBlob([], undefined, []).then(
      () => "resolved",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_000)),
  ]);
  assert.match(outcome, /No download path is available/);
});
```

- [ ] **Step 3: Run them and see them fail.** Run:
```bash
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/hybrid-net.test.ts src/lib/hybrid-download.test.ts
```
Expected: `ℹ fail 4`, `ℹ pass 1` (`readBlob …` already passes):
- the policy test fails on `existsSync(bypass.ts)` (`true !== false`);
- `proxyFetch asks only…` fails with `actual: [ 'https://proxy.corsfix.com/?https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://api.allorigins.win/raw?url=…' ]` (the stubbed `fetch` records them; nothing leaves the machine);
- `proxyFetch rejects a relay block page…` fails with `Input: 'Error: No relays configured.'`;
- the `hybrid-download` test fails with a `SyntaxError` (the stub has no `mintPoToken` export, or `raceFirstBlob` is not exported).

- [ ] **Step 4: Edit `src/lib/hybrid-download.ts`.** Apply each replacement exactly.
  1. Replace `import { mintPoToken, resolvePlayback } from "@/lib/resolve-video";` with `import { resolvePlayback } from "@/lib/resolve-video";`.
  2. Delete the line `import { downloadHeaders } from "@/lib/guest-id";`.
  3. Replace
     ```ts
       assertMedia,
       proxyFetch,
       readBlob,
       stampClientPot,
       withTimeout,
     } from "@/lib/hybrid-net";
     ```
     with
     ```ts
       assertMedia,
       proxyFetch,
       readBlob,
     } from "@/lib/hybrid-net";
     ```
  4. Replace
     ```ts
     import {
       applyPresentedHop,
       emptyTransfer,
     ```
     with
     ```ts
     import {
       emptyTransfer,
     ```
  5. Replace `function raceFirstBlob(` with `export function raceFirstBlob(`.
  6. Replace
     ```ts
           { once: true },
         );
         for (const attempt of attempts) {
     ```
     with
     ```ts
           { once: true },
         );
         // No leg can run (e.g. a video-only itag whose relay leg is skipped): fail
         // now instead of returning a promise that never settles.
         if (attempts.length === 0) {
           reject(classifyDownloadError(new Error("No download path is available for this quality.")));
           return;
         }
         for (const attempt of attempts) {
     ```
  7. Replace the whole `INITIAL_STEPS` array
     ```ts
     const INITIAL_STEPS: HybridStep[] = [
       { id: "server", label: "Server + PO token", status: "pending" },
       { id: "botguard", label: "BotGuard / PO token", status: "pending" },
       { id: "bypass", label: "Velo unlock (nsig + dual POT + same-hop + HLS)", status: "pending" },
       { id: "ytdlp", label: "yt-dlp web_embedded over SOCKS", status: "pending" },
       { id: "relay", label: "CORS relays (corsfix / allorigins / Velo)", status: "pending" },
     ];
     ```
     with
     ```ts
     const INITIAL_STEPS: HybridStep[] = [
       { id: "ytdlp", label: "yt-dlp on the server", status: "pending" },
       { id: "relay", label: "Velo relay", status: "pending" },
     ];
     ```
  8. Delete the comment line `    // Relay bytes are their own leg. A same-hop HLS tick must not abandon them.` (inside `onBytes`).
  9. Delete everything from the line `  patchStep(steps, "server", { status: "skip", detail: "Save already tried the builder hop" }, onSteps);` up to, **not including**, the line `  transfer = noteStage(transfer, "hop", 18);`. That removes the skip, the BotGuard `runAttempt`, `potInfo`, `pot` and the cold-start `patchStep`.
  10. Replace `  publish("Racing same-hop bypass, yt-dlp, relays");` with `  publish("Racing yt-dlp and the relay");`.
  11. Delete everything from the line `  if (!silentVideo) {` whose next line is `    attempts.push({` and whose third line is `      id: "bypass",`, up to, **not including**, the line `  if (!muxLeg) {`. That removes the whole same-hop leg and its `else` branch.
  12. Replace `    attempts.push({ id: "ytdlp", run: (signal) => ytdlpBlob(videoId, itag, cookies, pot, signal) });` with `    attempts.push({ id: "ytdlp", run: (signal) => ytdlpBlob(videoId, itag, cookies, signal) });`.
  13. Replace `            return await blobFromResponse(await proxyFetch(stampClientPot(url, pot), { signal }), onBytes);` with `            return await blobFromResponse(await proxyFetch(url, { signal }), onBytes);`.
  14. Replace
      ```ts
              const bypass = await fetch(`/api/bypass?id=${encodeURIComponent(videoId)}&itag=${itag}`, {
                headers: downloadHeaders(),
                signal,
              });
              if (bypass.ok) return blobFromResponse(bypass, onBytes);
              throw new Error(errors[0] || "Relays blocked.");
      ```
      with
      ```ts
              throw new Error(errors[0] || "Relay blocked.");
      ```
  15. At the end of the file, replace
      ```ts
      }

      export { downloadViaHybrid as downloadViaBypass };
      ```
      with `}` followed by a single newline. The file has no trailing newline today; end it with one.

- [ ] **Step 5: Edit `src/lib/builder-download.ts`.**
  1. Delete the line `import { mintPoToken } from "@/lib/resolve-video";`.
  2. Delete the two lines `import { isVideoOnlyItag } from "@/lib/ytdlp-auth";` and `import { linkAbort } from "@/lib/abort-link";`.
  3. Replace
     ```ts
     import {
       applyPresentedHop,
       emptyTransfer,
       noteFileBytes,
       presentedTransfer,
       settleTransfer,
       type PresentedTransfer,
     } from "@/lib/transfer-progress";
     ```
     with
     ```ts
     import {
       emptyTransfer,
       noteFileBytes,
       presentedTransfer,
       settleTransfer,
     } from "@/lib/transfer-progress";
     ```
  4. In `fetchServerItag`'s options type, delete the line `  pot?: string;`. In its request body, delete the line `      pot: opts.pot || "",`.
  5. Delete everything from `function raceBlobs(` up to, **not including**, `export async function downloadViaBuilder(`. That removes `raceBlobs` and `fetchBuilderBlob`, the only caller of the same-hop race.
  6. Delete the block
     ```ts
       let pot = "";
       try {
         const info = await mintPoToken({ data: { id: opts.videoId } });
         pot = info?.token ?? "";
       } catch {
         /* guest still works */
       }

     ```
  7. Replace
     ```ts
         const blob = await fetchBuilderBlob({
           videoId: opts.videoId,
           itag,
           cookies: opts.cookies,
           pot,
           signal: opts.signal,
           onProgress: (label, hopView) => {
             transfer = applyPresentedHop(transfer, hopView);
             const view = presentedTransfer(transfer);
             opts.onProgress?.({
               label,
               percent: view.percent,
               mode: view.mode,
               steps,
               ...(view.loaded != null && view.total != null ? { loaded: view.loaded, total: view.total } : {}),
             });
           },
           onBytes
     ```
     with
     ```ts
         const blob = await fetchServerItag({
           videoId: opts.videoId,
           itag,
           cookies: opts.cookies,
           signal: opts.signal,
           onBytes
     ```
  8. Delete the two comment lines `        // Server bytes are their own leg. abandonFile runs only inside the` and `        // same-hop attempt, so an HLS tick cannot clear this loaded/total.`.

  The step labels ("Matching hop …", "… nsig crawl") are rewritten in Task 9; leave them.

- [ ] **Step 6: Edit `src/lib/hybrid-net.ts`.**
  1. Replace
     ```ts
     import { withRetry } from "@/lib/retry";
     import { downloadHeaders } from "@/lib/guest-id";
     import { localRelayUrl, publicRelayUrls, relayHost } from "@/lib/cors-relays";
     import { unlockStreamUrl } from "@/lib/stream-unlock";
     import { isImaUrl } from "@/lib/ima";
     ```
     with
     ```ts
     import { downloadHeaders } from "@/lib/guest-id";
     import { localRelayUrl } from "@/lib/cors-relays";
     import { isImaUrl } from "@/lib/ima";
     ```
  2. Delete everything from `export function stampClientPot(` up to, **not including**, `export async function readBlob(`. That removes `stampClientPot` and `withTimeout`, whose only caller was the BotGuard mint.
  3. Replace everything from `export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {` to the end of the file with:
     ```ts
     /**
      * Fetch a YouTube / googlevideo URL through this app's own `/api/relay`. The
      * 20 s timer only guards the headers: the caller drains the body after this
      * returns, so the parent signal stays linked past that point. AbortSignal.any
      * does that without a listener to clean up; without it (older Safari/Firefox)
      * linkAbort's listener stays on the parent for a handed-off response.
      */
     export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
       const mode = fetchMode(url);
       const controller = new AbortController();
       const parent = init?.signal ?? undefined;
       const viaAny = parent && typeof AbortSignal.any === "function";
       const signal = viaAny ? AbortSignal.any([parent, controller.signal]) : controller.signal;
       const detach = viaAny ? () => {} : linkAbort(parent, controller);
       const timer = window.setTimeout(() => controller.abort(), 20_000);
       let handedOff = false;
       try {
         const response = await fetch(localRelayUrl(url), {
           redirect: "error",
           ...init,
           headers: downloadHeaders(init?.headers),
           signal,
         });
         const blocked = mode === "media" && isBlockPage(response);
         if (response.ok && !blocked) {
           handedOff = true;
           return response;
         }
         void response.body?.cancel();
         throw new Error(`Velo relay ${response.status}${blocked ? " block-page" : ""}`);
       } finally {
         window.clearTimeout(timer);
         if (!handedOff) detach();
       }
     }
     ```

- [ ] **Step 7: Edit `src/lib/hybrid-ytdlp.ts`.**
  1. Replace
     ```ts
       cookies?: string,
       pot?: string | null,
       signal?: AbortSignal,
     ```
     with
     ```ts
       cookies?: string,
       signal?: AbortSignal,
     ```
  2. Replace `      body: JSON.stringify({ id: videoId, itag, cookies: cookies || "", pot: pot || "" }),` with `      body: JSON.stringify({ id: videoId, itag, cookies: cookies || "" }),`.

- [ ] **Step 8: Delete the browser bypass module and its `readAll` test.**
```bash
git rm src/lib/bypass.ts
```
In `src/lib/bypass.test.ts`, delete everything from `function bodyOf(parts: Uint8Array[], contentLength?: number): Response {` to the end of the file (the `bodyOf` helper and the `readAll rejects a body…` test), and end the file with one newline after the preceding `});`. The same assertions now run against `readBlob` in `hybrid-net.test.ts`. Task 4 deletes the rest of `bypass.test.ts` with `bypass.server.ts`.

- [ ] **Step 9: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/hybrid-net.test.ts src/lib/hybrid-download.test.ts
npm run typecheck && npm run lint && npm test
```
Expected: the three files report `ℹ pass 5`, `ℹ fail 0`. `typecheck` is clean, `lint` exits 0, and `npm test` has 0 failures. The TS test count goes up by 4: 5 new tests minus the deleted `readAll`.

- [ ] **Step 10: Commit.**
```bash
git add -A src/lib/bypass.ts src/lib/bypass.test.ts src/lib/hybrid-download.ts src/lib/builder-download.ts src/lib/hybrid-net.ts src/lib/hybrid-ytdlp.ts src/lib/remote-code-policy.test.ts src/lib/hybrid-net.test.ts src/lib/hybrid-download.test.ts
git commit -m "fix(download)!: drop the BotGuard, same-hop and public-relay legs from the browser ladder

The browser no longer mints a PO token, races the same-hop bypass or calls
proxy.corsfix.com / api.allorigins.win: proxyFetch goes only to /api/relay,
and the hybrid race is yt-dlp on the server plus the Velo relay. A race with
no runnable leg now fails instead of hanging.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Delete PO-token/BotGuard minting and every PO-token path

**Executor:** velo-impl-opus-high (removes a remote-code path; touches the youtubei.js client, the yt-dlp argv and two routes)
**Covers:** SEC-01, SUP-01, ARCH-08 (b: BotGuard + `globalThis.window` swap), SEC-12, OPS-11 (the minter part), M-04 (BotGuard part), ARCH-23 (technical part: PO-token minting)

**Files:**
- Delete: `src/lib/po-token.server.ts` (with the first `W4b` eslint-disable line)
- Modify: `src/lib/resolve-video.ts`, `src/lib/youtube-client.server.ts`, `src/lib/youtube-stream.server.ts`, `src/lib/ytdlp.server.ts`, `src/lib/ytdlp-meta.server.ts`, `src/lib/ytdlp-auth.ts`, `src/lib/ytdlp-auth.test.ts`, `src/lib/builder.server.ts`, `src/routes/api/builder.ts`, `src/routes/api/ytdlp.ts`, `src/lib/remote-code-policy.test.ts`

**Interfaces:**
- Produces:
  - `extractorArgs(client: string, visitor?: string | null, dataSyncId?: string | null): string`. The two PO-token parameters are gone, and the result never contains `po_token` or `fetch_pot`.
  - `ytdlpArgv(opts)`, `downloadWithYtdlp(opts)` and `streamBuilderDownload(opts)` lose `pot`/`playerPot`.
  - `/api/builder` and `/api/ytdlp` bodies lose `pot`. zod's default `z.object` strips unknown keys, so an old client that still sends `pot` is unaffected.
  - Deleted exports: `mintPoToken` (server fn), `poTokenArgs`, `PO_TOKEN_STEPS`.
- Consumes: Task 1 (no browser caller of `mintPoToken` remains).

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -n -E 'po-token\.server|mintPoToken|mintDualPoTokens|mintContentPoToken' -- src ':!src/lib/po-token.server.ts'
git grep -c -F 'export function poTokenArgs(client: string, pot?: string, playerPot?: string): string {' -- src/lib/ytdlp-auth.ts
git grep -c -F 'extractorArgs(client, dual.gvs ?? undefined, null, dual.player ?? undefined),' -- src/lib/ytdlp-meta.server.ts
git grep -c -F '  pot: z.string().max(4000).optional(),' -- src/routes/api/builder.ts src/routes/api/ytdlp.ts
git grep -c -F '// eslint-disable-next-line no-restricted-syntax -- W4b deletes this code path (C5) and this line' -- src/lib/po-token.server.ts
```
Expected:
- the first grep prints exactly 16 lines: `remote-code-policy.test.ts` ×1 (Task 1's regex), `resolve-video.ts` ×3, `youtube-client.server.ts` ×2, `youtube-stream.server.ts` ×4, `ytdlp-meta.server.ts` ×4 and `ytdlp.server.ts` ×2;
- then `:1`, then `:2`, then `src/routes/api/builder.ts:1` and `src/routes/api/ytdlp.ts:1`, then `:1`.

Any other hit: STOP.

- [ ] **Step 2: Write the failing test.** Append to `src/lib/remote-code-policy.test.ts`:
```ts

test("no PO-token minter remains, and no route or yt-dlp call carries a PO token", () => {
  assert.equal(existsSync(here("./po-token.server.ts")), false);
  const files = [
    "./resolve-video.ts",
    "./youtube-client.server.ts",
    "./youtube-stream.server.ts",
    "./ytdlp.server.ts",
    "./ytdlp-meta.server.ts",
    "./ytdlp-auth.ts",
    "./builder.server.ts",
    "../routes/api/builder.ts",
    "../routes/api/ytdlp.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(
      source(file),
      /po-token\.server|mintPoToken|mintDualPoTokens|mintContentPoToken|poTokenArgs|fetch_pot=never|po_token: /,
      file,
    );
  }
  for (const file of ["./builder.server.ts", "../routes/api/builder.ts", "../routes/api/ytdlp.ts", "./ytdlp.server.ts"]) {
    assert.doesNotMatch(source(file), /\bpot\??:/, file);
  }
});
```
Also change the two existing `extractorArgs` tests in `src/lib/ytdlp-auth.test.ts` to the new contract. This is a spec change: PO tokens are gone.
  1. In the import list, delete the lines `  PO_TOKEN_STEPS,` and `  poTokenArgs,`.
  2. Replace
     ```ts
     test("extractor-args stamp po_token and visitor_data; never use -u/-p", () => {
       const args = extractorArgs("mweb", "POTTOKEN", "visitorA");
       assert.match(args, /player_client=mweb/);
       assert.match(args, /player_js_variant=main/);
       assert.match(args, /fetch_pot=never/);
       assert.ok(!args.includes("use_ad_playback_context"));
       assert.match(args, /visitor_data=visitorA/);
       assert.match(args, /po_token=mweb\.gvs\+POTTOKEN/);
       assert.match(args, /mweb\.player\+POTTOKEN/);
       const dual = extractorArgs("web_embedded", "GVS123", "visitorA", "PLAYER456");
       assert.match(dual, /web_embedded\.gvs\+GVS123/);
       assert.match(dual, /web_embedded\.player\+PLAYER456/);
       assert.ok(!dual.includes("use_ad_playback_context"));
       const none = extractorArgs("web_embedded");
       assert.ok(!none.includes("fetch_pot=never"), "let yt-dlp fetch POT when we have none");
       const vr = extractorArgs("android_vr", "POT");
       assert.match(vr, /player_client=web_embedded/);
     ```
     with
     ```ts
     test("extractor-args carry visitor_data and never a PO token; never use -u/-p", () => {
       const args = extractorArgs("mweb", "visitorA");
       assert.match(args, /player_client=mweb/);
       assert.match(args, /player_js_variant=main/);
       assert.ok(!args.includes("use_ad_playback_context"));
       assert.match(args, /visitor_data=visitorA/);
       assert.doesNotMatch(args, /po_token|fetch_pot/);
       const vr = extractorArgs("android_vr");
       assert.match(vr, /player_client=web_embedded/);
     ```
  3. In the same test, replace
     ```ts
       assert.equal(argv[argv.indexOf("-f") + 1], "18");
       assert.ok(PO_TOKEN_STEPS.some((row) => row.step === "4 mint"));
     });
     ```
     with
     ```ts
       assert.equal(argv[argv.indexOf("-f") + 1], "18");
       assert.doesNotMatch(argv.join(" "), /po_token|fetch_pot/);
     });
     ```
  4. In `test("working command matches argv …")`, replace
     ```ts
         impersonate: true,
         pot: "GVS",
         playerPot: "PLAYER",
       });
     ```
     with
     ```ts
         impersonate: true,
       });
     ```
  5. Replace the whole test
     ```ts
     test("keeps = in visitor_data and does not pin fetch_pot without a token", () => {
       const args = extractorArgs("mweb", undefined, "abc=def");
       assert.match(args, /visitor_data=abc=def/);
       assert.ok(!args.includes("fetch_pot=never"));
       const loggedIn = extractorArgs("web_embedded", "POT", null, "PLAYER", "104123||");
       assert.match(loggedIn, /data_sync_id=104123\|\|/);
       assert.equal(poTokenArgs("android", "WEBPO"), "");
       assert.match(poTokenArgs("web_embedded", "WEBPO"), /web_embedded\.gvs\+WEBPO/);
       assert.ok(YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "data_sync_id"));
       assert.ok(
         YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "fetch_pot" && /never iff/.test(row.use)),
       );
     });
     ```
     with
     ```ts
     test("keeps = in visitor_data and never pins fetch_pot", () => {
       const args = extractorArgs("mweb", "abc=def");
       assert.match(args, /visitor_data=abc=def/);
       assert.ok(!args.includes("fetch_pot"));
       const loggedIn = extractorArgs("web_embedded", null, "104123||");
       assert.match(loggedIn, /data_sync_id=104123\|\|/);
       assert.ok(YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "data_sync_id"));
       assert.ok(YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "fetch_pot" && row.use === "never"));
       assert.ok(YTDLP_EXTRACTOR_ARGS.some((row) => row.arg === "po_token" && row.use === "never"));
     });
     ```

- [ ] **Step 3: Run them and see them fail.** Run: `node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/ytdlp-auth.test.ts`
Expected: failures:
- the new policy test (`true !== false` for `po-token.server.ts`);
- `extractor-args carry visitor_data…` (`visitor_data=visitorA` missing, because the old signature reads the second argument as a PO token);
- `keeps = in visitor_data…`.

- [ ] **Step 4: Delete the minter.** `git rm src/lib/po-token.server.ts`

- [ ] **Step 5: Remove every mint call site.**
  1. `src/lib/resolve-video.ts`: delete the whole `export const mintPoToken = createServerFn({ method: "POST" })` block (7 lines, ending `    return mintPoTokenDetailed(data.id);` and `  });`) plus the blank line after it.
  2. `src/lib/youtube-client.server.ts`:
     - delete the whole `const WEBPO_INNERTUBE = new Set([` … `]);` block and the blank line after it;
     - replace
       ```ts
         let fallback: PlayableInfo | null = null;
         let gvsPot: string | undefined;
         try {
           const { mintContentPoToken } = await import("@/lib/po-token.server");
           gvsPot = (await mintContentPoToken(id)) || undefined;
         } catch {
           /* BotGuard optional — Innertube still tries */
         }
       ```
       with `  let fallback: PlayableInfo | null = null;`;
     - replace
       ```ts
                 const usePot = Boolean(gvsPot && WEBPO_INNERTUBE.has(client));
                 return await yt.getBasicInfo(id, usePot ? { client, po_token: gvsPot } : { client });
       ```
       with `          return await yt.getBasicInfo(id, { client });`.
  3. `src/lib/youtube-stream.server.ts` (Tasks 4 and 5 replace the rest of this file):
     - replace
       ```ts
       async function decorateUrls(raw: string, cpn: string, videoId: string): Promise<{ url: string; directUrl: string }> {
         const { mintContentPoToken } = await import("@/lib/po-token.server");
         const { unlockStreamUrl } = await import("@/lib/stream-unlock");
         const pot = await mintContentPoToken(videoId);
         const unlocked = unlockStreamUrl(raw, { pot, cpn, stripAlr: true });
       ```
       with
       ```ts
       async function decorateUrls(raw: string, cpn: string): Promise<{ url: string; directUrl: string }> {
         const { unlockStreamUrl } = await import("@/lib/stream-unlock");
         const unlocked = unlockStreamUrl(raw, { cpn, stripAlr: true });
       ```
     - replace
       ```ts
         videoId?: string;
         cpn?: string;
         pot?: boolean;
       }): Promise<{ url: string; applied: string[] }> {
         const deciphered = await decipherRawFormat(input);
         let pot: string | null = null;
         if (input.pot !== false && input.videoId) {
           const { mintContentPoToken } = await import("@/lib/po-token.server");
           pot = await mintContentPoToken(input.videoId);
         }
         const { unlockStreamUrl } = await import("@/lib/stream-unlock");
         return unlockStreamUrl(deciphered, { pot, cpn: input.cpn, stripAlr: true });
       ```
       with
       ```ts
         videoId?: string;
         cpn?: string;
       }): Promise<{ url: string; applied: string[] }> {
         const deciphered = await decipherRawFormat(input);
         const { unlockStreamUrl } = await import("@/lib/stream-unlock");
         return unlockStreamUrl(deciphered, { cpn: input.cpn, stripAlr: true });
       ```
     - replace both occurrences of `  const urls = await decorateUrls(deciphered, cpn, id);` with `  const urls = await decorateUrls(deciphered, cpn);` (use replace-all; there are exactly two).
  4. `src/lib/ytdlp.server.ts`:
     - in `runClient`'s options type, delete the two lines `  pot?: string;` and `  playerPot?: string;` that sit directly above `  visitorData?: string | null;`;
     - in `muxOne`'s options type and in `downloadWithYtdlp`'s options type, delete the line `  pot?: string;` that sits between `  cookies?: string;` and `  signal?: AbortSignal;` (once in each function);
     - delete the block
       ```ts
           let gvsPot = opts.pot;
           let playerPot = opts.pot;
           try {
             const { mintDualPoTokens } = await import("@/lib/po-token.server");
             const dual = await mintDualPoTokens({ visitor: session?.visitorData, videoId: opts.id });
             gvsPot = dual.gvs || opts.pot;
             playerPot = dual.player || opts.pot;
           } catch {
             /* yt-dlp still runs without POT */
           }
       ```
     - in `attempt`, delete the two lines `        pot: gvsPot,` and `        playerPot,`.
  5. `src/lib/ytdlp-meta.server.ts`:
     - delete the block that starts `    let dual: { gvs: string | null; player: string | null } = { gvs: null, player: null };` and ends `      /* captions may work without POT */` + `    }`, plus the blank line after it;
     - delete the second block that starts with the same `let dual` line and ends `      /* list without POT */` + `    }`;
     - replace both occurrences of `              extractorArgs(client, dual.gvs ?? undefined, null, dual.player ?? undefined),` with `              extractorArgs(client),`;
     - replace the comment `  // cost a pool slot, a SOCKS hop and a PO token mint to find that out.` with `  // cost a pool slot and a SOCKS hop to find that out.`.

- [ ] **Step 6: Remove PO-token plumbing from `src/lib/ytdlp-auth.ts`.**
  1. Replace the header lines
     ```ts
      * 1. --cookies Netscape file (what Velo imports)
      * 2. visitor_data from VISITOR_INFO1_LIVE
      * 3. po_token stamped per player client (gvs + player)
      * 4. account cookies unlock web_embedded / web / mweb / web_safari (not android/ios)
      * 5. --cookies-from-browser only if YTDLP_BROWSER is set
      * 6. --proxy SOCKS5 for guest same-hop when this host's IP is 403
     ```
     with
     ```ts
      * 1. --cookies Netscape file (what Velo imports)
      * 2. visitor_data from VISITOR_INFO1_LIVE
      * 3. account cookies unlock web_embedded / web / mweb / web_safari (not android/ios)
      * 4. --cookies-from-browser only if YTDLP_BROWSER is set
      * 5. --proxy SOCKS5 for guest same-hop when this host's IP is 403
      *
      * Velo supplies no PO token (roadmap D7): yt-dlp runs with what it has.
     ```
  2. Replace everything from the line `/** InnerTube clients that accept WebPO (yt_dlp.extractor.youtube.pot.utils.WEBPO_CLIENTS). */` through the closing `}` of `export function extractorArgs(` (that is: `WEBPO_CLIENTS`, `poTokenArgs`, its doc comment and the old `extractorArgs`) with:
     ```ts
     /**
      * youtube extractor-args (yt-dlp 2026.08.19 `_video.py` / `_base.py`):
      * player_client, visitor_data (only without cookies), data_sync_id (logged-in),
      * player_js_variant. Never po_token or fetch_pot: Velo mints no PO token (D7).
      */
     export function extractorArgs(
       client: string,
       visitor?: string | null,
       dataSyncId?: string | null,
     ): string {
       const resolved = resolvePlayerClient(client);
       const parts = [`youtube:player_client=${resolved}`, "player_js_variant=main"];
       if (visitor) parts.push(`visitor_data=${visitor.replace(/[^A-Za-z0-9_=%-]/g, "")}`);
       if (dataSyncId) parts.push(`data_sync_id=${dataSyncId.replace(/[^A-Za-z0-9_|=%-]/g, "")}`);
       return parts.join(";");
     }
     ```
  3. Delete everything from `/** How Velo mints PO tokens (bgutils-js BotGuard, not yt-dlp's empty POT providers). */` up to, **not including**, `export function browserCookieArgs(): string[] {` (the `PO_TOKEN_STEPS` table).
  4. In `ytdlpArgv`'s options type, delete `  pot?: string;` and `  playerPot?: string;` (directly above `  visitorData?: string | null;`). Replace
     ```ts
         extractorArgs(
           client,
           opts.pot,
           hasCookies ? null : opts.visitorData,
           opts.playerPot,
           hasCookies ? (opts.dataSyncId ?? null) : null,
         ),
     ```
     with
     ```ts
         extractorArgs(
           client,
           hasCookies ? null : opts.visitorData,
           hasCookies ? (opts.dataSyncId ?? null) : null,
         ),
     ```
  5. Replace `    does: "gvs + player PO tokens (we mint, yt-dlp has none built-in)",` with `    does: "gvs + player PO tokens (yt-dlp's own providers; Velo supplies none)",`.
  6. In `YTDLP_EXTRACTOR_ARGS`, replace
     ```ts
       {
         arg: "po_token",
         use: "when minted",
         note: "CLIENT.gvs+X,CLIENT.player+X — video-id bind (GVS experiment)",
       },
     ```
     with `  { arg: "po_token", use: "never", note: "Velo mints no PO token (roadmap D7)" },`. Then replace
     ```ts
       {
         arg: "fetch_pot",
         use: "never iff stamped",
         note: "omit (auto) when we have no token so yt-dlp can still fetch",
       },
     ```
     with `  { arg: "fetch_pot", use: "never", note: "omitted; yt-dlp keeps its default" },`.
  7. Replace `/** Copy-paste command matching Save. POT is required for 1080p; without it yt-dlp falls to 18. */` with `/** Copy-paste command matching Save. */`.

- [ ] **Step 7: Drop `pot` from the routes.**
  1. `src/routes/api/builder.ts`:
     - delete `  pot: z.string().max(4000).optional(),`;
     - replace `async function handleBuilder(request: Request, id: string, itag: number, cookies?: string, pot?: string) {` with `async function handleBuilder(request: Request, id: string, itag: number, cookies?: string) {`;
     - replace `    return await streamBuilderDownload({ id, itag, cookies, pot, signal: request.signal });` with `    return await streamBuilderDownload({ id, itag, cookies, signal: request.signal });`;
     - replace `{ id, itag, cookies, pot }. GET cannot carry a YouTube session.` with `{ id, itag, cookies }. GET cannot carry a YouTube session.`;
     - replace `        return handleBuilder(request, id, parsed.data.itag, parsed.data.cookies, parsed.data.pot);` with `        return handleBuilder(request, id, parsed.data.itag, parsed.data.cookies);`.
  2. `src/routes/api/ytdlp.ts`: delete `  pot: z.string().max(4000).optional(),` and `            pot: parsed.data.pot,`.
  3. `src/lib/builder.server.ts`: delete `  pot?: string;` (in `streamBuilderDownload`'s options) and `      pot: opts.pot,` (in the `downloadWithYtdlp` call).

- [ ] **Step 8: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/ytdlp-auth.test.ts
git grep -n -E 'po-token\.server|mintPoToken|mintDualPoTokens|mintContentPoToken|poTokenArgs|PO_TOKEN_STEPS|WEBPO_' -- src ':!src/lib/remote-code-policy.test.ts'
npm run typecheck && npm run lint && npm test
```
Expected:
- the two test files have 0 failures;
- the grep prints nothing;
- the gate is green. Lint passes because the `W4b` disable line went away with `po-token.server.ts`.

- [ ] **Step 9: Commit.**
```bash
git add -A src/lib src/routes/api/builder.ts src/routes/api/ytdlp.ts
git commit -m "fix(security)!: delete PO-token/BotGuard minting and every PO-token path

The server no longer downloads and runs YouTube's BotGuard interpreter with
new Function against a jsdom window bound onto globalThis (roadmap D7/C5,
audit M-04, SEC-01, SUP-01, SEC-12). InnerTube and yt-dlp run without a
PO token; /api/builder and /api/ytdlp no longer take one.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Remove `bgutils-js`, move `jsdom` to devDependencies, drop the circumvention research table

**Executor:** velo-impl-sonnet-high (exact delete lists and exact greps)
**Covers:** SUP-10 (the dependencies this workstream frees), SUP-01 (dependency side), ARCH-23 (research notes in `ytdlp-auth.ts`)

**Files:** Modify `package.json`, `package-lock.json`, `src/lib/tool-versions.ts`, `scripts/auto-update-plan.mjs`, `scripts/auto-update.mjs`, `.github/dependabot.yml`, `.github/workflows/auto-update.yml`, `vite.config.ts`, `src/lib/ytdlp-auth.ts`, `src/lib/ytdlp-auth.test.ts`.

**Interfaces:**
- Produces: `ToolId = "youtubei.js" | "yt-dlp"` (the Tools tab lists two tools).
- `jsdom` stays installed for the two tests that use it; `socks-proxy-agent` and `undici` stay because the user-proxy feature imports them.

- [ ] **Step 1: Verify anchors and usage.** Run:
```bash
git grep -n -E 'from "bgutils-js|from "jsdom"|import\("jsdom"\)' -- src scripts server
git grep -c -F '    "bgutils-js": "^4.0.3",' -- package.json
git grep -c -F '    "jsdom": "^30.0.1",' -- package.json
git grep -c -F '    external: ["youtubei.js", "bgutils-js", "jsdom", "@electric-sql/pglite"],' -- vite.config.ts
git grep -c -F -- '--only=youtubei.js,bgutils-js,jsdom,undici,socks-proxy-agent' -- .github/workflows/auto-update.yml
git grep -c -F 'export const YOUTUBE_ALT_APIS = [' -- src/lib/ytdlp-auth.ts
```
Expected: the first grep prints only `src/lib/proxy-confirmation-focus.test.ts` and `src/lib/use-keyboard-shortcuts.test.ts` lines (`await import("jsdom")`); no `bgutils-js` import remains after Task 2. Then `:1` for each of the other five. Anything else: STOP.

- [ ] **Step 2: Edit `package.json`.**
  1. Delete the line `    "bgutils-js": "^4.0.3",` (in `dependencies`).
  2. Delete the line `    "jsdom": "^30.0.1",` (in `dependencies`).
  3. In `devDependencies`, replace `    "globals": "^15.15.0",` with the two lines `    "globals": "^15.15.0",` and `    "jsdom": "^30.0.1",`.

- [ ] **Step 3: Update the lockfile.** Run `npm install --ignore-scripts --no-audit --no-fund`. Then run:
```bash
git diff package-lock.json | grep -E '^[-+] +"version"'
npm ls bgutils-js jsdom
```
Expected:
- the version diff shows only `-      "version": "4.0.3",` for `bgutils-js`. npm 11 may also drop the three optional entries `@emnapi/core`, `@emnapi/runtime` and `nitro/node_modules/lru-cache` (`-      "version": "1.11.3"` ×2 and `"11.5.3"`) and add `"peer": true` / `"dev": true` flags; that is npm-version normalization, measured on npm 11.6.2 with no package change at all. Any other added or changed `"version"`: STOP.
- `npm ls` shows `└── jsdom@30.1.1` and no `bgutils-js`.
- Then run `rm -rf node_modules && npm ci --ignore-scripts --no-audit --no-fund`. Expected: `added … packages`, exit 0.

- [ ] **Step 4: Remove the references.**
  1. `src/lib/tool-versions.ts`:
     - replace the four doc lines
       ```ts
        * Why these three: `youtubei.js` and `bgutils-js` track the YouTube player and
        * BotGuard; the `yt-dlp` Python module ships roughly monthly because YouTube
        * keeps breaking it. Left alone they go stale in weeks and extraction starts
        * failing for reasons that look like bugs in this repo.
       ```
       with
       ```ts
        * Why these two: `youtubei.js` tracks the YouTube InnerTube API; the `yt-dlp`
        * Python module ships roughly monthly because YouTube keeps breaking it. Left
        * alone they go stale in weeks and extraction starts failing for reasons that
        * look like bugs in this repo.
       ```
     - replace `export type ToolId = "youtubei.js" | "bgutils-js" | "yt-dlp";` with `export type ToolId = "youtubei.js" | "yt-dlp";`;
     - delete the whole `TOOL_CATALOG` entry that starts `    id: "bgutils-js",` (the 8 lines from `  {` to `  },`, including `role: "BotGuard / PO-token minting for web clients."`);
     - replace `    role: "InnerTube client — metadata, formats, player deciphering.",` with `    role: "InnerTube client — metadata and formats.",`.
  2. `scripts/auto-update-plan.mjs`: replace the line
     ```js
      * YouTube player — `youtubei.js`, `bgutils-js` and the `yt-dlp` Python module
     ```
     with
     ```js
      * YouTube player — `youtubei.js` and the `yt-dlp` Python module
     ```
  3. `scripts/auto-update.mjs`: replace the line
     ```js
      * `youtubei.js` and `bgutils-js` track the YouTube player, and the `yt-dlp`
     ```
     with
     ```js
      * `youtubei.js` tracks the YouTube player, and the `yt-dlp`
     ```
  4. `.github/dependabot.yml`:
     - replace the two lines `# Dependency updates. The extraction family (youtubei.js, bgutils-js, jsdom,` / `# undici, socks-proxy-agent) is refreshed weekly by auto-update.yml with a` with `# Dependency updates. The extraction family (youtubei.js, undici,` / `# socks-proxy-agent) is refreshed weekly by auto-update.yml with a`;
     - delete the two lines `      - dependency-name: bgutils-js` and `      - dependency-name: jsdom`. `jsdom` becomes an ordinary dev dependency, updated by the `dev-tooling` group.
  5. `.github/workflows/auto-update.yml`:
     - replace `# (youtubei.js, bgutils-js, jsdom, undici, socks-proxy-agent). Everything else` with `# (youtubei.js, undici, socks-proxy-agent). Everything else`;
     - replace `--only=youtubei.js,bgutils-js,jsdom,undici,socks-proxy-agent` with `--only=youtubei.js,undici,socks-proxy-agent`.

     `scripts/workflow-policy.test.mjs` checks that every `--only` package is ignored by Dependabot, and still holds.
  6. `vite.config.ts`: replace `    external: ["youtubei.js", "bgutils-js", "jsdom", "@electric-sql/pglite"],` with `    external: ["youtubei.js", "@electric-sql/pglite"],`.
  7. `src/lib/ytdlp-auth.ts`: delete everything from the comment line `/**` directly above ` * APIs besides yt-dlp player_client. Probed 24 Aug 2026 on this host:` up to, **not including**, `export function ytdlpClients(loggedIn: boolean): readonly string[] {`. That is the `YOUTUBE_ALT_APIS` table: Invidious/Piped/Cobalt/Turnstile probe notes, used only by a test.
  8. `src/lib/ytdlp-auth.test.ts`: delete the import line `  YOUTUBE_ALT_APIS,` and the two assertions `  assert.ok(YOUTUBE_ALT_APIS.some((row) => row.id === "tv_embedded"));` and `  assert.ok(YOUTUBE_ALT_APIS.some((row) => row.id === "invidious" && /403/.test(row.note)));`.

- [ ] **Step 5: Verify.** Run:
```bash
git grep -n bgutils -- . ':!package-lock.json' ':!docs' ':!audit' ':!README.md'
git grep -n -E 'YOUTUBE_ALT_APIS|invidious|Turnstile' -- src
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: both greps print nothing. README's mention goes in Task 9, and `docs/`/`audit/` are W7's. The gate and the build are green.

- [ ] **Step 6: Commit.**
```bash
git add package.json package-lock.json src/lib/tool-versions.ts scripts/auto-update-plan.mjs scripts/auto-update.mjs .github/dependabot.yml .github/workflows/auto-update.yml vite.config.ts src/lib/ytdlp-auth.ts src/lib/ytdlp-auth.test.ts
git commit -m "build(deps): remove bgutils-js, make jsdom a dev dependency

Nothing imports bgutils-js after the PO-token minter went; jsdom is only
used by two unit tests. The Tools tab, the updater, Dependabot and the SSR
externals stop listing them, and the Invidious/Piped/Cobalt probe table goes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 4: Delete `/api/unlock`, `/api/bypass` and the server same-hop layer

**Executor:** velo-impl-opus-high (route removal)
**Covers:** SEC-01 (server decipher entry point), ARCH-09 (server bypass relay), SEC-07 (bypass fan-out to corsfix/allorigins), M-04 (entry point), ARCH-23 (technical part: throttle-bypass route)

**Files:**
- Delete: `src/routes/api/unlock.ts`, `src/routes/api/bypass.ts`, `src/lib/bypass.server.ts`, `src/lib/bypass-parse.ts`, `src/lib/bypass.test.ts`. The test goes with the code it tests: the `bypass-parse` helpers, `isBlock` of `bypass.server.ts` and `isVideoplaybackUrl`. No surviving module uses them.
- Modify: `src/routes/api/download.ts`, `src/lib/resolve-video.ts`, `src/lib/youtube-stream.server.ts`, `src/lib/youtube.server.ts`, `tests/http/api-guards.test.mjs`, `src/lib/remote-code-policy.test.ts`
- Regenerate: `src/routeTree.gen.ts` (by `npm run build`)

**Interfaces:**
- Produces:
  - `GET /api/bypass`, `GET /api/unlock` and `POST /api/unlock` answer 404 (the app's not-found page);
  - `GET /api/download` no longer falls back to a same-hop relay; a YouTube block returns the route's own 403/422/502 with the quota refunded;
  - deleted exports: `decipherCipher` (server fn), `unlockPlaybackUrl`, `streamSameHop`, and everything in `bypass-parse.ts`.
- Consumes: Task 1 (no browser caller of `/api/unlock`/`/api/bypass`/`decipherCipher`) and Task 2 (`po-token.server.ts`, the only other importer of `bypass-parse.ts`, is gone).

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '            const { streamSameHop } = await import("@/lib/bypass.server");' -- src/routes/api/download.ts
git grep -c -F 'export const decipherCipher = createServerFn({ method: "POST" })' -- src/lib/resolve-video.ts
git grep -c -F 'export async function unlockPlaybackUrl(input: {' -- src/lib/youtube-stream.server.ts
git grep -c -F '  test("bypass without id/itag is 400", async () => {' -- tests/http/api-guards.test.mjs
git grep -c -F '  test("unlock rejects a body without a stream URL with 400", async () => {' -- tests/http/api-guards.test.mjs
MSYS_NO_PATHCONV=1 git grep -n -E 'bypass\.server|bypass-parse|streamSameHop|decipherCipher|unlockPlaybackUrl|/api/unlock|/api/bypass' -- src tests ':!src/routeTree.gen.ts' ':!src/lib/bypass.server.ts' ':!src/lib/bypass-parse.ts' ':!src/lib/bypass.test.ts' ':!src/routes/api/unlock.ts' ':!src/routes/api/bypass.ts'
```
Expected: `:2`, then `:1` ×4. The last grep prints exactly 12 lines:
- `resolve-video.ts:…decipherCipher`;
- `youtube-stream.server.ts` ×2 (a `bypass.server.ts` comment and `unlockPlaybackUrl`);
- `youtube.server.ts:…unlockPlaybackUrl,`;
- `download.ts` ×5 (two `streamSameHop` imports, two calls, one `/api/bypass` comment);
- `relay.ts:…bypass.server.ts hop()` (a comment, rewritten in Task 7);
- `api-guards.test.mjs` ×2.

Anything else: STOP.

- [ ] **Step 2: Write the failing HTTP tests.** In `tests/http/api-guards.test.mjs`:
  1. Delete
     ```js
       test("bypass without id/itag is 400", async () => {
         assert.equal((await get("/api/bypass")).status, 400);
       });

     ```
  2. Replace
     ```js
       test("unlock rejects a body without a stream URL with 400", async () => {
         assert.equal((await postJson("/api/unlock", JSON.stringify({}))).status, 400);
       });
     ```
     with
     ```js
       // Roadmap D7/C5: the same-hop bypass and the server-side decipher/unlock
       // routes are deleted; their paths fall through to the 404 page. The inputs
       // are ones the old handlers rejected before any upstream fetch, so the
       // failing-first run stays offline too.
       test("GET /api/bypass is 404 (route deleted)", async () => {
         assert.equal((await get("/api/bypass")).status, 404);
       });

       test("POST /api/unlock is 404 (route deleted)", async () => {
         assert.equal((await postJson("/api/unlock", JSON.stringify({}))).status, 404);
       });

       test("GET /api/unlock is 404 (route deleted)", async () => {
         assert.equal((await get("/api/unlock")).status, 404);
       });
     ```
  Append to `src/lib/remote-code-policy.test.ts`:
```ts

test("the unlock and same-hop bypass routes and their server helpers are gone", () => {
  for (const file of ["../routes/api/unlock.ts", "../routes/api/bypass.ts", "./bypass.server.ts", "./bypass-parse.ts"]) {
    assert.equal(existsSync(here(file)), false, file);
  }
  assert.doesNotMatch(source("../routes/api/download.ts"), /streamSameHop|bypass/);
  assert.doesNotMatch(source("./resolve-video.ts"), /decipherCipher|decipherRawFormat/);
  assert.doesNotMatch(source("./youtube-stream.server.ts"), /unlockPlaybackUrl/);
});
```

- [ ] **Step 3: See them fail.** Run:
```bash
npm run build && node --test tests/http/api-guards.test.mjs
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts
```
Expected:
- `api-guards` has `ℹ fail 3`: `400 !== 404` (GET bypass), `400 !== 404` (POST unlock) and `200 !== 404` (GET unlock; the old route has no GET handler and the app shell answers);
- the policy file fails its new test.

All three inputs are answered before any upstream call.

- [ ] **Step 4: Delete the routes and the same-hop server layer.**
```bash
git rm src/routes/api/unlock.ts src/routes/api/bypass.ts src/lib/bypass.server.ts src/lib/bypass-parse.ts src/lib/bypass.test.ts
```
- [ ] **Step 5: `src/routes/api/download.ts` without the same-hop fallback.** Replace everything from `        const { streamYoutubeDownload } = await import("@/lib/youtube.server");` through the `}` that closes the outer `catch (err) { … }` (the line before `      },`) with:
```ts
        const { streamYoutubeDownload } = await import("@/lib/youtube.server");
        try {
          const result = await streamYoutubeDownload(id, itag, request.signal);
          // An error answer (the video-only 422, a 403 block) served no bytes,
          // yet the quota was charged up front — refund it so repeated error
          // responses can't drain a caller's bucket. A 2xx stream keeps its charge.
          if (result.status >= 400) await downloadQuotaRefund(request);
          return result;
        } catch (err) {
          await downloadQuotaRefund(request);
          const message =
            err instanceof Error ? err.message : "Download failed. Try fetching the video again.";
          return Response.json({ error: message }, { status: 502 });
        }
```
The raw `err.message` stays as it was; W4a's error mapping (C2) replaces it (Hand-off).

- [ ] **Step 6: Remove the decipher server fn and the unlock helper.**
  1. `src/lib/resolve-video.ts`:
     - delete the `const cipherSchema = z.object({` block (5 lines: `url`, `signatureCipher`, `cipher`, `});`) and the blank line after it;
     - delete the whole `export const decipherCipher = createServerFn({ method: "POST" })` block (7 lines, ending `    return decipherRawFormat(data);` and `  });`) and the blank line after it.
  2. `src/lib/youtube-stream.server.ts`: delete everything from `export async function unlockPlaybackUrl(input: {` up to, **not including**, `export async function getPlaybackUrl(id: string, itag: number): Promise<PlaybackFile> {`.
  3. `src/lib/youtube.server.ts`: replace
     ```ts
     export {
       decipherRawFormat,
       unlockPlaybackUrl,
       getPlaybackUrl,
       streamYoutubeDownload,
     } from "@/lib/youtube-stream.server";
     ```
     with
     ```ts
     export {
       decipherRawFormat,
       getPlaybackUrl,
       streamYoutubeDownload,
     } from "@/lib/youtube-stream.server";
     ```

- [ ] **Step 7: Regenerate the route tree, then run the tests and the gate.** Run:
```bash
npm run build
git diff --stat src/routeTree.gen.ts
npm run typecheck && npm run lint && npm test
node --test tests/http/*.test.mjs
```
Expected:
- the build regenerates `src/routeTree.gen.ts`: `1 file changed, 42 deletions(-)`, and every removed line belongs to `/api/bypass` or `/api/unlock`;
- the gate is green;
- the HTTP tests report `ℹ fail 0`, including the three new 404 tests.

If the harness needs a database after W2, see Preconditions.

- [ ] **Step 8: Commit.**
```bash
git add -A src/routes/api src/lib/bypass.server.ts src/lib/bypass-parse.ts src/lib/bypass.test.ts src/lib/resolve-video.ts src/lib/youtube-stream.server.ts src/lib/youtube.server.ts src/routeTree.gen.ts tests/http/api-guards.test.mjs src/lib/remote-code-policy.test.ts
git commit -m "fix(api)!: delete /api/unlock, /api/bypass and the same-hop server layer

/api/unlock ran player-script deciphering and a BotGuard mint per call;
/api/bypass relayed watch pages and media through corsfix/allorigins.
Both now answer 404, and /api/download no longer falls back to them.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Run no YouTube player script; ban `eval`, `Function` and `node:vm`

**Executor:** velo-impl-opus-high (youtubei.js client configuration, removes the second remote-code path, lint security boundary)
**Covers:** SEC-01, ARCH-08 (a: `Platform.shim.eval`), M-04 (player-script part), ARCH-23 (technical part: nsig deciphering, throttle-beating range lanes), W1 hand-off to W4b (delete the second `W4b` disable; add ESLint `no-eval`/`no-new-func`/`no-implied-eval` and a `vm` ban; the W1-T3 review's alias gaps: `window["eval"]`, `(0, eval)`, `globalThis.Function`)

**Files:**
- Delete: `src/lib/nsig.ts`, `src/lib/nsig.test.ts`, `src/lib/stream-unlock.ts`, `src/lib/stream-unlock.test.ts`, `src/lib/parallel-stream.ts`, `src/lib/parallel-stream.test.ts`
  - `nsig.test.ts` tests the nsig cache, which is deleted.
  - Of `stream-unlock.test.ts`, the two HLS tests move to `hls.test.ts` verbatim; the other nine test the URL "unlock" (pot, `ratebypass`, `rn`, `alr`, lock analysis), which is deleted.
  - `parallel-stream.test.ts` tests the per-connection throttle lanes, which are deleted.
- Create: `src/lib/hls.ts` (moved code), `src/lib/hls.test.ts` (moved tests), `src/lib/youtube-client.server.test.ts`, `src/lib/youtube-stream.server.test.ts`, `scripts/eval-ban.test.mjs`
- Modify: `src/lib/youtube-client.server.ts`, `src/lib/youtube-stream.server.ts` (full replacement), `src/lib/youtube.server.ts`, `src/lib/iso-bmff.test.ts`, `src/lib/mpeg-ts.test.ts` (import path only), `eslint.config.mjs`, `src/lib/remote-code-policy.test.ts`

**Interfaces:**
- Produces:
  - `getClient()` creates every Innertube client with `retrieve_player: false` and installs no evaluator. youtubei.js therefore never downloads `base.js`, and `Format.decipher()` returns the plain `url` (documented no-player behaviour, `youtubei.js/dist/src/parser/classes/misc/Format.js`). Anything that would need deciphering throws the library's own "provide your own JavaScript evaluator" error (`dist/src/platform/jsruntime/default.js`).
  - `export async function plainFormatUrl(format: Pick<FormatLike, "decipher">): Promise<string>`: the URL as sent, or it throws `This quality isn’t available as a direct download. Pick another quality.`
  - `getPlaybackUrl(id, itag)` returns `{ url, directUrl }`, both the plain URL (no redirector swap, no pot/`ratebypass`/`rn`/`alr` stamping).
  - `streamYoutubeDownload` streams over one connection.
  - `parseHls`/`pickHlsVariant`/`HlsVariant`/`HlsMedia` now live in `src/lib/hls.ts`.
  - Deleted exports: `decipherRawFormat`, `unlockStreamUrl`, `analyzeStreamUrl`, `lockSummary`, `playbackHeaders`, `unlockVariants`, `parsePlaybackUrl`, `orderedParallelStream`, and everything in `nsig.ts`.
- Consumes: Task 4 (`unlockPlaybackUrl`, `decipherCipher` and `bypass.server.ts`, the other users of `decipherRawFormat`/`unlockStreamUrl`, are gone).

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F 'Platform.shim.eval = (data) => new Function(data.output)();' -- src/lib/youtube-client.server.ts
git grep -c -F '      retrieve_player: true,' -- src/lib/youtube-client.server.ts
git grep -c -F 'import { parseHls } from "./stream-unlock.ts";' -- src/lib/iso-bmff.test.ts src/lib/mpeg-ts.test.ts
git grep -c -F 'export type HlsVariant = {' -- src/lib/stream-unlock.ts
git grep -c -F 'export function lockSummary(report: StreamReport): string {' -- src/lib/stream-unlock.ts
git grep -c -F '      "no-restricted-syntax": ["error", ...noInProcessEval],' -- eslint.config.mjs
git grep -n -E 'from "@/lib/(nsig|stream-unlock|parallel-stream)"|import\("@/lib/(nsig|stream-unlock|parallel-stream)"\)|from "\./(nsig|stream-unlock|parallel-stream)\.ts"' -- src
```
Expected: `:1`, `:2`, `src/lib/iso-bmff.test.ts:1` and `src/lib/mpeg-ts.test.ts:1`, then `:1` ×3. The last grep prints only:
- `youtube-stream.server.ts` ×2 (the `nsig` and `parallel-stream` imports);
- `youtube-stream.server.ts` ×1 (the dynamic `stream-unlock` import in `decorateUrls`);
- the three test imports (`iso-bmff.test.ts`, `mpeg-ts.test.ts`, `stream-unlock.test.ts`);
- `nsig.test.ts`, `parallel-stream.test.ts`.

Anything else: STOP.

- [ ] **Step 2: Write the failing tests.**

Create `src/lib/youtube-client.server.test.ts`:
```ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Load the real module, with its server-only neighbours stubbed: the user-proxy
// store needs a database and the ipv4 pin patches process-wide networking.
const STUBS: Record<string, string> = {
  "@/lib/user-proxy.server": "export async function proxiedFetch(input, init) { return fetch(input, init); }",
  "@/lib/ipv4-bind.server": "export {};",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in STUBS) return { url: `velo-stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("velo-stub:")) {
      return { format: "module", source: STUBS[url.slice("velo-stub:".length)] ?? "export {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test("loading the InnerTube client installs no JavaScript evaluator", async () => {
  await import("./youtube-client.server.ts");
  const { Platform } = await import("youtubei.js");
  // Still youtubei.js's own default, which throws "you must provide your own
  // JavaScript evaluator" instead of running player code (ytjs.dev guide).
  // Read as source, not called: calling it is exactly what the lint ban forbids.
  assert.match(String(Platform.shim.eval), /provide your own JavaScript evaluator/);
});
```

Create `src/lib/youtube-stream.server.test.ts`:
```ts
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Load the real module; only the user-proxy store (it needs a database) is stubbed.
const STUBS: Record<string, string> = {
  "@/lib/user-proxy.server": "export async function proxiedFetch(input, init) { return fetch(input, init); }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in STUBS) return { url: `velo-stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("velo-stub:")) {
      return { format: "module", source: STUBS[url.slice("velo-stub:".length)] ?? "export {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test("a format URL is used exactly as YouTube sent it, with no player", async () => {
  const { plainFormatUrl } = await import("./youtube-stream.server.ts");
  const calls: unknown[][] = [];
  const url = "https://r1.googlevideo.com/videoplayback?itag=18&n=raw";
  const got = await plainFormatUrl({
    decipher: async (...args: unknown[]) => {
      calls.push(args);
      return url;
    },
  });
  assert.equal(got, url);
  assert.deepEqual(calls, [[]], "decipher() gets no player, so nothing is deciphered");
});

test("a signatureCipher-only format is refused with a fixed message", async () => {
  const { plainFormatUrl } = await import("./youtube-stream.server.ts");
  await assert.rejects(
    plainFormatUrl({ decipher: async () => "" }),
    { message: "This quality isn’t available as a direct download. Pick another quality." },
  );
});
```

Create `scripts/eval-ban.test.mjs`:
```js
// The lint ban on in-process evaluation (roadmap D7/C5, W4b). Each snippet is
// linted as if it were a file in src/ and must be rejected by the named rule,
// so a config edit that silently drops a rule fails here, not in review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
const PROBE = "src/lib/eval-ban-probe.server.ts";

const CASES = [
  ["eval(code);", "no-eval"],
  ["(0, eval)(code);", "no-restricted-syntax"],
  ["globalThis.eval(code);", "no-restricted-syntax"],
  ["new Function(code);", "no-new-func"],
  ["Function(code)();", "no-new-func"],
  ["globalThis.Function(code)();", "no-restricted-syntax"],
  ['setTimeout("run()", 1);', "no-implied-eval"],
  ['import vm from "node:vm";\nvm.runInThisContext(code);', "no-restricted-imports"],
  ['import { runInNewContext } from "vm";\nrunInNewContext(code);', "no-restricted-imports"],
  ['await import("node:vm");', "no-restricted-syntax"],
  ['process.getBuiltinModule("node:vm");', "no-restricted-syntax"],
];

for (const [snippet, rule] of CASES) {
  test(`lint rejects ${JSON.stringify(snippet.split("\n")[0])} (${rule})`, async () => {
    const code = `declare const code: string;\n${snippet}\nexport {};\n`;
    const [result] = await eslint.lintText(code, { filePath: PROBE });
    const hits = result.messages.filter((m) => m.ruleId === rule && m.severity === 2);
    assert.ok(hits.length > 0, `${rule} did not fire: ${JSON.stringify(result.messages)}`);
  });
}

test("ordinary code passes the ban", async () => {
  const code = 'const n = JSON.parse("1");\nsetTimeout(() => n, 1);\nexport {};\n';
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  assert.deepEqual(result.messages.map((m) => m.ruleId), []);
});
```

Append to `src/lib/remote-code-policy.test.ts`, and change its `node:fs` import line to `import { existsSync, readdirSync, readFileSync } from "node:fs";`:
```ts

test("the server downloads and runs no YouTube player script", () => {
  for (const file of ["./nsig.ts", "./stream-unlock.ts", "./parallel-stream.ts"]) {
    assert.equal(existsSync(here(file)), false, file);
  }
  const client = source("./youtube-client.server.ts");
  assert.doesNotMatch(client, /Platform|shim\.eval|new Function|retrieve_player: true/);
  assert.equal(client.match(/retrieve_player: false,/g)?.length, 2);
  assert.doesNotMatch(source("./youtube-stream.server.ts"), /session\.player|nsig|decipherRawFormat|rn=/);
});

test("no module in src/ imports node:vm", () => {
  const vm = /\bfrom\s*["'](node:)?vm["']|import\(\s*["'](node:)?vm["']\s*\)|require\(\s*["'](node:)?vm["']\s*\)|getBuiltinModule\(\s*["'](node:)?vm["']/;
  const root = here("../");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) =>
    /\.(ts|tsx|js|mjs)$/.test(name),
  );
  assert.ok(files.length > 100, "walked src/");
  for (const name of files) {
    assert.doesNotMatch(readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8"), vm, name);
  }
});
```

- [ ] **Step 3: See them fail.** Run:
```bash
node --experimental-strip-types --test src/lib/youtube-client.server.test.ts src/lib/youtube-stream.server.test.ts src/lib/remote-code-policy.test.ts
node --test scripts/eval-ban.test.mjs
```
Expected:
- `loading the InnerTube client installs no JavaScript evaluator` fails. The installed shim's source is `(data) => new Function(data.output)()`, so `The input did not match /provide your own JavaScript evaluator/`.
- Both `youtube-stream.server` tests fail (`plainFormatUrl is not a function`).
- The policy test `the server downloads and runs no YouTube player script` fails (`nsig.ts`).
- `no module in src/ imports node:vm` already passes; it pins the state from here on.
- `eval-ban` has `ℹ fail 10`, `ℹ pass 2`. `globalThis.eval` and "ordinary code" are already right; every other rule "did not fire".

- [ ] **Step 4: Configure the youtubei.js client with no evaluator and no player.** In `src/lib/youtube-client.server.ts`:
  1. Replace `import { Innertube, Platform } from "youtubei.js";` with `import { Innertube } from "youtubei.js";`.
  2. Replace
     ```ts
     // eslint-disable-next-line no-restricted-syntax -- W4b deletes this code path (C5) and this line
     Platform.shim.eval = (data) => new Function(data.output)();
     ```
     with
     ```ts
     // No JavaScript evaluator is installed and every client is created with
     // `retrieve_player: false` (roadmap D7/C5): the server never downloads or runs
     // YouTube's player script. youtubei.js then returns format URLs exactly as
     // YouTube sent them, and anything that would need deciphering throws the
     // library's own "provide your own JavaScript evaluator" error.
     ```
  3. Replace both occurrences of `      retrieve_player: true,` with `      retrieve_player: false,` (replace-all; exactly two: the session client and the shared client).

- [ ] **Step 5: Replace `src/lib/youtube-stream.server.ts` entirely with:**
```ts
import { fileBasename } from "@/lib/safe-filename";
import { getClient, getPlayableInfo, STREAM_HEADERS, type PlayableInfo } from "@/lib/youtube-client.server";
import { containerExt } from "@/lib/youtube-map.server";

function contentDisposition(title: string, ext: string): string {
  const base = fileBasename(title);
  const ascii = `${base.replace(/[^\x20-\x7E]/g, "_")}.${ext}`;
  const encoded = encodeURIComponent(`${base}.${ext}`).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

type FormatLike = {
  itag: number;
  mime_type: string;
  has_audio: boolean;
  has_video: boolean;
  content_length?: number;
  is_type_otf?: boolean;
  url?: string;
  decipher: (player?: unknown) => Promise<string>;
};

async function findRawFormat(id: string, itag: number): Promise<{ format: FormatLike; title: string }> {
  const yt = await getClient();
  let info: PlayableInfo;
  try {
    info = await getPlayableInfo(yt, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach YouTube.";
    throw new Error(message.replace(/^InnertubeError:\s*/i, ""));
  }
  const status = info.playability_status?.status;
  if (status && status !== "OK") {
    throw new Error(info.playability_status?.reason || "YouTube won’t play this video.");
  }
  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const format = raw.find((f) => f.itag === itag);
  if (!format || (format as { is_type_otf?: boolean }).is_type_otf) {
    throw new Error("That quality is no longer available. Fetch the video again.");
  }
  return {
    format: format as unknown as FormatLike,
    title: info.basic_info.title?.trim() || "video",
  };
}

/**
 * The format's URL exactly as YouTube returned it. The client is created with
 * `retrieve_player: false`, so there is no player script: youtubei.js's
 * documented no-player `decipher()` returns the plain `url` (or "" for a
 * format that only carries a signatureCipher). Nothing is deciphered and no
 * YouTube JavaScript runs (roadmap D7/C5).
 */
export async function plainFormatUrl(format: Pick<FormatLike, "decipher">): Promise<string> {
  const url = await format.decipher();
  if (!url) throw new Error("This quality isn’t available as a direct download. Pick another quality.");
  return url;
}

function appendParam(url: string, key: string, value: string): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
}

/**
 * One media fetch. When the operator configured an http(s) proxy, the request
 * rides it through undici's own fetch (Node's global fetch rejects a foreign
 * undici dispatcher); otherwise it is the plain global fetch.
 */
async function openStream(url: string, range?: { start: number; end: number }, signal?: AbortSignal): Promise<Response> {
  const target = range ? appendParam(url, "range", `${range.start}-${range.end}`) : url;
  const { proxiedFetch } = await import("@/lib/user-proxy.server");
  const response = await proxiedFetch(target, {
    headers: STREAM_HEADERS,
    signal,
    redirect: "follow",
  });
  return response;
}

/**
 * A googlevideo "200" carrying an HTML or JSON body is a soft-block page, not
 * media. The download route sees a 403 instead of streaming the page as video.
 */
function isBlock(type: string | null, status: number): boolean {
  if (status < 200 || status >= 300) return true;
  const mime = (type ?? "").toLowerCase();
  return mime.includes("text/html") || mime.includes("application/json");
}

const BLOCKED = "YouTube refused to serve this file to the server. Try again later or pick another quality.";

export type PlaybackFile = {
  url: string;
  directUrl: string;
  filename: string;
  mime: string;
  ext: string;
  size: number | null;
};

export async function getPlaybackUrl(id: string, itag: number): Promise<PlaybackFile> {
  const { format, title } = await findRawFormat(id, itag);
  const url = await plainFormatUrl(format);
  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  return {
    url,
    directUrl: url,
    filename: `${fileBasename(title)}.${ext}`,
    mime,
    ext,
    size: typeof format.content_length === "number" ? format.content_length : null,
  };
}

export async function streamYoutubeDownload(
  id: string,
  itag: number,
  signal?: AbortSignal,
): Promise<Response> {
  // The client may abort (Close, a new Save) while this resolves; without these
  // checks the server keeps resolving and probing googlevideo for a connection
  // that is already gone.
  if (signal?.aborted) throw new Error("aborted");
  const { format, title } = await findRawFormat(id, itag);
  if (format.has_video && !format.has_audio) {
    return Response.json(
      { error: "This quality is video-only. Save uses yt-dlp to mux 137+140." },
      { status: 422 },
    );
  }
  const url = await plainFormatUrl(format);
  if (signal?.aborted) throw new Error("aborted");

  const ext = containerExt(format.mime_type, format.has_video);
  const mime = format.mime_type.split(";")[0]?.trim() || "application/octet-stream";
  const size = format.content_length;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(title, ext),
    "Cache-Control": "no-store",
  };

  const probe = await openStream(url, { start: 0, end: 2047 }, signal);
  if (isBlock(probe.headers.get("content-type"), probe.status)) {
    await probe.body?.cancel().catch(() => undefined);
    return Response.json({ error: BLOCKED }, { status: 403 });
  }
  await probe.body?.cancel().catch(() => undefined);

  const upstream = await openStream(url, undefined, signal);
  if (isBlock(upstream.headers.get("content-type"), upstream.status) || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return Response.json({ error: BLOCKED }, { status: 403 });
  }

  const length = upstream.headers.get("content-length") || (size ? String(size) : null);
  if (length) headers["Content-Length"] = length;

  return new Response(upstream.body, { status: 200, headers });
}
```
Then in `src/lib/youtube.server.ts`, replace
```ts
export {
  decipherRawFormat,
  getPlaybackUrl,
  streamYoutubeDownload,
} from "@/lib/youtube-stream.server";
```
with `export { getPlaybackUrl, streamYoutubeDownload } from "@/lib/youtube-stream.server";`.

- [ ] **Step 6: Move the HLS parser out of `stream-unlock.ts`, then delete the unlock/nsig/lane modules.**
  1. Create `src/lib/hls.ts` with this header:
     ```ts
     /**
      * HLS playlist parsing: master variants (bandwidth, height, codecs, audio
      * group) and media segments (EXT-X-MAP init + segment URIs). Pure and
      * network-free.
      */
     ```
     Directly below it, paste **verbatim** everything from `src/lib/stream-unlock.ts` that starts at `export type HlsVariant = {` and ends just before `export function lockSummary(report: StreamReport): string {`. That is `HlsVariant`, `HlsMedia`, `codecFlags`, `parseHls` and `pickHlsVariant`, about 115 lines, unchanged. End the file with one newline.
  2. Create `src/lib/hls.test.ts` with these three lines and a blank line:
     ```ts
     import assert from "node:assert/strict";
     import { test } from "node:test";
     import { parseHls, pickHlsVariant } from "./hls.ts";
     ```
     then paste **verbatim** the two tests `test("pickHlsVariant returns null when no variant carries video", …)` and `test("parses HLS master and media playlists", …)` from `src/lib/stream-unlock.test.ts`.
  3. In `src/lib/iso-bmff.test.ts` and `src/lib/mpeg-ts.test.ts`, replace `import { parseHls } from "./stream-unlock.ts";` with `import { parseHls } from "./hls.ts";`.
  4. Delete:
     ```bash
     git rm src/lib/nsig.ts src/lib/nsig.test.ts src/lib/stream-unlock.ts src/lib/stream-unlock.test.ts src/lib/parallel-stream.ts src/lib/parallel-stream.test.ts
     ```

- [ ] **Step 7: Extend the lint ban.** In `eslint.config.mjs`:
  1. Replace
     ```js
     /**
      * The server never executes remote JavaScript (roadmap D7/C5). These are the
      * in-process escape hatches; W4b deletes the remaining uses.
      */
     const UNTRUSTED_EVAL_MESSAGE =
       "Do not evaluate code in-process. The server never executes remote JavaScript (roadmap C5, D7).";
     const noInProcessEval = [
       { selector: "NewExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.property.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.property.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
     ];
     ```
     with
     ```js
     /**
      * The server never executes remote JavaScript (roadmap D7/C5). ESLint's core
      * `no-eval`, `no-implied-eval` and `no-new-func` cover the direct forms; these
      * selectors add the aliased ones they miss (`globalThis.Function(...)`,
      * `x.eval(...)`, `(0, eval)(...)`) and every way to reach `node:vm`.
      */
     const UNTRUSTED_EVAL_MESSAGE =
       "Do not evaluate code in-process. The server never executes remote JavaScript (roadmap C5, D7).";
     const VM_MODULE = "/^(node:)?vm$/";
     const noInProcessEval = [
       { selector: "NewExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "NewExpression[callee.property.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.property.name='Function']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.property.name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "SequenceExpression > Identifier[name='eval']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: "CallExpression[callee.property.name='runInThisContext']", message: UNTRUSTED_EVAL_MESSAGE },
       { selector: `ImportExpression[source.value=${VM_MODULE}]`, message: UNTRUSTED_EVAL_MESSAGE },
       {
         selector: `CallExpression[callee.name='require'][arguments.0.value=${VM_MODULE}]`,
         message: UNTRUSTED_EVAL_MESSAGE,
       },
       {
         selector: `CallExpression[callee.property.name='getBuiltinModule'][arguments.0.value=${VM_MODULE}]`,
         message: UNTRUSTED_EVAL_MESSAGE,
       },
     ];
     ```
  2. Replace `      "no-restricted-syntax": ["error", ...noInProcessEval],` with:
     ```js
           "no-eval": "error",
           "no-implied-eval": "error",
           "no-new-func": "error",
           "no-restricted-syntax": ["error", ...noInProcessEval],
           "no-restricted-imports": [
             "error",
             {
               paths: [
                 { name: "vm", message: UNTRUSTED_EVAL_MESSAGE },
                 { name: "node:vm", message: UNTRUSTED_EVAL_MESSAGE },
               ],
             },
           ],
     ```

- [ ] **Step 8: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/youtube-client.server.test.ts src/lib/youtube-stream.server.test.ts src/lib/remote-code-policy.test.ts src/lib/hls.test.ts src/lib/iso-bmff.test.ts src/lib/mpeg-ts.test.ts
node --test scripts/eval-ban.test.mjs
git grep -n -E 'W4b deletes|new Function|shim\.eval|decipherRawFormat|unlockStreamUrl|nsigCache|orderedParallelStream|ratebypass' -- src ':!src/lib/remote-code-policy.test.ts' ':!src/lib/youtube-client.server.test.ts'
npm run typecheck && npm run lint && npm test && npm run build && node --test tests/http/*.test.mjs
```
Expected:
- the six unit files and `eval-ban` have 0 failures (`eval-ban`: `ℹ pass 12`);
- the grep prints nothing;
- the gate, the build and the HTTP tests are green;
- lint passing shows the second `W4b` disable is gone and no remaining code trips the wider ban.

- [ ] **Step 9: Commit.**
```bash
git add -A src/lib scripts/eval-ban.test.mjs eslint.config.mjs
git commit -m "fix(security)!: run no YouTube player script; ban eval, Function and node:vm

youtubei.js now runs with retrieve_player: false and no evaluator, so the
server never downloads or runs base.js; format URLs are used as sent, with
no nsig/signature deciphering, pot/ratebypass stamping or parallel range
lanes. Lint adds no-eval, no-new-func, no-implied-eval, the aliased forms
and a node:vm ban, pinned by a lint-probe test.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Remove the process-wide IPv4 and dispatcher patch

**Executor:** velo-impl-sonnet-high (exact delete list, verbatim test)
**Covers:** ARCH-12, M-34 (the ARCH-12 half), TEST-13 (the W4b half: the process-global `NODE_TLS_REJECT_UNAUTHORIZED` in `ipv4-bind.test.ts` goes with the file)

**Why no replacement (ARCH-12's "scoped, per-request option"):**
- `ipv4-bind.server.ts` exists for a Grok-sandbox IPv6/NAT mismatch (ULA IPv6 player call, NAT IPv4 CDN fetch).
- The only paths that crossed Node's resolver with a separate player/CDN pair were the minter and the same-hop relays, all deleted by Tasks 2–4.
- yt-dlp does not inherit Node's `dns.lookup` patch at all. It keeps its own scoped `--force-ipv4` on direct runs (`ytdlpFamilyArgs`), which is exactly ARCH-12's per-process option.
- The remaining Node fetches for one video (InnerTube player call, then `/api/download` or `/api/relay` from the same process) use one resolver and one family.
- The global dispatcher's `allowH2: false` only worked around a fault the dispatcher itself caused. Node's bundled fetch with its own default dispatcher has no header-stripping problem.
- A host with genuinely broken dual-stack egress sets `NODE_OPTIONS=--dns-result-order=ipv4first`. That is an operator knob documented in "Behaviour changes", not code.

**Files:**
- Delete: `src/lib/ipv4-bind.server.ts`, `src/lib/ipv4-bind.test.ts`. The test deletes with its module:
  - the IPv4-pin, ULA and diagnosis tests test deleted code;
  - the "SOCKS … socks5h" and "direct hops pin IPv4" cases duplicate `ytdlp-auth.test.ts` ("socks proxy is passed to yt-dlp…" asserts `--force-ipv4` absence with a proxy and `ytdlpFamilyArgs`);
  - the h2 dispatcher test tests the deleted dispatcher.
- Modify: `src/lib/youtube-client.server.ts`, `src/lib/ytdlp-proc.server.ts`, `src/lib/ytdlp.server.ts`, `src/routes/api/builder.ts`, `src/routes/api/download.ts`, `src/routes/api/relay.ts`, `src/routes/api/ytdlp.ts` (one import line each), `package.json` (`sideEffects`), `src/lib/youtube-copy.ts` + `src/lib/youtube.ts` (dead `IPV6_TROUBLESHOOT`, whose only reader was `ipv4-bind.test.ts`), `src/lib/youtube-client.server.test.ts`, `src/lib/remote-code-policy.test.ts`

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -n -F 'import "@/lib/ipv4-bind.server";' -- src
git grep -c -F '    "src/lib/ipv4-bind.server.ts"' -- package.json
git grep -n -E 'IPV6_TROUBLESHOOT|ipv4-bind' -- src ':!src/lib/ipv4-bind.server.ts'
```
Expected:
- the first grep prints exactly 7 lines: `youtube-client.server.ts`, `ytdlp-proc.server.ts`, `ytdlp.server.ts` and `routes/api/{builder,download,relay,ytdlp}.ts`;
- then `:1`;
- the last grep prints those 7 plus `ipv4-bind.test.ts` (×3), `youtube-client.server.test.ts` (the stub, ×1), `youtube-copy.ts:…export const IPV6_TROUBLESHOOT = [` and `youtube.ts:…  IPV6_TROUBLESHOOT,`.

Anything else: STOP.

- [ ] **Step 2: Write the failing tests.** In `src/lib/youtube-client.server.test.ts`:
  1. Replace
     ```ts
     import assert from "node:assert/strict";
     import { registerHooks } from "node:module";
     import { test } from "node:test";
     ```
     with
     ```ts
     import assert from "node:assert/strict";
     import dns from "node:dns";
     import { registerHooks } from "node:module";
     import net from "node:net";
     import { test } from "node:test";

     // Captured before anything below imports app code.
     const pristine = {
       lookup: dns.lookup,
       order: dns.getDefaultResultOrder(),
       autoSelectFamily: net.getDefaultAutoSelectFamily(),
     };
     ```
  2. Replace
     ```ts
     // Load the real module, with its server-only neighbours stubbed: the user-proxy
     // store needs a database and the ipv4 pin patches process-wide networking.
     const STUBS: Record<string, string> = {
       "@/lib/user-proxy.server": "export async function proxiedFetch(input, init) { return fetch(input, init); }",
       "@/lib/ipv4-bind.server": "export {};",
     };
     ```
     with
     ```ts
     // Load the real module, with the user-proxy store (it needs a database) stubbed.
     const STUBS: Record<string, string> = {
       "@/lib/user-proxy.server": "export async function proxiedFetch(input, init) { return fetch(input, init); }",
     };
     ```
  3. Append:
     ```ts

     test("loading the InnerTube client leaves process-wide DNS and socket defaults alone", async () => {
       await import("./youtube-client.server.ts");
       assert.equal(dns.lookup, pristine.lookup);
       assert.equal(dns.getDefaultResultOrder(), pristine.order);
       assert.equal(net.getDefaultAutoSelectFamily(), pristine.autoSelectFamily);
     });
     ```
  Append to `src/lib/remote-code-policy.test.ts`:
```ts

test("nothing patches process-wide DNS or the global fetch dispatcher", () => {
  assert.equal(existsSync(here("./ipv4-bind.server.ts")), false);
  const root = here("../");
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith("remote-code-policy.test.ts")) continue;
    const text = readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(text, /ipv4-bind|setGlobalDispatcher|dns\.lookup\s*=|setDefaultAutoSelectFamily/, name);
  }
  assert.doesNotMatch(source("../../package.json"), /sideEffects/);
});
```
Run: `node --experimental-strip-types --test src/lib/youtube-client.server.test.ts src/lib/remote-code-policy.test.ts`
Expected: `ℹ fail 2`:
- `leaves process-wide DNS and socket defaults alone` fails because the real `ipv4-bind.server.ts` now loads and replaces `dns.lookup`;
- the policy test fails on `existsSync`.

- [ ] **Step 3: Delete the patch and its importers.**
```bash
git rm src/lib/ipv4-bind.server.ts src/lib/ipv4-bind.test.ts
```
  1. Delete the line `import "@/lib/ipv4-bind.server";` from each of the 7 files in Step 1.
  2. `package.json`: replace
     ```json
       "private": true,
       "sideEffects": [
         "src/lib/ipv4-bind.server.ts"
       ],
     ```
     with `  "private": true,`. With no `sideEffects` key, the bundler treats every module as side-effectful, which is the safe default.
  3. `src/lib/youtube.ts`: in the `export { … } from "./youtube-copy.ts";` list, delete the line `  IPV6_TROUBLESHOOT,`.
  4. `src/lib/youtube-copy.ts`: delete everything from the line `/** Product copy for mixed IPv6 player / IPv4 CDN 403s. */` to the end of the file, then end the file with one newline after the preceding `] as const;`.

- [ ] **Step 4: Verify.** Run:
```bash
git grep -n -E 'ipv4-bind|IPV6_TROUBLESHOOT|setGlobalDispatcher|pinIpv4' -- src package.json ':!src/lib/remote-code-policy.test.ts'
node --experimental-strip-types --test src/lib/youtube-client.server.test.ts src/lib/remote-code-policy.test.ts
npm run typecheck && npm run lint && npm test && npm run build && node --test tests/http/*.test.mjs
```
Expected: the grep prints nothing, both files pass, and the gate, the build and the HTTP tests are green.

- [ ] **Step 5: Commit.**
```bash
git add -A src/lib src/routes/api package.json
git commit -m "fix(net): remove the process-wide IPv4 and dispatcher patch

Importing ipv4-bind.server.ts replaced dns.lookup, disabled Happy Eyeballs
and installed an HTTP/1-only undici dispatcher for the whole process, to
fix a Grok-sandbox IPv6/NAT mismatch for the paths W4b deleted. yt-dlp keeps
its own per-run --force-ipv4 (audit ARCH-12).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 7: Remove the free SOCKS pool and the public CORS relays

**Executor:** velo-impl-opus-high (rewires the yt-dlp download and metadata ladders, the proxy route selector and `/api/relay`)
**Covers:** SEC-04, SUP-05, SEC-14, ARCH-09, SEC-07 (the third-party CORS fan-out part), PRIV-09 (relay and proxy parts), M-14

**Scope split with W4a.** The roadmap table lists "free proxies and CORS relays" under W4a, and the W4b brief moves the deletion here. This task edits exactly two things in `src/routes/api/relay.ts`: the `publicRelayUrls` import and the one `attempts` line, plus three comments. W4a still owns the rest of that handler:
- `isRelayTarget` exact hosts, paths and ports (SEC-07 allowlist, TEST-18);
- dropping upstream `Content-Disposition`;
- `requireSameOrigin`;
- `apiError`.

W4a plans against the post-W4b tree (see Hand-off).

**Files:**
- Delete: `src/lib/socks-pool.server.ts`, `src/lib/socks-pool.test.ts`. The test goes with the pool: `normalizeSocksUrl` and the probe URL.
- Modify:
  - yt-dlp ladders: `src/lib/ytdlp.server.ts`, `src/lib/ytdlp-meta.server.ts`, `src/lib/ytdlp-meta-routing.ts` (+ `.test.ts`), `src/lib/ytdlp-fallback-contract.test.ts`;
  - proxy routing: `src/lib/proxy-selector.server.ts` (+ `.test.ts`), `src/lib/user-proxy.server.ts`, `src/lib/ytdlp-python.server.ts`, `src/lib/user-proxy-parse.ts` (comment);
  - relays: `src/lib/cors-relays.ts` (+ `.test.ts`), `src/routes/api/relay.ts`;
  - `src/lib/remote-code-policy.test.ts`.

**Interfaces:**
- Produces:
  - `SelectedRoute = { kind: "proxy"; … } | { kind: "direct"; … }`; the `free_socks` kind is gone.
  - `selectProxyRoutes(routes, capability)`; the third parameter is gone.
  - `attemptYtdlpMetadataLadder(userRoutes, attemptSaved, attemptDirect, usable)`: saved operator routes, then the gated direct attempt. It no longer passes `allowDirectFallback: false`.
  - The yt-dlp download ladder is: saved operator routes → gated direct probe → ungated direct loop.
  - `cors-relays.ts` exports only `isRelayTarget`, `isMediaHostTarget` and `localRelayUrl`.
  - `/api/relay` fetches the target itself and nothing else.
  - `VELO_SOCKS_PROXY` and `ALL_PROXY` are no longer read.
  - Removed: `ensurePySocks`, which ran a runtime `pip install PySocks`. yt-dlp's `--proxy socks5h://…` does not need PySocks.
- Consumes: Task 1 (`hybrid-net.ts` no longer imports `publicRelayUrls`/`relayHost`), Task 4 (`bypass.server.ts`, the other `PUBLIC_RELAYS` user, is gone).

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -n -E 'socks-pool|takeSocks|markSocks|releaseSocks|ensurePySocks|free_socks|PUBLIC_RELAYS|publicRelayUrls|isPublicHtmlTarget|allRelayUrls|relayHost|RelaySpec|VELO_SOCKS_PROXY|ALL_PROXY' -- src ':!src/lib/socks-pool.server.ts' ':!src/lib/remote-code-policy.test.ts' | awk -F: '{print $1}' | sort | uniq -c
git grep -c -F '        const attempts = [target, ...publicRelayUrls(target)];' -- src/routes/api/relay.ts
```
Expected, exactly:
```text
      6 src/lib/cors-relays.test.ts
      9 src/lib/cors-relays.ts
      2 src/lib/proxy-selector.server.test.ts
      2 src/lib/proxy-selector.server.ts
      1 src/lib/socks-pool.test.ts
      1 src/lib/user-proxy.server.ts
      1 src/lib/user-proxy-parse.ts
      7 src/lib/ytdlp.server.ts
      7 src/lib/ytdlp-meta.server.ts
      2 src/lib/ytdlp-meta-routing.ts
      1 src/lib/ytdlp-python.server.ts
      4 src/routes/api/relay.ts
src/routes/api/relay.ts:1
```
The `relay.ts` count includes its `relayHeaders(upstream, relayHost)` parameter, which stays. Any other file: STOP.

- [ ] **Step 2: Write the failing tests.**
  1. Append to `src/lib/remote-code-policy.test.ts`:
     ```ts

     test("no source file names a free proxy list, a public CORS relay or the BotGuard library", () => {
       const banned = /proxifly|free-proxy-list|corsfix|allorigins|bgutils/i;
       const repo = here("../../");
       const self = "remote-code-policy.test.ts";
       let scanned = 0;
       for (const dir of ["src", "scripts", "server", "public", "packages"]) {
         const base = new URL(`${dir}/`, repo);
         if (!existsSync(base)) continue;
         for (const name of readdirSync(base, { recursive: true, encoding: "utf8" })) {
           if (!/\.(ts|tsx|js|mjs|cjs|json|html|css)$/.test(name) || name.endsWith(self)) continue;
           scanned += 1;
           assert.doesNotMatch(readFileSync(new URL(name.replaceAll("\\", "/"), base), "utf8"), banned, `${dir}/${name}`);
         }
       }
       for (const file of ["package.json", "vite.config.ts"]) {
         scanned += 1;
         assert.doesNotMatch(readFileSync(new URL(file, repo), "utf8"), banned, file);
       }
       assert.ok(scanned > 100, "walked the source tree");
       assert.equal(existsSync(here("./socks-pool.server.ts")), false);
     });
     ```
  2. `src/lib/ytdlp-fallback-contract.test.ts`: replace the whole first test
     ```ts
     test("Given failed saved yt-dlp routes, When the download caller continues, Then a gated direct probe, then free routes, precede the ungated direct fallback", async () => {
       const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
       const saved = source.indexOf("const savedOutcome");
       const probe = source.indexOf("directYtdlpOpen()", saved);
       const free = source.indexOf("if (!loggedIn) {", probe);
       const direct = source.indexOf("Direct is the final fallback", free);
       assert.ok(saved >= 0 && probe > saved && free > probe && direct > free);
       // A failed probe must close the window, or blocked hosts pay it every save.
       assert.match(source, /markDirectYtdlpBlocked\(\)/);
       // Formats and subtitles take the same direct-first hop before free SOCKS.
       const meta = await readFile(new URL("./ytdlp-meta.server.ts", import.meta.url), "utf8");
       assert.match(meta, /markDead: markDirectYtdlpBlocked/);
       assert.equal(meta.match(/runHops\(null, tryHop\)/g)?.length, 2);
       assert.match(source, /allowDirectFallback: false/);
       assert.equal(source.includes("savedRoutes.length === 0"), false);
     });
     ```
     with
     ```ts
     test("Given failed saved yt-dlp routes, When the download caller continues, Then a gated direct probe precedes the ungated direct fallback and no free route exists", async () => {
       const source = await readFile(new URL("./ytdlp.server.ts", import.meta.url), "utf8");
       const saved = source.indexOf("const savedOutcome");
       const probe = source.indexOf("directYtdlpOpen()", saved);
       const direct = source.indexOf("Direct is the final fallback", probe);
       assert.ok(saved >= 0 && probe > saved && direct > probe);
       // A failed probe must close the window, or blocked hosts pay it every save.
       assert.match(source, /markDirectYtdlpBlocked\(\)/);
       // Roadmap D7/M-14: no public SOCKS pool anywhere in the ladder.
       assert.doesNotMatch(source, /takeSocks|socks-pool/);
       // Formats and subtitles take the same gated direct hop after saved routes.
       const meta = await readFile(new URL("./ytdlp-meta.server.ts", import.meta.url), "utf8");
       assert.match(meta, /markDead: markDirectYtdlpBlocked/);
       assert.equal(meta.match(/runHops\(null, tryHop\)/g)?.length, 2);
       assert.doesNotMatch(meta, /takeSocks|socks-pool/);
       assert.match(source, /allowDirectFallback: false/);
       assert.equal(source.includes("savedRoutes.length === 0"), false);
     });
     ```
     In the second test, delete the line `  assert.match(source, /attempt\(client, proxy\)/);`. The pool attempt is gone; the saved-route and `cookiePath` assertions stay.
  3. `src/lib/proxy-selector.server.test.ts`: replace the test `Given only incapable or skipped routes, When yt-dlp routes are selected, Then free SOCKS and direct remain ordered fallbacks` and the `for (const capability …)` test after it (from `test("Given only incapable or skipped routes` through the `});` that closes the `for` test) with:
     ```ts
     test("Given only incapable or skipped routes, When yt-dlp routes are selected, Then direct is the only fallback", () => {
       // Given / When
       const selected = selectProxyRoutes([route("x", 1, "http", false)], "ytdlp");
       // Then
       assert.deepEqual(selected.map((item) => item.kind), ["direct"]);
     });

     for (const capability of ["metadata", "media", "ytdlp"] as const) test(`Given ${capability} consumers, When configured attempts fail, Then the ledger preserves configured then direct fallback order`, async () => {
       const routes = selectProxyRoutes([route("b", 2, "http"), route("a", 1, "http")], capability);
       const ledger = await attemptSelectedRoutes(routes, async (selected) => selected.kind === "direct" ? { ok: true, value: "direct-ok" } : { ok: false });
       assert.deepEqual(ledger.attempted.map((selected) => selected.kind === "proxy" ? selected.id : selected.kind), ["a", "b", "direct"]);
       assert.deepEqual(ledger.attempted.map((selected) => selected.trusted), [true, true, false]);
       assert.equal(ledger.result, "direct-ok");
     });
     ```
  4. `src/lib/ytdlp-meta-routing.test.ts`:
     - in the first test, replace
       ```ts
           async () => { attempts.push("free"); return "free-result"; },
           (value) => value.length > 0,
         );
         assert.equal(result, "free-result");
         assert.deepEqual(attempts, ["http://first:80", "http://second:80", "free"]);
       ```
       with
       ```ts
           async () => { attempts.push("direct"); return "direct-result"; },
           (value) => value.length > 0,
         );
         assert.equal(result, "direct-result");
         assert.deepEqual(attempts, ["http://first:80", "http://second:80", "direct"]);
       ```
     - in the source-wiring test, replace `  assert.match(adapter, /allowDirectFallback: false/);` with `  assert.doesNotMatch(adapter, /free_socks/);`.
  5. `src/lib/cors-relays.test.ts`:
     - replace the import with `import { isRelayTarget, localRelayUrl } from "./cors-relays.ts";`;
     - replace the whole test `test("public CORS hops are HTML-only; googlevideo stays on the local hop", () => {` … `});` with:
       ```ts
       test("the only relay is this app's own /api/relay", () => {
         const page = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
         assert.equal(localRelayUrl(page), `/api/relay?url=${encodeURIComponent(page)}`);
       });
       ```

  Run: `node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/ytdlp-fallback-contract.test.ts src/lib/proxy-selector.server.test.ts src/lib/ytdlp-meta-routing.test.ts src/lib/cors-relays.test.ts`
  Expected failures:
  - the policy test: `src/lib/cors-relays.ts` or `src/lib/socks-pool.server.ts` matches `corsfix`/`proxifly`;
  - the fallback-contract test: `takeSocks` found;
  - `ytdlp-meta-routing`: `free_socks` found;
  - `proxy-selector` and `cors-relays` already pass: without a third argument the old `selectProxyRoutes` returns no free route, and `localRelayUrl` exists. They pin the new contract once `free_socks` is gone.

- [ ] **Step 3: Delete the pool.** `git rm src/lib/socks-pool.server.ts src/lib/socks-pool.test.ts`

- [ ] **Step 4: Rewire the yt-dlp download ladder (`src/lib/ytdlp.server.ts`).**
  1. Delete `import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";`.
  2. In the `@/lib/ytdlp-python.server` import list, delete the line `  ensurePySocks,`.
  3. Replace ` * One budget for the whole ladder (saved routes × clients × retries, SOCKS` / ` * hops, direct): a worst-case walk of failing routes could hold a download` with ` * One budget for the whole ladder (saved routes × clients × retries, then` / ` * direct): a worst-case walk of failing routes could hold a download`.
  4. Replace `  // Before the tmpdir, the client ladder and the SOCKS hops: none of that can` with `  // Before the tmpdir and the client ladder: none of that can`.
  5. Replace `        // operator's own hop. Pool-SOCKS hops keep the strict no-cookie rule.` with `        // operator's own hop. Any other proxy keeps the strict no-cookie rule.`.
  6. Replace `        auth: proxy ? "socks" : session?.loggedIn ? "cookies" : session ? "visitor" : "anon",` with `        auth: proxy ? "proxy" : session?.loggedIn ? "cookies" : session ? "visitor" : "anon",`. The only proxy left is the operator's.
  7. Delete the whole free-SOCKS stage: from the line `    if (!loggedIn) {` whose next line is `      await ensurePySocks().catch(() => undefined);`, through its closing `    }` (the line before the blank line and `    // Direct is the final fallback, after every configured and free route.`). Then replace that comment with `    // Direct is the final fallback, after every configured route.`.
  8. Delete the orphaned doc comment at the end of the file: from `/**` / ` * Fetch a caption track through yt-dlp over SOCKS — bypasses IP-based 429` through its closing ` */`, plus the blank line before it. No declaration follows it; it described the re-exported `fetchSubtitlesViaYtdlp`.

- [ ] **Step 5: Rewire the metadata ladder (`src/lib/ytdlp-meta.server.ts`, `src/lib/ytdlp-meta-routing.ts`).**
  1. `ytdlp-meta.server.ts`:
     - delete the import line `import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";`;
     - in the `@/lib/ytdlp-python.server` import list, delete `  ensurePySocks,`;
     - replace the whole `runHops` doc comment and function
       ```ts
       /**
        * One metadata ladder stage. A saved route is tried once; the free stage tries
        * direct while it is open (see directYtdlpOpen), then one pool SOCKS hop.
        * `tryHop` returns a result to end the stage, or null to move to the next hop.
        */
       async function runHops<T>(saved: Hop | null, tryHop: (hop: Hop) => Promise<T | null>): Promise<T | null> {
         if (saved) return tryHop(saved);
         if (directYtdlpOpen()) {
           const hit = await tryHop({ markDead: markDirectYtdlpBlocked, markGood: () => undefined });
           if (hit !== null) return hit;
         }
         const socks = await takeSocks(1);
         const proxy = socks[0];
         if (!proxy) return null;
         try {
           return await tryHop({ proxy, markDead: () => markSocksDead(proxy), markGood: () => markSocksGood(proxy) });
         } finally {
           releaseSocks(socks);
         }
       }
       ```
       with
       ```ts
       /**
        * One metadata ladder stage. A saved route is tried once; otherwise direct is
        * tried while it is open (see directYtdlpOpen). `tryHop` returns a result to
        * end the stage, or null to move on.
        */
       async function runHops<T>(saved: Hop | null, tryHop: (hop: Hop) => Promise<T | null>): Promise<T | null> {
         if (saved) return tryHop(saved);
         if (!directYtdlpOpen()) return null;
         return tryHop({ markDead: markDirectYtdlpBlocked, markGood: () => undefined });
       }
       ```
     - delete both lines `    await ensurePySocks().catch(() => undefined);` (one in `fetchSubtitlesViaYtdlp`, one in `listYtdlpFormatsOnce`);
     - replace `    // The operator's proxy rides first, then the free stage (runHops).` with `    // The operator's proxy rides first, then direct (runHops).`;
     - replace `  // cost a pool slot and a SOCKS hop to find that out.` with `  // cost a pool slot to find that out.`;
     - replace the three comment lines `    // Same first-hop rule as the download ladder: the operator's proxy before` / `    // any free-SOCKS hop, so formats/captions do not fail on a blocked origin` / `    // while downloads through the same proxy succeed.` with `    // Same first-hop rule as the download ladder: the operator's proxy before` / `    // direct, so formats/captions do not fail on a blocked origin while` / `    // downloads through the same proxy succeed.`;
     - replace `  // Negative-cache the empty outcome: re-running yt-dlp -J over SOCKS on every` / `  // resolve of the same id holds a pool slot for nothing.` with `  // Negative-cache the empty outcome: re-running yt-dlp -J on every resolve of` / `  // the same id holds a pool slot for nothing.`.
  2. `ytdlp-meta-routing.ts`: replace the whole `attemptYtdlpMetadataLadder` function (from `/** One saved-first attempt adapter shared by yt-dlp captions and format metadata. */` to the end of the file) with:
     ```ts
     /** One saved-first attempt adapter shared by yt-dlp captions and format metadata. */
     export async function attemptYtdlpMetadataLadder<Result>(
       userRoutes: readonly YtdlpMetadataRoute[],
       attemptSaved: (route: YtdlpMetadataRoute, url: string) => Promise<Result>,
       attemptDirect: () => Promise<Result>,
       usable: (result: Result) => boolean,
     ): Promise<Result | null> {
       const selected = [
         ...userRoutes.map((route) => ({ kind: "proxy", id: route.id, protocol: route.protocol, trusted: true } as const)),
         { kind: "direct", trusted: false } as const,
       ];
       const outcome = await attemptSelectedRoutes(selected, async (choice) => {
         if (choice.kind === "direct") {
           const result = await attemptDirect();
           return usable(result) ? { ok: true as const, value: result } : { ok: false as const };
         }
         const route = userRoutes.find((candidate) => candidate.id === choice.id);
         if (route === undefined) return { ok: false as const };
         const result = await route.run((url) => attemptSaved(route, url));
         return result !== null && usable(result) ? { ok: true as const, value: result } : { ok: false as const };
       });
       return (outcome.result ?? null) as Result | null;
     }
     ```

- [ ] **Step 6: Remove the `free_socks` route kind and PySocks.**
  1. `src/lib/proxy-selector.server.ts`:
     - delete the union member line `  | { readonly kind: "free_socks"; readonly url: string; readonly trusted: false }`;
     - delete the parameter line `  freeSocks: readonly string[] = [],`;
     - replace
       ```ts
         const free = capability === "ytdlp"
           ? freeSocks.map((url) => ({ kind: "free_socks", url, trusted: false }) satisfies SelectedRoute)
           : [];
         return [...configured, ...free, { kind: "direct", trusted: false }];
       ```
       with `  return [...configured, { kind: "direct", trusted: false }];`.
  2. `src/lib/user-proxy.server.ts`: delete the line `    if (choice.kind === "free_socks") return { ok: false };`.
  3. `src/lib/ytdlp-python.server.ts`:
     - replace the four doc lines starting ` * Direct yt-dlp beats the free SOCKS pool by 2-40x where it works (measured:` (through ` * probe for a while: a blocked host pays one fast failure per window.`) with:
       ```ts
        * A datacenter origin often gets 403 from YouTube. So every ladder probes
        * direct first and, once it fails, skips the probe for a while: a blocked host
        * pays one fast failure per window.
       ```
     - replace ` * remembered forever — one transient pip failure otherwise disabled SOCKS (or` / ` * impersonation) for the life of the server.` with ` * remembered forever — one transient pip failure otherwise disabled` / ` * impersonation for the life of the server.`;
     - delete `export const ensurePySocks = optionalModule("socks", "PySocks");`.
  4. `src/lib/user-proxy-parse.ts`: replace
     ```ts
      * relabelling it `socks5h` just fails at version negotiation — the same reason
      * socks-pool.server.ts refuses it.
     ```
     with
     ```ts
      * relabelling it `socks5h` just fails at version negotiation.
     ```

- [ ] **Step 7: Remove the public CORS relays.**
  1. `src/lib/cors-relays.ts`:
     - replace everything from the first line through the closing `];` of `PUBLIC_RELAYS` (the header comment, the `isImaUrl` import, `RelaySpec` and `PUBLIC_RELAYS`) with:
       ```ts
       /**
        * Which URLs this app's own `/api/relay` may fetch. There is no third-party
        * relay (roadmap: no public CORS relays): the browser only ever talks to this
        * origin. The relay must never fetch IMA / DoubleClick.
        */
       import { isImaUrl } from "./ima.ts";
       ```
     - replace everything from `export function isPublicHtmlTarget(raw: string): boolean {` to the end of the file (`isPublicHtmlTarget`, `publicRelayUrls`, `localRelayUrl`, `allRelayUrls`, `relayHost`) with:
       ```ts
       export function localRelayUrl(url: string): string {
         return `/api/relay?url=${encodeURIComponent(url)}`;
       }
       ```
     - `PAGE_HOST`, `MEDIA_HOST`, `isRelayTarget` and `isMediaHostTarget` stay unchanged.
  2. `src/routes/api/relay.ts`:
     - replace `import { isMediaHostTarget, isRelayTarget, publicRelayUrls } from "@/lib/cors-relays";` with `import { isMediaHostTarget, isRelayTarget } from "@/lib/cors-relays";`;
     - replace the comment lines `  // Bodies may come from third-party CORS proxies yet are served from the app` / `  // origin: sandbox + nosniff keep a text/html answer inert if the URL is ever` / `  // navigated to directly (fetch()/blob consumers ignore both).` with `  // Upstream bodies are served from the app origin: sandbox + nosniff keep a` / `  // text/html answer inert if the URL is ever navigated to directly` / `  // (fetch()/blob consumers ignore both).`;
     - replace `        // Without this the non-media path was an unauthenticated, uncapped proxy` / `        // that also amplified onto three third-party CORS services per request.` with `        // Without this the non-media path was an unauthenticated, uncapped proxy.`;
     - replace `        const attempts = [target, ...publicRelayUrls(target)];` with `        // Direct only: no third-party CORS relay (roadmap Global Constraints).` / `        const attempts = [target];`;
     - replace
       ```ts
                 // Header-only timer, as in bypass.server.ts hop(): cleared in `finally`
                 // once headers are in, so the cap never cuts a streaming body.
       ```
       with
       ```ts
                 // Header-only timer: cleared in `finally` once headers are in, so the
                 // cap never cuts a streaming body.
       ```

     The single-element loop stays as is; W4a rewrites this handler.

- [ ] **Step 8: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/ytdlp-fallback-contract.test.ts src/lib/proxy-selector.server.test.ts src/lib/ytdlp-meta-routing.test.ts src/lib/cors-relays.test.ts src/lib/ima.test.ts
git grep -n -i -E 'socks-pool|takeSocks|free_socks|PUBLIC_RELAYS|publicRelayUrls|VELO_SOCKS_PROXY|ALL_PROXY|proxifly|corsfix|allorigins|PySocks' -- src ':!src/lib/remote-code-policy.test.ts' ':!src/lib/ytdlp-fallback-contract.test.ts' ':!src/lib/ytdlp-meta-routing.test.ts'
npm run typecheck && npm run lint && npm test && npm run build && node --test tests/http/*.test.mjs
```
Expected: 0 failures, the grep prints nothing, and the gate, the build and the HTTP tests are green. `api-guards`' relay refusals still answer 400, from `isRelayTarget`.

- [ ] **Step 9: Commit.**
```bash
git add -A src/lib src/routes/api/relay.ts
git commit -m "fix(egress)!: remove the free SOCKS pool and public CORS relays

Guest yt-dlp runs no longer ride anonymous SOCKS5 hosts from the moving
proxifly/free-proxy-list@main, and /api/relay no longer falls back to
proxy.corsfix.com or api.allorigins.win. Egress is the operator's saved
proxy routes, then direct (audit M-14, SEC-04, SUP-05, SEC-14, ARCH-09).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: yt-dlp downloads no solver code at run time; children get no server secrets

**Blocked on:** Contract change request 1, ruled by [OWNER] in Task 10 Step 1. Execute this task only if the ruling is the proposal; otherwise STOP and hand back to the orchestrator.
**Executor:** velo-impl-opus-high (subprocess environment, subprocess argv)
**Covers:** M-04 (the subprocess half: player JS in yt-dlp's `node --permission` child no longer sees secrets), SEC-01 (yt-dlp path), SUP-05-style supply chain (no solver fetched from GitHub `latest` at run time)

**Files:**
- Modify: `src/lib/proc-run.server.ts`, `src/lib/ytdlp-proc.server.ts`, `src/lib/ytdlp-auth.ts`, `src/lib/ytdlp-meta.server.ts`, `src/lib/ytdlp-auth.test.ts`, `src/lib/proc-run.server.test.ts`, `src/lib/remote-code-policy.test.ts`
- Create: `src/lib/ytdlp-proc.server.test.ts`

**Interfaces:**
- Produces:
  - `export const CHILD_ENV_ALLOWLIST: readonly string[]`;
  - `export function childEnv(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`. It keeps only allow-listed keys, matched case-insensitively, with their original casing.
  - `run()` and `runCapture()` spawn with `env: childEnv()`.
  - yt-dlp argv no longer contains `--remote-components`. `--no-js-runtimes --js-runtimes node` stays: yt-dlp's solver runs from the installed `yt-dlp-ejs`.
- W5 obligation (Hand-off): if the container needs another variable for yt-dlp/ffmpeg, it is added to `CHILD_ENV_ALLOWLIST` in a reviewed change, never by passing the full environment.

- [ ] **Step 1: Verify anchors.** Run:
```bash
git grep -c -F '    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });' -- src/lib/proc-run.server.ts src/lib/ytdlp-proc.server.ts
git grep -c -F 'import { killTree } from "@/lib/proc-run.server";' -- src/lib/ytdlp-proc.server.ts
git grep -c -F 'import { run } from "./proc-run.server.ts";' -- src/lib/proc-run.server.test.ts
git grep -c -F '  assert.equal(argv[argv.indexOf("--remote-components") + 1], "ejs:github");' -- src/lib/ytdlp-auth.test.ts
git grep -n -E 'remote-components|ejs:github' -- src ':!src/lib/ytdlp-auth.test.ts'
git grep -n -E 'spawn\(' -- src ':!*.test.ts'
```
Expected:
- `src/lib/proc-run.server.ts:1` and `src/lib/ytdlp-proc.server.ts:1`, then `:1` ×3;
- the `remote-components` grep prints `ytdlp-auth.ts` ×3 (two argv lines and `YTDLP_WORKING_EXAMPLE`) and `ytdlp-meta.server.ts` ×4;
- the `spawn(` grep prints `proc-run.server.ts`, `ytdlp-proc.server.ts` and `tool-updates.server.ts`. The last is the runtime-installer that W4a deletes (Hand-off); leave it.

Anything else: STOP.

- [ ] **Step 2: Write the failing tests.**
  1. `src/lib/proc-run.server.test.ts`: replace `import { run } from "./proc-run.server.ts";` with `import { childEnv, run } from "./proc-run.server.ts";`, then append:
     ```ts

     test("childEnv keeps only allow-listed variables, matched case-insensitively", () => {
       const env = childEnv({
         Path: "C:/bin",
         SystemRoot: "C:/Windows",
         HOME: "/home/velo",
         DATABASE_URL: "postgres://u:p@db/velo",
         BETTER_AUTH_SECRET: "x".repeat(40),
         VELO_PROXY_SECRET_KEY: "k",
         NODE_OPTIONS: "--require ./evil.js",
         UNSET: undefined,
       });
       assert.deepEqual(env, { Path: "C:/bin", SystemRoot: "C:/Windows", HOME: "/home/velo" });
     });

     test("a child started by run() cannot read server secrets", async () => {
       const saved = { db: process.env.DATABASE_URL, auth: process.env.BETTER_AUTH_SECRET };
       process.env.DATABASE_URL = "postgres://u:p@db/velo";
       process.env.BETTER_AUTH_SECRET = "x".repeat(40);
       try {
         const script =
           "process.stderr.write(JSON.stringify([process.env.DATABASE_URL ?? null, process.env.BETTER_AUTH_SECRET ?? null]))";
         const result = await run(node, ["-e", script], 5_000);
         assert.equal(result.code, 0);
         assert.deepEqual(JSON.parse(result.stderr), [null, null]);
       } finally {
         if (saved.db === undefined) delete process.env.DATABASE_URL;
         else process.env.DATABASE_URL = saved.db;
         if (saved.auth === undefined) delete process.env.BETTER_AUTH_SECRET;
         else process.env.BETTER_AUTH_SECRET = saved.auth;
       }
     });
     ```
  2. Create `src/lib/ytdlp-proc.server.test.ts`:
     ```ts
     import assert from "node:assert/strict";
     import { registerHooks } from "node:module";
     import { test } from "node:test";

     // ytdlp-proc.server.ts imports proc-run through the "@/" alias.
     registerHooks({
       resolve(specifier, context, nextResolve) {
         if (specifier.startsWith("@/")) {
           return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
         }
         return nextResolve(specifier, context);
       },
     });

     test("a child started by runCapture() cannot read server secrets", async () => {
       const { runCapture } = await import("./ytdlp-proc.server.ts");
       const saved = process.env.DATABASE_URL;
       process.env.DATABASE_URL = "postgres://u:p@db/velo";
       try {
         const script = "process.stdout.write(JSON.stringify([process.env.DATABASE_URL ?? null, Boolean(process.env.PATH ?? process.env.Path)]))";
         const result = await runCapture(process.execPath, ["-e", script], 5_000);
         assert.equal(result.code, 0);
         assert.deepEqual(JSON.parse(result.stdout), [null, true]);
       } finally {
         if (saved === undefined) delete process.env.DATABASE_URL;
         else process.env.DATABASE_URL = saved;
       }
     });
     ```
  3. `src/lib/ytdlp-auth.test.ts`: replace
     ```ts
       assert.deepEqual(ytdlpFamilyArgs(), ["--force-ipv4"]);
       assert.equal(argv[argv.indexOf("--remote-components") + 1], "ejs:github");
     });
     ```
     with
     ```ts
       assert.deepEqual(ytdlpFamilyArgs(), ["--force-ipv4"]);
       // The challenge solver comes from the pinned yt-dlp install, never fetched at run time.
       assert.equal(argv.includes("--remote-components"), false);
       assert.doesNotMatch(YTDLP_WORKING_EXAMPLE, /--remote-components/);
     });
     ```
  4. Append to `src/lib/remote-code-policy.test.ts`:
     ```ts

     test("yt-dlp never downloads its challenge solver, and its children get no server secrets", () => {
       for (const file of ["./ytdlp-auth.ts", "./ytdlp-meta.server.ts"]) {
         assert.doesNotMatch(source(file), /remote-components|ejs:github/, file);
       }
       for (const file of ["./proc-run.server.ts", "./ytdlp-proc.server.ts"]) {
         assert.match(source(file), /env: childEnv\(\)/, file);
       }
     });
     ```

  Run: `node --experimental-strip-types --test src/lib/proc-run.server.test.ts src/lib/ytdlp-proc.server.test.ts src/lib/ytdlp-auth.test.ts src/lib/remote-code-policy.test.ts`
  Expected failures:
  - `proc-run.server.test.ts` fails to load (`does not provide an export named 'childEnv'`);
  - `runCapture()` fails with `actual: [ 'postgres://u:p@db/velo', true ]`, `expected: [ null, true ]`;
  - the `ytdlp-auth` socks test fails (`true !== false`);
  - the policy test fails.

- [ ] **Step 3: Add the allow-listed child environment.**
  1. `src/lib/proc-run.server.ts`: directly after `import { spawn, type ChildProcess } from "node:child_process";`, insert:
     ```ts

     /**
      * The only ambient variables a child inherits (matched case-insensitively;
      * Windows spells them Path, SystemRoot, ...). yt-dlp runs YouTube's challenge
      * solver in a `node --permission` child that reads its environment, so server
      * secrets (DATABASE_URL, BETTER_AUTH_SECRET, proxy keys, ...) must never reach
      * it (roadmap D7, audit M-04). Everything a child needs to find python, node,
      * ffmpeg, a temp dir and CA certificates is here; nothing else is.
      */
     export const CHILD_ENV_ALLOWLIST = Object.freeze([
       "PATH",
       "PATHEXT",
       "SYSTEMROOT",
       "WINDIR",
       "COMSPEC",
       "TEMP",
       "TMP",
       "TMPDIR",
       "HOME",
       "USERPROFILE",
       "APPDATA",
       "LOCALAPPDATA",
       "XDG_CACHE_HOME",
       "LANG",
       "LC_ALL",
       "TZ",
       "SSL_CERT_FILE",
       "SSL_CERT_DIR",
     ]);
     const CHILD_ENV_ALLOWED = new Set(CHILD_ENV_ALLOWLIST);

     export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
       return Object.fromEntries(
         Object.entries(source).filter(
           ([key, value]) => value !== undefined && CHILD_ENV_ALLOWED.has(key.toUpperCase()),
         ),
       );
     }
     ```
     Then, in `run`, replace `    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });` with:
     ```ts
         const child = spawn(command, args, {
           stdio: ["ignore", "pipe", "pipe"],
           detached: true,
           env: childEnv(),
         });
     ```
  2. `src/lib/ytdlp-proc.server.ts`: replace `import { killTree } from "@/lib/proc-run.server";` with `import { childEnv, killTree } from "@/lib/proc-run.server";`. Replace its `    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });` with the same 5-line `spawn(command, args, { … env: childEnv() })` block as in (1).

- [ ] **Step 4: Stop fetching the solver at run time.**
  1. `src/lib/ytdlp-auth.ts`: in `ytdlpArgv`, replace
     ```ts
       args.push(
         "--remote-components",
         "ejs:github",
         "--extractor-args",
     ```
     with
     ```ts
       args.push(
         "--extractor-args",
     ```
     In `YTDLP_WORKING_EXAMPLE`, replace ` --extractor-args youtube:player_client=web_embedded --remote-components ejs:github --no-playlist` with ` --extractor-args youtube:player_client=web_embedded --no-playlist`.
  2. `src/lib/ytdlp-meta.server.ts`: replace both occurrences (replace-all; exactly two) of
     ```ts
                   ...(impersonate ? ytdlpImpersonateArgs(client) : []),
                   "--remote-components",
                   "ejs:github",
                   "--extractor-args",
     ```
     with
     ```ts
                   ...(impersonate ? ytdlpImpersonateArgs(client) : []),
                   "--extractor-args",
     ```

- [ ] **Step 5: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/proc-run.server.test.ts src/lib/ytdlp-proc.server.test.ts src/lib/ytdlp-auth.test.ts src/lib/remote-code-policy.test.ts
git grep -n -E 'remote-components|ejs:github' -- src ':!src/lib/ytdlp-auth.test.ts' ':!src/lib/remote-code-policy.test.ts'
npm run typecheck && npm run lint && npm test && npm run build && node --test tests/http/*.test.mjs
```
Expected: 0 failures (on Windows, the process-group test stays skipped as before), the grep prints nothing, and the gate, the build and the HTTP tests are green.

- [ ] **Step 6: Optional live check (skip without Python/yt-dlp).** Run:
```bash
python -m yt_dlp --no-update --no-js-runtimes --js-runtimes node --no-playlist --extractor-args "youtube:player_client=web_embedded" -F "https://www.youtube.com/watch?v=jNQXAC9IVRw" 2>&1 | grep -E "jsc|challenge|^18 "
```
Expected, when `yt-dlp[default]` is installed: `[youtube] [jsc:node] Solving JS challenges using node` and an `18  mp4` row. That shows the bundled solver works without `--remote-components`. If it prints `challenge solving failed`, the install lacks `yt-dlp-ejs`: `python -m pip install "yt-dlp[default]"`, pinned by W5.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/proc-run.server.ts src/lib/ytdlp-proc.server.ts src/lib/ytdlp-auth.ts src/lib/ytdlp-meta.server.ts src/lib/ytdlp-auth.test.ts src/lib/proc-run.server.test.ts src/lib/ytdlp-proc.server.test.ts src/lib/remote-code-policy.test.ts
git commit -m "fix(ytdlp): take the challenge solver from the pinned install; scrub child env

yt-dlp no longer downloads its challenge solver from GitHub at run time
(--remote-components ejs:github). yt-dlp, ffmpeg and pip children get an
allow-listed environment, so the node child that yt-dlp runs YouTube's
player script in cannot read DATABASE_URL or any other server secret.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Neutral copy: UI, error hints, README

**Executor:** velo-impl-opus-medium (copy)
**Covers:** UX-05 (circumvention copy and the "AI" chip), OSS-11 (copy only; the legal review is W9), ARCH-23 (copy half; the legal review is W9)

**Files:**
- UI: `src/components/{bulk-view,bulk-export-menu,save-stage,video-panel,mode-tabs,command-palette,proxy-tools-card}.tsx`
- Copy strings: `src/lib/{download-client,builder-download,download-error,youtube-copy,ytdlp-auth,throttle,fallback-path}.ts`, `src/lib/throttle.test.ts`
- Comments only: `src/lib/{youtube-captions.server,guest-limit.server}.ts`
- Other: `README.md`, `src/lib/remote-code-policy.test.ts`

**Rules for this task:**
- Change only the listed strings and the one dead copy table.
- Describe what the code does now, and never promise reliability.
- No legal notice text: counsel's wording goes in via W8/W9.

- [ ] **Step 1: Verify anchors.** Each of these must print a count of `1`, except `builder-download.ts`'s "Matching hop" line, which prints `2`:
```bash
git grep -c -F '                Anti-Throttle Queue' -- src/components/bulk-view.tsx
git grep -c -F 'Runs anti-throttle batch locally' -- src/components/bulk-export-menu.tsx
git grep -c -F 'Velo’s own chain: nsig even on “plain” URLs, dual PO token, cver/rn/keepalive,' -- src/components/save-stage.tsx
git grep -c -F 'NSig & BotGuard Bypass: ' -- src/components/video-panel.tsx
git grep -c -F '{progress.throttled ? " · slow speed (nsig hop active)" : ""}' -- src/components/video-panel.tsx
git grep -c -F '  { mode: "transcript", icon: FileText, label: "Transcript", chip: "AI" },' -- src/components/mode-tabs.tsx
git grep -c -F 'hint: "Captions & AI summary" }' -- src/components/command-palette.tsx
git grep -c -F 'A deliberate route vault, not an automatic bypass.' -- src/components/proxy-tools-card.tsx
git grep -c -F '"Hybrid: PO token + cookies + relays"' -- src/lib/download-client.ts
git grep -c -F '"Matching hop — player and file share one IP"' -- src/lib/builder-download.ts
git grep -c -F 'Save already retries through a matching hop' -- src/lib/download-error.ts
git grep -c -F '"PO token missing — remint GVS+player, next client"' -- src/lib/ytdlp-auth.ts
git grep -c -F 'export const THROTTLE_QA = [' -- src/lib/throttle.ts
git grep -c -F '"SOCKS web_embedded + ffmpeg mux (137+140 / 137+251)",' -- src/lib/fallback-path.ts
git grep -c -F 'backend fallback ladders to bypass rate limits' -- README.md
git grep -c -F -- '- **Proof-of-Origin (PO Token)**' -- README.md
```
Any other count: STOP.

- [ ] **Step 2: Write the failing test.** Append to `src/lib/remote-code-policy.test.ts`:
```ts

test("user-facing copy and the README make no circumvention claims", () => {
  const banned = /bypass|beat bot|bot[- ]detection|po token|botguard|\bn-?sig\b|anti-throttle|same-hop|matching hop|cors relay/i;
  const components = here("../components/");
  for (const name of readdirSync(components, { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".tsx")) continue;
    assert.doesNotMatch(readFileSync(new URL(name.replaceAll("\\", "/"), components), "utf8"), banned, name);
  }
  for (const file of ["./youtube-copy.ts", "./download-error.ts", "./download-client.ts", "./builder-download.ts", "./hybrid-download.ts", "../../README.md"]) {
    assert.doesNotMatch(source(file), banned, file);
  }
  // UX-05: no "AI" badge on a transcript feature that runs no AI.
  assert.doesNotMatch(source("../components/mode-tabs.tsx"), /chip:\s*"AI"/);
});
```
Run: `node --experimental-strip-types --test src/lib/remote-code-policy.test.ts`
Expected: this test fails, first on `bulk-export-menu.tsx` (`anti-throttle`). `\bn-?sig\b` is word-bounded so `onSignIn` does not match.

- [ ] **Step 3: UI copy.**
  1. `src/components/bulk-view.tsx`:
     - replace `                Anti-Throttle Queue` with `                Queue`;
     - replace `              Paste multiple YouTube links or playlists. Velo uses staggered bursts, BotGuard PO token rotation, and zero-loss copy-muxing to prevent 429 rate-limiting.` with `              Paste multiple YouTube links or playlists. Velo saves them one after another with short pauses between requests, and copies the original streams into one file without re-encoding.`.
  2. `src/components/bulk-export-menu.tsx`: replace `Runs anti-throttle batch locally` with `Runs the batch on your computer`.
  3. `src/components/save-stage.tsx`: delete the paragraph
     ```tsx
             <p className="text-xs leading-relaxed text-subtle">
               Velo’s own chain: nsig even on “plain” URLs, dual PO token, cver/rn/keepalive,
               YouTube client headers, same-hop IP, then HLS stitch if progressive is SABR.
             </p>
     ```
  4. `src/components/video-panel.tsx`:
     - delete the diagnostics row
       ```tsx
                         <div>
                           <span className="text-subtle font-medium">NSig & BotGuard Bypass: </span>
                           <span className="text-success font-mono">Pre-warmed & Verified</span>
                         </div>
       ```
     - replace `{progress.throttled ? " · slow speed (nsig hop active)" : ""}` with `{progress.throttled ? " · slow download" : ""}`.
  5. `src/components/mode-tabs.tsx`:
     - replace `  { mode: "transcript", icon: FileText, label: "Transcript", chip: "AI" },` with `  { mode: "transcript", icon: FileText, label: "Transcript" },`;
     - replace `      {tabs.map(({ mode, icon: Icon, label, ...tab }) => {` with `      {tabs.map(({ mode, icon: Icon, label }) => {`;
     - delete the now-dead chip render block
       ```tsx
                   {"chip" in tab && tab.chip ? (
                     <span
                       className={cn(
                         "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors duration-[var(--motion-medium)]",
                         active ? "bg-accent-fg/20 text-accent-fg" : "bg-accent/15 text-accent",
                       )}
                     >
                       {tab.chip}
                     </span>
                   ) : null}
       ```
       Without it TypeScript fails with `TS2322: Type '{}' is not assignable to type 'ReactNode'`. Keep the `cn` import only if another use remains; lint will say.
  6. `src/components/command-palette.tsx`: replace `hint: "Captions & AI summary" }` with `hint: "Captions & summary prompts" }`.
  7. `src/components/proxy-tools-card.tsx`: replace `A deliberate route vault, not an automatic bypass.` with `A deliberate route vault, not an automatic fallback.`.

- [ ] **Step 4: Progress, error and diagnostic strings.**
  1. `src/lib/download-client.ts`: replace `"Hybrid: PO token + cookies + relays"` with `"Trying yt-dlp and the relay"`.
  2. `src/lib/builder-download.ts`:
     - replace `    { id: "builder", label: "Matching hop — player and file share one IP", status: "running" },` with `    { id: "builder", label: "Server download", status: "running" },`;
     - replace the two comment lines `    // Server already muxes 137+140 (or HLS 96) on the matching hop.` / `    // A second /api/builder call for audio would double quota and race two SOCKS downloads.` with `    // The server already muxes 137+140 (or HLS 96). A second /api/builder call` / `    // for audio would double the quota and race two server downloads.`;
     - replace ``            ? `Throttled · ${formatSpeed(sample.bytesPerSec)} — nsig crawl` `` with ``            ? `Slow · ${formatSpeed(sample.bytesPerSec)}` ``;
     - replace
       ```ts
               ? `${opts.preset.height ?? 1080}p hop — video+AAC muxed on this origin`
               : "Matching hop — player and file share one IP",
       ```
       with
       ```ts
               ? `${opts.preset.height ?? 1080}p — video and AAC audio combined on the server`
               : "Server download",
       ```
     - replace `      label: "Builder pipe (this origin + same-hop)",` with `      label: "Server download",`.
  3. `src/lib/download-error.ts`:
     - replace `    return "YouTube bound the file to a different IP than this host. Save already retries through a matching hop — wait a moment and try again.";` with `    return "YouTube refused to serve this file to the server. Wait a moment and try again, or pick a lower quality.";`;
     - replace `      return "A CORS relay dropped. Wait a few seconds, then Save once.";` with `      return "The connection dropped. Wait a few seconds, then Save once.";`;
     - delete the line `    lower.includes("botguard") ||`. Only the deleted minter produced that text.
  4. `src/lib/youtube-copy.ts`:
     - replace `  "HLS fallback: if DASH 137 is SABR or 403, Save stitches YouTube’s itag 96 playlist (~5s MPEG-TS chunks) on the same hop. The master playlist’s 1080p variant is used — not 4K.";` with `  "HLS fallback: if DASH 137 is unavailable, Save asks yt-dlp for YouTube’s itag 96 playlist (~5s MPEG-TS chunks). The master playlist’s 1080p variant is used — not 4K.";`. `youtube.test.ts` still matches `itag 96`, `MPEG-TS` and `137`.
     - replace `aborts the rest so SOCKS and guest quota are not spent twice.";` with `aborts the rest so guest quota is not spent twice.";`;
     - delete the two `SAVE_MECHANICS` rows `  { name: "nsig", detail: "player.js transforms n= or the CDN crawls at ~40 KB/s." },` and `  { name: "BotGuard", detail: "player and GVS tokens bound to the video id." },`;
     - replace `  { name: "IPv4 pin", detail: "Direct hops stay on IPv4 so player and file share one family." },` with `  { name: "IPv4 pin", detail: "yt-dlp stays on IPv4 so the player request and the file share one address family." },`.
  5. `src/lib/ytdlp-auth.ts` (failure hints shown in save errors):
     - replace `"timed out — next matching hop"` with `"timed out — trying the next route"`;
     - replace `"SABR-only — need a video-bound PO token or a muxed client"` with `"streaming-only response — trying a client with a downloadable format"`;
     - replace `"PO token missing — remint GVS+player, next client"` with `"YouTube refused this client — trying the next one"`;
     - replace `"nsig failed — retry node ejs, then next client"` with `"yt-dlp could not read this video’s formats — retrying"`;
     - replace `"CDN 403 — next matching hop"` with `"YouTube refused the file (403) — trying the next route"`.

     The `kind`/`next` values that tests assert do not change.
  6. `src/lib/throttle.ts`:
     - replace the header comment
       ```ts
       /**
        * YouTube throttle is the `n` query param. Untouched n ≈ 40 KB/s.
        * yt-dlp solves n via player.js (Node + ejs). If that fails, we:
        *  - re-extract when speed < 100 KB/s
        *  - download in 10 MB HTTP ranges (old >10 MB single-GET cap)
        *  - one HLS fragment at a time (many threads look like a scraper)
        *  - same-hop SOCKS so IP on the player JSON matches the file
        *
        * --retries stays at 1: a GVS 403 never succeeds on the same URL.
        * Fragment retries still cover HLS flake.
        */
       ```
       with:
       ```ts
       /**
        * yt-dlp transfer flags for every run: re-extract when speed stays under
        * 100 KB/s, 10 MB HTTP chunks, one HLS fragment at a time.
        *
        * --retries stays at 1: a 403 never succeeds on the same URL.
        * Fragment retries still cover HLS flake.
        */
       ```
     - delete everything from `export const THROTTLE_QA = [` to the end of the file, ending the file with one newline after the closing `}` of `looksThrottled`. `THROTTLE_QA` is dead copy ("We run Node + ejs…", "Solved nsig, same-hop IP…") that no component renders.
  7. `src/lib/throttle.test.ts`: replace `import { looksThrottled, THROTTLE_FLAGS, THROTTLE_QA } from "./throttle.ts";` with `import { looksThrottled, THROTTLE_FLAGS } from "./throttle.ts";`, and delete the test `test("Q&A covers nsig, same-hop, and cookies-only-for-gated", () => {` … `});` together with its deleted constant.
  8. `src/lib/fallback-path.ts`:
     - replace ` *    137+140  1080p H.264 + AAC — the hop that works` with ` *    137+140  1080p H.264 + AAC — the default`;
     - replace ` *    logged-in innertube on this host → SOCKS web_embedded (137+140/137+251)` / ` *    → SOCKS web_safari (HLS 96) → SOCKS tv_simply / android (18)` with ` *    innertube on this host → yt-dlp web_embedded (137+140/137+251)` / ` *    → yt-dlp web_safari (HLS 96) → yt-dlp tv_simply / android (18),` / ` *    each through the operator's proxy first when one is configured`;
     - in `BUILDER_FALLBACK_STEPS`, replace the three strings `"SOCKS web_embedded + ffmpeg mux (137+140 / 137+251)"`, `"SOCKS web_safari HLS (96)"` and `"SOCKS android muxed 360 (18)"` with `"yt-dlp web_embedded + ffmpeg mux (137+140 / 137+251)"`, `"yt-dlp web_safari HLS (96)"` and `"yt-dlp android muxed 360 (18)"`. `fallback-path.test.ts` still passes.
  9. Comments:
     - `src/lib/youtube-captions.server.ts`: replace `  // 429/502: try yt-dlp over SOCKS (different IP bypasses rate-limiting)` with `  // 429/502: try yt-dlp's caption fetch instead (operator proxy first, then direct)`. Replace the two lines `    // timedtext is throttling this server's IP — route through yt-dlp over` / `    // SOCKS so the request comes from a different IP entirely.` with `    // timedtext refused this request — try yt-dlp's caption fetch instead` / `    // (the operator's proxy first when one is configured, then direct).`.
     - `src/lib/guest-limit.server.ts`: replace ` * real upstream work — up to ~14 InnerTube calls plus a BotGuard mint for a` / ` * caption lookup — so an unmetered flood` with ` * real upstream work — up to ~14 InnerTube calls for a caption lookup — so an unmetered flood`. Keep the rest of the sentence.

- [ ] **Step 5: README (copy only; W7 rewrites the document).** In `README.md`:
  1. Replace `It combines client-side streaming intelligence with backend fallback ladders to bypass rate limits, resolve throttled streams, and mux multi-track audio/video with zero quality loss.` with `It tries YouTube's own format URLs first, falls back to the pinned yt-dlp on the server, and muxes multi-track audio/video with zero quality loss.`.
  2. Replace `### 4. Anti-Throttle Bulk & Playlist Ingest Engine` with `### 4. Bulk & Playlist Queue`.
  3. Replace `  - Staggered launch delays (1.0s - 3.0s) between successive requests to prevent YouTube 429 rate limits and BotGuard burst triggers.` with `  - Staggered launch delays (1.0s - 3.0s) between successive requests, so a long queue does not flood YouTube.`.
  4. Replace the three bullets
     ```markdown
     - **Proof-of-Origin (PO Token)**: Automated WebPO token minting and validation to prevent bot-detection blocks.
     - **Throttling Bypass & nsig Deciphering**: Live transformation of YouTube's `n` parameter to prevent 40 KB/s stream choking.
     - **SOCKS Proxy Pool & Same-Hop Routing**: Failover to IPv4 proxies when server IPs encounter 403 blocks.
     ```
     with
     ```markdown
     - **yt-dlp**: The pinned yt-dlp downloads and merges video with its audio when YouTube's direct URL is not available, through the operator's own proxy first when one is configured.
     ```
  5. Replace `Anti-throttle bulk queue & playlist download manager` with `Bulk queue & playlist download manager`.
  6. Replace `│   │   ├── stream-unlock.ts         # Stream cipher / signature / nsig deciphering` with `│   │   ├── hls.ts                   # HLS playlist parser`.
  7. Replace `  hybrid and InnerTube paths cover most videos — but 1080p muxing over SOCKS,` / `  the most reliable path, is unavailable. Install with:` with `  relay and InnerTube paths cover some videos — but yt-dlp's 1080p muxing,` / `  the most reliable path, is unavailable. Install with:`.
  8. Replace
     ```markdown
       The extras bring the `--impersonate` backend and the EJS signature solver in
       the versions this yt-dlp supports; yt-dlp also needs `ffmpeg` on `PATH` to
     ```
     with
     ```markdown
       The extras bring the optional components (`curl_cffi`, `yt-dlp-ejs`) in the
       versions this yt-dlp supports; yt-dlp also needs `ffmpeg` on `PATH` to
     ```
  9. Replace
     ```markdown
     Extraction depends on libraries that track a moving target: `youtubei.js` and
     `bgutils-js` follow the YouTube player, and the `yt-dlp` Python module ships
     ```
     with
     ```markdown
     Extraction depends on libraries that track a moving target: `youtubei.js`
     follows YouTube's InnerTube API, and the `yt-dlp` Python module ships
     ```

- [ ] **Step 6: Run the tests and the gate.** Run:
```bash
node --experimental-strip-types --test src/lib/remote-code-policy.test.ts src/lib/youtube.test.ts src/lib/throttle.test.ts src/lib/fallback-path.test.ts src/lib/ytdlp-auth.test.ts
git grep -n -i -E 'bypass|botguard|po token|\bnsig\b|anti-throttle|same-hop|matching hop|cors relay|socks' -- src/components README.md ':!src/components/proxy-tools-*.tsx'
MSYS_NO_PATHCONV=1 git grep -n -E 'BotGuard|ANTI-THROTTLE|chip: "AI"' -- src/components
npm run typecheck && npm run lint && npm test && npm run build && node --test tests/http/*.test.mjs
```
Expected:
- 0 failures;
- the first grep prints nothing. `proxy-tools-*.tsx` is excluded because "SOCKS5" there names the user-proxy protocol, which is legitimate;
- the second grep prints nothing (audit UX-05's own verification command);
- the gate, the build and the HTTP tests are green.

- [ ] **Step 7: Commit.**
```bash
git add -A src/components src/lib README.md
git commit -m "docs(copy): describe features neutrally; drop circumvention wording

Remove \"BotGuard PO token rotation\", \"Anti-Throttle\", \"NSig & BotGuard
Bypass\", \"matching hop\" and \"CORS relay\" from the UI, error hints and
README, and the \"AI\" chip on Transcript (audit UX-05, OSS-11). Legal notice
text waits for counsel (W9).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: [OWNER] Rulings and operator notice

- [ ] **Step 1 (before Task 8): Rule on Contract change request 1.**
  - **Accept.** Add the sentence below to the roadmap's Global Constraint "Untrusted JavaScript", in its own reviewed commit, `docs(roadmap): allow yt-dlp's pinned challenge solver in a scrubbed child (W4b CCR-1)`:
    > "The one exception is the pinned yt-dlp's bundled challenge solver (`yt-dlp-ejs`, hash-pinned by W5), which runs in yt-dlp's own `node --permission` child with the allow-listed environment of `childEnv()`; nothing downloads solver code at run time."
  - **Reject (strict).** Tell the orchestrator. Task 8 is then re-planned: drop `--js-runtimes node`, stop forcing web clients, and accept losing signed-in yt-dlp downloads.
- [ ] **Step 2: Add a W9 counsel question.** Append to the W9-1 packet: "yt-dlp's own JavaScript challenge solving (signature/n-parameter), run from its pinned install with no remote components, remains in the product after W4b. May it stay?" (`--impersonate` was removed under ruling P1 and `--throttled-rate` under ruling P10, so neither is a question.)
- [ ] **Step 3: Operator notice for existing deployments.** Post with the release that ships W4b:
  > Velo no longer reads `VELO_SOCKS_PROXY` or `ALL_PROXY` and no longer uses a public proxy list. If you relied on one, add your own proxy in the proxy console (Tools → Proxy operations). yt-dlp now runs with a minimal environment. If you set `HTTP_PROXY`/`HTTPS_PROXY` for yt-dlp, use the proxy console instead until `VELO_EGRESS_PROXY` lands.
- [ ] **Step 4: Merge W4b** by PR after CI is green and the whole-branch review passes.

---

## Behaviour changes (for the CHANGELOG)

1. **No PO tokens.** Velo no longer runs BotGuard or mints proof-of-origin tokens; InnerTube and yt-dlp requests carry none. Formats YouTube only serves with a token (some web-client 1080p DASH, SABR-only answers) are unavailable, and more videos fall through to yt-dlp or fail.
2. **No player-script deciphering in the app.** youtubei.js runs with `retrieve_player: false`, and format URLs are used exactly as YouTube returns them:
   - formats that only carry a `signatureCipher` fail with "This quality isn’t available as a direct download. Pick another quality.";
   - URLs whose `n` value would need solving may be slow or refused by YouTube.
3. **Deleted endpoints.**
   - `/api/unlock` and `/api/bypass` return 404.
   - `/api/download` no longer falls back to them: a YouTube refusal returns 403 "YouTube refused to serve this file to the server…" with the quota refunded.
4. **`/api/download` uses one connection.** It no longer splits large files over four parallel range requests, so big downloads through it are slower.
5. **Browser save.**
   - The hybrid race has two legs, "yt-dlp on the server" and "Velo relay". The BotGuard step, the same-hop leg and the public CORS relays are gone.
   - The browser never contacts `proxy.corsfix.com` or `api.allorigins.win`.
   - A save with no runnable leg fails at once instead of hanging.
6. **`/api/relay` fetches only the requested YouTube/googlevideo URL.** It no longer falls back to third-party relays.
7. **No free SOCKS pool.**
   - Guest yt-dlp runs go through the operator's saved proxy routes, then direct.
   - `VELO_SOCKS_PROXY` and `ALL_PROXY` are no longer read.
   - Hosts whose IP YouTube blocks fail more often unless the operator configures a proxy.
   - PySocks is no longer auto-installed.
8. **yt-dlp metadata and caption fallback.** While direct yt-dlp is marked blocked (15 minutes after a failure) and no operator proxy is configured, yt-dlp format enrichment and the yt-dlp caption fallback are skipped.
9. **No process-wide IPv4 pin or HTTP/1-only dispatcher.**
   - Node uses its defaults: Happy Eyeballs, and DNS order as the OS returns it.
   - yt-dlp keeps `--force-ipv4` on direct runs.
   - A host with broken IPv6 egress can set `NODE_OPTIONS=--dns-result-order=ipv4first`.
10. **yt-dlp no longer downloads its challenge solver from GitHub** at run time. It needs `yt-dlp-ejs` installed (the `yt-dlp[default]` extra); without it, yt-dlp lists fewer formats.
11. **yt-dlp's child processes get a minimal environment.** yt-dlp (and the ffmpeg and `node` solver processes it starts) get only `PATH`/`PATHEXT`/`SYSTEMROOT`/`WINDIR`/`COMSPEC`/`TEMP`/`TMP`/`TMPDIR`/`HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`XDG_CACHE_HOME`/`LANG`/`LC_ALL`/`TZ`/`SSL_CERT_FILE`/`SSL_CERT_DIR`. `HTTP(S)_PROXY`, `PYTHONPATH` and `NODE_OPTIONS` no longer reach them. The Tools tab's `npm`/`pip` updater (`tool-updates.server.ts`) still passes the full environment until W4a (ruling P8).
12. **`pot` in `/api/builder` and `/api/ytdlp` bodies is ignored.**
13. **The Tools tab shows two tools**, `youtubei.js` and `yt-dlp`; `bgutils-js` is gone.
14. **Copy.**
    - The Bulk badge reads "Queue".
    - The "Velo's own chain" paragraph and the "NSig & BotGuard Bypass" diagnostics row are gone.
    - The Transcript tab has no "AI" chip.
    - Save-error hints no longer mention PO tokens, nsig or "matching hop".
15. **`--impersonate` is no longer passed to yt-dlp** (ruling P1: TLS fingerprint impersonation is bot-detection evasion). Some yt-dlp runs fail more often.
16. **curl_cffi is no longer pip-installed at run time.** Nothing on the yt-dlp path installs a Python module.
17. **The browser mux of a video-only itag is relay-only.** `hybridMux`'s video leg (an itag with an `audioItag`) skips "yt-dlp on the server" and takes only the Velo relay.
18. **`--throttled-rate` is removed** (ruling P10: re-extracting a throttled stream is throttle bypass). A throttled yt-dlp download stays slow instead of restarting.
19. **yt-dlp ignores configuration files and plugins.** Every run passes `--ignore-config --no-plugin-dirs --no-remote-components`, so a user or system `yt-dlp.conf` and any installed yt-dlp plugin are ignored.

## Audit coverage

| Audit ID | Resolution |
|---|---|
| SEC-01 | Task 2 (BotGuard `new Function` deleted), Task 5 (`Platform.shim.eval` deleted, `retrieve_player: false`), Task 4 (`/api/unlock`), Task 1 (browser callers), Task 8 (yt-dlp child: no secrets, no run-time solver download). No isolated sandbox is added: C5 deletes instead |
| SUP-01 | Task 2 (interpreter fetch + execution deleted), Task 3 (`bgutils-js` removed) |
| ARCH-08 | Task 2 (b: BotGuard, `globalThis.window/self/document` swap), Task 5 (a: youtubei.js evaluator). `db.ts`' `typeof window` guard no longer races a bound window |
| SEC-12 | Task 2 (`withBgWindow`/`bindBgWindow` deleted with the file) |
| OPS-11 | Task 2 (the jsdom-on-`globalThis` part). Per-instance slots/rate limits/"direct blocked" bit: **Hand-off W5** (C8 Postgres rate store, deep health). The SOCKS-pool state is deleted by Task 7 |
| SEC-04 | Task 7 (free SOCKS pool deleted; no opt-in flag is kept) |
| SEC-07 | Task 4 (`/api/bypass` fan-out), Task 7 (`/api/relay` public-relay fan-out). The `isRelayTarget` allowlist, `Content-Disposition` pass-through and port check: **Hand-off W4a** (with TEST-18) |
| SEC-14 | Task 7 (the unfiltered free-SOCKS entries and `VELO_SOCKS_PROXY`/`ALL_PROXY` are deleted, so there is nothing left to filter; the user-proxy path keeps `isForbiddenAddress`) |
| SUP-05 | Task 7 (`proxifly/free-proxy-list@main` fetch deleted; policy test bans the name) |
| ARCH-09 | Task 1 (browser relays), Task 4 (`/api/bypass`), Task 7 (SOCKS pool, `/api/relay` fan-out, the false "HTML only" `cors-relays.ts` contract comment rewritten). Privacy-notice disclosure: not needed, because no third-party relay remains; W8/W9 write the policy |
| PRIV-09 | Tasks 1 and 7 (relay and proxy parts: the browser and server no longer contact corsfix/allorigins or free SOCKS). The privacy-policy text: **Hand-off W8/W9** |
| PRIV-10 | **DEFERRED, owner W3 + W9.** Operator proxies carrying signed-in sessions are the permitted operator egress (Global Constraints), so W4b deletes nothing here. Disclosure in the cookie-import dialog and a per-user opt-out belong to W3 (cookie handling); the privacy policy belongs to W9. W4b narrows it: after Task 7 the operator's own proxy is the only third party on the path |
| ARCH-12 | Task 6 (global `dns.lookup`/Happy Eyeballs/undici dispatcher patch deleted; the scoped `--force-ipv4` stays; justification in Task 6) |
| M-34 | Task 6 (the ARCH-12 half). ARCH-13 (a proxy-table DB error fails every InnerTube call) is not W4b's: **Hand-off W4a** (error mapping) |
| UX-05 | Task 9 (circumvention copy, the "Anti-Throttle Queue" badge, the "AI" chip and the "AI summary" hint). Counsel sign-off on the remaining copy: W9 |
| OSS-11 | Task 9 (README copy only). Legal review, usage notice and takedown contact: **W9 / W8** |
| ARCH-23 | Technical part: Tasks 1, 2, 4, 5 and 7 (BotGuard minting, nsig deciphering, throttle bypass, rotating third-party proxies removed), Task 3 (research notes). The "official Google" extension README goes with `extension/`: **W6**. Legal review: **W9** |
| M-04 | Tasks 2, 5 and 8 (no remote JS in the server realm; yt-dlp's child gets no secrets); Task 4 (entry point). CCR-1 records the yt-dlp exception |
| M-14 | Tasks 1 and 7 (free SOCKS pool and public relays deleted). Operator-owned egress (`VELO_EGRESS_PROXY`): **Hand-off W4a** |
| SUP-10 | Task 3 (`bgutils-js` removed; `jsdom` moved to `devDependencies`). `socks-proxy-agent` and `undici` stay (the user-proxy feature imports them). The other unused template deps: **W7** |
| W1 hand-off → W4b (delete the two `W4b` disables with their code) | Task 2 (`po-token.server.ts`), Task 5 (`youtube-client.server.ts`) |
| W1 hand-off → W4b (extend the ban to `vm.*`; core `no-eval`/`no-new-func`/`no-implied-eval`; alias gaps) | Task 5 (config + `scripts/eval-ban.test.mjs` lint probe, which also closes W1-T3's "an ESLint#lintText probe test would guard the bans" note) |
| TEST-13 (W4b half) | Task 6 (`ipv4-bind.test.ts` and its process-global `NODE_TLS_REJECT_UNAUTHORIZED` deleted with the module) |

## Hand-off

- **W4a**:
  - **Files W4b touched in W4a's area (minimal):**
    - `src/routes/api/relay.ts`: the import, the one `attempts` line and three comments (Task 7);
    - `src/routes/api/download.ts`: the same-hop fallback removed (Task 4);
    - `src/routes/api/{builder,ytdlp}.ts`: `pot` removed (Task 2).

    W4a plans against this post-W4b tree.
  - **Still W4a's:**
    - `isRelayTarget` exact hosts/paths/port (SEC-07 allowlist, TEST-18);
    - drop upstream `Content-Disposition`;
    - `requireSameOrigin` and `apiError` on every route, including the fixed strings W4b added (`BLOCKED`, "not available as a direct download", "No download path…") and the raw `err.message` in `download.ts`;
    - the runtime installers: `tool-updates.server.ts`'s `npm install` / `pip install` and the full `process.env` it passes (`optionalModule` and `ensureImpersonate` are already deleted, ruling P1);
    - ARCH-13.
  - **Wire `VELO_EGRESS_PROXY` (C1)** into yt-dlp `--proxy` and `proxiedFetch`. It replaces the deleted `VELO_SOCKS_PROXY`/`ALL_PROXY`.
- **W3:**
  - `src/lib/har.ts` / `src/lib/har-store.ts` still collect `poTokens` from imported HAR files (inert: nothing sends them). Drop the field when HAR import goes client-side (D7).
  - PRIV-10's import-dialog disclosure and per-user opt-out.
- **W5:**
  - install `yt-dlp[default]` pinned with hashes, which includes `yt-dlp-ejs` (the challenge solver Task 8 relies on), plus Node on `PATH` for `--js-runtimes node`;
  - install no yt-dlp PO-token provider plugin (e.g. `bgutil-ytdlp-pot-provider`) and no Deno;
  - `CHILD_ENV_ALLOWLIST` is the whole environment yt-dlp sees. Add a variable there, in a reviewed change, if the image needs one;
  - OPS-11's per-instance state (slots, "direct blocked" bit) moves to C8/deep health.
- **W6:** `extension/README.md` "official Google" wording (ARCH-23) goes with the extension.
- **W7:**
  - `docs/architecture.md` was brought up to date for W4b in the final fix wave; W7 keeps it current;
  - README rewrite;
  - dead code left in place, which W7 may delete:
    - `transfer-progress.ts` same-hop helpers (`applyPresentedHop`, `abandonFile`, `foldHybridBypassReport`, `fileByteReport`, `hlsSegmentReport`, `SameHopReport`), now used only by tests;
    - `hls.ts`, used only by tests;
    - `fallback-path.ts`' `BUILDER_FALLBACK_STEPS`;
    - `looksThrottled` (`throttle.ts:27`), used only by tests;
    - the research tables in `ytdlp-auth.ts` that only tests read: `YTDLP_PLAYER_CLIENTS`, `YTDLP_EXTRACTOR_ARGS`, `YTDLP_EXTRACTOR_LAYERS`, `YTDLP_CLIENT_EXTRACT` and `YTDLP_WORKING_EXAMPLE`;
    - naming: `SOCKS_CLIENTS`/`socksClientsForItag`, the `YtdlpNext` value `"next-socks"` and `YTDLP_PLAYER_CLIENTS.pot`;
  - CHANGELOG entry from "Behaviour changes" above.
- **W8:** the privacy policy lists no CORS relay or free-proxy third party. Any "use only for content you have rights to" notice (OSS-11) uses counsel's text.
- **W9 (counsel):**
  - yt-dlp's own challenge solving remains (CCR-1, Task 10 Step 2);
  - `--impersonate` (ruling P1) and `--throttled-rate` (ruling P10) were removed, so they need no ruling;
  - PRIV-10.

## Self-review

1. **Spec coverage.** Every item in the W4b brief maps to a task:
   - the PO-token minter plus `bgutils-js` → T2 and T3;
   - `/api/unlock`, `nsig.ts`, `stream-unlock.ts` and their client callers → T1, T4 and T5;
   - the `Platform.shim.eval` hook, deleted following youtubei.js's documented no-evaluator/no-player behaviour → T5;
   - the global `window`/`document` swap → T2;
   - the `bypass*.ts`, `/api/bypass` and same-hop paths → T1 and T4. The per-connection "throttle beating" parallel lanes also go, in T5;
   - the free SOCKS list and public CORS relays → T7. No operator-proxy seam existed besides the user-proxy console, which stays; `VELO_EGRESS_PROXY` goes to W4a;
   - the two `W4b` disables → T2 and T5;
   - the lint ban extension → T5;
   - copy and README → T9;
   - `ipv4-bind` → T6, with the justification recorded;
   - dependencies → T3.

   Every task leaves typecheck, lint, test and build green; this was verified in the scratch prototype after each one. Required tests:
   - `/api/unlock` and `/api/bypass` 404 → T4;
   - no `node:vm` import → T5;
   - the `proxifly|corsfix|allorigins|bgutils` policy → T7.
2. **Placeholder scan.** No TBD, TODO or "similar to Task N" remains. Two deliberate conditionals remain:
   - Task 8 is blocked on the [OWNER] ruling, with both outcomes spelled out;
   - W2-dependent anchors say STOP rather than guess.
3. **Type and name consistency.** The same names are used everywhere they appear:
   - `raceFirstBlob(steps, emit, attempts, parent?)` (T1);
   - `extractorArgs(client, visitor?, dataSyncId?)` (T2, used by T2/T7/T8);
   - `plainFormatUrl(format)` (T5);
   - `childEnv(source?)` and `CHILD_ENV_ALLOWLIST` (T8);
   - `attemptYtdlpMetadataLadder(userRoutes, attemptSaved, attemptDirect, usable)` (T7);
   - `SelectedRoute` without `free_socks` (T7, used by `user-proxy.server.ts`);
   - `remote-code-policy.test.ts` imports `readdirSync` from T5 on. T6, T7 and T9 use it; T1–T4 don't.
4. **Review Focus.** Each line has its test in the owning task: T1 zero-leg race, T5 cipher-only format, T4 404s, T8 child env (including Windows casing) and T5 lint probe.
5. **Verified by experiment**:
   - **Scratch copy:** a `git archive` of the W1 head with `npm ci --ignore-scripts`, 2026-09-24. Every task was applied in order. After each one, typecheck, lint (0 warnings), `npm test` and the build were green; `test:http` was green after T4 onward. Final counts: 251 script tests and 531 TS tests, 0 failures, plus 22 HTTP tests passing. The diff came to 85 files, +1,009/−4,346.
   - **Failing-first:** each new test was run and failed before its implementation, with the messages quoted in the steps.
   - **Deleted routes:** they answer 404 HTML on the built server. `GET /api/unlock` previously answered 200 (app shell).
   - **youtubei.js 18.1.0:** the default `Platform.shim.eval` throws "provide your own JavaScript evaluator"; `retrieve_player: false` skips `Player.create`; `Format.decipher(undefined)` returns `url || ''`.
   - **yt-dlp 2026.06.09:** the facts quoted in CCR-1 (`node --permission` child, env inherited, `REQUIRE_JS_PLAYER` table, `-F` results with and without a runtime, and the bundled solver working without `--remote-components`).
   - **ESLint:** core rules plus the selectors reject all 11 probe forms. `setTimeout(variable)` is not caught (it needs type-aware linting).
   - **npm 11.6.2:** it rewrites unrelated optional-dependency metadata in `package-lock.json` even with no package change (Task 3 Step 3).
   - **One probe during planning** (`GET /api/bypass?id=…&itag=18` on the unmodified build) made live requests to corsfix/allorigins before the plan switched to offline-only inputs. No step in this plan does that.
