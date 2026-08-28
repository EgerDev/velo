import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  EpochMillisecondsSchema,
  PrioritySchema,
  ProxyIdSchema,
  type ProxyId,
  type ProxyProtocol,
  type SafeProxyView,
} from "./proxy-operations.ts";
import type { ProxyDatabase, ProxyQueryExecutor } from "./user-proxy-repository-db.server.ts";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  ProxySecretDecryptError,
  ProxyVaultKeyError,
} from "./vault-crypto.ts";

const LOCK_ID = 8_613_024;
const StoredRowSchema = z.object({
  id: ProxyIdSchema,
  url_encrypted: z.string().min(1),
  protocol: z.enum(["http", "socks5"]),
  credential_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  priority: PrioritySchema,
  enabled: z.boolean(),
  eligible: z.boolean(),
  verdict: z.enum(["unknown", "checking", "healthy", "degraded", "blocked", "unreachable", "unsafe_tls", "misconfigured"]),
  last_checked_at: z.coerce.date().nullable(),
});
type StoredRow = z.infer<typeof StoredRowSchema>;

const ProxyInputSchema = z.string().url().transform((value, context) => {
  const url = new URL(value);
  if (!["http:", "https:", "socks5:"].includes(url.protocol)) {
    context.addIssue({ code: "custom", message: "Unsupported proxy protocol" });
    return z.NEVER;
  }
  return url.toString();
});

export type AddProxyResult =
  | { readonly kind: "added"; readonly id: ProxyId }
  | { readonly kind: "duplicate"; readonly id: ProxyId };
export type ProxyHistory = {
  readonly id: string;
  readonly proxyId: string | null;
  readonly routeRef: string;
  readonly maskedLabel: string;
  readonly eventType: "added" | "updated" | "enabled" | "disabled" | "reordered" | "validated" | "deleted";
  readonly verdict: string | null;
  readonly errorCode: string | null;
  readonly protocol: ProxyProtocol;
  readonly createdAt: number;
};
export type ProxyVerdictInput = { readonly ok: boolean; readonly exitIp: string | null };

export class ProxyReorderError extends Error {
  readonly code = "invalid_proxy_reorder";

  constructor(message: string) {
    super(message);
    this.name = "ProxyReorderError";
  }
}

export interface UserProxyRepository {
  add(normalizedUrl: string): Promise<AddProxyResult>;
  list(): Promise<readonly SafeProxyView[]>;
  withSecret<Result>(id: ProxyId, consume: (url: string) => Promise<Result>): Promise<Result | null>;
  delete(id: ProxyId): Promise<void>;
  reorder(ids: readonly ProxyId[]): Promise<void>;
  setEnabled(id: ProxyId, enabled: boolean): Promise<void>;
  rememberVerdict(id: ProxyId, verdict: ProxyVerdictInput): Promise<void>;
  backfillLegacyFingerprints(): Promise<void>;
  history(): Promise<readonly ProxyHistory[]>;
  clearHistory(): Promise<void>;
}

function protocolOf(url: string): ProxyProtocol {
  return new URL(url).protocol === "socks5:" ? "socks5" : "http";
}

function maskedLabel(protocol: ProxyProtocol, fingerprint: string, url: string): string {
  const port = new URL(url).port || (new URL(url).protocol === "https:" ? "443" : "80");
  return `${protocol.toUpperCase()} ${fingerprint.slice(0, 8)} ••••:${port}`;
}

