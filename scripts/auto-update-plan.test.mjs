import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  bumpSpec,
  buildUpdatePlan,
  classifyUpdate,
  compareVersions,
  describePlan,
  dependencyBlock,
  isPinnedSpec,
  parseSpec,
  ytdlpNeedsUpdate,
} from "./auto-update-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

test("range operators survive a bump", () => {
  assert.equal(bumpSpec("^18.0.0", "19.2.0"), "^19.2.0");
  assert.equal(bumpSpec("~1.6.30", "1.7.1"), "~1.7.1");
  assert.equal(bumpSpec(">=8.16.3", "9.0.0"), ">=9.0.0");
  assert.equal(bumpSpec("6.2.9", "6.2.10"), "6.2.10");
});

test("specs the planner refuses to reason about are left alone", () => {
  for (const spec of ["*", "latest", "file:../local", "git+https://x/y.git", "workspace:*"]) {
    assert.equal(parseSpec(spec), null, spec);
    assert.equal(bumpSpec(spec, "1.0.0"), null, spec);
    assert.equal(
      classifyUpdate({ name: "x", spec, current: "1.0.0", wanted: "1.0.0", latest: "2.0.0" }).kind,
      "skip",
      spec,
    );
  }
});

test("an exact spec reads as a deliberate pin", () => {
  assert.equal(isPinnedSpec("6.2.9"), true);
  assert.equal(isPinnedSpec("=6.2.9"), true);
  assert.equal(isPinnedSpec("3.0.260610-beta"), true);
  assert.equal(isPinnedSpec("^6.2.9"), false);
  assert.equal(isPinnedSpec("~6.2.9"), false);
});

