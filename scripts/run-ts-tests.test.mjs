import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const runnerPath = join(projectRoot, "scripts/run-ts-tests.mjs");

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "velo-ts-tests-"));
  try {
    await mkdir(join(root, "src/lib/nested"), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Given the npm test command, when its phases are inspected, then script tests remain and TypeScript tests delegate to discovery", async () => {
  // Given
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));

  // When
  const testCommand = packageJson.scripts.test;

  // Then
  assert.equal(testCommand, "node --test 'scripts/**/*.test.mjs' && node scripts/run-ts-tests.mjs");
});

test("Given nested TypeScript tests, when discovery runs, then every path is returned in sorted order", async () => {
  await withFixture(async (root) => {
    // Given
    await writeFile(join(root, "src/z.test.ts"), "");
    await writeFile(join(root, "src/lib/a.test.ts"), "");
    await writeFile(join(root, "src/lib/nested/m.test.ts"), "");
    await writeFile(join(root, "src/lib/nested/not-a-test.ts"), "");

    // When
    const { discoverTypeScriptTests } = await import("./run-ts-tests.mjs");
    const discovered = await discoverTypeScriptTests(root);

    // Then
    assert.deepEqual(discovered, [
      "src/lib/a.test.ts",
      "src/lib/nested/m.test.ts",
      "src/z.test.ts",
    ]);
  });
});

test("Given no TypeScript tests, when the runner starts, then it fails instead of reporting success", async () => {
  await withFixture(async (root) => {
    // Given
    const environment = { ...process.env, NODE_TEST_CONTEXT: undefined };

    // When
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    });

    // Then
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /No TypeScript tests discovered/);
  });
});

test("Given an intentionally failing fixture, when the runner starts, then Node names and executes it", async () => {
  await withFixture(async (root) => {
    // Given
    const fixturePath = join(root, "src/lib/new-proxy-fixture.test.ts");
    await writeFile(
      fixturePath,
      'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("proxy fixture sentinel", () => assert.fail("AUTO_DISCOVERY_SENTINEL"));\n',
    );

    // When
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });

    // Then
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /proxy fixture sentinel/);
    assert.match(output, /AUTO_DISCOVERY_SENTINEL/);
  });
});

test("Given a removed fixture, when discovery runs again, then stale paths are not retained", async () => {
  await withFixture(async (root) => {
    // Given
    const fixturePath = join(root, "src/lib/transient.test.ts");
    await writeFile(fixturePath, "");
    const { discoverTypeScriptTests } = await import("./run-ts-tests.mjs");
    assert.deepEqual(await discoverTypeScriptTests(root), ["src/lib/transient.test.ts"]);

    // When
    await rm(fixturePath);
    const discovered = await discoverTypeScriptTests(root);

    // Then
    assert.deepEqual(discovered, []);
  });
});
