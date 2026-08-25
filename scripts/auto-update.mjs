#!/usr/bin/env node
// @ts-check
/**
 * Dependency updater with rollback — `npm run update:deps`.
 *
 * The download path here is built on libraries that reverse a moving target:
 * `youtubei.js` and `bgutils-js` track the YouTube player, and the `yt-dlp`
 * Python module ships roughly monthly because YouTube keeps breaking it. Left
 * alone they go stale in weeks and extraction starts failing for reasons that
 * look like bugs in this repo. So this exists to be run unattended.
 *
 * The contract that makes it safe to run unattended is that NOTHING lands
 * unverified. Every install is followed by `typecheck` + `test` + `lint`, and
 * anything that fails is rolled back to the exact bytes of `package.json` and
 * `package-lock.json` that were on disk before the attempt. A red tree is never
 * an outcome of running this.
 *
 * Ordering is deliberate:
 *
 *   1. In-range updates land as ONE batch and verify once. These are versions
 *      the committed specs already allow, so batching is honest — and it is the
 *      difference between one verify cycle and eight. If the batch fails, it is
 *      bisected package-by-package so one bad release does not block the rest.
 *   2. Range bumps (`--major`) go one at a time. Each rewrites a spec, so each
 *      needs its own verdict.
 *   3. yt-dlp last, and separately: it is a Python package, its failure mode is
 *      independent, and its rollback is a pip install of the prior version.
 *
 * Planning is pure and lives in `auto-update-plan.mjs` (tested there). This file
 * is only the part that touches the network and the filesystem.
 *
 * Flags:
 *   --check        report only, exit 1 if anything is out of date (for CI)
 *   --dry-run      report what would happen, change nothing
 *   --major        also cross spec ceilings (rewrites package.json ranges)
 *   --pinned       also move exact-pinned specs (they are pinned on purpose)
 *   --only=a,b     restrict to these package names
 *   --skip-tests   verify with typecheck + lint only (faster, weaker)
 *   --skip-ytdlp   leave the Python side alone
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildUpdatePlan, describePlan, ytdlpNeedsUpdate } from "./auto-update-plan.mjs";
import { projectRoot } from "./with-app-env.mjs";

const ROOT = projectRoot();
const PKG_PATH = join(ROOT, "package.json");
const LOCK_PATH = join(ROOT, "package-lock.json");

/** Keep captured child output bounded — a failing test run can emit megabytes. */
const MAX_CAPTURE = 64 * 1024;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const options = {
  check: flag("check"),
  dryRun: flag("dry-run"),
  major: flag("major"),
  pinned: flag("pinned"),
  only: (value("only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  skipTests: flag("skip-tests"),
  skipYtdlp: flag("skip-ytdlp"),
};

/**
 * Run a command to completion, capturing a bounded tail of its output.
 *
 * `spawn` rather than `exec` on purpose: `exec` buffers everything and throws
 * ENOBUFS past its 1 MB default, which would turn a *passing* test run into a
 * spurious "tests failed" and a needless rollback.
 *
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, code: number | null, output: string }>}
 */
function run(cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let truncated = false;
    const capture = (chunk) => {
      if (output.length >= MAX_CAPTURE) {
        truncated = true;
        return;
      }
      output += chunk.toString();
      if (!opts.quiet) process.stdout.write(chunk);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (err) => resolve({ ok: false, code: null, output: String(err) }));
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        code,
        output: truncated ? `${output}\n…(output truncated)` : output,
      }),
    );
  });
}

const npm = (argv, opts) => run("npm", [...argv, "--no-audit", "--no-fund"], opts);

/** The bytes of package.json and package-lock.json, to restore verbatim on failure. */
function snapshot() {
  return {
    pkg: readFileSync(PKG_PATH, "utf8"),
    lock: existsSync(LOCK_PATH) ? readFileSync(LOCK_PATH, "utf8") : null,
  };
}