function fallbackRef(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

async function lease(transaction: ProxyQueryExecutor): Promise<void> {
  await transaction.query("select pg_advisory_xact_lock($1)", [LOCK_ID]);
}

async function insertEvent(
  transaction: ProxyQueryExecutor,
  input: { readonly proxyId: ProxyId | null; readonly ref: string; readonly label: string; readonly type: ProxyHistory["eventType"]; readonly verdict?: string; readonly code?: string },
): Promise<void> {
  await transaction.query(
    "insert into velo_proxy_event (id,proxy_id,route_ref,masked_label,event_type,verdict,error_code) values ($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), input.proxyId, input.ref, input.label, input.type, input.verdict ?? null, input.code ?? null],
  );
}

function parseRows(rows: readonly unknown[]): readonly StoredRow[] {
  return z.array(StoredRowSchema).parse(rows);
}

function isProxyConfigurationError(error: unknown): boolean {
  return error instanceof ProxySecretDecryptError || error instanceof ProxyVaultKeyError;
}

export function createUserProxyRepository(database: ProxyDatabase): UserProxyRepository {
  const backfillLegacyFingerprints = async (): Promise<void> => {
    await database.transaction(async (transaction) => {
      await lease(transaction);
      const result = await transaction.query("select * from velo_proxy order by created_at,id");
      const legacy = parseRows(result.rows);
      const claimed = new Set<string>();
      const prepared: Array<{ readonly row: StoredRow; readonly plaintext: string; readonly fingerprint: string; readonly previous: boolean; readonly winner: boolean }> = [];
      for (const row of legacy) {
        try {
          const decrypted = decryptSecret(row.url_encrypted);
          const fingerprint = fingerprintSecret(decrypted.plaintext);
          const winner = !claimed.has(fingerprint);
          if (winner) claimed.add(fingerprint);
          prepared.push({ row, plaintext: decrypted.plaintext, fingerprint, previous: decrypted.key === "previous", winner });
        } catch (error) {
          if (!isProxyConfigurationError(error)) throw error;
          const code = error instanceof ProxyVaultKeyError ? "key_unstable" : "credential_undecryptable";
          await transaction.query("update velo_proxy set enabled=false,eligible=false,verdict='misconfigured',last_error_code=$1 where id=$2", [code, row.id]);
        }
      }
      const changes = prepared.some(({ row, fingerprint, previous, winner }) => previous || !winner || row.credential_fingerprint !== fingerprint);
      if (!changes) return;
      for (const item of prepared) await transaction.query("update velo_proxy set credential_fingerprint=null where id=$1", [item.row.id]);
      for (const item of prepared) {
        if (item.winner) {
          if (item.previous) await transaction.query("update velo_proxy set url_encrypted=$1,credential_fingerprint=$2 where id=$3", [encryptSecret(item.plaintext), item.fingerprint, item.row.id]);
          else await transaction.query("update velo_proxy set credential_fingerprint=$1 where id=$2", [item.fingerprint, item.row.id]);
        } else {
          await transaction.query("update velo_proxy set enabled=false,eligible=false,verdict='misconfigured',last_error_code='credential_missing' where id=$1", [item.row.id]);
          await insertEvent(transaction, { proxyId: item.row.id, ref: item.fingerprint, label: maskedLabel(item.row.protocol, item.fingerprint, item.plaintext), type: "disabled", verdict: "misconfigured", code: "credential_missing" });
        }
      }
    });
  };

  const list = async (): Promise<readonly SafeProxyView[]> => {
    await backfillLegacyFingerprints();
    const result = await database.query("select * from velo_proxy order by priority,id");
    return parseRows(result.rows).map((row) => {
      try {
        const decrypted = decryptSecret(row.url_encrypted);
        const ref = row.credential_fingerprint ?? fingerprintSecret(decrypted.plaintext);
        return {
          id: row.id, routeRef: ref, maskedLabel: maskedLabel(row.protocol, ref, decrypted.plaintext), protocol: row.protocol,
          priority: row.priority, enabled: row.enabled, eligible: row.eligible, verdict: row.verdict,
          stale: false, lastCheckedAt: row.last_checked_at === null ? null : EpochMillisecondsSchema.parse(row.last_checked_at.getTime()), evidence: [],
        } satisfies SafeProxyView;
      } catch (error) {
        if (!isProxyConfigurationError(error)) throw error;
        const ref = fallbackRef(row.id);
        return { id: row.id, routeRef: ref, maskedLabel: `${row.protocol.toUpperCase()} ${ref.slice(0, 8)} ••••:0`, protocol: row.protocol, priority: row.priority, enabled: false, eligible: false, verdict: "misconfigured", stale: false, lastCheckedAt: null, evidence: [] } satisfies SafeProxyView;
      }
    });
  };

  return {
    add: async (input) => {
      const normalized = ProxyInputSchema.parse(input);
      return database.transaction(async (transaction) => {
        await lease(transaction);
        const fingerprint = fingerprintSecret(normalized);
        const duplicate = await transaction.query<{ id: string }>("select id from velo_proxy where credential_fingerprint=$1", [fingerprint]);
        const duplicateId = duplicate.rows[0]?.id;
        if (duplicateId !== undefined) return { kind: "duplicate", id: ProxyIdSchema.parse(duplicateId) };
        const id = ProxyIdSchema.parse(randomUUID());
        const protocol = protocolOf(normalized);
        const priorityRows = await transaction.query<{ priority: number }>("select coalesce(max(priority),0)+1 as priority from velo_proxy");
        const priority = PrioritySchema.parse(priorityRows.rows[0]?.priority);
        await transaction.query("insert into velo_proxy (id,url_encrypted,protocol,credential_fingerprint,priority) values ($1,$2,$3,$4,$5)", [id, encryptSecret(normalized), protocol, fingerprint, priority]);
        await insertEvent(transaction, { proxyId: id, ref: fingerprint, label: maskedLabel(protocol, fingerprint, normalized), type: "added" });
        return { kind: "added", id };
      });
    },
    list,
    withSecret: async (id, consume) => {
      await backfillLegacyFingerprints();
      const result = await database.query<{ url_encrypted: string }>("select url_encrypted from velo_proxy where id=$1 and enabled and eligible", [id]);
      const stored = result.rows[0]?.url_encrypted;
      if (stored === undefined) return null;
      let plaintext: string;
      try { plaintext = decryptSecret(stored).plaintext; } catch (error) { if (isProxyConfigurationError(error)) return null; throw error; }
      return consume(plaintext);
    },
    delete: async (id) => database.transaction(async (transaction) => {
      await lease(transaction);
      const found = await transaction.query<{ credential_fingerprint: string | null; protocol: ProxyProtocol; url_encrypted: string }>("select credential_fingerprint,protocol,url_encrypted from velo_proxy where id=$1", [id]);
      const row = found.rows[0];
      if (row === undefined) return;
      let ref = row.credential_fingerprint ?? fallbackRef(id);
      let label = `${row.protocol.toUpperCase()} ${ref.slice(0, 8)} ••••:0`;
      try {
        const decrypted = decryptSecret(row.url_encrypted);
        ref = row.credential_fingerprint ?? fingerprintSecret(decrypted.plaintext);
        label = maskedLabel(row.protocol, ref, decrypted.plaintext);
      } catch (error) {
        if (!(error instanceof ProxySecretDecryptError)) throw error;
      }
      await insertEvent(transaction, { proxyId: id, ref, label, type: "deleted" });
      await transaction.query("delete from velo_proxy where id=$1", [id]);
    }),
    reorder: async (ids) => database.transaction(async (transaction) => {
      await lease(transaction);
      const count = await transaction.query<{ count: number }>("select count(*)::int as count from velo_proxy");
      if (count.rows[0]?.count !== ids.length || new Set(ids).size !== ids.length) throw new ProxyReorderError("Reorder must contain every proxy exactly once.");
      const matched = await transaction.query<{ count: number }>("select count(*)::int as count from velo_proxy where id=any($1::text[])", [ids]);
      if (matched.rows[0]?.count !== ids.length) throw new ProxyReorderError("Reorder contains an unknown proxy.");
      await transaction.query("update velo_proxy set priority=priority+$1", [ids.length + 1]);
      for (const [index, id] of ids.entries()) await transaction.query("update velo_proxy set priority=$1 where id=$2", [index + 1, id]);
    }),
    setEnabled: async (id, enabled) => database.transaction(async (transaction) => {
      await lease(transaction);
      const found = await transaction.query<{ credential_fingerprint: string; protocol: ProxyProtocol; url_encrypted: string }>("select credential_fingerprint,protocol,url_encrypted from velo_proxy where id=$1", [id]);
      const row = found.rows[0];
      if (row === undefined) return;
      const decrypted = decryptSecret(row.url_encrypted);
      await transaction.query("update velo_proxy set enabled=$1 where id=$2", [enabled, id]);
      await insertEvent(transaction, { proxyId: id, ref: row.credential_fingerprint, label: maskedLabel(row.protocol, row.credential_fingerprint, decrypted.plaintext), type: enabled ? "enabled" : "disabled" });
    }),
    rememberVerdict: async (id, verdict) => database.transaction(async (transaction) => {
      await lease(transaction);
      const next = verdict.ok ? "healthy" : "unreachable";
      await transaction.query("update velo_proxy set verdict=$1,last_checked_at=now(),hard_failures=case when $2 then 0 else hard_failures+1 end,full_passes=case when $2 then full_passes+1 else 0 end,eligible=case when $2 then eligible else hard_failures+1<2 end,last_error_code=case when $2 then null else 'connect_failed' end where id=$3", [next, verdict.ok, id]);
      const found = await transaction.query<{ credential_fingerprint: string; protocol: ProxyProtocol; url_encrypted: string }>("select credential_fingerprint,protocol,url_encrypted from velo_proxy where id=$1", [id]);
      const row = found.rows[0];
      if (row !== undefined) {
        const decrypted = decryptSecret(row.url_encrypted);
        if (verdict.ok) {
          await insertEvent(transaction, { proxyId: id, ref: row.credential_fingerprint, label: maskedLabel(row.protocol, row.credential_fingerprint, decrypted.plaintext), type: "validated", verdict: next });
        } else {
          await insertEvent(transaction, { proxyId: id, ref: row.credential_fingerprint, label: maskedLabel(row.protocol, row.credential_fingerprint, decrypted.plaintext), type: "validated", verdict: next, code: "connect_failed" });
        }
      }
    }),
    backfillLegacyFingerprints,
    history: async () => {
      const result = await database.query<{ id: string; proxy_id: string | null; route_ref: string; masked_label: string; event_type: ProxyHistory["eventType"]; verdict: string | null; error_code: string | null; created_at: Date }>("select id,proxy_id,route_ref,masked_label,event_type,verdict,error_code,created_at from velo_proxy_event order by created_at desc,id desc limit 200");
      return result.rows.map((row) => ({ id: row.id, proxyId: row.proxy_id, routeRef: row.route_ref, maskedLabel: row.masked_label, eventType: row.event_type, verdict: row.verdict, errorCode: row.error_code, protocol: row.masked_label.startsWith("SOCKS5 ") ? "socks5" : "http", createdAt: row.created_at.getTime() }));
    },
    clearHistory: async () => database.transaction(async (transaction) => {
      await lease(transaction);
      await transaction.query("delete from velo_proxy_validation_run");
      await transaction.query("delete from velo_proxy_event where event_type='validated'");
    }),
  };
}
