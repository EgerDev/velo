import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { ProxyActionError, parseProxyHistoryQuery, proxyActionHandlers } from "./proxy-action-contracts";
import {
  maskProxyDisplay,
  normalizeUserProxy,
  redactProxyUrl,
  PROXY_INPUT_MAX,
  type ProxyProbe,
  type UserProxyRow,
} from "./user-proxy-parse";

export { maskProxyDisplay, normalizeUserProxy, redactProxyUrl } from "./user-proxy-parse";
export type { ProxyProtocol, ProxyProbe, UserProxyRow } from "./user-proxy-parse";

export type UserProxyList = {
  rows: UserProxyRow[];
  canManage: boolean;
  reason: string | null;
};

export type ProxyOperationsView = {
  readonly routes: readonly import("./proxy-operations").SafeProxyView[];
  readonly history: readonly import("./user-proxy-repository.server").ProxyHistory[];
  readonly canManage: boolean;
  readonly reason: string | null;
};
export type ProxyHistoryPage = {
  readonly items: readonly import("./user-proxy-repository.server").ProxyHistory[];
  readonly nextCursor: { readonly createdAt: number; readonly id: string } | null;
};
export { ProxyActionError, parseProxyHistoryQuery } from "./proxy-action-contracts";

/**
 * Tools-tab server functions. Client/server split mirrors tool-updates.ts:
 * every node-side module is imported inside the handlers.
 */

const addSchema = z.object({
  proxy: z.string().min(1).max(PROXY_INPUT_MAX),
  protocol: z.enum(["http", "socks5"]),
});

/** Operator gate, shared with the tool-update actions. */
async function gateOrThrow(userId: string): Promise<void> {
  const { proxyManagementGate } = await import("@/lib/operator-gate.server");
  const gate = await proxyManagementGate(userId);
  if (!gate.allowed) throw new ProxyActionError("forbidden", gate.reason ?? "Not allowed.");
}

function maskRows(rows: Awaited<ReturnType<typeof loadProxyRows>>, canManage: boolean) {
  return rows.map((row) => ({
    ...row,
    display: canManage ? row.display : maskProxyDisplay(row.display),
  }));
}

async function loadProxyRows(): Promise<UserProxyRow[]> {
  const { getUserProxies } = await import("@/lib/user-proxy.server");
  const proxies = await getUserProxies();
  return proxies.map((row) => ({
    id: row.id,
    display: row.display,
    protocol: row.protocol,
    ok: row.ok,
    exitIp: row.exitIp,
    checkedAt: row.checkedAt ?? null,
  }));
}

export const listUserProxies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UserProxyList> => {
    return proxyActionHandlers.listUserProxies({ userId: context.userId, gate: async () => undefined, run: async () => {
      const { proxyManagementGate } = await import("@/lib/operator-gate.server");
      const gate = await proxyManagementGate(context.userId);
      // Non-operators get a masked display: for an unauthenticated proxy the
      // host:port is itself the credential.
      const rows = maskRows(await loadProxyRows(), gate.allowed);
      return { rows, canManage: gate.allowed, reason: gate.reason };
    } });
  });

export const addUserProxy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => addSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProxyProbe> => {
    return proxyActionHandlers.addUserProxy({ userId: context.userId, gate: gateOrThrow, run: async () => {
      const normalized = normalizeUserProxy(data.proxy, data.protocol);
      if (!normalized) throw new ProxyActionError("invalid_input", "Use IP:PORT or user:pass@IP:PORT.");
      const { saveUserProxy } = await import("@/lib/user-proxy.server");
      await saveUserProxy(normalized);
      const { probeProxy } = await import("@/lib/user-proxy.server");
      const probe = await probeProxy(normalized.url);
      await refreshRowStatus(normalized.url, probe);
      return redactProbe(probe);
    } });
  });

export const removeUserProxy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return proxyActionHandlers.removeUserProxy({ userId: context.userId, gate: gateOrThrow, run: async () => {
      const { deleteUserProxy } = await import("@/lib/user-proxy.server");
      await deleteUserProxy(data.id);
      return { ok: true };
    } });
  });

