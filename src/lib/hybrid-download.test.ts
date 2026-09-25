import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// hybrid-download.ts is browser code: map "@/" onto src/ and stub the modules
// that pull in server functions, localStorage or IndexedDB.
const STUBS: Record<string, string> = {
  "@/lib/guest-id": "export function downloadHeaders(headers) { return headers ?? {}; }",
  "@/lib/resolve-video":
    "export async function resolvePlayback() { return { url: 'https://r1.googlevideo.com/videoplayback?itag=18' }; }",
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

// The ytdlp and relay legs arm their timers with window.setTimeout.
(globalThis as { window?: unknown }).window ??= globalThis;

const MEDIA = "https://r1.googlevideo.com/videoplayback?itag=18";
const RELAY = `/api/relay?url=${encodeURIComponent(MEDIA)}`;
const media = () => new Response(new Uint8Array(4096), { headers: { "content-type": "video/mp4" } });
const blocked = () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } });

/** Run with a stubbed fetch; returns every URL asked for, sorted (the legs race). */
async function legsOf(answer: (url: string) => Response, run: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return answer(String(input));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
  return seen.sort();
}

test("muxed itag 18 races exactly yt-dlp on the server and the Velo relay", async () => {
  const { hybridFetchBlob } = await import("./hybrid-download.ts");
  let blob: Blob | undefined;
  const seen = await legsOf(media, async () => {
    blob = await hybridFetchBlob({ videoId: "jNQXAC9IVRw", itag: 18 });
  });
  assert.deepEqual(seen, [RELAY, "/api/ytdlp"]);
  assert.equal(blob?.size, 4096);
});

test("video-only 137 with audio 140 takes exactly the Velo relay", async () => {
  const { hybridFetchBlob } = await import("./hybrid-download.ts");
  const seen = await legsOf(media, () => hybridFetchBlob({ videoId: "jNQXAC9IVRw", itag: 137, audioItag: 140 }));
  assert.deepEqual(seen, [RELAY]);
});

test("when every leg fails the download rejects, and no other URL is tried", async () => {
  const { hybridFetchBlob } = await import("./hybrid-download.ts");
  const muxed = await legsOf(blocked, () =>
    assert.rejects(hybridFetchBlob({ videoId: "jNQXAC9IVRw", itag: 18 })),
  );
  assert.deepEqual(muxed, [RELAY, "/api/ytdlp"]);
  const videoOnly = await legsOf(blocked, () =>
    assert.rejects(hybridFetchBlob({ videoId: "jNQXAC9IVRw", itag: 137, audioItag: 140 })),
  );
  assert.deepEqual(videoOnly, [RELAY]);
});
