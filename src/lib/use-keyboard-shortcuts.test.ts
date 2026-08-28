import test from "node:test";
import assert from "node:assert/strict";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts.ts";

type DomGlobals = { window: unknown; document: unknown };

function installDom(dom: { window: { document: Document } }): DomGlobals {
  const previous: DomGlobals = { window: globalThis.window, document: globalThis.document };
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  return previous;
}

function restoreDom(previous: DomGlobals) {
  Object.defineProperty(globalThis, "window", { value: previous.window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: previous.document, configurable: true });
}

test("useKeyboardShortcuts: hook is exported as a function", () => {
  assert.equal(typeof useKeyboardShortcuts, "function");
});

test("useKeyboardShortcuts: Escape already claimed by a popover does not fire onClear", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><button id=trigger></button>", { pretendToBeVisual: true });
  const previous = installDom(dom);
  try {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    let cleared = 0;
    const handlers = { onClear: () => void cleared++ };
    function Harness() {
      useKeyboardShortcuts(handlers);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await React.act(async () => {
      root.render(React.createElement(Harness));
    });

    const trigger = document.getElementById("trigger")!;
    const escape = () => new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    trigger.dispatchEvent(escape());
    assert.equal(cleared, 1);

    const claim = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", claim);
    trigger.dispatchEvent(escape());
    document.removeEventListener("keydown", claim);
    assert.equal(cleared, 1);

    await React.act(async () => root.unmount());
  } finally {
    restoreDom(previous);
  }
});

test("useKeyboardShortcuts: Cmd+K is left to the command palette", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><button id=trigger></button>", { pretendToBeVisual: true });
  const previous = installDom(dom);
  try {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    let focused = 0;
    const handlers = { onFocusSearch: () => void focused++ };
    function Harness() {
      useKeyboardShortcuts(handlers);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await React.act(async () => {
      root.render(React.createElement(Harness));
    });

    const trigger = document.getElementById("trigger")!;
    const cmdK = () =>
      new dom.window.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });

    trigger.dispatchEvent(cmdK());
    assert.equal(focused, 0);

    await React.act(async () => root.unmount());
  } finally {
    restoreDom(previous);
  }
});

test("useKeyboardShortcuts: single-key shortcuts are ignored inside a focused <select>", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    "<!doctype html><button id=trigger></button><select id=pick><option>1080p</option><option>720p</option></select>",
    { pretendToBeVisual: true },
  );
  const previous = installDom(dom);
  try {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");

    const switched: string[] = [];
    let focused = 0;
    const handlers = {
      onSwitchMode: (mode: string) => void switched.push(mode),
      onFocusSearch: () => void focused++,
    };
    function Harness() {
      useKeyboardShortcuts(handlers);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await React.act(async () => {
      root.render(React.createElement(Harness));
    });

    const key = (k: string) => new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });

    document.getElementById("trigger")!.dispatchEvent(key("1"));
    assert.deepEqual(switched, ["single"]);

    const select = document.getElementById("pick")!;
    const one = key("1");
    select.dispatchEvent(one);
    assert.deepEqual(switched, ["single"]);
    assert.equal(one.defaultPrevented, false);
    select.dispatchEvent(key("/"));
    assert.equal(focused, 0);

    await React.act(async () => root.unmount());
  } finally {
    restoreDom(previous);
  }
});
