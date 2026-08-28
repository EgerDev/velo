import assert from "node:assert/strict";
import { test } from "node:test";
import { maskProxyDisplay, type UserProxyRow } from "./user-proxy-parse.ts";
import {
  ByteCountSchema,
  EpochMillisecondsSchema,
  INITIAL_PROXY_HEALTH,
  MillisecondsSchema,
  PrioritySchema,
  PROTOCOL_CAPABILITIES,
  PROTOCOLS,
  ProxyIdSchema,
  classifyValidation,
  compareProxyPriority,
  isEvidenceStale,
  isRouteUsable,
  parseProxyHealthState,
  setRouteEnabled,
  toSafeProxyView,
  transitionHealth,
  VALIDATION_STAGES,
  type ValidationOutcome,
} from "./proxy-operations.ts";

test("Given legacy unknown/ok/fail rows, When the public mask helper projects them, Then status semantics are unchanged", () => {
  // Given
  const rows: readonly UserProxyRow[] = [
    { id: "unknown", display: "one.example:80", protocol: "http", ok: null, exitIp: null, checkedAt: null },
    { id: "ok", display: "two.example:80", protocol: "http", ok: true, exitIp: null, checkedAt: 1 },
    { id: "fail", display: "three.example:80", protocol: "http", ok: false, exitIp: null, checkedAt: 2 },
  ];

  // When
  const observed = rows.map((row) => ({ id: row.id, ok: row.ok, display: maskProxyDisplay(row.display) }));

  // Then
  assert.deepEqual(observed, [
    { id: "unknown", ok: null, display: "one.x.x:80" },
    { id: "ok", ok: true, display: "two.x.x:80" },
    { id: "fail", ok: false, display: "three.x.x:80" },
  ]);
});

test("Given the new proxy domain is requested, When its protocol table loads, Then the approved protocols exist", () => {
  // Given / When
  const protocols = PROTOCOLS;

  // Then
  assert.deepEqual(protocols, ["http", "socks5"]);
  assert.deepEqual(PROTOCOL_CAPABILITIES, { http: ["metadata", "media", "ytdlp"], socks5: ["ytdlp"] });
  assert.deepEqual(VALIDATION_STAGES, ["connection", "tls", "route_probe", "metadata", "media_range"]);
});

test("Given every validator outcome, When classified, Then the approved verdict and attribution table is exact", () => {
  // Given
  const table: readonly (readonly [ValidationOutcome, string, string | null])[] = [
    [{ kind: "never_checked" }, "none", "unknown"],
    [{ kind: "active_check" }, "none", "checking"],
    [{ kind: "full_pass" }, "route", "healthy"],
    ...(["connection", "dns", "refusal", "timeout"] as const).map((kind) => [{ kind }, "route", "unreachable"] as const),
    ...(["certificate", "hostname", "chain"] as const).map((kind) => [{ kind }, "route", "unsafe_tls"] as const),
    ...(["bot_wall", "login_required", "route_forbidden"] as const).map((kind) => [{ kind }, "route", "blocked"] as const),
    ...(["media_range", "optional_stage"] as const).map((kind) => [{ kind }, "route", "degraded"] as const),
    ...(["credential_missing", "credential_undecryptable", "key_unstable", "proxy_authentication_failed", "invalid_configuration", "forbidden_proxy_address"] as const).map((kind) => [{ kind }, "configuration", "misconfigured"] as const),
    ...(["content_private", "content_age_restricted", "content_members_only", "content_deleted", "caller_abort"] as const).map((kind) => [{ kind }, "content", null] as const),
  ];

  // When
  const observed = table.map(([input]) => classifyValidation(input));

  // Then
  assert.deepEqual(observed, table.map(([, attribution, verdict]) => ({ attribution, verdict })));
});

test("Given consecutive route-caused hard failures, When the second arrives, Then the route becomes ineligible", () => {
  // Given
  const once = transitionHealth(INITIAL_PROXY_HEALTH, classifyValidation({ kind: "timeout" }));

  // When
  const twice = transitionHealth(once, classifyValidation({ kind: "bot_wall" }));

  // Then
  assert.deepEqual({ hardFailures: twice.hardFailures, eligible: twice.eligible }, { hardFailures: 2, eligible: false });
});

test("Given an ineligible route, When two consecutive full passes arrive, Then counters clear and eligibility is restored", () => {
  // Given
  const failed = transitionHealth(transitionHealth(INITIAL_PROXY_HEALTH, classifyValidation({ kind: "chain" })), classifyValidation({ kind: "refusal" }));

  // When
  const once = transitionHealth(failed, classifyValidation({ kind: "full_pass" }));
  const twice = transitionHealth(once, classifyValidation({ kind: "full_pass" }));

  // Then
  assert.equal(once.eligible, false);
  assert.deepEqual({ hardFailures: twice.hardFailures, fullPasses: twice.fullPasses, eligible: twice.eligible }, { hardFailures: 0, fullPasses: 0, eligible: true });
});

