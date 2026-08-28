import { randomUUID } from "node:crypto";
import type { Classification, ProxyId, SafeErrorCode, SafeProxyView, StageEvidence } from "./proxy-operations.ts";
import type { ProxyValidation } from "./proxy-validator.server.ts";

export type RunRecord = { readonly proxyId: ProxyId; readonly routeRef: string; readonly maskedLabel: string; readonly classification: Classification; readonly errorCode: SafeErrorCode | null; readonly evidence: readonly StageEvidence[] };
export interface ProxyRunStore {
  create(routes: readonly SafeProxyView[], requestedId?: string): Promise<string>;
  secret<Result>(id: ProxyId, use: (url: string) => Promise<Result>): Promise<Result | null>;
  commit(record: RunRecord, runId: string): Promise<void>;
  finish(runId: string, status: "completed" | "partial" | "failed"): Promise<void>;
  cancelled?(runId: string): Promise<boolean>;
}
export type RunProgress = { readonly runId: string; readonly total: number; readonly completed: number; readonly failed: number; readonly nextCursor: number; readonly done: boolean };
export type ResumeSnapshot = { readonly runId: string; readonly routeIds: readonly ProxyId[]; readonly nextCursor: number };
const activeRunControllers = new Map<string, Set<AbortController>>();

export function abortProxyValidationRun(runId: string): void {
  for (const controller of activeRunControllers.get(runId) ?? []) controller.abort();
}

export function remainingResumeRoutes(snapshot: ResumeSnapshot, routes: readonly SafeProxyView[]): readonly SafeProxyView[] {
  const remaining = new Set(snapshot.routeIds.slice(snapshot.nextCursor, snapshot.nextCursor + 8));
  return routes.filter((route) => remaining.has(route.id)).sort((left, right) => snapshot.routeIds.indexOf(left.id) - snapshot.routeIds.indexOf(right.id));
}

export async function runAllProxyChecks(
  routes: readonly SafeProxyView[], store: ProxyRunStore,
  validate: (url: string, signal?: AbortSignal) => Promise<ProxyValidation>, concurrency = 3, existingRunId?: string,
): Promise<RunProgress> {
  const cap = Math.max(1, Math.min(2, Math.floor(concurrency)));
  const ordered = [...routes].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const runId = existingRunId === undefined ? await store.create(ordered) : existingRunId;
  const records: RunRecord[] = [];
  let wasCancelled = false;
  try {
    if (await store.cancelled?.(runId)) wasCancelled = true;
    const batch = wasCancelled ? [] : ordered.slice(0, 8);
    for (let start = 0; start < batch.length; start += cap) {
      if (start > 0 && await store.cancelled?.(runId)) {
        wasCancelled = true;
        break;
      }
      const controller = new AbortController(); let polling = false;
      controller.signal.addEventListener("abort", () => { wasCancelled = true; }, { once: true });
      const activeControllers = activeRunControllers.get(runId) ?? new Set<AbortController>();
      activeControllers.add(controller); activeRunControllers.set(runId, activeControllers);
      const cancellationPoll = store.cancelled === undefined ? undefined : setInterval(() => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void store.cancelled?.(runId).then((cancelled) => {
          if (cancelled) { wasCancelled = true; controller.abort(); }
        }).finally(() => { polling = false; });
      }, 250);
      let completed: RunRecord[];
      try {
        completed = await Promise.all(batch.slice(start, start + cap).map(async (route): Promise<RunRecord> => {
          const validation = await store.secret(route.id, (url) => validate(url, controller.signal));
          const safe = validation ?? { classification: { attribution: "configuration", verdict: "misconfigured" } as const, errorCode: "credential_undecryptable" as const, evidence: [] };
          return { proxyId: route.id, routeRef: route.routeRef, maskedLabel: route.maskedLabel, ...safe };
        }));
      } finally {
        if (cancellationPoll !== undefined) clearInterval(cancellationPoll);
        activeControllers.delete(controller);
        if (activeControllers.size === 0) activeRunControllers.delete(runId);
      }
      if (wasCancelled) break;
      for (const record of completed) { await store.commit(record, runId); records.push(record); }
    }
    const failed = records.filter((record) => record?.classification.verdict !== "healthy").length;
    if (!wasCancelled) await store.finish(runId, failed > 0 ? "partial" : "completed");
    return { runId, total: ordered.length, completed: records.length, failed, nextCursor: records.length, done: records.length >= ordered.length };
  } catch (error: unknown) {
    await store.finish(runId, "failed");
    throw error;
  }
}

export function createDatabaseRunStore(database: import("./user-proxy-repository-db.server.ts").ProxyDatabase, repository: import("./user-proxy-repository.server.ts").UserProxyRepository): ProxyRunStore {
  return {
    create: async (routes, requestedId) => { const id = requestedId ?? randomUUID(); await database.transaction(async (transaction) => { await transaction.query("delete from velo_proxy_validation_run where completed_at<now()-interval '30 days'"); await transaction.query("delete from velo_proxy_event where created_at<now()-interval '180 days'"); await transaction.query("insert into velo_proxy_validation_run (id,status,route_ids,total_count) values ($1,'running',$2,$3) on conflict (id) do nothing", [id, routes.map((route) => route.id), routes.length]); }); return id; },
    secret: (id, use) => repository.withSecret(id, use),
    commit: async (record, runId) => database.transaction(async (transaction) => {
      const id = randomUUID(); const verdict = record.classification.verdict ?? "unknown";
      await transaction.query("insert into velo_proxy_validation_result (id,run_id,proxy_id,route_ref,masked_label,verdict,error_code,completed_at) values ($1,$2,$3,$4,$5,$6,$7,now())", [id, runId, record.proxyId, record.routeRef, record.maskedLabel, verdict, record.errorCode]);
      for (const item of record.evidence) await transaction.query("insert into velo_proxy_validation_evidence (id,result_id,stage,outcome,code,http_status,duration_ms,bytes_read) values ($1,$2,$3,$4,$5,$6,$7,$8)", [randomUUID(), id, item.stage, item.outcome, item.code, item.httpStatus, item.durationMs, item.bytesRead]);
      await transaction.query("update velo_proxy set verdict=$1,last_checked_at=now(),last_evidence_at=now(),last_error_code=$2,hard_failures=case when $1 in ('blocked','unreachable','unsafe_tls') then hard_failures+1 when $1 in ('healthy','degraded') then 0 else hard_failures end,full_passes=case when $1='healthy' then full_passes+1 else 0 end,eligible=case when $1 in ('blocked','unreachable','unsafe_tls') then hard_failures+1<2 when $1='healthy' and full_passes+1>=2 then true else eligible end where id=$3", [verdict, record.errorCode, record.proxyId]);
      await transaction.query("update velo_proxy_validation_run set completed_count=completed_count+1,next_cursor=next_cursor+1,failed_count=failed_count+$1,lease_expires_at=case when lease_token is null then null else now()+interval '120 seconds' end where id=$2", [verdict === "healthy" ? 0 : 1, runId]);
    }),
    finish: async (runId, status) => { await database.query("update velo_proxy_validation_run set status=case when next_cursor<total_count and $1='completed' then 'partial' else $1 end,completed_at=case when next_cursor>=total_count then now() else null end,lease_token=null,lease_expires_at=null where id=$2", [status, runId]); },
    cancelled: async (runId) => {
      const result = await database.query<{ cancel_requested: boolean }>("select cancel_requested from velo_proxy_validation_run where id=$1", [runId]);
      return result.rows[0]?.cancel_requested ?? true;
    },
  };
}
