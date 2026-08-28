import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ProxyIdSchema } from "./proxy-operations.ts";
import { attemptYtdlpMetadataLadder, type YtdlpMetadataRoute } from "./ytdlp-meta-routing.ts";

function route(id: string): YtdlpMetadataRoute {
  return {
    id: ProxyIdSchema.parse(id), protocol: "http",
    run: async (callback) => callback(`http://${id}:80`),
    mark: async () => undefined,
  };
}

test("Given saved routes and free SOCKS, When yt-dlp metadata attempts run, Then the shared adapter preserves saved-first order", async () => {
  const attempts: string[] = [];
  const result = await attemptYtdlpMetadataLadder(
    [route("first"), route("second")],
    async (_route, url) => { attempts.push(url); return ""; },
    async () => { attempts.push("free"); return "free-result"; },
    (value) => value.length > 0,
  );
  assert.equal(result, "free-result");
  assert.deepEqual(attempts, ["http://first:80", "http://second:80", "free"]);
});

test("Given a successful saved route, When yt-dlp metadata attempts run, Then free SOCKS is not reached", async () => {
  let freeAttempts = 0;
  const result = await attemptYtdlpMetadataLadder(
    [route("saved")],
    async () => "saved-result",
    async () => { freeAttempts += 1; return "free-result"; },
    (value) => value.length > 0,
  );
  assert.equal(result, "saved-result"); assert.equal(freeAttempts, 0);
});

test("Given the live subtitle and format paths, When source wiring is inspected, Then both call the shared adapter instead of private saved-route loops", async () => {
  const source = await readFile(new URL("./ytdlp-meta.server.ts", import.meta.url), "utf8");
  assert.equal(source.match(/attemptYtdlpMetadataLadder\(/g)?.length, 2);
  assert.equal(source.includes("for (const up of userRoutes)"), false);
  const adapter = await readFile(new URL("./ytdlp-meta-routing.ts", import.meta.url), "utf8");
  assert.match(adapter, /attemptSelectedRoutes\(selected/);
  assert.match(adapter, /allowDirectFallback: false/);
});
