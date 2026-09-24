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
 * ponytail: redaction is by key (and by a cookie entry's `name`); values are not
 * scanned, so a secret inside a free-text message is not caught. Keep secrets out
 * of messages; add value patterns here only if a real leak shows up.
 */
export type LogFields = Record<string, unknown>;

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /cookie|token|secret|authorization|password|sapisid|sid/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function threshold(): number {
  const wanted = process.env.LOG_LEVEL?.trim().toLowerCase() as Level | undefined;
  return (wanted && LEVELS[wanted]) || LEVELS.info;
}

function clean(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  ancestors.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => clean(item, depth + 1, ancestors));
  } else {
    const record = value as LogFields;
    const fields: LogFields = {};
    // A cookie-jar entry ({ name: "SID", value }) hides its secret in `value`.
    const namedSecret = typeof record.name === "string" && SECRET_KEY.test(record.name);
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
  const line: LogFields = { ts: new Date().toISOString(), level, event };
  if (fields) {
    for (const [key, value] of Object.entries(redact(fields))) {
      if (!(key in line)) line[key] = value; // ts/level/event cannot be overridden
    }
  }
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
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
