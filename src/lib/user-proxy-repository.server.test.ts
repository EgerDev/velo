import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import type { ProxyDatabase } from "./user-proxy-repository-db.server.ts";
import { createUserProxyCompatibilityFacade } from "./user-proxy-compatibility.server.ts";
import { createUserProxyRepository } from "./user-proxy-repository.server.ts";
import { encryptSecret, fingerprintSecret } from "./vault-crypto.ts";

const ORIGINAL_KEY = process.env.VELO_VAULT_KEY;
const ORIGINAL_PREVIOUS_KEY = process.env.VELO_VAULT_KEY_PREVIOUS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const databases: PGlite[] = [];

after(async () => {
  if (ORIGINAL_KEY === undefined) delete process.env.VELO_VAULT_KEY;
  else process.env.VELO_VAULT_KEY = ORIGINAL_KEY;
  if (ORIGINAL_PREVIOUS_KEY === undefined) delete process.env.VELO_VAULT_KEY_PREVIOUS;
  else process.env.VELO_VAULT_KEY_PREVIOUS = ORIGINAL_PREVIOUS_KEY;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await Promise.all(databases.map((database) => database.close()));
});

beforeEach(() => {
  process.env.VELO_VAULT_KEY = "repository-test-key";
  delete process.env.VELO_VAULT_KEY_PREVIOUS;
  process.env.NODE_ENV = "test";
});

async function fixture() {
  const database = new PGlite();
  databases.push(database);
  await database.waitReady;
  const base = await readFile(new URL("../../migrations/0004_user_proxies.sql", import.meta.url), "utf8");
  const operations = await readFile(new URL("../../migrations/0005_proxy_operations.sql", import.meta.url), "utf8");
  await database.exec(base);
  await database.exec(operations);
  return { database, repository: createUserProxyRepository(database) };
}

class InjectedTransactionError extends Error {
  constructor() {
    super("Injected transaction interruption");
    this.name = "InjectedTransactionError";
  }
}

function failAfterMatchingQuery(
  database: ProxyDatabase,
  pattern: RegExp,
  occurrence: number,
): ProxyDatabase {
  return {
    query: (text, params) => database.query(text, params),
    transaction: (run) =>
      database.transaction(async (transaction) => {
        let matches = 0;
        return run({
          query: async <Row extends QueryResultRow = QueryResultRow>(
            text: string,
            params: readonly unknown[] = [],
          ) => {
            const result = await transaction.query<Row>(text, params);
            if (pattern.test(text)) matches += 1;
            if (matches === occurrence) throw new InjectedTransactionError();
            return result;
          },
        });
      }),
  };
}

const FIRST = "http://alpha:sentinel-one@127.0.0.1:8080";
const SECOND = "socks5://beta:sentinel-two@127.0.0.2:1080";

test("Given a cold repository, When it lists persisted routes, Then health and order survive", async () => {
  const { database, repository } = await fixture();
  const added = await repository.add(FIRST);
  assert.equal(added.kind, "added");
  if (added.kind !== "added") return;
  await repository.rememberVerdict(added.id, { ok: false, exitIp: null });
  const cold = createUserProxyRepository(database);
  assert.deepEqual((await cold.list()).map(({ verdict, priority }) => ({ verdict, priority })), [
    { verdict: "unreachable", priority: 1 },
  ]);
});

test("Given two routes, When reordered, Then the swap is atomic", async () => {
  const { repository } = await fixture();
  const first = await repository.add(FIRST);
  const second = await repository.add(SECOND);
  assert.equal(first.kind, "added");
  assert.equal(second.kind, "added");
  if (first.kind !== "added" || second.kind !== "added") return;
  await repository.reorder([second.id, first.id]);
  assert.deepEqual((await repository.list()).map(({ id }) => id), [second.id, first.id]);
});

test("Given concurrent identical inserts, When committed, Then exactly one wins", async () => {
  const { database } = await fixture();
  const left = createUserProxyRepository(database);
  const right = createUserProxyRepository(database);
  const results = await Promise.all([left.add(FIRST), right.add(FIRST)]);
  assert.deepEqual(results.map(({ kind }) => kind).sort(), ["added", "duplicate"]);
  assert.equal((await left.list()).length, 1);
});

test("Given legacy rows without fingerprints, When backfilled, Then later duplicates are disabled and retained", async () => {
  const { database, repository } = await fixture();
  const encrypted = encryptSecret(FIRST);
  await database.query(
    "insert into velo_proxy (id,url_encrypted,protocol,priority,created_at) values ($1,$2,'http',1,'2025-01-01'),($3,$4,'http',2,'2025-01-02')",
    ["legacy-first", encrypted, "legacy-later", encrypted],
  );
  await repository.backfillLegacyFingerprints();
  const rows = await database.query<{ id: string; enabled: boolean; credential_fingerprint: string | null }>(
    "select id,enabled,credential_fingerprint from velo_proxy order by priority",
  );
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0]?.enabled, true);
  assert.equal(rows.rows[1]?.enabled, false);
  assert.notEqual(rows.rows[0]?.credential_fingerprint, null);
  assert.equal(rows.rows[1]?.credential_fingerprint, null);
  const events = await repository.history();
  assert.equal(events.some(({ eventType, proxyId }) => eventType === "disabled" && proxyId === "legacy-later"), true);
});

