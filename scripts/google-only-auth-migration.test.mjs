// 0006_google_only_auth.sql: only Google identities survive the removal of the
// platform broker, gate identity and email/password (roadmap D4).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isMigrationFile } from "./migration-plan.mjs";
import { projectRoot } from "./project-root.mjs";

const MIGRATION = "0006_google_only_auth.sql";
const dir = join(projectRoot(), "migrations");
const sql = (name) => readFileSync(join(dir, name), "utf8");

async function databaseBefore() {
  const db = new PGlite();
  await db.waitReady;
  for (const name of readdirSync(dir).filter(isMigrationFile).sort()) {
    if (name >= MIGRATION) break;
    await db.exec(sql(name));
  }
  return db;
}

async function seed(db) {
  const users = ["google-only", "broker-only", "broker-and-google", "password-only", "gate-only"];
  for (const id of users) {
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, $1, $1 || '@example.test', false)`,
      [id],
    );
    await db.query(
      `insert into "session" (id, token, "userId", "expiresAt", "updatedAt") values ($1, $1, $1, now() + interval '1 day', now())`,
      [id],
    );
    await db.query(`insert into youtube_vault (user_id, cookies) values ($1, 'jar')`, [id]);
  }
  const accounts = [
    ["google-only", "google"],
    ["broker-only", "grok-google"],
    ["broker-and-google", "grok-x"],
    ["broker-and-google", "google"],
    ["password-only", "credential"],
    ["gate-only", "grok-gate"],
  ];
  for (const [userId, providerId] of accounts) {
    await db.query(
      `insert into "account" (id, "accountId", "providerId", "userId", "updatedAt") values ($1, $1, $2, $3, now())`,
      [`${userId}:${providerId}`, providerId, userId],
    );
  }
  await db.query(
    `insert into "verification" (id, identifier, value, "expiresAt") values ('v1', 'velo-link:x', 'x', now() + interval '1 hour')`,
  );
}

const ids = async (db, query) => (await db.query(query)).rows.map((row) => Object.values(row)[0]).sort();

test("only Google identities survive; sessions, verifications and orphaned cookie jars go", async () => {
  const db = await databaseBefore();
  await seed(db);
  await db.exec(sql(MIGRATION));
  assert.deepEqual(await ids(db, `select id from "user"`), ["broker-and-google", "google-only"]);
  assert.deepEqual(await ids(db, `select distinct "providerId" from "account"`), ["google"]);
  assert.deepEqual(await ids(db, `select id from "session"`), []);
  assert.deepEqual(await ids(db, `select id from "verification"`), []);
  assert.deepEqual(await ids(db, `select user_id from youtube_vault`), ["broker-and-google", "google-only"]);
  await db.close();
});

test("the migration is a no-op on an empty database", async () => {
  const db = await databaseBefore();
  await db.exec(sql(MIGRATION));
  assert.deepEqual(await ids(db, `select id from "user"`), []);
  await db.close();
});
