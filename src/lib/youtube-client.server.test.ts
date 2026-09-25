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
