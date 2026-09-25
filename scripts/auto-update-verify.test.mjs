import assert from "node:assert/strict";
import { test } from "node:test";
import { verifySteps } from "./auto-update-plan.mjs";

test("every update is verified with typecheck, test, lint and build, in that order", () => {
  assert.deepEqual(verifySteps(), [
    ["typecheck", ["run", "typecheck"]],
    ["test", ["run", "test"]],
    ["lint", ["run", "lint"]],
    ["build", ["run", "build"]],
  ]);
});

test("--skip-tests drops only the test step; build still runs", () => {
  assert.deepEqual(
    verifySteps({ skipTests: true }).map(([label]) => label),
    ["typecheck", "lint", "build"],
  );
});
