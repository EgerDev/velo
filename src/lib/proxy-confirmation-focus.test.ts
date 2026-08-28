import assert from "node:assert/strict";
import test from "node:test";
import { restoreFocusAfterCancel } from "./proxy-confirmation-focus.ts";

test("keyboard cancellation restores focus to the Remove route trigger", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    "<!doctype html><button id=remove>Remove route</button><button id=keep>Keep route</button>",
    { pretendToBeVisual: true },
  );
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });

  try {
    const remove = document.getElementById("remove") as HTMLButtonElement;
    const keep = document.getElementById("keep") as HTMLButtonElement;
    remove.focus();
    keep.focus();
    assert.equal(document.activeElement, keep);

    keep.addEventListener("keydown", (event) => {
      if (event.key === "Enter") restoreFocusAfterCancel(remove, (callback) => callback());
    });
    keep.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(document.activeElement, remove);
  } finally {
    Object.defineProperty(globalThis, "window", { value: previousWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: previousDocument, configurable: true });
  }
});
