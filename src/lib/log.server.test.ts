import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { redact, type LogFields } from "./log.server.ts";

const R = "[REDACTED]";

/** Run `body` in a fresh Node process with `log` imported, and capture both streams. */
function runLog(body: string, env: Record<string, string> = {}) {
  const url = new URL("./log.server.ts", import.meta.url).href;
  const script = `const { log } = await import(${JSON.stringify(url)});\n${body}`;
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
    { encoding: "utf8", env: { ...process.env, LOG_LEVEL: "", ...env } },
  );
  assert.equal(child.status, 0, child.stderr);
  const lines = (text: string) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stdout: lines(child.stdout), stderr: lines(child.stderr) };
}

test("redact replaces credential-looking keys at any depth and keeps the rest", () => {
  const out = redact({
    videoId: "dQw4w9WgXcQ",
    cookie: "SID=abc; HSID=def",
    headers: { Authorization: "Bearer x", accept: "*/*" },
    jar: [
      { name: "__Secure-3PAPISID", value: "z" },
      { name: "PREF", value: "f6=1" },
    ],
    nested: { deeper: { refreshToken: "t", clientSecret: "s", PASSWORD: "p", status: 200 } },
  });
  assert.deepEqual(out, {
    videoId: "dQw4w9WgXcQ",
    cookie: R,
    headers: { Authorization: R, accept: "*/*" },
    jar: [
      { name: "__Secure-3PAPISID", value: R },
      { name: "PREF", value: "f6=1" },
    ],
    nested: { deeper: { refreshToken: R, clientSecret: R, PASSWORD: R, status: 200 } },
  });
});

test("redact serializes errors and bigints, and survives cycles", () => {
  const err = new TypeError("boom");
  const shared = { n: 1 };
  const loop: Record<string, unknown> = { name: "loop" };
  loop.self = loop;
  const out = redact({ err, big: 10n, a: shared, b: shared, loop });
  assert.deepEqual(out.err, { name: "TypeError", message: "boom", stack: err.stack });
  assert.equal(out.big, "10");
  assert.deepEqual(out.a, { n: 1 });
  assert.deepEqual(out.b, { n: 1 }, "a repeated (non-circular) object is not a cycle");
  assert.deepEqual(out.loop, { name: "loop", self: "[Circular]" });
});

test("redact leaves the input untouched", () => {
  const input = { token: "keep-me-in-the-caller" };
  redact(input);
  assert.equal(input.token, "keep-me-in-the-caller");
});

test("info writes one JSON line to stdout; ts/level/event come first and cannot be overridden", () => {
  const { stdout, stderr } = runLog(
    `log.info("download.start", { id: "abc", level: "spoofed", cookie: "SID=1" });`,
  );
  assert.equal(stderr.length, 0);
  assert.equal(stdout.length, 1);
  const line = stdout[0]!;
  assert.deepEqual(Object.keys(line).slice(0, 3), ["ts", "level", "event"]);
  assert.equal(line.level, "info");
  assert.equal(line.event, "download.start");
  assert.equal(line.id, "abc");
  assert.equal(line.cookie, R);
  assert.ok(!Number.isNaN(Date.parse(String(line.ts))));
});

test("warn and error go to stderr, and error serializes err", () => {
  const { stdout, stderr } = runLog(
    `log.warn("ytdlp.slow", { ms: 5 }); log.error("ytdlp.failed", { err: new Error("exit 1") });`,
  );
  assert.equal(stdout.length, 0);
  assert.deepEqual(
    stderr.map((l) => l.level),
    ["warn", "error"],
  );
  const err = stderr[1]!.err as Record<string, unknown>;
  assert.equal(err.name, "Error");
  assert.equal(err.message, "exit 1");
  assert.match(String(err.stack), /exit 1/);
});

test("LOG_LEVEL sets the threshold; the default drops debug", () => {
  const all = `log.debug("d"); log.info("i"); log.warn("w"); log.error("e");`;
  const events = (r: ReturnType<typeof runLog>) => [...r.stdout, ...r.stderr].map((l) => l.event);
  assert.deepEqual(events(runLog(all)), ["i", "w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "debug" })), ["d", "i", "w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "WARN" })), ["w", "e"]);
  assert.deepEqual(events(runLog(all, { LOG_LEVEL: "nonsense" })), ["i", "w", "e"]);
});

// Added beyond the brief: the cases the controller asked to be covered explicitly.

test("redact: headers.Cookie inside nested objects and arrays, any key casing", () => {
  const out = redact({
    requests: [
      { url: "https://www.youtube.com/", headers: { Cookie: "SAPISID=x", "User-Agent": "ua" } },
      { headers: { COOKIE: "a", "set-cookie": ["b"], "X-Goog-AuthUser": "0" } },
    ],
    deep: { list: [[{ SaPiSiD: "y", AccessToken: "z", ok: true }]] },
  });
  assert.deepEqual(out, {
    requests: [
      { url: "https://www.youtube.com/", headers: { Cookie: R, "User-Agent": "ua" } },
      { headers: { COOKIE: R, "set-cookie": R, "X-Goog-AuthUser": "0" } },
    ],
    deep: { list: [[{ SaPiSiD: R, AccessToken: R, ok: true }]] },
  });
});

