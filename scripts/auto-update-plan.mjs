// @ts-check
/**
 * Update planning shared by `scripts/auto-update.mjs` and its tests.
 *
 * This app's download path is only as good as the libraries that reverse the
 * YouTube player — `youtubei.js`, `bgutils-js` and the `yt-dlp` Python module
 * all go stale within weeks of a player change — so the updater has to be
 * something you can actually run unattended. That means the planning has to be
 * separable from the installing: everything below is pure, so the risky part
 * (which version do we move to, and is that move in-range or a range bump?) is
 * decided and tested without touching the network or `node_modules`.
 *
 * Two rules carry most of the weight:
 *
 * - An EXACT spec is a decision, not an oversight. `jose: "6.2.9"` and
 *   `nitro: "3.0.260610-beta"` are pinned because something broke at a
 *   floating range; the planner never bumps them without `--pinned`.
 * - A name under `overrides` is pinned for the whole tree. Bumping the direct
 *   spec would leave the override silently winning, so those are skipped too.
 *
 * In-range updates (npm's `wanted`) are already permitted by specs the repo
 * committed to, so they are planned as ONE batch — eight verify cycles to land
 * eight patch bumps is the difference between a script that runs weekly and one
 * that never gets run. The driver bisects that batch only if it fails.
 */

/** Specs the planner understands. Anything else (`file:`, `git+`, `*`, `workspace:`) is left alone. */
const SIMPLE_SPEC = /^(\^|~|>=|>|<=|<|=)?(\d[^\s|]*)$/;

/**
 * Split a dependency spec into its range operator and version.
 * Returns null for specs this planner refuses to reason about.
 * @param {string} spec
 * @returns {{ prefix: string, version: string } | null}
 */
export function parseSpec(spec) {
  const match = SIMPLE_SPEC.exec(spec.trim());
  if (!match) return null;
  return { prefix: match[1] ?? "", version: match[2] };
}

/**
 * An exact spec (`6.2.9`, `=6.2.9`) is a deliberate pin — see the header.
 * @param {string} spec
 * @returns {boolean}
 */
export function isPinnedSpec(spec) {
  const parsed = parseSpec(spec);
  return parsed !== null && (parsed.prefix === "" || parsed.prefix === "=");
}

/**
 * The spec that keeps the same range operator but points at `version`.
 * Returns null when the spec is not one we can safely rewrite.
 * @param {string} spec
 * @param {string} version
 * @returns {string | null}
 */
export function bumpSpec(spec, version) {
  const parsed = parseSpec(spec);
  if (!parsed) return null;
  return `${parsed.prefix}${version}`;
}

/**
 * Compare two dotted numeric versions, ignoring any prerelease tail.
 * Enough for "is npm's `latest` actually ahead of what we have" — full semver
 * precedence is npm's job, not ours.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Which dependency block a package lives in, or null when it is neither.
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkgJson
 * @param {string} name
 * @returns {"dependencies" | "devDependencies" | null}
 */
export function dependencyBlock(pkgJson, name) {
  if (pkgJson.dependencies?.[name]) return "dependencies";
  if (pkgJson.devDependencies?.[name]) return "devDependencies";
  return null;
}

/**
 * Classify one `npm outdated` row against the spec the repo committed to.
 *
 * `skip` carries a reason so the report can explain a no-op, which is the
 * difference between "nothing to do" and "we quietly refused".
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.spec        the range in package.json
 * @param {string} [input.current]   installed version (absent when not installed)
 * @param {string} [input.wanted]    highest version the spec allows
 * @param {string} [input.latest]    highest version published
 * @param {boolean} [input.overridden] name appears under `overrides`
 * @param {boolean} [input.allowPinned]
 * @param {boolean} [input.allowRangeBump] caller passed --major
 * @returns {{ name: string, kind: "in-range" | "range-bump" | "none" | "skip", from: string, to: string, spec: string, nextSpec?: string, reason?: string }}
 */
