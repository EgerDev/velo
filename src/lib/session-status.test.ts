import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSessionStatus } from "./session-status.ts";

const NOW = 1_700_000_000_000;
const secs = (ms: number) => Math.floor(ms / 1000);

function jar(rows: Array<{ name: string; expires: number }>): string {
  return [
    "# Netscape HTTP Cookie File",
    ...rows.map((row) => `.youtube.com\tTRUE\t/\tTRUE\t${row.expires}\t${row.name}\tvalue`),
  ].join("\n");
}

test("no cookies reads as no session, not a broken one", () => {
  const status = describeSessionStatus("", NOW);
  assert.equal(status.level, "none");
  assert.equal(status.count, 0);
  assert.match(status.detail, /No YouTube cookies saved/);
});

test("a healthy jar is ready and names its expiry", () => {
  const future = secs(NOW) + 90 * 24 * 60 * 60;
  const status = describeSessionStatus(
    jar([
      { name: "SID", expires: future },
      { name: "SAPISID", expires: future },
      { name: "LOGIN_INFO", expires: future },
    ]),
    NOW,
  );
  assert.equal(status.level, "ready");
  assert.equal(status.count, 3);
});

test("an expired SID is reported as expired, not ready", () => {
  const past = secs(NOW) - 60;
  const future = secs(NOW) + 90 * 24 * 60 * 60;
  const status = describeSessionStatus(
    jar([
      { name: "SID", expires: past },
      { name: "SAPISID", expires: future },
    ]),
    NOW,
  );
  assert.equal(status.level, "expired");
  assert.match(status.detail, /SID/);
  assert.match(status.detail, /Re-export/);
});

test("a SID about to lapse warns while it still works", () => {
  // The whole point of reading expiry: warn before the download fails.
  const soon = secs(NOW) + 2 * 24 * 60 * 60;
  const status = describeSessionStatus(
    jar([
      { name: "SID", expires: soon },
      { name: "SAPISID", expires: soon },
    ]),
    NOW,
  );
  assert.equal(status.level, "expiring");
  assert.match(status.label, /Session ends in 2 days/);
});

test("account cookies missing entirely is called incomplete", () => {
  const future = secs(NOW) + 90 * 24 * 60 * 60;
  const status = describeSessionStatus(jar([{ name: "VISITOR_INFO1_LIVE", expires: future }]), NOW);
  assert.equal(status.level, "unusable");
  assert.match(status.detail, /signed out/);
});

test("unparseable text is unreadable rather than silently empty", () => {
  const status = describeSessionStatus("this is not a cookie export", NOW);
  assert.equal(status.level, "unusable");
  assert.equal(status.count, 0);
});
