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