test("Given a saved route with history, When deleted, Then ciphertext is removed and tombstone remains", async () => {
  const { database, repository } = await fixture();
  const added = await repository.add(FIRST);
  assert.equal(added.kind, "added");
  if (added.kind !== "added") return;
  await repository.delete(added.id);
  const credentials = await database.query("select url_encrypted from velo_proxy where id=$1", [added.id]);
  assert.equal(credentials.rows.length, 0);
  assert.equal((await repository.history()).some(({ eventType }) => eventType === "deleted"), true);
});

test("Given a previous-key row, When listed, Then it rotates transactionally to the current key", async () => {
  const { database, repository } = await fixture();
  process.env.VELO_VAULT_KEY = "old-repository-key";
  const encrypted = encryptSecret(FIRST);
  await database.query(
    "insert into velo_proxy (id,url_encrypted,protocol,priority) values ('rotating',$1,'http',1)",
    [encrypted],
  );
  process.env.VELO_VAULT_KEY = "new-repository-key";
  process.env.VELO_VAULT_KEY_PREVIOUS = "old-repository-key";
  assert.equal((await repository.list())[0]?.verdict, "unknown");
  delete process.env.VELO_VAULT_KEY_PREVIOUS;
  assert.equal((await createUserProxyRepository(database).list())[0]?.verdict, "unknown");
});