export const testUserProxy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().min(1).max(64).optional(),
        proxy: z.string().max(PROXY_INPUT_MAX).optional(),
        protocol: z.enum(["http", "socks5"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ProxyProbe> => {
    // Operator-gated: an unsaved-spec probe could otherwise be aimed at
    // internal addresses.
    return proxyActionHandlers.testUserProxy({ userId: context.userId, gate: gateOrThrow, run: async () => {
      let url: string | null = null;
    if (data.id) {
      const [{ ProxyIdSchema }, { userProxyById }] = await Promise.all([
        import("@/lib/proxy-operations"),
        import("@/lib/user-proxy.server"),
      ]);
      const lease = await userProxyById(ProxyIdSchema.parse(data.id));
      if (lease === null) throw new ProxyActionError("not_found", "That proxy is gone. Refresh and try again.");
      const savedProbe = await lease.run(async (savedUrl) => {
        const { probeProxy } = await import("@/lib/user-proxy.server");
        const probe = await probeProxy(savedUrl);
        await lease.mark({ ok: probe.ok, exitIp: probe.exitIp });
        return redactProbe(probe);
      });
      if (savedProbe === null) throw new ProxyActionError("unavailable", "That proxy is unavailable. Check its vault key.");
      return savedProbe;
    } else if (data.proxy && data.protocol) {
      const normalized = normalizeUserProxy(data.proxy, data.protocol);
      if (!normalized) throw new ProxyActionError("invalid_input", "Use IP:PORT or user:pass@IP:PORT.");
      url = normalized.url;
    }
    if (!url) throw new ProxyActionError("invalid_input", "Nothing to test.");
    const { probeProxy } = await import("@/lib/user-proxy.server");
    const probe = await probeProxy(url);
      return redactProbe(probe);
    } });
  });

function redactProbe(probe: ProxyProbe): ProxyProbe {
  return {
    ...probe,
    error: probe.error ? redactProxyUrl(probe.error).slice(0, 200) : null,
  };
}

async function refreshRowStatus(url: string, probe: ProxyProbe): Promise<void> {
  const { rememberProxyProbe } = await import("@/lib/user-proxy.server");
  await rememberProxyProbe(url, probe.ok, probe.exitIp);
}

export const listProxyOperations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ProxyOperationsView> => {
    return proxyActionHandlers.listProxyOperations({ userId: context.userId, gate: async () => undefined, run: async () => {
      const [{ proxyManagementGate }, { getProxyDatabase }, { createUserProxyRepository }, { toSafeProxyView }] = await Promise.all([
        import("@/lib/operator-gate.server"), import("@/lib/user-proxy-repository-db.server"),
        import("@/lib/user-proxy-repository.server"), import("@/lib/proxy-operations"),
      ]);
      const gate = await proxyManagementGate(context.userId);
      if (!gate.allowed) return { routes: [], history: [], canManage: false, reason: gate.reason };
      const repository = createUserProxyRepository(await getProxyDatabase());
      return { routes: (await repository.list()).map(toSafeProxyView), history: await repository.history(), canManage: true, reason: null };
    } });
  });

export const runAllProxyValidations = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional(), idempotencyKey: z.string().uuid().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    return proxyActionHandlers.runAllProxyValidations({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const [{ getProxyDatabase }, { createUserProxyRepository }, { createDatabaseRunStore, runAllProxyChecks }, { validateProxyRoute }] = await Promise.all([
      import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"),
      import("@/lib/proxy-run-service.server"), import("@/lib/proxy-validator.server"),
    ]);
    const database = await getProxyDatabase();
    if (data.idempotencyKey !== undefined) {
      const existing = await database.query<{ total_count: number; completed_count: number; failed_count: number; next_cursor: number }>("select total_count,completed_count,failed_count,next_cursor from velo_proxy_validation_run where id=$1", [data.idempotencyKey]);
      const row = existing.rows[0];
      if (row !== undefined) return { runId: data.idempotencyKey, total: row.total_count, completed: row.completed_count, failed: row.failed_count, nextCursor: row.next_cursor, done: row.next_cursor >= row.total_count };
    }
    const repository = createUserProxyRepository(database);
    const routes = await repository.list();
    if (data.idempotencyKey !== undefined) {
      await createDatabaseRunStore(database, repository).create(routes, data.idempotencyKey);
      const claimed = await database.query<{ id: string }>("update velo_proxy_validation_run set lease_token=$2,lease_expires_at=now()+interval '120 seconds' where id=$1 and lease_token is null returning id", [data.idempotencyKey, crypto.randomUUID()]);
      if (claimed.rows.length === 0) {
        const current = await database.query<{ total_count: number; completed_count: number; failed_count: number; next_cursor: number }>("select total_count,completed_count,failed_count,next_cursor from velo_proxy_validation_run where id=$1", [data.idempotencyKey]);
        const row = current.rows[0];
        if (row !== undefined) return { runId: data.idempotencyKey, total: row.total_count, completed: row.completed_count, failed: row.failed_count, nextCursor: row.next_cursor, done: row.next_cursor >= row.total_count };
      }
    }
      return runAllProxyChecks(routes, createDatabaseRunStore(database, repository), (url, signal) => validateProxyRoute(url, { videoId: data.videoId, signal }), 2, data.idempotencyKey);
    } });
  });

