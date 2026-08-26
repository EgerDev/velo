import { createFileRoute } from "@tanstack/react-router";
import { dbSource, getSql } from "@/lib/db";

/**
 * Liveness/readiness probe for uptime monitors and the in-app status card.
 *
 * The audit's operational review flagged that the first signal of an outage —
 * a dead database, or the extraction ladder breaking — was a user complaint.
 * This gives a monitor (or the /status page) one cheap URL to watch.
 *
 * Deliberately leaks nothing: it reports WHICH datastore backs the app
 * (`neon` / `pglite`) and whether a trivial round-trip succeeded, never the
 * connection string, host, or any row data. `?deep=1` additionally confirms the
 * auth schema migrated (the `verification` table is present) so a half-applied
 * migration shows up as `degraded` rather than as green.
 */

const DB_PING_TIMEOUT_MS = 3_000;

/** Per-instance start time. On serverless each warm instance reports its own. */
const startedAt = Date.now();

type Check = { ok: boolean; detail?: string; latencyMs?: number };

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(deep: boolean): Promise<Check> {
  const started = Date.now();
  try {
    const sql = await withTimeout(getSql(), DB_PING_TIMEOUT_MS, "db connect");
    await withTimeout(sql`select 1 as ok`, DB_PING_TIMEOUT_MS, "db ping");
    if (deep) {
      // A half-applied migration leaves the app booting but broken; confirm the
      // auth schema is really there. to_regclass returns null for a missing rel
      // instead of throwing, so this stays a clean boolean.
      const rows = await withTimeout(
        sql<{ present: string | null }>`select to_regclass('verification')::text as present`,
        DB_PING_TIMEOUT_MS,
        "db schema",
      );
      if (!rows[0]?.present) {
        return { ok: false, detail: "verification table missing", latencyMs: Date.now() - started };
      }
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    // Message only — never the underlying connection string / stack.
    const detail = err instanceof Error ? err.message : "database unreachable";
    return { ok: false, detail, latencyMs: Date.now() - started };
  }
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const deep = new URL(request.url).searchParams.get("deep") === "1";
        const db = await checkDatabase(deep);
        const healthy = db.ok;
        const body = {
          status: healthy ? "ok" : "degraded",
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          time: new Date().toISOString(),
          checks: {
            database: { source: dbSource, ...db },
          },
        };
        return Response.json(body, {
          status: healthy ? 200 : 503,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
