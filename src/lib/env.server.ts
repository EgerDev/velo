/**
 * Server configuration (roadmap contract C1). The one place server code reads
 * its environment from.
 *
 * Production (`NODE_ENV=production`) fails closed: every required variable that
 * is missing or invalid is collected, and `loadServerEnv` throws one `EnvError`
 * naming all of them — names only, never values. `server/plugins/env.ts` calls
 * it before the server listens, so a misconfigured deploy exits instead of
 * serving. Development and test get defaults instead; none of them exists in
 * production.
 */
import { randomBytes } from "node:crypto";

export type ServerEnv = {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_URL: string | undefined;
  BETTER_AUTH_SECRET: string;
  VELO_PUBLIC_ORIGIN: string;
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
  VELO_ADMIN_EMAILS: string[];
  VELO_EGRESS_PROXY: string | undefined;
  VELO_PROXY_SECRET_KEY: string | undefined;
  VELO_PROXY_SECRET_KEY_PREVIOUS: string | undefined;
  VELO_EXTENSION_IDS: string[];
  SENTRY_DSN: string | undefined;
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  YTDLP_PYTHON: string;
};

/** Thrown when production config is incomplete. `missing` holds every missing or invalid name. */
export class EnvError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Missing or invalid required environment variables: ${missing.join(", ")}`);
    this.name = "EnvError";
    this.missing = missing;
  }
}

const MIN_SECRET_LENGTH = 32;
/**
 * Better Auth reads these straight from the environment, past this file: the
 * first widens the trusted origins beyond VELO_PUBLIC_ORIGIN (C9), the second
 * replaces BETTER_AUTH_SECRET. Production refuses to boot with either set.
 */
const BETTER_AUTH_OVERRIDES = ["BETTER_AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_SECRETS"];
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Trimmed value, or undefined when unset or blank. */
function read(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = source[key]?.trim();
  return value ? value : undefined;
}

function list(value: string | undefined, lower = false): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => (lower ? entry.trim().toLowerCase() : entry.trim()))
    .filter(Boolean);
}

/**
 * An origin: scheme + host (+ port), nothing else. https, or http on a
 * loopback host (a local production build). Returns undefined when invalid.
 */
function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== "/") return undefined;
  // Better Auth reads `*` in a trusted origin as a wildcard pattern.
  if (url.hostname.includes("*")) return undefined;
  return url.origin;
}

/** The local dev origin. Follows `VELO_DEV_PORT` exactly as `vite.config.ts` does. */
export function devOrigin(source: NodeJS.ProcessEnv = process.env): string {
  return `http://localhost:${Number(source.VELO_DEV_PORT) || 8080}`;
}

const secretGlobal = globalThis as typeof globalThis & { __veloDevAuthSecret__?: string };

/** Dev-only signing secret that survives HMR re-evaluation (sessions stay valid until restart). */
function devSecret(): string {
  secretGlobal.__veloDevAuthSecret__ ??= randomBytes(32).toString("hex");
  return secretGlobal.__veloDevAuthSecret__;
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const rawNodeEnv = read(source, "NODE_ENV");
  const NODE_ENV = rawNodeEnv === "production" || rawNodeEnv === "test" ? rawNodeEnv : "development";
  const production = NODE_ENV === "production";
  const missing: string[] = [];

  const DATABASE_URL = read(source, "DATABASE_URL");
  if (production && !DATABASE_URL) missing.push("DATABASE_URL");

  let BETTER_AUTH_SECRET = read(source, "BETTER_AUTH_SECRET");
  if (production && (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < MIN_SECRET_LENGTH)) {
    missing.push("BETTER_AUTH_SECRET");
  }
  BETTER_AUTH_SECRET ??= production ? "" : devSecret();

  let VELO_PUBLIC_ORIGIN = parseOrigin(read(source, "VELO_PUBLIC_ORIGIN"));
  if (!VELO_PUBLIC_ORIGIN) {
    if (production) missing.push("VELO_PUBLIC_ORIGIN");
    VELO_PUBLIC_ORIGIN = production ? "" : devOrigin(source);
  }

  const GOOGLE_CLIENT_ID = read(source, "GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = read(source, "GOOGLE_CLIENT_SECRET");
  if (production && !GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (production && !GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (production) missing.push(...BETTER_AUTH_OVERRIDES.filter((name) => read(source, name)));

  if (production && missing.length > 0) throw new EnvError(missing);

  const level = read(source, "LOG_LEVEL")?.toLowerCase();
  return {
    NODE_ENV,
    DATABASE_URL,
    BETTER_AUTH_SECRET,
    VELO_PUBLIC_ORIGIN,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    VELO_ADMIN_EMAILS: list(read(source, "VELO_ADMIN_EMAILS"), true),
    VELO_EGRESS_PROXY: read(source, "VELO_EGRESS_PROXY"),
    VELO_PROXY_SECRET_KEY: read(source, "VELO_PROXY_SECRET_KEY"),
    VELO_PROXY_SECRET_KEY_PREVIOUS: read(source, "VELO_PROXY_SECRET_KEY_PREVIOUS"),
    VELO_EXTENSION_IDS: list(read(source, "VELO_EXTENSION_IDS")),
    SENTRY_DSN: read(source, "SENTRY_DSN"),
    LOG_LEVEL: LOG_LEVELS.find((name) => name === level) ?? "info",
    YTDLP_PYTHON: read(source, "YTDLP_PYTHON") ?? (process.platform === "win32" ? "python" : "python3"),
  };
}

let memo: ServerEnv | undefined;

/** `loadServerEnv(process.env)`, computed once per process. */
export function serverEnv(): ServerEnv {
  memo ??= loadServerEnv(process.env);
  return memo;
}
