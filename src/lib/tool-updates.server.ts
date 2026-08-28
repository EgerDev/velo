import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  pipExternallyManaged,
  specVersion,
  toolSpec,
  toolStatus,
  TOOL_CATALOG,
  npmInstallArgs,
  pipUpgradeArgs,
  type ToolId,
  type ToolRow,
  type ToolSpec,
} from "@/lib/tool-versions";
import { pythonBin } from "@/lib/ytdlp-auth";

/**
 * Server half of the Tools tab: read what is installed, ask the registries
 * what is newest, and — for an operator — install the newer one.
 *
 * Everything spawned here is a fixed argv. The only caller-controlled input is
 * the tool id, and that is validated against `TOOL_CATALOG` before it gets
 * anywhere near a command line.
 */

const REGISTRY_TIMEOUT_MS = 8_000;
/** Registry answers are cached so the tab badge can poll without hammering npm/PyPI. */
const REGISTRY_TTL_MS = 10 * 60 * 1000;
const PIP_TIMEOUT_MS = 3 * 60 * 1000;
const NPM_TIMEOUT_MS = 5 * 60 * 1000;
/** Keep the log the panel shows bounded — npm can be chatty on failure. */
const LOG_MAX = 12_000;

const registryCache = new Map<string, { at: number; value: Promise<string | null> }>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function latestVersion(spec: ToolSpec, force: boolean): Promise<string | null> {
  const key = `${spec.kind}:${spec.pkg}`;
  const hit = registryCache.get(key);
  if (!force && hit && Date.now() - hit.at < REGISTRY_TTL_MS) return hit.value;
  const value = (async () => {
    if (spec.kind === "npm") {
      const body = await fetchJson<{ version?: string }>(
        `https://registry.npmjs.org/${encodeURIComponent(spec.pkg)}/latest`,
      );
      return body?.version ?? null;
    }
    const body = await fetchJson<{ info?: { version?: string } }>(
      `https://pypi.org/pypi/${encodeURIComponent(spec.pkg)}/json`,
    );
    return body?.info?.version ?? null;
  })();
  const entry = { at: Date.now(), value };
  registryCache.set(key, entry);
  // A miss (registry down) should be retried on the next check, not cached
  // for ten minutes as "unknown".
  void value.then((v) => {
    if (v === null) registryCache.delete(key);
  });
  return value;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The version that is actually on disk. The package.json *spec* (`^18.0.0`)
 * is a floor, not what is installed, and comparing it to the registry reports
 * "behind" forever once any patch ships.
 */
async function installedNpmVersion(spec: ToolSpec): Promise<string | null> {
  const root = process.cwd();
  const installed = await readJson(join(root, "node_modules", spec.pkg, "package.json"));
  if (typeof installed?.version === "string") return installed.version;
  const pkg = await readJson(join(root, "package.json"));
  const deps = (pkg?.dependencies ?? {}) as Record<string, string>;
  return specVersion(deps[spec.pkg]);
}

async function installedPipVersion(): Promise<{ version: string | null; note?: string }> {
  const { ensurePython } = await import("@/lib/ytdlp.server");
  try {
    const probe = await ensurePython();
    if (probe.ok) return { version: probe.version.trim() };
    return { version: null, note: probe.message };
  } catch {
    return { version: null };
  }
}

export async function toolRows(force = false): Promise<ToolRow[]> {
  return Promise.all(
    TOOL_CATALOG.map(async (spec): Promise<ToolRow> => {
      const pip = spec.kind === "pip" ? await installedPipVersion() : null;
      const [current, latest] = await Promise.all([
        pip ? pip.version : installedNpmVersion(spec),
        latestVersion(spec, force),
      ]);
      const status = toolStatus(current, latest);
      if (pip?.note && !current) status.note = pip.note;
      return {
        id: spec.id,
        label: spec.label,
        kind: spec.kind,
        role: spec.role,
        liveReload: spec.liveReload,
        current,
        latest,
        ...status,
      };
    }),
  );
}

type RunResult = { code: number; output: string; timedOut: boolean };

function runLogged(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NO_COLOR: "1", npm_config_color: "false" },
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer | string) => {
      output += String(chunk);
      if (output.length > LOG_MAX) output = output.slice(-LOG_MAX);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 137 : (code ?? 1), output, timedOut });
    });
  });
}

export type UpdateResult = {
  id: ToolId;
  ok: boolean;
  /** Version on disk after the attempt (re-read, not assumed). */
  version: string | null;
  /** True when the running server still has the old module loaded. */
  needsRestart: boolean;
  log: string;
  message: string;
};

/** One install at a time — two npm installs into one tree corrupt it. */
let inflight: Promise<UpdateResult> | null = null;

export function updateInProgress(): boolean {
  return inflight !== null;
}

export function installTool(id: ToolId): Promise<UpdateResult> {
  if (inflight) return Promise.reject(new Error("Another update is still running."));
  const work = (async () => {
    const spec = toolSpec(id);
    return spec.kind === "pip" ? installPip(spec) : installNpm(spec);
  })();
  inflight = work;
  void work.finally(() => {
    if (inflight === work) inflight = null;
  });
  return work;
}

async function installPip(spec: ToolSpec): Promise<UpdateResult> {
  const bin = pythonBin();
  const base = pipUpgradeArgs(spec.pkg);
  let result: RunResult;
  try {
    result = await runLogged(bin, base, PIP_TIMEOUT_MS);
    if (result.code !== 0 && pipExternallyManaged(result.output)) {
      const retry = await runLogged(bin, [...base, "--break-system-packages"], PIP_TIMEOUT_MS);
      result = { ...retry, output: `${result.output}\n— retrying with --break-system-packages —\n${retry.output}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: spec.id,
      ok: false,
      version: null,
      needsRestart: false,
      log: message,
      message: `Could not start ${bin}: ${message}`,
    };
  }
  // The probe pins a good version for the life of the process; drop it so the
  // next check reads the version that was just installed.
  const { resetPythonProbe } = await import("@/lib/ytdlp.server");
  resetPythonProbe();
  const after = await installedPipVersion();
  const ok = result.code === 0 && after.version !== null;
  return {
    id: spec.id,
    ok,
    version: after.version,
    needsRestart: false,
    log: result.output.trim(),
    message: ok
      ? `yt-dlp ${after.version} is installed and in use.`
      : result.timedOut
        ? "pip timed out."
        : (after.note ?? "pip exited with an error — see the log."),
  };
}

async function installNpm(spec: ToolSpec): Promise<UpdateResult> {
  const before = await installedNpmVersion(spec);
  let result: RunResult;
  try {
    result = await runLogged(
      "npm",
      npmInstallArgs(spec.pkg),
      NPM_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: spec.id, ok: false, version: before, needsRestart: false, log: message, message };
  }
  const after = await installedNpmVersion(spec);
  const ok = result.code === 0 && after !== null;
  const changed = ok && after !== before;
  return {
    id: spec.id,
    ok,
    version: after,
    needsRestart: changed,
    log: result.output.trim(),
    message: ok
      ? changed
        ? `${spec.pkg} ${after} is installed. Restart the server to load it.`
        : `${spec.pkg} ${after} was already installed.`
      : result.timedOut
        ? "npm timed out."
        : "npm exited with an error — see the log.",
  };
}