test("Given an undecryptable row, When listed, Then it is masked and marked misconfigured", async () => {
  const { database, repository } = await fixture();
  process.env.VELO_VAULT_KEY = "wrong-key";
  const badEnvelope = encryptSecret(FIRST);
  process.env.VELO_VAULT_KEY = "repository-test-key";
  await database.query(
    "insert into velo_proxy (id,url_encrypted,protocol,priority) values ('broken',$1,'http',1)",
    [badEnvelope],
  );
  const serialized = JSON.stringify(await repository.list());
  assert.equal(serialized.includes("sentinel-one"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);
  assert.match(serialized, /misconfigured/);
});

test("Given credential sentinels nested in an error, When redacted, Then no response or event leaks them", async () => {
  const { repository } = await fixture();
  const added = await repository.add(FIRST);
  assert.equal(added.kind, "added");
  const serialized = JSON.stringify({ list: await repository.list(), history: await repository.history() });
  assert.equal(serialized.includes("sentinel-one"), false);
  assert.equal(serialized.includes("alpha"), false);
  assert.equal(serialized.includes(FIRST), false);
});

test("Given production without a stable key, When a route is added, Then storage refuses", async () => {
  const { repository } = await fixture();
  delete process.env.VELO_VAULT_KEY;
  delete process.env.BETTER_AUTH_SECRET;
  process.env.NODE_ENV = "production";
  await assert.rejects(repository.add(FIRST), /stable proxy vault key/i);
  assert.equal((await repository.history()).length, 0);
});

test("Given an encrypted production row without a stable key, When listed, Then a masked misconfigured row is returned", async () => {
  const { database, repository } = await fixture();
  const added = await repository.add(FIRST);
  assert.equal(added.kind, "added");
  delete process.env.VELO_VAULT_KEY;
  delete process.env.BETTER_AUTH_SECRET;
  process.env.NODE_ENV = "production";
  const serialized = JSON.stringify(await createUserProxyRepository(database).list());
  assert.match(serialized, /misconfigured/);
  assert.equal(serialized.includes("sentinel-one"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);
  const state = await database.query<{ last_error_code: string | null }>(
    "select last_error_code from velo_proxy where id=$1",
    [added.id],
  );
  assert.deepEqual(state.rows, [{ last_error_code: "key_unstable" }]);
});

test("Given compatibility rows seeded with credentials, When recursively serialized, Then no URL or credentials escape", async () => {
  const { repository } = await fixture();
  await repository.add(FIRST);
  const facade = createUserProxyCompatibilityFacade(repository);
  const output = JSON.stringify({ rows: await facade.list(), nested: { active: await facade.active() } });
  assert.equal(output.includes("url"), false);
  assert.equal(output.includes("sentinel-one"), false);
  assert.equal(output.includes("alpha"), false);
  assert.equal(output.includes("127.0.0.1"), false);
});

test("Given a mixed preclaimed and null legacy duplicate, When backfilled, Then the earliest row wins without deletion", async () => {
  const { database, repository } = await fixture();
  const encrypted = encryptSecret(FIRST);
  const fingerprint = fingerprintSecret(FIRST);
  await database.query(
    "insert into velo_proxy (id,url_encrypted,protocol,credential_fingerprint,priority,created_at) values ('null-earliest',$1,'http',null,1,'2025-01-01'),('preclaimed-later',$1,'http',$2,2,'2025-01-02')",
    [encrypted, fingerprint],
  );
  await repository.backfillLegacyFingerprints();
  const rows = await database.query<{ id: string; enabled: boolean; credential_fingerprint: string | null }>(
    "select id,enabled,credential_fingerprint from velo_proxy order by priority",
  );
  assert.deepEqual(rows.rows, [
    { id: "null-earliest", enabled: true, credential_fingerprint: fingerprint },
    { id: "preclaimed-later", enabled: false, credential_fingerprint: null },
  ]);
});

test("Given an interrupted reorder, When one priority update has executed, Then every row rolls back", async () => {
  const { database, repository } = await fixture();
  const first = await repository.add(FIRST);
  const second = await repository.add(SECOND);
  assert.equal(first.kind, "added");
  assert.equal(second.kind, "added");
  if (first.kind !== "added" || second.kind !== "added") return;
  const before = await database.query("select id,priority,url_encrypted,credential_fingerprint from velo_proxy order by priority");
  const interrupted = createUserProxyRepository(
    failAfterMatchingQuery(database, /update velo_proxy set priority=\$1 where id=\$2/, 1),
  );
  await assert.rejects(interrupted.reorder([second.id, first.id]), InjectedTransactionError);
  const after = await database.query("select id,priority,url_encrypted,credential_fingerprint from velo_proxy order by priority");
  assert.deepEqual(after.rows, before.rows);
});

test("Given interrupted previous-key rotation, When ciphertext was updated, Then ciphertext and fingerprint roll back together", async () => {
  const { database } = await fixture();
  process.env.VELO_VAULT_KEY = "old-interrupted-key";
  const encrypted = encryptSecret(FIRST);
  await database.query("insert into velo_proxy (id,url_encrypted,protocol,priority) values ('interrupted',$1,'http',1)", [encrypted]);
  process.env.VELO_VAULT_KEY = "new-interrupted-key";
  process.env.VELO_VAULT_KEY_PREVIOUS = "old-interrupted-key";
  const interrupted = createUserProxyRepository(
    failAfterMatchingQuery(database, /update velo_proxy set url_encrypted=\$1,credential_fingerprint=\$2/, 1),
  );
  await assert.rejects(interrupted.list(), InjectedTransactionError);
  const row = await database.query<{ url_encrypted: string; credential_fingerprint: string | null }>(
    "select url_encrypted,credential_fingerprint from velo_proxy where id='interrupted'",
  );
  assert.deepEqual(row.rows, [{ url_encrypted: encrypted, credential_fingerprint: null }]);
});

test("Given validation and deletion race under the lease, When both commit, Then credentials vanish and sanitized history survives", async () => {
  const { database, repository } = await fixture();
  const added = await repository.add(FIRST);
  assert.equal(added.kind, "added");
  if (added.kind !== "added") return;
  await Promise.all([
    repository.rememberVerdict(added.id, { ok: true, exitIp: "192.0.2.44" }),
    createUserProxyRepository(database).delete(added.id),
  ]);
  const row = await database.query("select url_encrypted,credential_fingerprint from velo_proxy where id=$1", [added.id]);
  const history = JSON.stringify(await repository.history());
  assert.equal(row.rows.length, 0);
  assert.match(history, /validated/);
  assert.match(history, /deleted/);
  assert.equal(history.includes("192.0.2.44"), false);
  assert.equal(history.includes("sentinel-one"), false);
});

test("Given the repository surface, When the operator lifecycle runs, Then only masked durable state escapes", async () => {
  const { database, repository } = await fixture();
  const first = await repository.add(FIRST);
  const second = await repository.add(SECOND);
  assert.equal(first.kind, "added");
  assert.equal(second.kind, "added");
  if (first.kind !== "added" || second.kind !== "added") return;
  const duplicate = await Promise.all([
    repository.add("http://gamma:sentinel-three@127.0.0.3:9090"),
    createUserProxyRepository(database).add("http://gamma:sentinel-three@127.0.0.3:9090"),
  ]);
  assert.deepEqual(duplicate.map(({ kind }) => kind).sort(), ["added", "duplicate"]);
  const third = duplicate.find((result) => result.kind === "added");
  assert.notEqual(third, undefined);
  if (third === undefined) return;
  await repository.reorder([second.id, first.id, third.id]);
  await repository.setEnabled(second.id, false);
  await repository.rememberVerdict(first.id, { ok: true, exitIp: "192.0.2.1" });
  const cold = createUserProxyRepository(database);
  process.env.VELO_VAULT_KEY_PREVIOUS = "repository-test-key";
  process.env.VELO_VAULT_KEY = "repository-rotated-key";
  await cold.list();
  delete process.env.VELO_VAULT_KEY_PREVIOUS;
  await cold.delete(second.id);
  const output = JSON.stringify({ list: await createUserProxyRepository(database).list(), history: await cold.history() });
  assert.equal(output.includes("sentinel-"), false);
  assert.equal(output.includes("127.0.0."), false);
  assert.equal((await cold.history()).some(({ eventType }) => eventType === "deleted"), true);
});
