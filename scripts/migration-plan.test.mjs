import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";
import { projectRoot } from "./project-root.mjs";

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/sub/0001_auth.sql"), "0001_auth.sql");
  assert.equal(migrationName("0001_auth.sql"), "0001_auth.sql");
});

test("a file already applied does not re-apply", () => {
  assert.deepEqual(pendingMigrations(["/migrations/0001_auth.sql"], ["0001_auth.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped", () => {
  assert.equal(isMigrationFile("auth"), false);
  assert.deepEqual(pendingMigrations(["auth", "README.md"], []), []);
});

test("migrations/ holds only numbered .sql files (no template copies in subdirectories)", () => {
  const entries = readdirSync(join(projectRoot(), "migrations"));
  assert.deepEqual(entries.filter((entry) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry)), []);
});

// A migration already applied to a real database is immutable: editing it
// after the fact desyncs that database's schema from the file, silently,
// since `_migrations` keys on filename and never re-runs it. Pin each
// already-applied file's content hash so an edit fails this test instead.
const APPLIED_MIGRATION_HASHES = {
  "0001_auth.sql": "217a634f966c9e8d93d59f22191fb5f377ec251e507e52d5eddd990e913eaa76",
  "0002_youtube_vault.sql": "078d587d021d15efa6dcb6134cc19fdc574a0445dbc6c4dae54ac0abe3ba2826",
  "0003_verification_value_idx.sql": "399416c133e87e75a6796d8633ce331e2da95cb7a06fae02b3fedddf91478cf0",
  "0004_user_proxies.sql": "96fefd6dd49f53696c95ee61ad004b80b1a79d457fa24166f6f3537e4a1cbc42",
  "0005_proxy_operations.sql": "f091dd203606c2cc13f50b19e52803a25932f9cdfaabdcc502ddfcc8484fdd3f",
};

for (const [name, expectedHash] of Object.entries(APPLIED_MIGRATION_HASHES)) {
  test(`applied migration ${name} is unedited`, () => {
    const content = readFileSync(join(projectRoot(), "migrations", name), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    assert.equal(hash, expectedHash, `${name} content hash changed — applied migrations are immutable`);
  });
}
