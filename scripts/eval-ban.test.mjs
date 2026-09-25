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
];

for (const [snippet, rule] of CASES) {
  test(`lint rejects ${JSON.stringify(snippet.split("\n")[0])} (${rule})`, async () => {
    const code = `declare const code: string;\n${snippet}\nexport {};\n`;
    const [result] = await eslint.lintText(code, { filePath: PROBE });
    const hits = result.messages.filter((m) => m.ruleId === rule && m.severity === 2);
    assert.ok(hits.length > 0, `${rule} did not fire: ${JSON.stringify(result.messages)}`);
  });
}

test("ordinary code passes the ban", async () => {
  const code = 'const n = JSON.parse("1");\nsetTimeout(() => n, 1);\nexport {};\n';
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  assert.deepEqual(result.messages.map((m) => m.ruleId), []);
});
