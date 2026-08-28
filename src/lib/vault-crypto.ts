import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * At-rest encryption for the YouTube cookie vault.
 *
 * The raw Netscape jar carries live Google session credentials (SID / HSID /
 * SAPISID), so it must never sit in the datastore as cleartext. Rows are
 * wrapped in an AES-256-GCM envelope before insert and unwrapped only
 * in-memory on read.
 *
 * Key — `VELO_VAULT_KEY` (checked in this order, after trimming whitespace):
 *   1. 64 hex chars                              -> used directly as the 32-byte key
 *   2. base64/base64url decoding to exactly 32 B -> used directly as the key
 *   3. anything else (a passphrase of any length) -> key = SHA-256(secret)
 * Unset or empty -> encryption is SKIPPED (dev/local keeps working): writes are
 * stored as plaintext (a single warning is logged the first time), plaintext
 * reads pass through unchanged, but reading an existing envelope THROWS — a
 * lost key must be loud, not silently served as garbage. Once the env var is
 * set, encryption is enforced.
 *
 * Envelope (a plain string, so the existing `text` column is unchanged):
 *   v1:gcm:<iv-b64>:<tag-b64>:<ciphertext-b64>
 * with a fresh random 12-byte IV per encryption.
 *
 * Backward compatibility: rows written before this change hold raw plaintext.
 * `decryptCookies` returns any value that does not start with the envelope
 * prefix as-is, so legacy rows keep working and upgrade to the envelope the
 * next time they are saved.
 *
 * This module must never log cookie contents or key material.
 */

const ENVELOPE_PREFIX = "v1:gcm:";
const IV_BYTES = 12;

let warnedMissingKey = false;

/** Resolve the 32-byte AES key from the env, or null when no key is configured. */
function resolveKey(): Buffer | null {
  const secret = process.env.VELO_VAULT_KEY?.trim();
  if (!secret) return null;
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(secret)) {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt a cookie jar for storage. With no `VELO_VAULT_KEY` configured the
 * plaintext is returned unchanged (dev/local), otherwise the envelope string.
 */
export function encryptCookies(plaintext: string): string {
  const key = resolveKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        "vault-crypto: VELO_VAULT_KEY is not set — vault cookies will be stored unencrypted. " +
          "Set a 32-byte base64/hex key (or any strong secret) to enable at-rest encryption.",
      );
    }
    return plaintext;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a stored vault value. Envelope rows are decrypted (throwing on a
 * wrong key or tampered data); legacy plaintext rows — anything without the
 * envelope prefix — are returned as-is. With no key configured a legacy row
 * still passes through, but an envelope throws.
 */
export function decryptCookies(stored: string): string {
  if (!stored.startsWith(ENVELOPE_PREFIX)) return stored; // legacy plaintext row
  const key = resolveKey();
  // An envelope can never be a valid jar without its key: fail here instead of
  // handing ciphertext to yt-dlp and surfacing an unrelated parse error.
  if (!key) {
    throw new Error("vault-crypto: stored vault is encrypted but VELO_VAULT_KEY is not set");
  }
  const parts = stored.split(":");
  const ivB64 = parts[2];
  const tagB64 = parts[3];
  const dataB64 = parts[4];
  if (parts.length !== 5 || ivB64 === undefined || tagB64 === undefined || dataB64 === undefined) {
    throw new Error("vault-crypto: malformed vault envelope");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // Deliberately generic: never echo key material or cookie data into errors.
    throw new Error("vault-crypto: could not decrypt vault envelope (wrong key or tampered data)");
  }
}
