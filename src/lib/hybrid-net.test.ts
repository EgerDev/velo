import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hybrid-net.ts is browser code: its "@/" imports need mapping onto src/, and
// guest-id reads localStorage/window, which a unit test must not touch.
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
