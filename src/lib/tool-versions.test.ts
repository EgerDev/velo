import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anyBehind,
  compareVersions,
  isLoopbackAddress,
  operatorDecision,
  pipExternallyManaged,
  specVersion,
  toolSpec,
  toolStatus,
  TOOL_CATALOG,
  TOOL_IDS,
  npmInstallArgs,
  pipUpgradeArgs,
} from "./tool-versions.ts";

test("compareVersions handles semver, date versions and pre-releases", () => {
  assert.equal(compareVersions("18.3.1", "18.3.1"), 0);
  assert.equal(compareVersions("18.3.1", "18.10.0"), -1);
  assert.equal(compareVersions("18.10.0", "18.3.1"), 1);
  assert.equal(compareVersions("2026.08.19", "2026.08.19"), 0);
  assert.equal(compareVersions("2026.07.30", "2026.08.19"), -1);
  assert.equal(compareVersions("2026.8.19", "2026.08.19"), 0);
  assert.equal(compareVersions("1.0.0", "1.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("v4.0.3", "4.0.3"), 0);
});

test("specVersion strips range operators and rejects non-numeric specs", () => {
  assert.equal(specVersion("^18.0.0"), "18.0.0");
  assert.equal(specVersion("~1.6.30"), "1.6.30");
  assert.equal(specVersion(">=2.0.0"), "2.0.0");
  assert.equal(specVersion("6.2.9"), "6.2.9");
  assert.equal(specVersion("workspace:*"), null);
  assert.equal(specVersion(undefined), null);
});

test("toolStatus: missing, unknown, current, behind, ahead", () => {
  assert.equal(toolStatus(null, "1.0.0").status, "missing");
  assert.equal(toolStatus("1.0.0", null).status, "unknown");
  assert.equal(toolStatus("1.0.0", "1.0.0").status, "current");
  assert.equal(toolStatus("1.0.0", "1.0.1").status, "behind");
  assert.equal(toolStatus("1.0.1", "1.0.0").status, "ahead");
  assert.equal(anyBehind([{ status: "current" }, { status: "behind" }]), true);
  assert.equal(anyBehind([{ status: "current" }, { status: "unknown" }]), false);
});

test("operator gate: loopback-only in local dev, closed by default with auth, allowlist wins", () => {
  assert.equal(
    operatorDecision({ authConfigured: false, email: null, allowlist: undefined, clientIp: "127.0.0.1" }).allowed,
    false,
    "loopback without VELO_ALLOW_TOOL_INSTALL must not install — preview proxies look local",
  );
  assert.deepEqual(
    operatorDecision({
      authConfigured: false,
      email: null,
      allowlist: undefined,
      clientIp: "127.0.0.1",
      allowLocalInstall: true,
    }),
    { allowed: true },
  );
  const lan = operatorDecision({
    authConfigured: false,
    email: null,
    allowlist: undefined,
    clientIp: "192.168.1.20",
    allowLocalInstall: true,
  });
  assert.equal(lan.allowed, false);
  assert.match(lan.allowed ? "" : lan.reason, /localhost/);
  assert.equal(operatorDecision({ authConfigured: false, email: null, allowlist: undefined }).allowed, false);
  const closed = operatorDecision({ authConfigured: true, email: "a@x.io", allowlist: undefined });
  assert.equal(closed.allowed, false);
  assert.match(closed.allowed ? "" : closed.reason, /VELO_ADMIN_EMAILS/);
  const signedOut = operatorDecision({ authConfigured: true, email: null, allowlist: "a@x.io" });
  assert.equal(signedOut.allowed, false);
  const wrong = operatorDecision({ authConfigured: true, email: "b@x.io", allowlist: "a@x.io" });
  assert.equal(wrong.allowed, false);
  assert.deepEqual(operatorDecision({ authConfigured: true, email: " A@X.io ", allowlist: "a@x.io, c@y.io" }), {
    allowed: true,
  });
});

test("catalog: every id resolves and yt-dlp is the only live-reload tool", () => {
  for (const id of TOOL_IDS) assert.equal(toolSpec(id).id, id);
  assert.deepEqual(
    TOOL_CATALOG.filter((tool) => tool.liveReload).map((tool) => tool.id),
    ["yt-dlp"],
  );
  assert.throws(() => toolSpec("nope" as never), /Unknown tool/);
});

test("pip PEP 668 refusal is recognised", () => {
  assert.equal(pipExternallyManaged("error: externally-managed-environment\n\n× This environment"), true);
  assert.equal(pipExternallyManaged("ERROR: No matching distribution"), false);
});

test("install argv is a fixed list — package name cannot inject flags", () => {
  for (const spec of TOOL_CATALOG) {
    if (spec.kind === "npm") {
      assert.deepEqual(npmInstallArgs(spec.pkg), [
        "install",
        `${spec.pkg}@latest`,
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        "--save",
      ]);
    } else {
      assert.deepEqual(pipUpgradeArgs(spec.pkg), ["-m", "pip", "install", "--upgrade", "--no-input", spec.pkg]);
    }
  }
  assert.throws(() => npmInstallArgs("--save-dev"), /Invalid install package/);
  assert.throws(() => pipUpgradeArgs("--index-url=x"), /Invalid install package/);
  assert.throws(() => npmInstallArgs("evil;rm"), /Invalid install package/);
});

test("isLoopbackAddress recognises the host itself and nothing else", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "[::1]", "localhost", " ::1 "]) {
    assert.equal(isLoopbackAddress(ip), true, ip);
  }
  for (const ip of ["192.168.1.20", "10.0.0.1", "::ffff:10.0.0.1", "1270.0.0.1", "", null, undefined]) {
    assert.equal(isLoopbackAddress(ip), false, String(ip));
  }
});