/**
 * Put the manifests back and reconcile node_modules to them.
 *
 * `npm install` and not `npm ci`: ci deletes node_modules first, so a network
 * blip during a rollback would leave no tree at all. install converges to the
 * restored lock without that window.
 * @param {ReturnType<typeof snapshot>} snap
 */
async function restore(snap) {
  writeFileSync(PKG_PATH, snap.pkg);
  if (snap.lock !== null) writeFileSync(LOCK_PATH, snap.lock);
  const result = await npm(["install", "--silent"], { quiet: true });
  if (!result.ok) {
    console.error("\n!! rollback reinstall failed — node_modules may not match package.json.");
    console.error("   Recover with: npm ci");
    console.error(result.output);
  }
  return result.ok;
}

/**
 * Typecheck, test and lint the tree as it stands.
 * @returns {Promise<{ ok: boolean, failed?: string, output?: string }>}
 */
async function verify() {
  const steps = [
    ["typecheck", ["run", "typecheck"]],
    ...(options.skipTests ? [] : [["test", ["run", "test"]]]),
    ["lint", ["run", "lint"]],
  ];
  for (const [label, argv] of steps) {
    process.stdout.write(`   verifying: ${label}… `);
    const result = await npm(/** @type {string[]} */ (argv), { quiet: true });
    console.log(result.ok ? "ok" : "FAILED");
    if (!result.ok) return { ok: false, failed: label, output: result.output };
  }
  return { ok: true };
}

/** `npm outdated` exits non-zero precisely when there is something to report. */
async function readOutdated() {
  const result = await npm(["outdated", "--json"], { quiet: true });
  const text = result.output.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    console.error("could not parse `npm outdated --json`:");
    console.error(text.slice(0, 2000));
    return {};
  }
}

/**
 * Install a set of packages, verify, and roll back as a unit if verification
 * fails. Returns whether the change was kept.
 * @param {string} label
 * @param {() => Promise<boolean>} install  applies the change; false aborts
 * @returns {Promise<{ kept: boolean, failed?: string, output?: string }>}
 */
async function attempt(label, install) {
  const snap = snapshot();
  console.log(`\n-> ${label}`);
  if (!(await install())) {
    await restore(snap);
    return { kept: false, failed: "install" };
  }
  const verdict = await verify();
  if (verdict.ok) {
    console.log(`   kept: ${label}`);
    return { kept: true };
  }
  console.log(`   rolling back (${verdict.failed} failed)`);
  await restore(snap);
  return { kept: false, failed: verdict.failed, output: verdict.output };
}

/**
 * Rewrite one dependency spec in package.json, preserving the file's formatting
 * by editing the parsed object and re-serializing with the same 2-space indent
 * npm itself writes.
 * @param {string} block
 * @param {string} name
 * @param {string} spec
 */
