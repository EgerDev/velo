/**
 * Structured server logger (roadmap contract C4). Server code logs only through
 * `log`; a lint rule bans `console.*` in `src/**\/*.server.ts` and `src/routes/**`.
 *
 * One JSON line per event, `{ts, level, event, ...fields}`: debug/info go to
 * stdout, warn/error to stderr. Before anything is written, every key that looks
 * like a credential is replaced with "[REDACTED]" at any depth, and Errors are
 * reduced to `{name, message, stack}`. Log lines are server-side only — never
 * return them, or a field from them, in a response.
 *
 * `LOG_LEVEL` (debug | info | warn | error, default info) sets the threshold.
 *
 * Redaction is structural, never by value: a matching key at any depth, `value`
 * in a `{name, value}` / `{key, value}` entry whose name/key matches, and the
 * second item of a 2-item `[name, value]` tuple whose name matches. Functions are
 * dropped (an own `toJSON` would otherwise run inside JSON.stringify), and a
 * field set that throws while being read is logged as `logError`, never rethrown.
 *
 * ponytail: values are not scanned. NOT covered, so callers must never log these
 * shapes: free-text messages and stacks (including Error message/stack), URL query
 * strings, flat `rawHeaders` arrays, CLI argv arrays, and objects whose
 * cookie-bearing keys don't match the regex (e.g. `ParsedCookies.netscape` /
 * `.header`). Add value patterns here only if a real leak shows up.
 */
export type LogFields = Record<string, unknown>;

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /cookie|token|secret|authorization|password|sapisid|sid/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;
// ponytail: fixed caps keep one line bounded (~100 items x 2 KB per string per level);
// raise them or add a total-bytes cap if a real line gets cut short or still too big.
const MAX_ITEMS = 100;
const MAX_STRING = 2048;

function threshold(): number {
  const wanted = process.env.LOG_LEVEL?.trim().toLowerCase() as Level | undefined;
  return (wanted && LEVELS[wanted]) || LEVELS.info;
}

const isSecretName = (name: unknown): boolean => typeof name === "string" && SECRET_KEY.test(name);

function clean(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === "function") return undefined;
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING} chars]`
      : value;
  }
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  if (ancestors.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  ancestors.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    if (value.length === 2 && isSecretName(value[0])) {
      // A header tuple (["Cookie", "SID=…"]) hides its secret in the second item.
      out = [value[0], REDACTED];
    } else {
      const items = value.slice(0, MAX_ITEMS).map((item) => clean(item, depth + 1, ancestors));
      if (value.length > MAX_ITEMS) items.push(`[+${value.length - MAX_ITEMS} more]`);
      out = items;
    }
  } else {
    const record = value as LogFields;
    const fields: LogFields = {};
    // A cookie-jar entry ({ name: "SID", value }) or a { key, value } pair hides its
    // secret in `value`.
    const namedSecret = isSecretName(record.name) || isSecretName(record.key);
    for (const [key, inner] of Object.entries(record)) {
      const secret = SECRET_KEY.test(key) || (namedSecret && key === "value");
      fields[key] = secret ? REDACTED : clean(inner, depth + 1, ancestors);
    }
    out = fields;
  }
  // Only ancestors count as cycles; the same object twice side by side is fine.
  ancestors.delete(value);
  return out;
}

/** Replace credential-looking keys (any depth) with "[REDACTED]". Exported for tests. */
export function redact(fields: LogFields): LogFields {
  return clean(fields, 0, new WeakSet()) as LogFields;
}

function write(level: Level, event: string, fields?: LogFields): void {
  if (LEVELS[level] < threshold()) return;
  const head: LogFields = { ts: new Date().toISOString(), level, event };
  let text: string;
  try {
    const line: LogFields = { ...head };
    if (fields) {
      for (const [key, value] of Object.entries(redact(fields))) {
        if (!Object.hasOwn(line, key)) line[key] = value; // ts/level/event cannot be overridden
      }
    }
    text = JSON.stringify(line);
  } catch {
    // A throwing getter or Proxy must not escape: log calls often run inside a catch.
    text = JSON.stringify({ ...head, logError: "unserializable fields" });
  }
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${text}\n`);
}

export const log: {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields & { err?: unknown }): void;
} = {
  debug: (event, fields) => write("debug", event, fields),
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};