export function classifyUpdate({
  name,
  spec,
  current,
  wanted,
  latest,
  overridden = false,
  allowPinned = false,
  allowRangeBump = false,
}) {
  const base = { name, spec, from: current ?? "", to: current ?? "" };

  if (!parseSpec(spec)) {
    return { ...base, kind: "skip", reason: `unmanageable spec "${spec}"` };
  }
  if (overridden) {
    return { ...base, kind: "skip", reason: "pinned by package.json overrides" };
  }
  if (isPinnedSpec(spec) && !allowPinned) {
    return { ...base, kind: "skip", reason: `pinned to ${spec} (use --pinned to override)` };
  }

  const ceiling = wanted ?? current;
  const outOfRange = Boolean(latest && ceiling && compareVersions(latest, ceiling) > 0);
  // An exact spec has no range to cross, so --pinned is its whole gate; moving
  // `jose: "6.2.9"` to 6.2.10 is a patch and should not also demand --major.
  const mayRewriteSpec = isPinnedSpec(spec) ? allowPinned : allowRangeBump;

  // A package can be behind BOTH inside its range and past it (spec `^18.0.0`,
  // wanted 18.4.0, latest 19.0.0). Going to `latest` subsumes the in-range hop,
  // so when --major is on it replaces that step rather than queueing after it.
  if (outOfRange && mayRewriteSpec) {
    const nextSpec = bumpSpec(spec, /** @type {string} */ (latest));
    if (!nextSpec) return { ...base, kind: "skip", reason: `cannot rewrite spec "${spec}"` };
    return { ...base, kind: "range-bump", from: current ?? ceiling ?? "", to: latest, nextSpec };
  }

  // An in-range move is one the committed spec already permits, so it needs no
  // package.json edit — `npm update` alone lands it.
  if (wanted && current && compareVersions(wanted, current) > 0) {
    return { ...base, kind: "in-range", to: wanted };
  }

  if (outOfRange) {
    return {
      ...base,
      kind: "skip",
      to: /** @type {string} */ (latest),
      reason: `${ceiling} -> ${latest} is out of range (use --major)`,
    };
  }

  return { ...base, kind: "none" };
}

/**
 * Turn a package.json plus `npm outdated --json` into an ordered plan.
 *
 * The in-range batch comes first and as a single step: those versions are ones
 * the repo's own specs already allow, so verifying them together is honest, and
 * the driver can bisect if the batch turns red.
 *
 * @param {object} pkgJson
 * @param {Record<string, { current?: string, wanted?: string, latest?: string }>} outdated
 * @param {object} [options]
 * @param {boolean} [options.major]      also plan out-of-range bumps
 * @param {boolean} [options.pinned]     also plan exact-pinned packages
 * @param {string[]} [options.only]      restrict to these package names
 * @returns {{ inRange: ReturnType<typeof classifyUpdate>[], rangeBumps: ReturnType<typeof classifyUpdate>[], skipped: ReturnType<typeof classifyUpdate>[] }}
 */
export function buildUpdatePlan(pkgJson, outdated, options = {}) {
  const { major = false, pinned = false, only } = options;
  const overrides = new Set(Object.keys(pkgJson.overrides ?? {}));
  const filter = only && only.length > 0 ? new Set(only) : null;

  const inRange = [];
  const rangeBumps = [];
  const skipped = [];

  for (const name of Object.keys(outdated).sort()) {
    if (filter && !filter.has(name)) continue;
    const block = dependencyBlock(pkgJson, name);
    // A row with no direct spec is a transitive dep; npm resolves those itself.
    if (!block) continue;

    const row = outdated[name];
    const verdict = classifyUpdate({
      name,
      spec: pkgJson[block][name],
      current: row.current,
      wanted: row.wanted,
      latest: row.latest,
      overridden: overrides.has(name),
      allowPinned: pinned,
      allowRangeBump: major,
    });

    if (verdict.kind === "in-range") inRange.push({ ...verdict, block });
    else if (verdict.kind === "range-bump") rangeBumps.push({ ...verdict, block });
    else if (verdict.kind === "skip") skipped.push({ ...verdict, block });
  }

  return { inRange, rangeBumps, skipped };
}

/**
 * yt-dlp ships date-stamped versions (`2026.08.19`) and PyPI reports them
 * zero-stripped (`2026.8.19`), so a string compare is wrong twice over: it
 * mis-orders `2026.8.19` against `2026.10.1` and calls the two spellings of the
 * same release different. Both spellings normalize to the same numbers here.
 * @param {string} installed
 * @param {string} available
 * @returns {boolean}
 */
export function ytdlpNeedsUpdate(installed, available) {
  if (!installed || !available) return false;
  return compareVersions(available, installed) > 0;
}

/**
 * Render a plan as the lines the CLI prints. Kept pure so the report itself is
 * covered by tests rather than eyeballed.
 * @param {ReturnType<typeof buildUpdatePlan>} plan
 * @returns {string[]}
 */
export function describePlan(plan) {
  const lines = [];
  for (const step of plan.inRange) lines.push(`in-range  ${step.name}  ${step.from} -> ${step.to}`);
  for (const step of plan.rangeBumps)
    lines.push(`bump      ${step.name}  ${step.spec} -> ${step.nextSpec}`);
  for (const step of plan.skipped) lines.push(`skip      ${step.name}  (${step.reason})`);
  if (lines.length === 0) lines.push("everything is current");
  return lines;
}
