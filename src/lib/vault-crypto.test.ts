import assert from "node:assert/strict";
import { after, test } from "node:test";
import { decryptCookies, encryptCookies } from "./vault-crypto.ts";

// A stand-in jar shaped like what saveVault stores — never real credentials.
const JAR =
  "# Netscape HTTP Cookie File\n" +
  ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest-sid-value\n" +
  ".google.com\tTRUE\t/\tTRUE\t0\tSAPISID\ttest-sapisid-value\n";

const ORIGINAL_KEY = process.env.VELO_VAULT_KEY;
after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.VELO_VAULT_KEY;
  else process.env.VELO_VAULT_KEY = ORIGINAL_KEY;
});

test("with a key set, the jar round-trips through an opaque v1:gcm envelope", () => {
  process.env.VELO_VAULT_KEY = "an arbitrary-length passphrase (sha256-derived)";
  const stored = encryptCookies(JAR);
  assert.notEqual(stored, JAR);
  assert.ok(stored.startsWith("v1:gcm:"));
  // The envelope must not leak any fragment of the plaintext.
  assert.ok(!stored.includes("test-sid-value"));
  assert.ok(!stored.includes("SAPISID"));
  assert.equal(decryptCookies(stored), JAR);
});

test("a random IV makes two encryptions of the same jar differ", () => {
  process.env.VELO_VAULT_KEY = "an arbitrary-length passphrase (sha256-derived)";
  const first = encryptCookies(JAR);
  const second = encryptCookies(JAR);
  assert.notEqual(first, second);
  assert.equal(decryptCookies(first), JAR);
  assert.equal(decryptCookies(second), JAR);
});

test("hex and base64 spellings of the same 32-byte key are interchangeable", () => {
  const keyBytes = Buffer.alloc(32, 7);
  process.env.VELO_VAULT_KEY = keyBytes.toString("hex"); // 64 hex chars
  const stored = encryptCookies(JAR);
  assert.ok(stored.startsWith("v1:gcm:"));
  process.env.VELO_VAULT_KEY = keyBytes.toString("base64"); // same key, base64
  assert.equal(decryptCookies(stored), JAR);
});

test("a tampered tag or ciphertext refuses to decrypt", () => {
  process.env.VELO_VAULT_KEY = "an arbitrary-length passphrase (sha256-derived)";
  const stored = encryptCookies(JAR);
  const parts = stored.split(":");
  const flip = (s: string) => (s.startsWith("A") ? `B${s.slice(1)}` : `A${s.slice(1)}`);

  const badTag = [parts[0], parts[1], parts[2], flip(parts[3]), parts[4]].join(":");
  assert.throws(() => decryptCookies(badTag));

  const badData = [parts[0], parts[1], parts[2], parts[3], flip(parts[4])].join(":");
  assert.throws(() => decryptCookies(badData));

  assert.throws(() => decryptCookies("v1:gcm:not-a-real-envelope"));
});

test("decrypting under a different key than the one that encrypted throws", () => {
  process.env.VELO_VAULT_KEY = "key used at write time";
  const stored = encryptCookies(JAR);
  process.env.VELO_VAULT_KEY = "a rotated, different key";
  assert.throws(() => decryptCookies(stored));
});

test("without VELO_VAULT_KEY both directions are a pass-through", () => {
  process.env.VELO_VAULT_KEY = "temp";
  const envelope = encryptCookies(JAR);
  delete process.env.VELO_VAULT_KEY;
  assert.equal(encryptCookies(JAR), JAR);
  assert.equal(decryptCookies(JAR), JAR);
  // Even an envelope string comes back unchanged when no key is configured.
  assert.equal(decryptCookies(envelope), envelope);
});

test("legacy plaintext rows (no envelope prefix) decrypt to themselves regardless of key", () => {
  process.env.VELO_VAULT_KEY = "an arbitrary-length passphrase (sha256-derived)";
  assert.equal(decryptCookies(JAR), JAR);
  delete process.env.VELO_VAULT_KEY;
  assert.equal(decryptCookies(JAR), JAR);
});
