import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// ytdlp-proc.server.ts imports proc-run through the "@/" alias.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

test("a child started by runCapture() cannot read server secrets", async () => {
  const { runCapture } = await import("./ytdlp-proc.server.ts");
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://u:p@db/velo";
  try {
    const script = "process.stdout.write(JSON.stringify([process.env.DATABASE_URL ?? null, Boolean(process.env.PATH ?? process.env.Path)]))";
    const result = await runCapture(process.execPath, ["-e", script], 5_000);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), [null, true]);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});
