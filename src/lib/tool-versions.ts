/**
 * The moving parts of the extraction ladder and how to tell whether they are
 * stale. Pure — no node or network imports — so the panel, the server function
 * and the tests all share one definition of "behind".
 *
 * Why these three: `youtubei.js` and `bgutils-js` track the YouTube player and
 * BotGuard; the `yt-dlp` Python module ships roughly monthly because YouTube
 * keeps breaking it. Left alone they go stale in weeks and extraction starts
 * failing for reasons that look like bugs in this repo.
 */

export type ToolKind = "npm" | "pip";

export type ToolSpec = {
  id: ToolId;
  label: string;
  kind: ToolKind;
  /** Registry package name. */
  pkg: string;
  /** One line on what breaks when it is stale. */
  role: string;
  /** Whether a fresh install is picked up without restarting the server. */
  liveReload: boolean;
};

export type ToolId = "youtubei.js" | "bgutils-js" | "yt-dlp";

export const TOOL_CATALOG: readonly ToolSpec[] = [
  {
    id: "youtubei.js",
    label: "youtubei.js",
    kind: "npm",
    pkg: "youtubei.js",
    role: "InnerTube client — metadata, formats, player deciphering.",
    liveReload: false,
  },
  {
    id: "bgutils-js",
    label: "bgutils-js",
    kind: "npm",
    pkg: "bgutils-js",
    role: "BotGuard / PO-token minting for web clients.",
    liveReload: false,
  },
  {
    id: "yt-dlp",
    label: "yt-dlp",
    kind: "pip",
    pkg: "yt-dlp",
    role: "Fallback extractor — runs as a subprocess, so a new version is used immediately.",
    liveReload: true,
  },
];

export const TOOL_IDS = TOOL_CATALOG.map((tool) => tool.id) as [ToolId, ...ToolId[]];

function assertInstallPkg(pkg: string): string {
  if (!pkg || pkg.startsWith("-") || !/^[a-zA-Z0-9@/._-]+$/.test(pkg)) {
    throw new Error(`Invalid install package: ${pkg}`);
  }
  return pkg;
}

export function npmInstallArgs(pkg: string): string[] {
  return ["install", `${assertInstallPkg(pkg)}@latest`, "--no-audit", "--no-fund", "--loglevel=error", "--save"];
}

export function pipUpgradeArgs(pkg: string): string[] {
  return ["-m", "pip", "install", "--upgrade", "--no-input", assertInstallPkg(pkg)];
}

export function toolSpec(id: ToolId): ToolSpec {
  const spec = TOOL_CATALOG.find((tool) => tool.id === id);
  if (!spec) throw new Error(`Unknown tool: ${id}`);
  return spec;
}

export type ToolStatus = "current" | "behind" | "ahead" | "unknown" | "missing";

export type ToolRow = {
  id: ToolId;
  label: string;
  kind: ToolKind;
  role: string;
  liveReload: boolean;
  /** Installed version, or null when not installed / unreadable. */
  current: string | null;
  /** Newest on the registry, or null when the registry was unreachable. */
  latest: string | null;
  status: ToolStatus;
  note: string;
};

/**
 * Compare two dotted version strings numerically, segment by segment.
 * Handles yt-dlp's date versions (`2026.08.19`), npm semver (`18.3.1`) and a
 * pre-release suffix (`1.0.0-beta.2` sorts before `1.0.0`). Returns -1/0/1.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMain, aPre] = splitPre(a);
  const [bMain, bPre] = splitPre(b);
  const as = aMain.split(".").map(numeric);
  const bs = bMain.split(".").map(numeric);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const x = as[i] ?? 0;
    const y = bs[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (aPre === bPre) return 0;
  // A release outranks its own pre-release; two pre-releases compare as text.
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre < bPre ? -1 : 1;
}

function splitPre(version: string): [string, string] {
  const trimmed = version.trim().replace(/^v/i, "");
  const idx = trimmed.search(/[-+]/);
  return idx === -1 ? [trimmed, ""] : [trimmed.slice(0, idx), trimmed.slice(idx + 1)];
}

function numeric(segment: string): number {
  const n = Number.parseInt(segment, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Strip the range operator off a package.json spec (`^18.0.0` → `18.0.0`). */
