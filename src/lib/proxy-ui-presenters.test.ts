import assert from "node:assert/strict";
import test from "node:test";
import {
  EpochMillisecondsSchema,
  PrioritySchema,
  ProxyIdSchema,
  type SafeProxyView,
} from "./proxy-operations.ts";
import {
  displayRouteStatus,
  evidenceFreshness,
  orderedProxyRoutes,
  proxyPoolSummary,
  validationRunControls,
} from "./proxy-ui-presenters.ts";

function route(
  id: string,
  priority: number,
  overrides: Partial<SafeProxyView> = {},
): SafeProxyView {
  return {
    id: ProxyIdSchema.parse(id),
    routeRef: `ref-${id}`,
    maskedLabel: `HTTP ref-${id.slice(0, 4)} ••••:0`,
    protocol: "http",
    priority: PrioritySchema.parse(priority),
    enabled: true,
    eligible: true,
    verdict: "unknown",
    stale: false,
    lastCheckedAt: null,
    evidence: [],
    ...overrides,
  };
}

test("orders the safe route vault by priority and then id", () => {
  const ordered = orderedProxyRoutes([
    route("route-b", 2),
    route("route-c", 1),
    route("route-a", 1),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["route-a", "route-c", "route-b"],
  );
});

test("summarizes operational states without reading route credentials", () => {
  const summary = proxyPoolSummary([
    route("healthy", 1, { verdict: "healthy" }),
    route("degraded", 2, { verdict: "degraded", stale: true }),
    route("blocked", 3, { verdict: "blocked" }),
    route("disabled", 4, { verdict: "healthy", enabled: false }),
  ]);
  assert.deepEqual(summary, { healthy: 1, degraded: 1, blocked: 1, stale: 1, disabled: 1 });
});

test("prioritizes disabled and held safety states over the underlying verdict", () => {
  assert.deepEqual(
    displayRouteStatus(route("disabled", 1, { enabled: false, verdict: "healthy" })),
    { key: "disabled", label: "Disabled", tone: "subtle" },
  );
  assert.deepEqual(displayRouteStatus(route("held", 2, { eligible: false, verdict: "blocked" })), {
    key: "held",
    label: "Held from routing",
    tone: "warn",
  });
});

test("maps each server-safe verdict to an operator-readable status", () => {
  const expected = {
    unknown: "Not checked",
    checking: "Checking",
    healthy: "Healthy",
    degraded: "Degraded",
    blocked: "Blocked",
    unreachable: "Unreachable",
    unsafe_tls: "TLS unsafe",
    misconfigured: "Needs configuration",
  } as const;
  for (const verdict of Object.keys(expected) as Array<keyof typeof expected>) {
    const label = expected[verdict];
    assert.equal(displayRouteStatus(route(`route-${verdict}`, 1, { verdict })).label, label);
  }
});

test("keeps cancellation reachable after a synchronous validation batch returns partial", () => {
  assert.deepEqual(
    validationRunControls({
      status: "partial",
      total: 16,
      completed: 8,
      cancelRequested: false,
    }),
    { canResume: true, canCancel: true, cancelLabel: "Cancel remaining checks" },
  );
});

test("renders a deterministic stale-evidence message from the safe stale flag", () => {
  assert.equal(
    evidenceFreshness({ lastCheckedAt: EpochMillisecondsSchema.parse(1_000), stale: true }),
    "Evidence older than one hour",
  );
  assert.equal(evidenceFreshness({ lastCheckedAt: null, stale: false }), "No completed check");
});
