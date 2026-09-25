import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isMainModule, projectRoot } from "./project-root.mjs";

test("projectRoot is the repository root", () => {
  assert.ok(existsSync(join(projectRoot(), "package.json")));
  assert.ok(existsSync(join(projectRoot(), "scripts", "project-root.mjs")));
});

test("isMainModule is false for a module node was not started with", () => {
  assert.equal(isMainModule(new URL("./auto-update.mjs", import.meta.url).href), false);
});
