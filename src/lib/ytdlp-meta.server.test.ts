import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Capture the argv of the two metadata runs (captions, -J formats). Every run
// fails, so each builder is called once per client and nothing is spawned.
const STUBS: Record<string, string> = {
  "@/lib/ytdlp-proc.server": `
    export const JSON_STDOUT_MAX = 1;
    export async function runCapture(_bin, args) {
      (globalThis.__veloArgv ??= []).push(args);
      return { code: 1, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false };
    }`,
  "@/lib/ytdlp-python.server": `
    export async function ensurePython() { return { ok: true, version: "test" }; }
    export function directYtdlpOpen() { return true; }
    export function markDirectYtdlpBlocked() {}`,
  "@/lib/download-pool.server": "export async function acquireYtdlpSlot() { return () => {}; }",
  "@/lib/user-proxy.server": "export async function userProxyLadder() { return []; }",
  "@/lib/log.server": "export const log = { debug() {}, info() {}, warn() {}, error() {} };",
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

const LOCKED_PREFIX = [
  "-m",
  "yt_dlp",
  "--ignore-config",
  "--no-plugin-dirs",
  "--no-remote-components",
  "--no-js-runtimes",
  "--js-runtimes",
  "node",
];

async function captured(run: () => Promise<unknown>): Promise<string[][]> {
  const store = globalThis as { __veloArgv?: string[][] };
  store.__veloArgv = [];
  await run();
  return store.__veloArgv;
}

test("the captions and -J formats argv start with the locked-down prefix and set no --throttled-rate", async () => {
  const { fetchSubtitlesViaYtdlp, listYtdlpFormats } = await import("./ytdlp-meta.server.ts");
  const subs = await captured(() => fetchSubtitlesViaYtdlp({ id: "jNQXAC9IVRw", lang: "en" }));
  const formats = await captured(() => listYtdlpFormats("jNQXAC9IVRw"));
  assert.ok(subs.length > 0 && subs.every((argv) => argv.includes("--write-subs")), "captions ran");
  assert.ok(formats.length > 0 && formats.every((argv) => argv.includes("-J")), "formats ran");
  for (const argv of [...subs, ...formats]) {
    assert.deepEqual(argv.slice(0, LOCKED_PREFIX.length), LOCKED_PREFIX);
    assert.equal(argv.includes("--throttled-rate"), false);
    assert.equal(argv.includes("--remote-components"), false);
  }
});