test("Given one hard failure followed by a full pass, When another hard failure arrives, Then the interrupted hard streak does not disable the route", () => {
  // Given
  const once = transitionHealth(INITIAL_PROXY_HEALTH, classifyValidation({ kind: "timeout" }));
  const interrupted = transitionHealth(once, classifyValidation({ kind: "full_pass" }));

  // When
  const observed = transitionHealth(interrupted, classifyValidation({ kind: "chain" }));

  // Then
  assert.deepEqual({ hardFailures: observed.hardFailures, eligible: observed.eligible }, { hardFailures: 1, eligible: true });
});

test("Given hard failure streaks, When degraded or a private-video content error arrives, Then only degraded interrupts the streak", () => {
  // Given
  const once = transitionHealth(INITIAL_PROXY_HEALTH, classifyValidation({ kind: "timeout" }));

  // When
  const content = transitionHealth(once, classifyValidation({ kind: "content_private" }));
  const degraded = transitionHealth(once, classifyValidation({ kind: "media_range" }));

  // Then
  assert.deepEqual(content, once);
  assert.deepEqual({ verdict: degraded.verdict, hardFailures: degraded.hardFailures, eligible: degraded.eligible }, { verdict: "degraded", hardFailures: 0, eligible: true });
});

test("Given a route control, When disabled then enabled, Then usability follows only enabled and eligibility", () => {
  // Given
  const disabled = setRouteEnabled(INITIAL_PROXY_HEALTH, false);

  // When
  const enabled = setRouteEnabled(disabled, true);
  const failed = transitionHealth(transitionHealth(enabled, classifyValidation({ kind: "timeout" })), classifyValidation({ kind: "timeout" }));

  // Then
  assert.equal(isRouteUsable(disabled), false);
  assert.equal(isRouteUsable(enabled), true);
  assert.equal(isRouteUsable(setRouteEnabled(failed, true)), false);
});

test("Given injected clocks at 59m59s and 60m, When stale is derived, Then the one-hour boundary is inclusive", () => {
  // Given
  const checkedAt = EpochMillisecondsSchema.parse(1_000);
  const before = { now: () => EpochMillisecondsSchema.parse(3_600_999) };
  const boundary = { now: () => EpochMillisecondsSchema.parse(3_601_000) };

  // When
  const observed = [isEvidenceStale(checkedAt, before), isEvidenceStale(checkedAt, boundary), isEvidenceStale(null, boundary)];

  // Then
  assert.deepEqual(observed, [false, true, false]);
});

test("Given equal and distinct priorities, When routes sort, Then priority and branded ID provide deterministic order", () => {
  // Given
  const makeKey = (id: string, priority: number) => ({ id: ProxyIdSchema.parse(id), priority: PrioritySchema.parse(priority) });
  const routes = [makeKey("b", 1), makeKey("c", 2), makeKey("a", 1)];

  // When
  const ordered = [...routes].sort(compareProxyPriority).map((route) => route.id);

  // Then
  assert.deepEqual(ordered, ["a", "b", "c"]);
});

test("Given nested credential, media, and header sentinels, When a safe view serializes, Then only allowlisted evidence remains", () => {
  // Given
  const route = {
    id: ProxyIdSchema.parse("route-1"), routeRef: "route-01", maskedLabel: "proxy.x.x:443", protocol: "http", priority: PrioritySchema.parse(1), enabled: true, eligible: true, verdict: "healthy", stale: false, lastCheckedAt: EpochMillisecondsSchema.parse(1_000),
    credential: "CREDENTIAL_SENTINEL",
    evidence: [{ stage: "media_range", outcome: "passed", durationMs: MillisecondsSchema.parse(12), code: null, httpStatus: 206, bytesRead: ByteCountSchema.parse(10_240), mediaUrl: "MEDIA_SENTINEL", headers: { authorization: "HEADER_SENTINEL" } }],
  } as const;

  // When
  const serialized = JSON.stringify(toSafeProxyView(route));

  // Then
  for (const sentinel of ["CREDENTIAL_SENTINEL", "MEDIA_SENTINEL", "HEADER_SENTINEL"]) assert.equal(serialized.includes(sentinel), false);
  assert.equal(serialized.includes('"stage":"media_range"'), true);
});

test("Given malformed persisted state, When parsed at the boundary, Then invalid tags, counters, and timestamps are rejected safely", () => {
  // Given
  const invalid = [
    { ...INITIAL_PROXY_HEALTH, verdict: "invented" },
    { ...INITIAL_PROXY_HEALTH, hardFailures: -1 },
    { ...INITIAL_PROXY_HEALTH, fullPasses: 0.5 },
    { ...INITIAL_PROXY_HEALTH, lastCheckedAt: -1 },
  ];

  // When
  const observed = invalid.map(parseProxyHealthState);

  // Then
  assert.equal(observed.every((result) => !result.ok && result.error.kind === "invalid_proxy_health_state"), true);
  assert.equal(parseProxyHealthState(INITIAL_PROXY_HEALTH).ok, true);
});
