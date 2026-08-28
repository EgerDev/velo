import assert from "node:assert/strict";
import { test } from "node:test";
import { PrioritySchema, ProxyIdSchema, type SafeProxyView } from "./proxy-operations.ts";
import { attemptSelectedRoutes, selectProxyRoutes } from "./proxy-selector.server.ts";

function route(id: string, priority: number, protocol: "http" | "socks5", eligible = true): SafeProxyView {
  return { id: ProxyIdSchema.parse(id), routeRef: id.padEnd(64, "0"), maskedLabel: `${protocol} hidden`, protocol,
    priority: PrioritySchema.parse(priority), enabled: true, eligible, verdict: eligible ? "degraded" : "blocked",
    stale: false, lastCheckedAt: null, evidence: [] };
}

test("Given unordered routes, When metadata routes are selected, Then capable hard-failure-free routes precede direct deterministically", () => {
  // Given
  const routes = [route("b", 2, "http"), route("s", 1, "socks5"), route("a", 1, "http"), route("x", 3, "http", false)];
  // When
  const selected = selectProxyRoutes(routes, "metadata");
  // Then
  assert.deepEqual(selected.map((item) => item.kind === "proxy" ? item.id : item.kind), ["a", "b", "direct"]);
});

test("Given only incapable or skipped routes, When yt-dlp routes are selected, Then free SOCKS and direct remain ordered fallbacks", () => {
  // Given / When
  const selected = selectProxyRoutes([route("x", 1, "http", false)], "ytdlp", ["free-b", "free-a"]);
  // Then
  assert.deepEqual(selected.map((item) => item.kind === "free_socks" ? item.url : item.kind), ["free-b", "free-a", "direct"]);
});

for (const capability of ["metadata", "media", "ytdlp"] as const) test(`Given ${capability} consumers, When configured attempts fail, Then the ledger preserves configured, free, and direct fallback order`, async () => {
  const routes = selectProxyRoutes([route("b", 2, "http"), route("a", 1, "http")], capability, capability === "ytdlp" ? ["free"] : []);
  const ledger = await attemptSelectedRoutes(routes, async (selected) => selected.kind === "direct" ? { ok: true, value: "direct-ok" } : { ok: false });
  assert.deepEqual(ledger.attempted.map((selected) => selected.kind === "proxy" ? selected.id : selected.kind), capability === "ytdlp" ? ["a", "b", "free_socks", "direct"] : ["a", "b", "direct"]);
  assert.deepEqual(ledger.attempted.map((selected) => selected.trusted), capability === "ytdlp" ? [true, true, false, false] : [true, true, false]);
  assert.equal(ledger.result, "direct-ok");
});

test("Given an explicit no-direct policy, When configured routes fail, Then direct is omitted deliberately", async () => {
  const routes = selectProxyRoutes([route("saved", 1, "http")], "metadata");
  const ledger = await attemptSelectedRoutes(routes, async () => ({ ok: false }), { allowDirectFallback: false });
  assert.deepEqual(ledger.attempted.map((selected) => selected.kind === "proxy" ? selected.id : selected.kind), ["saved"]);
});
