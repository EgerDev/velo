import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  decryptCookies,
  decryptSecret,
  encryptCookies,
  encryptSecret,
  fingerprintSecret,
} from "./vault-crypto.ts";

// A stand-in jar shaped like what saveVault stores — never real credentials.
const JAR =
  "# Netscape HTTP Cookie File\n" +
  ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest-sid-value\n" +
  ".google.com\tTRUE\t/\tTRUE\t0\tSAPISID\ttest-sapisid-value\n";

const ORIGINAL_KEY = process.env.VELO_VAULT_KEY;
const ORIGINAL_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const ORIGINAL_PREVIOUS_KEY = process.env.VELO_VAULT_KEY_PREVIOUS;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.VELO_VAULT_KEY;
  else process.env.VELO_VAULT_KEY = ORIGINAL_KEY;
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  if (ORIGINAL_PREVIOUS_KEY === undefined) delete process.env.VELO_VAULT_KEY_PREVIOUS;
  else process.env.VELO_VAULT_KEY_PREVIOUS = ORIGINAL_PREVIOUS_KEY;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

test("proxy credentials are encrypted even when the cookie vault key is unset", () => {
  delete process.env.VELO_VAULT_KEY;
  delete process.env.BETTER_AUTH_SECRET;
  const proxy = "http://audit-user:audit-pass@127.0.0.1:8080";
  const stored = encryptSecret(proxy);
  assert.ok(stored.startsWith("v1:gcm:"));
  assert.equal(stored.includes("audit-user"), false);
  assert.equal(stored.includes("audit-pass"), false);
  assert.deepEqual(decryptSecret(stored), { plaintext: proxy, key: "current" });
});

test("proxy encryption falls back to the stable authentication secret", () => {
  delete process.env.VELO_VAULT_KEY;
  process.env.BETTER_AUTH_SECRET = "stable deployed auth secret";
  const proxy = "socks5://127.0.0.1:1080";
  const stored = encryptSecret(proxy);
  assert.deepEqual(decryptSecret(stored), { plaintext: proxy, key: "current" });
  process.env.BETTER_AUTH_SECRET = "rotated auth secret";
  assert.throws(() => decryptSecret(stored));
});

test("proxy fingerprints are deterministic, key-bound, and do not expose the secret", () => {
  process.env.VELO_VAULT_KEY = "fingerprint-key-one";
  const secret = "http://audit-user:audit-pass@127.0.0.1:8080";
  const first = fingerprintSecret(secret);
  assert.equal(first, fingerprintSecret(secret));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first.includes("audit-user"), false);
  process.env.VELO_VAULT_KEY = "fingerprint-key-two";
  assert.notEqual(fingerprintSecret(secret), first);
});

test("proxy decryption reports use of the previous key during rotation", () => {
  process.env.VELO_VAULT_KEY = "old-key";
  const stored = encryptSecret("socks5://127.0.0.1:1080");
  process.env.VELO_VAULT_KEY = "new-key";
  process.env.VELO_VAULT_KEY_PREVIOUS = "old-key";
  assert.deepEqual(decryptSecret(stored), {
    plaintext: "socks5://127.0.0.1:1080",
    key: "previous",
  });
});

test("production proxy crypto refuses a process-local key", () => {
  delete process.env.VELO_VAULT_KEY;
  delete process.env.BETTER_AUTH_SECRET;
  process.env.NODE_ENV = "production";
  assert.throws(() => encryptSecret("http://127.0.0.1:8080"), /stable proxy vault key/i);
  assert.throws(() => fingerprintSecret("http://127.0.0.1:8080"), /stable proxy vault key/i);
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

test("without VELO_VAULT_KEY plaintext passes through but an envelope refuses", () => {
  process.env.VELO_VAULT_KEY = "temp";
  const envelope = encryptCookies(JAR);
  delete process.env.VELO_VAULT_KEY;
  assert.equal(encryptCookies(JAR), JAR);
  assert.equal(decryptCookies(JAR), JAR);
  // An envelope can never be a jar without its key — a lost key must be loud.
  assert.throws(() => decryptCookies(envelope), /VELO_VAULT_KEY/);
});

test("legacy plaintext rows (no envelope prefix) decrypt to themselves regardless of key", () => {
  process.env.VELO_VAULT_KEY = "an arbitrary-length passphrase (sha256-derived)";
  assert.equal(decryptCookies(JAR), JAR);
  delete process.env.VELO_VAULT_KEY;
  assert.equal(decryptCookies(JAR), JAR);
});