test("versions compare numerically, not lexically", () => {
  // The bug a string compare hides: "9" sorts after "10".
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
  assert.ok(compareVersions("2026.10.1", "2026.8.19") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  // Missing trailing components are zero, not absent.
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  // A prerelease tail does not make the version bigger than its own release.
  assert.equal(compareVersions("3.0.260610-beta", "3.0.260610"), 0);
});

test("an in-range move needs no package.json edit", () => {
  const verdict = classifyUpdate({
    name: "@tanstack/react-query",
    spec: "^5.101.0",
    current: "5.101.4",
    wanted: "5.102.3",
    latest: "5.102.3",
  });
  assert.equal(verdict.kind, "in-range");
  assert.equal(verdict.to, "5.102.3");
  assert.equal(verdict.nextSpec, undefined);
});

test("a move past the spec ceiling needs --major, and rewrites the spec", () => {
  const row = {
    name: "eslint",
    spec: "^9.20.0",
    current: "9.39.5",
    wanted: "9.39.5",
    latest: "10.9.1",
  };
  assert.equal(classifyUpdate(row).kind, "skip");
  const verdict = classifyUpdate({ ...row, allowRangeBump: true });
  assert.equal(verdict.kind, "range-bump");
  assert.equal(verdict.nextSpec, "^10.9.1");
});

test("--major on a package behind both inside and past its range is one hop, not two", () => {
  // spec ^18.0.0, 18.4.0 available in-range, 19.0.0 past it: going straight to
  // 19.0.0 subsumes the 18.4.0 step, so the plan must not queue both.
  const row = {
    name: "youtubei.js",
    spec: "^18.0.0",
    current: "18.0.1",
    wanted: "18.4.0",
    latest: "19.0.0",
  };
  assert.equal(classifyUpdate(row).kind, "in-range");
  const verdict = classifyUpdate({ ...row, allowRangeBump: true });
  assert.equal(verdict.kind, "range-bump");
  assert.equal(verdict.from, "18.0.1");
  assert.equal(verdict.nextSpec, "^19.0.0");
});

test("a package pinned by overrides is never bumped", () => {
  const verdict = classifyUpdate({
    name: "nf3",
    spec: "^0.3.17",
    current: "0.3.17",
    wanted: "0.3.17",
    latest: "0.4.0",
    overridden: true,
  });
  assert.equal(verdict.kind, "skip");
  assert.match(verdict.reason ?? "", /overrides/);
});

test("--pinned is the whole gate for an exact spec — it does not also need --major", () => {
  const row = { name: "jose", spec: "6.2.9", current: "6.2.9", wanted: "6.2.9", latest: "6.2.10" };
  assert.equal(classifyUpdate(row).kind, "skip");
  assert.match(classifyUpdate(row).reason ?? "", /--pinned/);
  const verdict = classifyUpdate({ ...row, allowPinned: true });
  assert.equal(verdict.kind, "range-bump");
  assert.equal(verdict.nextSpec, "6.2.10");
});

test("a current package plans nothing", () => {
  const verdict = classifyUpdate({
    name: "mediabunny",
    spec: "^1.55.2",
    current: "1.55.2",
    wanted: "1.55.2",
    latest: "1.55.2",
  });
  assert.equal(verdict.kind, "none");
});

const PKG = {
  dependencies: {
    "@tanstack/react-query": "^5.101.0",
    "youtubei.js": "^18.0.0",
    jose: "6.2.9",
    nf3: "^0.3.17",
  },
  devDependencies: { eslint: "^9.20.0" },
  overrides: { nf3: "0.3.17" },
};

const OUTDATED = {
  "@tanstack/react-query": { current: "5.101.4", wanted: "5.102.3", latest: "5.102.3" },
  "youtubei.js": { current: "18.0.1", wanted: "18.4.0", latest: "19.0.0" },
  jose: { current: "6.2.9", wanted: "6.2.9", latest: "6.2.10" },
  nf3: { current: "0.3.17", wanted: "0.3.17", latest: "0.4.0" },
  eslint: { current: "9.39.5", wanted: "9.39.5", latest: "10.9.1" },
  // Transitive: no direct spec, so npm owns it and the plan ignores it.
  "some-transitive-dep": { current: "1.0.0", wanted: "2.0.0", latest: "2.0.0" },
};

test("dependencies and devDependencies are both planned", () => {
  assert.equal(dependencyBlock(PKG, "youtubei.js"), "dependencies");
  assert.equal(dependencyBlock(PKG, "eslint"), "devDependencies");
  assert.equal(dependencyBlock(PKG, "some-transitive-dep"), null);
});

test("without --major the plan is only what the committed specs already allow", () => {
  const plan = buildUpdatePlan(PKG, OUTDATED);
  assert.deepEqual(
    plan.inRange.map((s) => `${s.name}@${s.to}`),
    ["@tanstack/react-query@5.102.3", "youtubei.js@18.4.0"],
  );
  assert.equal(plan.rangeBumps.length, 0);
  // A transitive row never reaches the plan at all.
  assert.ok(!plan.skipped.some((s) => s.name === "some-transitive-dep"));
  // eslint's major is refused with a reason, not silently dropped.
  assert.match(plan.skipped.find((s) => s.name === "eslint")?.reason ?? "", /--major/);
});

test("--major plans the out-of-range bumps one step at a time", () => {
  const plan = buildUpdatePlan(PKG, OUTDATED, { major: true });
  assert.deepEqual(
    plan.rangeBumps.map((s) => `${s.name}:${s.nextSpec}`),
    ["eslint:^10.9.1", "youtubei.js:^19.0.0"],
  );
  // youtubei.js moved to the range-bump list rather than being planned twice.
  assert.deepEqual(
    plan.inRange.map((s) => s.name),
    ["@tanstack/react-query"],
  );
  // Still refuses the pin and the override, even under --major.
  assert.deepEqual(plan.skipped.map((s) => s.name).sort(), ["jose", "nf3"]);
});

test("--only narrows the plan", () => {
  const plan = buildUpdatePlan(PKG, OUTDATED, { only: ["youtubei.js"] });
  assert.deepEqual(
    plan.inRange.map((s) => s.name),
    ["youtubei.js"],
  );
  assert.equal(plan.skipped.length, 0);
});

test("an empty plan says so rather than printing nothing", () => {
  assert.deepEqual(describePlan({ inRange: [], rangeBumps: [], skipped: [] }), [
    "everything is current",
  ]);
});

test("yt-dlp date versions compare across PyPI's zero-stripped spelling", () => {
  // PyPI reports 2026.8.19 for the release yt-dlp itself calls 2026.08.19.
  assert.equal(ytdlpNeedsUpdate("2026.08.19", "2026.8.19"), false);
  assert.equal(ytdlpNeedsUpdate("2026.08.19", "2026.9.1"), true);
  // The compare a string sort gets backwards.
  assert.equal(ytdlpNeedsUpdate("2026.8.19", "2026.10.1"), true);
  assert.equal(ytdlpNeedsUpdate("2026.10.1", "2026.8.19"), false);
  assert.equal(ytdlpNeedsUpdate("", "2026.9.1"), false);
});

test("every spec this repo actually ships is one the planner can handle", () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot(), "package.json"), "utf8"));
  const specs = { ...pkg.dependencies, ...pkg.devDependencies };
  const unmanageable = Object.entries(specs).filter(([, spec]) => parseSpec(spec) === null);
  assert.deepEqual(unmanageable, [], "add a case to parseSpec for these");
});
