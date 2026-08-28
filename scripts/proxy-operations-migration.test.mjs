import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationNames = ["0002_youtube_vault.sql", "0003_verification_value_idx.sql", "0004_user_proxies.sql", "0005_proxy_operations.sql"];
const ROUTE_REF = "a".repeat(64);
const MASKED_LABEL = "HTTP aaaaaaaa ••••:443";

async function migrationSql(name) {
  return readFile(join(projectRoot, "migrations", name), "utf8");
}

async function openDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  return database;
}

async function migrate(database, names = migrationNames) {
  const applied = await database.query("select name from _migrations order by name");
  const plan = pendingMigrations(names, applied.rows.map((row) => row.name));
  for (const entry of plan) {
    await database.transaction(async (transaction) => {
      await transaction.exec(await migrationSql(entry.name));
      await transaction.query("insert into _migrations (name) values ($1)", [entry.name]);
    });
  }
  return plan.map((entry) => entry.name);
}

async function expectRejected(action, pattern) {
  await assert.rejects(action, pattern);
}

test("Given a clean database, when the migration loader runs, then proxy operations tables are created", async () => {
  // Given
  const database = await openDatabase();
  try {
    // When
    const applied = await migrate(database);

    // Then
    assert.deepEqual(applied, migrationNames);
    const tables = await database.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'velo_proxy%' order by table_name",
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["velo_proxy", "velo_proxy_event", "velo_proxy_validation_evidence", "velo_proxy_validation_result", "velo_proxy_validation_run"],
    );
  } finally {
    await database.close();
  }
});

test("Given an existing 0004 database, when 0005 runs, then priorities are backfilled deterministically", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database, migrationNames.slice(0, 3));
    await database.query(
      "insert into velo_proxy (id,url_encrypted,protocol,created_at) values ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)",
      ["b", "enc-b", "http", "2026-01-01", "a", "enc-a", "http", "2026-01-01", "c", "enc-c", "socks5", "2025-01-01"],
    );

    // When
    await migrate(database);
    const rows = await database.query("select id, priority from velo_proxy order by priority");

    // Then
    assert.deepEqual(rows.rows, [
      { id: "c", priority: 1 },
      { id: "a", priority: 2 },
      { id: "b", priority: 3 },
    ]);
  } finally {
    await database.close();
  }
});

test("Given the migrated schema, when invalid values are inserted, then constraints reject them", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database);
    await database.query(
      "insert into velo_proxy (id,url_encrypted,protocol,priority) values ('p1','enc','http',1)",
    );

    // When / Then
    await expectRejected(
      () => database.query("insert into velo_proxy (id,url_encrypted,protocol,priority) values ('p2','enc','http',1)"),
      /unique|duplicate/i,
    );
    await expectRejected(
      () => database.query("update velo_proxy set verdict = 'excellent' where id = 'p1'"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_validation_result (id,run_id,route_ref,masked_label,verdict) values ($1,$2,$3,$4,$5)", ["orphan", "missing", ROUTE_REF, MASKED_LABEL, "healthy"]),
      /foreign key constraint/i,
    );
    await database.query("insert into velo_proxy_validation_run (id,status) values ('r1','running')");
    await database.query(
      "insert into velo_proxy_validation_result (id,run_id,proxy_id,route_ref,masked_label,verdict) values ($1,$2,$3,$4,$5,$6)",
      ["x1", "r1", "p1", ROUTE_REF, MASKED_LABEL, "checking"],
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_validation_evidence (id,result_id,stage,outcome) values ('s1','x1','cookies','passed')"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_event (id,route_ref,masked_label,event_type) values ('e1','https://user:secret@example.test','masked','deleted')"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_event (id,route_ref,masked_label,event_type) values ('e2',repeat('a',64),repeat('x',129),'deleted')"),
      /check constraint/i,
    );
  } finally {
    await database.close();
  }
});

