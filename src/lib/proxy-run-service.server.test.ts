import assert from "node:assert/strict";
import { test } from "node:test";
import { PrioritySchema, ProxyIdSchema, type SafeProxyView } from "./proxy-operations.ts";
import { abortProxyValidationRun, remainingResumeRoutes, runAllProxyChecks, type ProxyRunStore } from "./proxy-run-service.server.ts";

const rows: readonly SafeProxyView[] = ["a", "b", "c"].map((id, index) => ({ id: ProxyIdSchema.parse(id), routeRef: id.repeat(64), maskedLabel: `HTTP ${id.repeat(8)} ••••:80`, protocol: "http", priority: PrioritySchema.parse(index + 1), enabled: true, eligible: true, verdict: "unknown", stale: false, lastCheckedAt: null, evidence: [] }));

test("Given ordered routes and a concurrency cap, When run-all executes, Then persistence remains ordered and progress is bounded", async () => {
  // Given
  let active = 0; let peak = 0; const committed: string[] = [];
  const store: ProxyRunStore = { create: async () => "run", secret: async (id, callback) => callback(`http://${id}:80`),
    commit: async (record) => { committed.push(record.proxyId); }, finish: async () => undefined };
  // When
  const result = await runAllProxyChecks(rows, store, async () => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return { classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }; }, 2);
  // Then
  assert.equal(peak, 2); assert.deepEqual(committed, ["a", "b", "c"]); assert.deepEqual(result, { runId: "run", total: 3, completed: 3, failed: 0, nextCursor: 3, done: true });
});

test("Given no routes, When run-all executes, Then a durable empty run completes safely", async () => {
  // Given
  let status = ""; const store: ProxyRunStore = { create: async () => "empty", secret: async () => null, commit: async () => undefined, finish: async (_id, value) => { status = value; } };
  // When
  const result = await runAllProxyChecks([], store, async () => { throw new TypeError("unreachable"); });
  // Then
  assert.equal(status, "completed"); assert.equal(result.total, 0);
});

test("Given a durable commit failure, When run-all persists ordered evidence, Then the run is marked failed and rejects", async () => {
  // Given
  let status = ""; const store: ProxyRunStore = { create: async () => "run", secret: async (_id, callback) => callback("http://safe:80"), commit: async () => { throw new TypeError("commit failed"); }, finish: async (_id, value) => { status = value; } };
  // When / Then
  await assert.rejects(() => runAllProxyChecks(rows.slice(0, 1), store, async () => ({ classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] })));
  assert.equal(status, "failed");
});

test("Given an excessive requested concurrency, When a batch runs, Then active validation never exceeds two", async () => {
  let active = 0; let peak = 0;
  const store: ProxyRunStore = { create: async () => "run", secret: async (_id, callback) => callback("http://safe:80"), commit: async () => undefined, finish: async () => undefined };
  await runAllProxyChecks(rows, store, async () => { active += 1; peak = Math.max(peak, active); await new Promise<void>((resolve) => setImmediate(resolve)); active -= 1; return { classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }; }, 99);
  assert.equal(peak, 2);
});

test("Given cancellation before the next batch, When run-all checks durable state, Then no route is attempted and status is partial", async () => {
  let status = ""; let attempts = 0;
  const store: ProxyRunStore = { create: async () => "run", secret: async (_id, callback) => { attempts += 1; return callback("http://safe:80"); }, commit: async () => undefined, finish: async (_id, value) => { status = value; }, cancelled: async () => true };
  const result = await runAllProxyChecks(rows, store, async () => ({ classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }));
  assert.equal(attempts, 0); assert.equal(status, ""); assert.equal(result.completed, 0);
});

test("Given cancellation after the first concurrency wave, When run-all starts the next wave, Then remaining routes are not attempted", async () => {
  const many: readonly SafeProxyView[] = Array.from({ length: 6 }, (_, index) => ({ ...rows[0], id: ProxyIdSchema.parse(`cancel-${index}`), routeRef: String(index).padStart(64, "0"), priority: PrioritySchema.parse(index + 1) }));
  let cancellationChecks = 0; let status = ""; const attempted: string[] = [];
  const store: ProxyRunStore = {
    create: async () => "run",
    secret: async (id, callback) => { attempted.push(id); return callback("http://safe:80"); },
    commit: async () => undefined,
    finish: async (_id, value) => { status = value; },
    cancelled: async () => { cancellationChecks += 1; return cancellationChecks > 1; },
  };
  const result = await runAllProxyChecks(many, store, async () => ({ classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }), 2);
  assert.deepEqual(attempted, ["cancel-0", "cancel-1"]); assert.equal(status, ""); assert.equal(result.completed, 2); assert.equal(result.done, false);
});

test("Given cancellation during an active wave, When durable state changes, Then in-flight validation receives an abort signal", async () => {
  let aborted = 0;
  const store: ProxyRunStore = {
    create: async () => "run", secret: async (_id, operation) => operation("http://safe:80"),
    commit: async () => undefined, finish: async () => undefined,
    cancelled: async () => false,
  };
  const pending = runAllProxyChecks(rows, store, async (_url, signal) => new Promise((resolve) => {
    signal?.addEventListener("abort", () => { aborted += 1; resolve({ classification: { attribution: "none", verdict: "unknown" }, errorCode: "caller_abort", evidence: [] }); }, { once: true });
  }), 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  abortProxyValidationRun("run");
  const result = await pending;
  assert.equal(aborted, 2); assert.equal(result.completed, 0); assert.equal(result.nextCursor, 0); assert.equal(result.done, false);
});

test("Given a partial durable cursor, When resumed then replayed at the completed cursor, Then only remaining routes commit once", async () => {
  const committed: string[] = [];
  const store: ProxyRunStore = { create: async () => "run", secret: async (_id, callback) => callback("http://safe:80"), commit: async (record) => { committed.push(record.proxyId); }, finish: async () => undefined };
  const partial = { runId: "run", routeIds: rows.map((row) => row.id), nextCursor: 1 };
  const remaining = remainingResumeRoutes(partial, rows);
  await runAllProxyChecks(remaining, store, async () => ({ classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }), 2, partial.runId);
  const replay = remainingResumeRoutes({ ...partial, nextCursor: 3 }, rows);
  await runAllProxyChecks(replay, store, async () => ({ classification: { attribution: "route", verdict: "healthy" }, errorCode: null, evidence: [] }), 2, partial.runId);
  assert.deepEqual(committed, ["b", "c"]); assert.equal(replay.length, 0);
});

test("Given more than eight ordered routes, When start then resume run, Then each invocation commits one batch and total reaches every route", async () => {
  const many: readonly SafeProxyView[] = Array.from({ length: 10 }, (_, index) => ({ ...rows[0], id: ProxyIdSchema.parse(`route-${index}`), routeRef: String(index).padStart(64, "0"), priority: PrioritySchema.parse(index + 1) }));
  const committed: string[] = [];
  const store: ProxyRunStore = { create: async () => "run", secret: async (_id, callback) => callback("http://safe:80"), commit: async (record) => { committed.push(record.proxyId); }, finish: async () => undefined };
  const validate = async () => ({ classification: { attribution: "route", verdict: "healthy" } as const, errorCode: null, evidence: [] });
  const first = await runAllProxyChecks(many, store, validate, 2, "run");
  const remaining = remainingResumeRoutes({ runId: "run", routeIds: many.map((route) => route.id), nextCursor: first.completed }, many);
  const second = await runAllProxyChecks(remaining, store, validate, 2, "run");
  assert.equal(first.completed, 8); assert.equal(second.completed, 2); assert.equal(new Set(committed).size, 10);
});
