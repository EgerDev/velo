// Policy checks over .github/workflows/*.yml (GH-03, GH-06, GH-10, SUP-08).
// Text checks on purpose: these are rules about the YAML itself, and a plain
// read keeps the test free of a YAML dependency.
//
// Limits of the text splitters (write workflows to fit them):
// - job ids must be lowercase (`[a-z0-9_-]`), indented two spaces under `jobs:`;
// - a trailing comment on a job-id line (`  update: # ...`) is not supported;
// - steps are list items indented six spaces (`      - `).
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

/** Split a job into its steps: each six-space-indented list item. */
function steps(jobText) {
  return jobText.split(/^(?= {6}- )/m).filter((chunk) => /^ {6}- /.test(chunk));
}

// A job holding a write scope, a secret, an App token or an OIDC token.
const PRIVILEGED = /:\s*write\b|secrets\.|create-github-app-token|id-token/;
const PACKAGE_CODE = /\b(npm|npx|node|pip)\s/;

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

  test(`${name}: a privileged job runs no package code`, () => {
    for (const job of jobs(text)) {
      if (!PRIVILEGED.test(job.text)) continue;
      assert.doesNotMatch(job.text, PACKAGE_CODE, `${name}/${job.id}`);
    }
  });

  test(`${name}: a job that runs package code holds no secret and no App token`, () => {
    for (const job of jobs(text)) {
      if (!PACKAGE_CODE.test(job.text)) continue;
      assert.doesNotMatch(job.text, /secrets\./, `${name}/${job.id}`);
      assert.doesNotMatch(job.text, /create-github-app-token/, `${name}/${job.id}`);
    }
  });

  test(`${name}: artifacts are downloaded under runner.temp, never into the checkout`, () => {
    for (const job of jobs(text)) {
      for (const step of steps(job.text)) {
        if (!/uses:\s*actions\/download-artifact@/.test(step)) continue;
        assert.match(step, /^\s*path:.*runner\.temp/m, `${name}/${job.id}`);
      }
    }
  });

  test(`${name}: a privileged job uses no cache`, () => {
    for (const job of jobs(text)) {
      if (!PRIVILEGED.test(job.text)) continue;
      assert.doesNotMatch(job.text, /\bcache:|actions\/cache\b/, `${name}/${job.id}`);
    }
  });

  test(`${name}: no git apply`, () => {
    assert.doesNotMatch(text, /\bgit\s+apply\b/);
  });
}

test("ci.yml exists and gates unit tests on Linux and Windows plus the verify job", () => {
  const ci = workflows.find((w) => w.name === "ci.yml");
  assert.ok(ci, "ci.yml is missing");
  assert.match(ci.text, /os: \[ubuntu-24\.04, windows-2025\]/);
  for (const step of ["npm run typecheck", "npm run lint", "npm run build", "npm run test:http", "npm audit signatures"]) {
    assert.ok(ci.text.includes(step), step);
  }
});

test("scanning workflows, Dependabot and CODEOWNERS are in place and agree with auto-update", () => {
  for (const name of ["codeql.yml", "dependency-review.yml", "scorecard.yml"]) {
    assert.ok(workflows.some((w) => w.name === name), `${name} is missing`);
  }
  const dependabot = readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  // auto-update.yml owns exactly the packages Dependabot ignores, so no package has two updaters.
  const auto = workflows.find((w) => w.name === "auto-update.yml").text;
  for (const pkg of auto.match(/--only=([\w.,@/-]+)/)[1].split(",")) {
    assert.match(dependabot, new RegExp(`dependency-name: ${pkg.replace(/\./g, "\\.")}(\\s|$)`), pkg);
  }
  const owners = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8");
  assert.match(owners, /^\/\.github\/\s+@EgerDev$/m);
});