export const clearProxyHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ confirm: z.literal(true) }).parse(input))
  .handler(async ({ context }): Promise<{ readonly ok: true }> => {
    return proxyActionHandlers.clearProxyHistory({ userId: context.userId, gate: gateOrThrow, run: async () => {
      const [{ getProxyDatabase }, { createUserProxyRepository }] = await Promise.all([
        import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"),
      ]);
      await createUserProxyRepository(await getProxyDatabase()).clearHistory();
      return { ok: true };
    } });
  });

export const setProxyRouteEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }): Promise<{ readonly ok: true }> => {
    return proxyActionHandlers.setProxyRouteEnabled({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const [{ ProxyIdSchema }, { getProxyDatabase }, { createUserProxyRepository }] = await Promise.all([
      import("@/lib/proxy-operations"), import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"),
    ]);
    await createUserProxyRepository(await getProxyDatabase()).setEnabled(ProxyIdSchema.parse(data.id), data.enabled);
      return { ok: true };
    } });
  });

export const reorderProxyRoutes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ ids: z.array(z.string().min(1).max(64)).max(100) }).parse(input))
  .handler(async ({ data, context }): Promise<{ readonly ok: true }> => {
    return proxyActionHandlers.reorderProxyRoutes({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const [{ ProxyIdSchema }, { getProxyDatabase }, { createUserProxyRepository }] = await Promise.all([
      import("@/lib/proxy-operations"), import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"),
    ]);
    await createUserProxyRepository(await getProxyDatabase()).reorder(data.ids.map((id) => ProxyIdSchema.parse(id)));
      return { ok: true };
    } });
  });

export const testProxyValidation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(64), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    return proxyActionHandlers.testProxyValidation({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const [{ ProxyIdSchema }, { getProxyDatabase }, { createUserProxyRepository }, { createDatabaseRunStore, runAllProxyChecks }, { validateProxyRoute }] = await Promise.all([
      import("@/lib/proxy-operations"), import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"),
      import("@/lib/proxy-run-service.server"), import("@/lib/proxy-validator.server"),
    ]);
    const database = await getProxyDatabase();
    const repository = createUserProxyRepository(database);
    const id = ProxyIdSchema.parse(data.id);
    const route = (await repository.list()).find((item) => item.id === id);
      return runAllProxyChecks(route === undefined ? [] : [route], createDatabaseRunStore(database, repository), (url, signal) => validateProxyRoute(url, { videoId: data.videoId, signal }), 1);
    } });
  });

const runIdSchema = z.string().uuid();

export const cancelProxyValidationRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ runId: runIdSchema }).parse(input))
  .handler(async ({ data, context }): Promise<{ readonly ok: true }> => {
    return proxyActionHandlers.cancelProxyValidationRun({ userId: context.userId, gate: gateOrThrow, run: async () => {
      const [{ getProxyDatabase }, { abortProxyValidationRun }] = await Promise.all([import("@/lib/user-proxy-repository-db.server"), import("@/lib/proxy-run-service.server")]);
      await (await getProxyDatabase()).query("update velo_proxy_validation_run set cancel_requested=true,status=case when status in ('pending','running') then 'cancelled' else status end,completed_at=case when status in ('pending','running') then now() else completed_at end where id=$1", [data.runId]);
      abortProxyValidationRun(data.runId);
      return { ok: true };
    } });
  });