export function specVersion(spec: string | undefined | null): string | null {
  if (!spec) return null;
  const cleaned = spec.trim().replace(/^[~^>=<\s]+/, "");
  return /^\d/.test(cleaned) ? cleaned : null;
}

export function toolStatus(
  current: string | null,
  latest: string | null,
): Pick<ToolRow, "status" | "note"> {
  if (!current) return { status: "missing", note: "Not installed on this host." };
  if (!latest) return { status: "unknown", note: "Could not reach the registry from this host." };
  const cmp = compareVersions(current, latest);
  if (cmp === 0) return { status: "current", note: "Up to date." };
  if (cmp > 0) return { status: "ahead", note: "Newer than the registry's latest tag." };
  return { status: "behind", note: `${latest} is available.` };
}

export function anyBehind(rows: readonly Pick<ToolRow, "status">[]): boolean {
  return rows.some((row) => row.status === "behind");
}

/**
 * Who may install updates from the Tools tab.
 *
 * Installing rewrites `node_modules` / site-packages on the host, so it is an
 * operator action, never a user one:
 *
 *   auth not configured        off, unless VELO_ALLOW_TOOL_INSTALL=1 *and* the
 *                              socket is loopback. Loopback alone is not
 *                              enough: a same-host preview proxy makes every
 *                              visitor look like 127.0.0.1.
 *   VELO_ADMIN_EMAILS=a,b      only these signed-in addresses.
 *   (unset, auth configured)   nobody. Updates still show; installing is off
 *                              until the operator names themselves.
 */
export type OperatorDecision = { allowed: true } | { allowed: false; reason: string };

export function operatorDecision(input: {
  authConfigured: boolean;
  email: string | null | undefined;
  allowlist: string | undefined;
  /** Socket address of the caller; only consulted when auth is off. */
  clientIp?: string | null;
  /** Explicit opt-in for auth-off localhost installs. */
  allowLocalInstall?: boolean;
}): OperatorDecision {
  if (!input.authConfigured) {
    if (input.allowLocalInstall && isLoopbackAddress(input.clientIp)) return { allowed: true };
    return {
      allowed: false,
      reason: input.allowLocalInstall
        ? "With sign-in off, installs are only allowed from this machine (localhost)."
        : "Installing is off. Set VELO_ALLOW_TOOL_INSTALL=1 to allow localhost installs when sign-in is off.",
    };
  }
  const allowlist = (input.allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) {
    return {
      allowed: false,
      reason: "Installing is off. Set VELO_ADMIN_EMAILS to the operator's address to turn it on.",
    };
  }
  const email = input.email?.trim().toLowerCase();
  if (!email) return { allowed: false, reason: "Sign in as an operator to install updates." };
  if (!allowlist.includes(email)) {
    return { allowed: false, reason: "Only operators listed in VELO_ADMIN_EMAILS can install updates." };
  }
  return { allowed: true };
}

/**
 * pip on Homebrew / Debian Python refuses to touch system site-packages
 * (PEP 668). yt-dlp is exactly the kind of leaf CLI package that override is
 * meant for, so retry once with the flag rather than asking the operator to
 * open a shell.
 */
export function pipExternallyManaged(stderr: string): boolean {
  return /externally[- ]managed[- ]environment/i.test(stderr);
}

/** 127.0.0.0/8, ::1, and their IPv4-mapped forms — the host itself. */
export function isLoopbackAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith("[")) addr = addr.slice(1, addr.indexOf("]"));
  if (addr.startsWith("::ffff:")) addr = addr.slice("::ffff:".length);
  if (addr === "::1" || addr === "localhost") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}
