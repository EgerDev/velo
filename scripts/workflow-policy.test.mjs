// Policy checks over .github/workflows/*.yml (GH-03, GH-06, GH-10, SUP-08).
// Text checks on purpose: these are rules about the YAML itself, and a plain
// read keeps the test free of a YAML dependency.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), "utf8").replace(/\r\n/g, "\n") }));

/** Split a workflow into its jobs: { id, text } for each two-space-indented key under `jobs:`. */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  return body
    .split(/^(?= {2}[a-z0-9_-]+:\s*$)/m)
    .filter((chunk) => /^ {2}[a-z0-9_-]+:/.test(chunk))
    .map((chunk) => ({ id: chunk.match(/^ {2}([a-z0-9_-]+):/)[1], text: chunk }));
}

for (const { name, text } of workflows) {
  test(`${name}: every action is pinned to a full commit SHA with a version comment`, () => {
    const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length > 0);
    for (const [, ref, rest] of uses) {
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${ref}`);
      assert.match(rest, /#\s*v\d+\.\d+\.\d+/, `${name}: ${ref} needs a "# vX.Y.Z" comment`);
    }
  });

  test(`${name}: default token has no permissions; jobs opt in`, () => {
    assert.match(text, /^permissions: \{\}$/m);
  });

  test(`${name}: checkout never persists the token`, () => {
    const checkouts = text.match(/uses: actions\/checkout@/g)?.length ?? 0;
    const hardened = text.match(/persist-credentials: false/g)?.length ?? 0;
    assert.equal(hardened, checkouts);
  });

  test(`${name}: every job has a timeout and a pinned runner image`, () => {
    for (const job of jobs(text)) {
      assert.match(job.text, /^ {4}timeout-minutes: \d+$/m, `${name}/${job.id}`);
    }
    assert.doesNotMatch(text, /-latest\b/);
  });

  test(`${name}: a job holding a write permission runs no package code`, () => {
    for (const job of jobs(text)) {
      if (!/:\s*write\b/.test(job.text)) continue;
      assert.doesNotMatch(job.text, /\b(npm|npx|pip|pip3|node)\s/, `${name}/${job.id}`);
    }
  });

  test(`${name}: no unpinned pip install`, () => {
    for (const [line] of text.matchAll(/^.*pip3? install.*$/gm)) {
      assert.match(line, /--require-hashes/, `${name}: ${line.trim()}`);
    }
  });
}