export const resumeProxyValidationRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ runId: runIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    return proxyActionHandlers.resumeProxyValidationRun({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const [{ getProxyDatabase }, { createUserProxyRepository }, { createDatabaseRunStore, remainingResumeRoutes, runAllProxyChecks }, { validateProxyRoute }, { ProxyIdSchema }] = await Promise.all([
      import("@/lib/user-proxy-repository-db.server"), import("@/lib/user-proxy-repository.server"), import("@/lib/proxy-run-service.server"), import("@/lib/proxy-validator.server"),
      import("@/lib/proxy-operations"),
    ]);
    const database = await getProxyDatabase();
    const result = await database.query<{ route_ids: string[]; next_cursor: number; total_count: number; completed_count: number; failed_count: number }>("update velo_proxy_validation_run set status='running',lease_token=$2,lease_expires_at=now()+interval '120 seconds' where id=$1 and not cancel_requested and status in ('pending','partial','failed') and (lease_expires_at is null or lease_expires_at<now()) returning route_ids,next_cursor,total_count,completed_count,failed_count", [data.runId, crypto.randomUUID()]);
    const row = result.rows[0];
    if (row === undefined) throw new ProxyActionError("not_resumable", "Run is not resumable.");
    const repository = createUserProxyRepository(database);
    const snapshot = { runId: data.runId, routeIds: row.route_ids.map((id) => ProxyIdSchema.parse(id)), nextCursor: row.next_cursor };
    const routes = remainingResumeRoutes(snapshot, await repository.list());
    await runAllProxyChecks(routes, createDatabaseRunStore(database, repository), (url, signal) => validateProxyRoute(url, { signal }), 2, data.runId);
    const fresh = await database.query<{ total_count: number; completed_count: number; failed_count: number; next_cursor: number }>("select total_count,completed_count,failed_count,next_cursor from velo_proxy_validation_run where id=$1", [data.runId]);
    const progress = fresh.rows[0];
    if (progress === undefined) throw new ProxyActionError("not_found", "Run was not found.");
      return { runId: data.runId, total: progress.total_count, completed: progress.completed_count, failed: progress.failed_count, nextCursor: progress.next_cursor, done: progress.next_cursor >= progress.total_count };
    } });
  });

export const startProxyValidationRun = runAllProxyValidations;

export const getProxyValidationRun = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ runId: runIdSchema }).parse(input))
  .handler(async ({ data, context }) => {
    return proxyActionHandlers.getProxyValidationRun({ userId: context.userId, gate: gateOrThrow, run: async () => {
      const { getProxyDatabase } = await import("@/lib/user-proxy-repository-db.server");
      const result = await (await getProxyDatabase()).query<{ id: string; status: string; total_count: number; completed_count: number; failed_count: number; next_cursor: number; cancel_requested: boolean }>("select id,status,total_count,completed_count,failed_count,next_cursor,cancel_requested from velo_proxy_validation_run where id=$1", [data.runId]);
      const row = result.rows[0];
      if (row === undefined) throw new ProxyActionError("not_found", "Run was not found.");
      return { runId: row.id, status: row.status, total: row.total_count, completed: row.completed_count, failed: row.failed_count, nextCursor: row.next_cursor, done: row.next_cursor >= row.total_count, cancelRequested: row.cancel_requested };
    } });
  });

export const listProxyHistoryPage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(parseProxyHistoryQuery)
  .handler(async ({ data, context }): Promise<ProxyHistoryPage> => {
    return proxyActionHandlers.listProxyHistoryPage({ userId: context.userId, gate: gateOrThrow, run: async () => {
    const { getProxyDatabase } = await import("@/lib/user-proxy-repository-db.server");
    const database = await getProxyDatabase();
    if (data.cursor !== undefined) {
      const anchor = await database.query<{ id: string }>("select id from velo_proxy_event where id=$1 and created_at=to_timestamp($2::double precision/1000)", [data.cursor.id, data.cursor.createdAt]);
      if (anchor.rows.length === 0) throw new ProxyActionError("invalid_cursor", "History cursor is stale.");
    }
    const params: readonly unknown[] = [data.status ?? null, data.protocol === undefined ? null : `${data.protocol === "socks5" ? "SOCKS5" : "HTTP"} %`, data.from ?? null, data.to ?? null, data.cursor?.createdAt ?? null, data.cursor?.id ?? null, data.limit + 1];
    const sql = "select id,proxy_id,route_ref,masked_label,event_type,verdict,error_code,created_at from velo_proxy_event where ($1::text is null or verdict=$1) and ($2::text is null or masked_label like $2) and ($3::double precision is null or created_at>=to_timestamp($3/1000)) and ($4::double precision is null or created_at<=to_timestamp($4/1000)) and ($5::double precision is null or (created_at,id)<(to_timestamp($5/1000),$6)) order by created_at desc,id desc limit $7";
    const result = await database.query<{ id: string; proxy_id: string | null; route_ref: string; masked_label: string; event_type: import("./user-proxy-repository.server").ProxyHistory["eventType"]; verdict: string | null; error_code: string | null; created_at: Date }>(sql, params);
    const visible = result.rows.slice(0, data.limit);
    const items = visible.map((row) => ({ id: row.id, proxyId: row.proxy_id, routeRef: row.route_ref, maskedLabel: row.masked_label, eventType: row.event_type, verdict: row.verdict, errorCode: row.error_code, protocol: row.masked_label.startsWith("SOCKS5 ") ? "socks5" as const : "http" as const, createdAt: row.created_at.getTime() }));
    const last = visible.at(-1);
      return { items, nextCursor: result.rows.length > data.limit && last !== undefined ? { createdAt: last.created_at.getTime(), id: last.id } : null };
    } });
  });
