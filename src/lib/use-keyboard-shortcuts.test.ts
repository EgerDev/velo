import test from "node:test";
import assert from "node:assert/strict";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts.ts";

test("useKeyboardShortcuts: hook is exported as a function", () => {
  assert.equal(typeof useKeyboardShortcuts, "function");
});