function writeSpec(block, name, spec) {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  pkg[block][name] = spec;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

/** Installed yt-dlp version, or null when the module is not importable. */
async function ytdlpInstalled() {
  const result = await run("python3", ["-m", "yt_dlp", "--version"], { quiet: true });
  return result.ok ? result.output.trim().split("\n").pop()?.trim() || null : null;
}

/** Latest yt-dlp on PyPI, or null when the registry is unreachable. */
async function ytdlpLatest() {
  try {
    const res = await fetch("https://pypi.org/pypi/yt-dlp/json", {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.info?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the Python side. Kept apart from the npm plan: different registry,
 * different failure mode, and a rollback that is just an install of the pinned
 * prior version.
 * @returns {Promise<string>} one report line
 */
async function updateYtdlp() {
  const installed = await ytdlpInstalled();
  if (!installed) {
    return "yt-dlp: not importable via `python3 -m yt_dlp` — skipped (pip install yt-dlp)";
  }
  const latest = await ytdlpLatest();
  if (!latest) return `yt-dlp: ${installed} (PyPI unreachable — left alone)`;
  if (!ytdlpNeedsUpdate(installed, latest)) return `yt-dlp: ${installed} is current`;

  console.log(`\n-> yt-dlp ${installed} -> ${latest}`);
  if (options.dryRun || options.check) return `yt-dlp: ${installed} -> ${latest} available`;

  const install = await run(
    "python3",
    ["-m", "pip", "install", "--user", "--upgrade", `yt-dlp==${latest}`],
    { quiet: true },
  );
  if (!install.ok) {
    return `yt-dlp: ${installed} — pip install failed, left alone (${install.output.trim().split("\n").pop()})`;
  }

  // The only verification that matters is that the extractor still starts.
  const after = await ytdlpInstalled();
  if (!after) {
    console.log("   yt-dlp no longer importable — reverting");
    await run("python3", ["-m", "pip", "install", "--user", `yt-dlp==${installed}`], {
      quiet: true,
    });
    return `yt-dlp: ${latest} broke \`python3 -m yt_dlp\` — reverted to ${installed}`;
  }
  console.log(`   kept: yt-dlp ${after}`);
  return `yt-dlp: ${installed} -> ${after}`;
}

async function main() {
  console.log(
    `Velo dependency update${options.dryRun ? " (dry run)" : ""}${options.check ? " (check only)" : ""}\n`,
  );

  const pkgJson = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const outdated = await readOutdated();
  const plan = buildUpdatePlan(pkgJson, outdated, options);

  for (const line of describePlan(plan)) console.log(`  ${line}`);

  const report = [];
  const pending = plan.inRange.length + plan.rangeBumps.length;

  if (options.check || options.dryRun) {
    if (!options.skipYtdlp) console.log(`\n  ${await updateYtdlp()}`);
    // --check is for CI: "there is work to do" is the failing condition.
    process.exit(options.check && pending > 0 ? 1 : 0);
  }

  if (plan.inRange.length > 0) {
    const names = plan.inRange.map((s) => s.name);
    const batch = await attempt(
      `in-range batch: ${names.join(", ")}`,
      async () => (await npm(["update", ...names], { quiet: true })).ok,
    );
    if (batch.kept) {
      for (const step of plan.inRange)
        report.push(`updated  ${step.name} ${step.from} -> ${step.to}`);
    } else {
      // One bad release must not hold back the rest, so find it by retrying
      // each package on its own against the restored tree.
      console.log("   batch failed — bisecting package by package");
      for (const step of plan.inRange) {
        const one = await attempt(
          `${step.name} ${step.from} -> ${step.to}`,
          async () => (await npm(["update", step.name], { quiet: true })).ok,
        );
        report.push(
          one.kept
            ? `updated  ${step.name} ${step.from} -> ${step.to}`
            : `HELD     ${step.name} ${step.from} -> ${step.to} (${one.failed} failed)`,
        );
      }
    }
  }

  for (const step of plan.rangeBumps) {
    const one = await attempt(`${step.name} ${step.spec} -> ${step.nextSpec}`, async () => {
      writeSpec(step.block, step.name, /** @type {string} */ (step.nextSpec));
      return (await npm(["install"], { quiet: true })).ok;
    });
    report.push(
      one.kept
        ? `updated  ${step.name} ${step.from} -> ${step.to} (spec ${step.nextSpec})`
        : `HELD     ${step.name} ${step.spec} -> ${step.nextSpec} (${one.failed} failed)`,
    );
  }

  for (const step of plan.skipped) report.push(`skipped  ${step.name} (${step.reason})`);
  if (!options.skipYtdlp) report.push(await updateYtdlp());

  console.log("\nsummary");
  for (const line of report) console.log(`  ${line}`);
  if (report.length === 0) console.log("  nothing to do");

  const held = report.filter((line) => line.startsWith("HELD")).length;
  if (held > 0) {
    console.log(`\n${held} update(s) held back — the tree is green and unchanged for those.`);
  }
}

main().catch((err) => {
  console.error("auto-update failed:", err);
  process.exit(1);
});
