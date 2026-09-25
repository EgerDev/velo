// The lint ban on in-process evaluation (roadmap D7/C5, W4b). Each snippet is
// linted as if it were a file in src/ and must be rejected by the named rule,
// so a config edit that silently drops a rule fails here, not in review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
const PROBE = "src/lib/eval-ban-probe.server.ts";

const CASES = [
  ["eval(code);", "no-eval"],
  ["(0, eval)(code);", "no-restricted-syntax"],
  ["globalThis.eval(code);", "no-restricted-syntax"],
  ["new Function(code);", "no-new-func"],
  ["Function(code)();", "no-new-func"],
  ["globalThis.Function(code)();", "no-restricted-syntax"],
  ['setTimeout("run()", 1);', "no-implied-eval"],
  ['import vm from "node:vm";\nvm.runInThisContext(code);', "no-restricted-imports"],
  ['import { runInNewContext } from "vm";\nrunInNewContext(code);', "no-restricted-imports"],
  ['await import("node:vm");', "no-restricted-syntax"],
  ['process.getBuiltinModule("node:vm");', "no-restricted-syntax"],
  ['window["eval"](code);', "no-eval"],
  ["const e = eval;\ne(code);", "no-eval"],
  ['require("vm");', "no-restricted-syntax"],
  // Aliased Function constructors, prototype constructors, loaders and workers.
  ['globalThis["Function"]("x");', "no-restricted-syntax"],
  ["globalThis[`Function`](\"x\");", "no-restricted-syntax"],
  ['const F = Function;\nnew F("x");', "no-restricted-syntax"],
  ['const { Function: F } = globalThis;\nF("x");', "no-restricted-syntax"],
  ['Reflect.construct(Function, ["x"]);', "no-restricted-syntax"],
  ['(() => {}).constructor("x");', "no-restricted-syntax"],
  ['Object.getPrototypeOf(async function () {}).constructor("x");', "no-restricted-syntax"],
  ['createRequire(import.meta.url)("vm");', "no-restricted-syntax"],
  ['new Worker("x", { eval: true });', "no-restricted-syntax"],
  ['await import("v" + "m");', "no-restricted-syntax"],
];

for (const [snippet, rule] of CASES) {
  test(`lint rejects ${JSON.stringify(snippet.split("\n")[0])} (${rule})`, async () => {
    const code = `declare const code: string;\n${snippet}\nexport {};\n`;
    const [result] = await eslint.lintText(code, { filePath: PROBE });
    const hits = result.messages.filter((m) => m.ruleId === rule && m.severity === 2);
    assert.ok(hits.length > 0, `${rule} did not fire: ${JSON.stringify(result.messages)}`);
  });
}

test("the Function type, a Function-named key and ordinary constructors pass the ban", async () => {
  const code = [
    "export type Handler = Function;",
    "export const o = { Function: 1 };",
    "export const v = o.Function;",
    "export class A { constructor() {} }",
    "export const k = o.constructor;",
    'export const lazy = () => import("./other.ts");',
    'export const w = () => new Worker("x", { type: "module" });',
  ].join("\n");
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  assert.deepEqual(result.messages.filter((m) => m.ruleId === "no-restricted-syntax"), []);
});

test("ordinary code passes the ban", async () => {
  const code = 'const n = JSON.parse("1");\nsetTimeout(() => n, 1);\nexport {};\n';
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  assert.deepEqual(result.messages.map((m) => m.ruleId), []);
});