test("redact: Error instances nested in objects and arrays", () => {
  const inner = new RangeError("deep");
  const out = redact({ ctx: { cause: inner }, errs: [new Error("one")] });
  assert.deepEqual((out.ctx as LogFields).cause, {
    name: "RangeError",
    message: "deep",
    stack: inner.stack,
  });
  const first = (out.errs as LogFields[])[0]!;
  assert.equal(first.name, "Error");
  assert.equal(first.message, "one");
  assert.ok(!(first instanceof Error), "an Error is reduced to a plain object");
});

test("redact: circular references through arrays and objects do not throw", () => {
  const a: Record<string, unknown> = {};
  const arr: unknown[] = [a];
  a.arr = arr;
  arr.push(arr);
  let out: Record<string, unknown> = {};
  assert.doesNotThrow(() => {
    out = redact({ a });
  });
  assert.deepEqual(out, { a: { arr: ["[Circular]", "[Circular]"] } });
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("redact: nesting past depth 6 becomes [Truncated]", () => {
  const out = redact({ l1: { l2: { l3: { l4: { l5: { l6: { l7: 1 } } } } } } });
  const l5 = ((((out.l1 as LogFields).l2 as LogFields).l3 as LogFields).l4 as LogFields)
    .l5 as LogFields;
  assert.equal(l5.l6, "[Truncated]");
});

test("redact does not mutate nested input objects, arrays or cookie-jar entries", () => {
  const input = {
    headers: { Cookie: "SID=keep", accept: "*/*" },
    jar: [{ name: "SID", value: "keep" }],
    err: new Error("keep"),
  };
  const snapshot = structuredClone({ headers: input.headers, jar: input.jar });
  redact(input);
  assert.deepEqual({ headers: input.headers, jar: input.jar }, snapshot);
  assert.ok(input.err instanceof Error);
});

// Fix round 1: leaks and hazards found in review.

test("redact drops functions, so an own toJSON cannot emit unredacted data", () => {
  const nested = JSON.stringify(redact({ o: { toJSON: () => ({ cookie: "a" }) } }));
  assert.ok(!nested.includes('"a"'), nested);
  const top = redact({ toJSON: () => "leak", keep: 1 });
  assert.equal(top.toJSON, undefined);
  assert.equal(JSON.stringify(top), '{"keep":1}');
});

test("log never throws into its caller: throwing getters and Proxies become logError", () => {
  const { stdout } = runLog(`
    log.info("getter", { bad: { get boom() { throw new Error("getter"); } } });
    log.info("proxy", new Proxy({}, { ownKeys() { throw new Error("trap"); } }));
    log.info("toJSON", { o: { toJSON: () => ({ cookie: "a" }) } });
    log.info("after");
  `);
  assert.deepEqual(
    stdout.map((l) => l.event),
    ["getter", "proxy", "toJSON", "after"],
  );
  assert.equal(stdout[0]!.logError, "unserializable fields");
  assert.equal(stdout[0]!.level, "info");
  assert.equal(stdout[1]!.logError, "unserializable fields");
  assert.ok(!JSON.stringify(stdout[2]).includes('"a"'));
});

test("fields named like Object.prototype members are kept; only ts/level/event are reserved", () => {
  const { stdout } = runLog(`log.info("proto", { constructor: "c", toString: "t", event: "spoof" });`);
  const line = stdout[0]!;
  assert.equal(line.constructor, "c");
  assert.equal(line.toString, "t");
  assert.equal(line.event, "proto");
});

test("redact bounds output: binary, long arrays, long strings", () => {
  const out = redact({
    buf: Buffer.from("secret"),
    u8: new Uint8Array(3),
    list: Array.from({ length: 150 }, (_, i) => i),
    exact: Array.from({ length: 100 }, (_, i) => i),
    text: "x".repeat(3000),
    short: "y".repeat(2048),
  });
  assert.equal(out.buf, "[6 bytes]");
  assert.equal(out.u8, "[3 bytes]");
  const list = out.list as unknown[];
  assert.equal(list.length, 101);
  assert.equal(list[99], 99);
  assert.equal(list[100], "[+50 more]");
  assert.equal((out.exact as unknown[]).length, 100);
  assert.equal(out.text, `${"x".repeat(2048)}…[+952 chars]`);
  assert.equal(out.short, "y".repeat(2048));
});

test("redact: {key, value} entries and [name, value] header tuples", () => {
  const out = redact({
    headers: [
      ["Cookie", "SID=x"],
      ["Accept", "*/*"],
    ],
    pairs: [
      { key: "Authorization", value: "Bearer x" },
      { key: "accept", value: "*/*" },
    ],
    triple: ["cookie", "a", "b"],
  });
  assert.deepEqual(out, {
    headers: [
      ["Cookie", R],
      ["Accept", "*/*"],
    ],
    pairs: [
      { key: "Authorization", value: R },
      { key: "accept", value: "*/*" },
    ],
    triple: ["cookie", "a", "b"],
  });
});
