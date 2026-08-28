import type { Pool, PoolClient, QueryResultRow } from "pg";

export type ProxyQueryResult<Row> = { readonly rows: readonly Row[] };

export interface ProxyQueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, params?: readonly unknown[]): Promise<ProxyQueryResult<Row>>;
}

export interface ProxyDatabase extends ProxyQueryExecutor {
  transaction<Result>(run: (transaction: ProxyQueryExecutor) => Promise<Result>): Promise<Result>;
}

type PgliteDatabase = Awaited<ReturnType<typeof import("@/lib/db")["getPglite"]>>;

function pgliteAdapter(database: PgliteDatabase): ProxyDatabase {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []) => {
      const result = await database.query<Row>(text, [...params]);
      return { rows: result.rows };
    },
    transaction: (run) =>
      database.transaction(async (transaction) =>
        run({
          query: async <Row extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []) => {
            const result = await transaction.query<Row>(text, [...params]);
            return { rows: result.rows };
          },
        }),
      ),
  };
}

const poolGlobal = globalThis as typeof globalThis & { __veloProxyPool__?: Pool };

function poolExecutor(client: PoolClient): ProxyQueryExecutor {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []) => {
      const result = await client.query<Row>(text, [...params]);
      return { rows: result.rows };
    },
  };
}

async function neonDatabase(databaseUrl: string): Promise<ProxyDatabase> {
  if (poolGlobal.__veloProxyPool__ === undefined) {
    const { Pool } = await import("pg");
    poolGlobal.__veloProxyPool__ = new Pool({ connectionString: databaseUrl });
  }
  const pool = poolGlobal.__veloProxyPool__;
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []) => {
      const result = await pool.query<Row>(text, [...params]);
      return { rows: result.rows };
    },
    transaction: async (run) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await run(poolExecutor(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function getProxyDatabase(): Promise<ProxyDatabase> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return neonDatabase(databaseUrl);
  const { getPglite } = await import("@/lib/db");
  return pgliteAdapter(await getPglite());
}
