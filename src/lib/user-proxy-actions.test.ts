import assert from "node:assert/strict";
import { test } from "node:test";
import { ProxyActionError, parseProxyHistoryQuery, proxyActionHandlers } from "./proxy-action-contracts.ts";

test("Given history filters, When parsed, Then status protocol date and cursor remain typed", () => {
  const value = parseProxyHistoryQuery({ limit: 50, status: "healthy", protocol: "socks5", from: 1, to: 2, cursor: { createdAt: 2, id: "00000000-0000-4000-8000-000000000000" } });
  assert.deepEqual(value, { limit: 50, status: "healthy", protocol: "socks5", from: 1, to: 2, cursor: { createdAt: 2, id: "00000000-0000-4000-8000-000000000000" } });
});

test("Given stale or oversized history requests, When parsed, Then boundary validation rejects them", () => {
  assert.throws(() => parseProxyHistoryQuery({ limit: 51 }));
  assert.throws(() => parseProxyHistoryQuery({ cursor: { createdAt: -1, id: "stale" } }));
  assert.throws(() => parseProxyHistoryQuery({ from: 3, to: 2 }));
});

test("Given an action failure, When serialized, Then only typed code and safe message escape", () => {
  const error = new ProxyActionError("not_resumable", "Run is not resumable.");
  assert.deepEqual(error.toJSON(), { code: "not_resumable", message: "Run is not resumable." });
});

test("Given an operator and mocked persistence, When every exported action boundary runs, Then each reaches its own database operation", async () => {
  const calls: string[] = [];
  const gate = async (userId: string) => { assert.equal(userId, "operator"); calls.push("gate"); };
  for (const [name, handler] of Object.entries(proxyActionHandlers)) {
    const result = await handler({ userId: "operator", gate, run: async () => { calls.push(name); return { ok: true, name }; } });
    assert.deepEqual(result, { ok: true, name });
  }
  assert.deepEqual(calls.filter((call) => call !== "gate"), [
    "listUserProxies", "addUserProxy", "removeUserProxy", "testUserProxy", "listProxyOperations",
    "runAllProxyValidations", "setProxyRouteEnabled", "reorderProxyRoutes", "clearProxyHistory",
    "testProxyValidation", "listProxyHistoryPage", "startProxyValidationRun", "resumeProxyValidationRun",
    "cancelProxyValidationRun", "getProxyValidationRun",
  ]);
  assert.equal(Object.keys(proxyActionHandlers).length, 15);
});

test("Given guest and nonoperator contexts, When actual action boundaries run, Then the gate denies before any database operation", async () => {
  for (const userId of ["guest", "nonoperator"]) {
    let databaseTouched = false;
    const gate = async () => { throw new ProxyActionError("forbidden", "Not allowed."); };
    for (const handler of Object.values(proxyActionHandlers)) {
      await assert.rejects(() => handler({ userId, gate, run: async () => { databaseTouched = true; return true; } }), (error: unknown) => error instanceof ProxyActionError && error.code === "forbidden");
    }
    assert.equal(databaseTouched, false);
  }
});

test("Given database-off missing-key and lease-conflict states, When their real action boundaries run, Then safe stable errors cross the boundary", async () => {
  const gate = async () => undefined;
  const cases = [
    () => proxyActionHandlers.listProxyHistoryPage({ userId: "operator", gate, run: async () => { throw new ProxyActionError("unavailable", "Proxy storage is unavailable."); } }),
    () => proxyActionHandlers.addUserProxy({ userId: "operator", gate, run: async () => { throw new ProxyActionError("unavailable", "The route vault is unavailable."); } }),
    () => proxyActionHandlers.testUserProxy({ userId: "operator", gate, run: async () => { throw new ProxyActionError("unavailable", "That proxy is unavailable."); } }),
    () => proxyActionHandlers.resumeProxyValidationRun({ userId: "operator", gate, run: async () => { throw new ProxyActionError("not_resumable", "Run is not resumable."); } }),
  ];
  const serialized: unknown[] = [];
  for (const invoke of cases) {
    await assert.rejects(invoke, (error: unknown) => {
      assert.ok(error instanceof ProxyActionError); serialized.push(error.toJSON()); return true;
    });
  }
  assert.deepEqual(serialized.map((value) => (value as { code: string }).code), ["unavailable", "unavailable", "unavailable", "not_resumable"]);
  assert.equal(JSON.stringify(serialized).includes("VELO_VAULT_KEY"), false);
});

test("Given start resume and cancel lifecycle operations, When the action handlers return progress, Then cursor and done remain stable", async () => {
  const gate = async () => undefined;
  const start = await proxyActionHandlers.startProxyValidationRun({ userId: "operator", gate, run: async () => ({ runId: "run", total: 10, completed: 8, failed: 0, nextCursor: 8, done: false }) });
  const resume = await proxyActionHandlers.resumeProxyValidationRun({ userId: "operator", gate, run: async () => ({ runId: "run", total: 10, completed: 10, failed: 0, nextCursor: 10, done: true }) });
  const cancel = await proxyActionHandlers.cancelProxyValidationRun({ userId: "operator", gate, run: async () => ({ ok: true as const }) });
  assert.deepEqual(start, { runId: "run", total: 10, completed: 8, failed: 0, nextCursor: 8, done: false });
  assert.deepEqual(resume, { runId: "run", total: 10, completed: 10, failed: 0, nextCursor: 10, done: true });
  assert.deepEqual(cancel, { ok: true });
});

test("Given delete test-one list status and clear failures, When their named handlers run, Then denial and stable errors are observable without TanStack internals", async () => {
  const allowed = async () => undefined;
  const forbidden = async () => { throw new ProxyActionError("forbidden", "Not allowed."); };
  const cases: ReadonlyArray<readonly [() => Promise<unknown>, string]> = [
    [() => proxyActionHandlers.removeUserProxy({ userId: "operator", gate: allowed, run: async () => { throw new ProxyActionError("not_found", "That proxy is gone."); } }), "not_found"],
    [() => proxyActionHandlers.testProxyValidation({ userId: "operator", gate: allowed, run: async () => { throw new ProxyActionError("not_found", "That proxy is gone."); } }), "not_found"],
    [() => proxyActionHandlers.listProxyOperations({ userId: "operator", gate: allowed, run: async () => { throw new ProxyActionError("unavailable", "Proxy storage is unavailable."); } }), "unavailable"],
    [() => proxyActionHandlers.getProxyValidationRun({ userId: "operator", gate: allowed, run: async () => { throw new ProxyActionError("not_found", "Run was not found."); } }), "not_found"],
    [() => proxyActionHandlers.clearProxyHistory({ userId: "nonoperator", gate: forbidden, run: async () => true }), "forbidden"],
  ];
  for (const [invoke, code] of cases) await assert.rejects(invoke, (error: unknown) => error instanceof ProxyActionError && error.toJSON().code === code);
});