test("Given credential-shaped plain strings, when they target structured history fields, then every value is rejected", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database);
    await database.query("insert into velo_proxy (id,url_encrypted,protocol,priority) values ('p1','enc','http',1)");
    await database.query("insert into velo_proxy_validation_run (id,status) values ('r1','running')");
    await database.query(
      "insert into velo_proxy_validation_result (id,run_id,proxy_id,route_ref,masked_label,verdict) values ($1,$2,$3,$4,$5,$6)",
      ["x1", "r1", "p1", ROUTE_REF, MASKED_LABEL, "checking"],
    );

    // When / Then
    await expectRejected(
      () => database.query("insert into velo_proxy_event (id,route_ref,masked_label,event_type) values ('bad-ref','username-password','HTTP aaaaaaaa ••••:443','deleted')"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_event (id,route_ref,masked_label,event_type) values ('bad-label',repeat('b',64),'hunter2-password','deleted')"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("update velo_proxy set last_error_code = 'hunter2' where id = 'p1'"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("update velo_proxy_validation_result set error_code = 'hunter2-password' where id = 'x1'"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_validation_evidence (id,result_id,stage,outcome,code) values ('s1','x1','connection','failed','hunter2')"),
      /check constraint/i,
    );
    await expectRejected(
      () => database.query("insert into velo_proxy_event (id,route_ref,masked_label,event_type,error_code) values ('bad-code',repeat('c',64),'SOCKS5 cccccccc ••••:1080','validated','username-password')"),
      /check constraint/i,
    );
  } finally {
    await database.close();
  }
});

test("Given an interrupted migration transaction, when the loader retries, then rollback leaves a clean recoverable schema", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database, migrationNames.slice(0, 3));
    const migration = await migrationSql("0005_proxy_operations.sql");
    await assert.rejects(
      () => database.transaction(async (transaction) => {
        await transaction.exec(migration);
        await transaction.exec("select definitely_missing_function()")
      }),
    );

    // When
    const applied = await migrate(database);

    // Then
    assert.deepEqual(applied, ["0005_proxy_operations.sql"]);
    const columns = await database.query(
      "select column_name from information_schema.columns where table_name = 'velo_proxy' and column_name in ('priority','eligible','hard_failures','full_passes') order by column_name",
    );
    assert.deepEqual(columns.rows.map((row) => row.column_name), ["eligible", "full_passes", "hard_failures", "priority"]);
  } finally {
    await database.close();
  }
});

test("Given an applied schema, when migration runs again, then no file is reapplied", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database);

    // When
    const applied = await migrate(database);

    // Then
    assert.deepEqual(applied, []);
  } finally {
    await database.close();
  }
});

test("Given sanitized history, when its proxy is deleted, then result and event rows remain", async () => {
  // Given
  const database = await openDatabase();
  try {
    await migrate(database);
    await database.query("insert into velo_proxy (id,url_encrypted,protocol,priority) values ('p1','enc','http',1)");
    await database.query("insert into velo_proxy_validation_run (id,status) values ('r1','completed')");
    await database.query(
      "insert into velo_proxy_validation_result (id,run_id,proxy_id,route_ref,masked_label,verdict) values ($1,$2,$3,$4,$5,$6)",
      ["x1", "r1", "p1", ROUTE_REF, MASKED_LABEL, "healthy"],
    );
    await database.query(
      "insert into velo_proxy_event (id,proxy_id,route_ref,masked_label,event_type) values ($1,$2,$3,$4,$5)",
      ["e1", "p1", ROUTE_REF, MASKED_LABEL, "deleted"],
    );

    // When
    await database.query("delete from velo_proxy where id = 'p1'");
    const results = await database.query("select proxy_id,route_ref,masked_label from velo_proxy_validation_result");
    const events = await database.query("select proxy_id,route_ref,masked_label from velo_proxy_event");

    // Then
    assert.deepEqual(results.rows, [{ proxy_id: null, route_ref: ROUTE_REF, masked_label: MASKED_LABEL }]);
    assert.deepEqual(events.rows, [{ proxy_id: null, route_ref: ROUTE_REF, masked_label: MASKED_LABEL }]);
  } finally {
    await database.close();
  }
});
