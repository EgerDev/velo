import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hybrid-download.ts is browser code: map "@/" onto src/ and stub the modules
// that pull in server functions, localStorage or IndexedDB.
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
