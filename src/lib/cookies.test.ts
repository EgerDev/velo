import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCookieFormat, cookieExpiryToUnix, parseCookieImport } from "./cookies.ts";
import { classifyDownloadError } from "./download-error.ts";

test("cookieExpiryToUnix normalises epochs, ms, and date strings", () => {
  assert.equal(cookieExpiryToUnix(1999999999), 1999999999);
  assert.equal(cookieExpiryToUnix(1999999999000), 1999999999);
  assert.equal(cookieExpiryToUnix("1999999999"), 1999999999);
  // HAR 1.2 writes an ISO-8601 date; Set-Cookie writes an HTTP-date. Reading
  // only numbers silently dropped both.
  assert.equal(cookieExpiryToUnix("2033-05-18T03:33:19.000Z"), 1999999999);
  assert.equal(cookieExpiryToUnix("Wed, 18 May 2033 03:33:19 GMT"), 1999999999);
  assert.equal(cookieExpiryToUnix("not a date"), undefined);
  assert.equal(cookieExpiryToUnix(0), undefined);
  assert.equal(cookieExpiryToUnix(undefined), undefined);
});

test("a bare Cookie paste lands on .youtube.com, mirroring account cookies", () => {
  // yt-dlp reads the jar scoped to www.youtube.com; parking SID on .google.com
  // alone made the session invisible to the YouTube extractor.
  const parsed = parseCookieImport("SID=abc; SAPISID=xyz; LOGIN_INFO=AFmmF2sw:token");
  assert.match(parsed.netscape, /^\.youtube\.com\tTRUE\t\/\tTRUE\t0\tSID\tabc$/m);
  assert.match(parsed.netscape, /^\.google\.com\tTRUE\t\/\tTRUE\t0\tSID\tabc$/m);
  assert.match(parsed.netscape, /^\.youtube\.com\tTRUE\t\/\tTRUE\t0\tLOGIN_INFO\t/m);
  // LOGIN_INFO is YouTube-only — no .google.com mirror.
  assert.doesNotMatch(parsed.netscape, /^\.google\.com\t.*LOGIN_INFO/m);
  // The mirror is the same credential, so the reported count stays honest.
  assert.equal(parsed.count, 3);
});

test("the reported cookie count survives a round trip through the jar", () => {
  // The vault re-parses the netscape it just saved, so a count that grew on
  // re-parse showed the user "Imported 7 cookies" for the 4 they pasted.
  const first = parseCookieImport("SID=abc; HSID=def; SAPISID=xyz; LOGIN_INFO=tok");
  assert.equal(first.count, 4);
  const second = parseCookieImport(first.netscape);
  assert.equal(second.count, 4);
  assert.equal(parseCookieImport(second.netscape).count, 4);
  // The jar still carries both domains for the account cookies.
  assert.match(second.netscape, /^\.google\.com\t.*\tSID\tabc$/m);
  assert.match(second.netscape, /^\.youtube\.com\t.*\tSID\tabc$/m);
});

test("parses Netscape YouTube cookies and ignores others", () => {
  const raw = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc",
    ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tHSID\tdef",
    ".example.com\tTRUE\t/\tFALSE\t1999999999\tfoo\tbar",
  ].join("\n");
  const parsed = parseCookieImport(raw);
  assert.equal(parsed.count, 2);
  assert.match(parsed.header, /SID=abc/);
  assert.match(parsed.netscape, /SID\tabc/);
  assert.doesNotMatch(parsed.netscape, /example.com/);
});

test("parses JSON cookie exports", () => {
  const json = JSON.stringify([
    { domain: ".youtube.com", name: "SID", value: "abc" },
    { domain: ".evil.com", name: "SID", value: "nope" },
  ]);
  const parsed = parseCookieImport(json);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.header, "SID=abc");
});

test("rejects empty or unrelated paste", () => {
  assert.throws(() => parseCookieImport(""));
  assert.throws(() => parseCookieImport("hello world"));
});

test("parses Cookie headers, cURL, and HAR session dumps", () => {
  const header = parseCookieImport("SID=abc; SAPISID=xyz; LOGIN_INFO=AFmmF2sw:token");
  assert.equal(header.count, 3);
  const curl = parseCookieImport(`curl 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' -H 'cookie: SID=abc; SAPISID=xyz'`);
  assert.match(curl.header, /SID=abc/);
  const har = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            headers: [{ name: "Cookie", value: "SID=abc; SAPISID=xyz" }],
          },
        },
      ],
    },
  });
  assert.match(parseCookieImport(har).header, /SAPISID=xyz/);
});

test("classifies blocked and bot download failures", () => {
  assert.equal(classifyDownloadError(new Error("HTTP 403 Forbidden")).code, "blocked");
  assert.equal(classifyDownloadError(new Error("Sign in to confirm you’re not a bot")).code, "bot");
  assert.equal(
    classifyDownloadError(new Error("HTTP 403 · Sign in to confirm you’re not a bot")).code,
    "bot",
  );
  assert.equal(classifyDownloadError(new Error("Sign in to use a YouTube session. Guest downloads stay unlocked.")).code, "bot");
  assert.equal(classifyDownloadError(new Error("Server timed out")).code, "timeout");
  assert.equal(
    classifyDownloadError(new Error("Guest download cap reached (about 12 files every 10 minutes)")).code,
    "rate",
  );
  assert.equal(classifyDownloadError(new Error("HTTP 429 Too Many Requests")).code, "rate");
  assert.equal(classifyDownloadError(new Error("Builder 503"), [], { status: 503 }).code, "queue");
  assert.equal(classifyDownloadError(new Error("Lots of people are saving right now.")).code, "queue");
  assert.equal(classifyDownloadError(new Error("All yt-dlp clients failed.")).code, "queue");
});

test("parses HttpOnly Netscape lines and Cookie-Editor host field", () => {
  const netscape = [
    "# Netscape HTTP Cookie File",
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc",
  ].join("\n");
  assert.equal(parseCookieImport(netscape).count, 1);
  const json = JSON.stringify([{ host: ".youtube.com", name: "SID", value: "z", path: "/", secure: true }]);
  assert.equal(parseCookieImport(json).header, "SID=z");
});

test("parses Chrome DevTools cookie table paste", () => {
  const table = [
    "Name\tValue\tDomain\tPath\tHttpOnly\tSecure",
    "SID\tdevsid\t.youtube.com\t/\t✓\t✓",
    "SAPISID\tdevsap\t.youtube.com\t/\t\t✓",
    "other\tx\t.example.com\t/\t\t",
  ].join("\n");
  const parsed = parseCookieImport(table);
  assert.ok(parsed.count >= 2);
  assert.match(parsed.header, /SID=devsid/);
  assert.match(parsed.header, /SAPISID=devsap/);
});

test("rewrites Cookie-Editor JSON to yt-dlp Netscape with HttpOnly", () => {
  const json = JSON.stringify([
    {
      domain: ".youtube.com",
      name: "SID",
      value: "sid",
      path: "/",
      secure: true,
      httpOnly: true,
      expirationDate: 1999999999,
    },
    { domain: ".youtube.com", name: "SAPISID", value: "sap", httpOnly: false, secure: true },
  ]);
  const parsed = parseCookieImport(json);
  assert.match(parsed.netscape, /^# Netscape HTTP Cookie File/m);
  assert.match(parsed.netscape, /#HttpOnly_\.youtube.com/);
  assert.match(parsed.netscape, /\tSID\tsid/);
  assert.doesNotMatch(parsed.netscape, /\r\n/);
  const report = analyzeCookieFormat(json);
  assert.equal(report.format, "json");
  assert.equal(report.hasSid, true);
  assert.equal(report.hasSapisid, true);
  assert.ok(report.httpOnly >= 1);
});

test("normalizes CRLF Netscape for yt-dlp", () => {
  const raw = "# Netscape HTTP Cookie File\r\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\r\n";
  const parsed = parseCookieImport(raw);
  assert.doesNotMatch(parsed.netscape, /\r/);
  const report = analyzeCookieFormat(raw);
  assert.equal(report.format, "netscape");
  assert.ok(report.issues.some((issue) => /CRLF/i.test(issue)));
});

test("flags expired SID and keeps a future SID", () => {
  const expired = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1000000000\tSID\told",
    ".youtube.com\tTRUE\t/\tTRUE\t2000000000\tSAPISID\tsap",
  ].join("\n");
  const report = analyzeCookieFormat(expired, 1_700_000_000_000);
  assert.equal(report.hasSid, true);
  assert.ok(report.expiredNames.includes("SID"));
  assert.ok(report.issues.some((issue) => /Expired/i.test(issue)));

  const live = parseCookieImport(
    JSON.stringify([{ domain: ".youtube.com", name: "SID", value: "x", expirationDate: 1999999999, httpOnly: true }]),
  );
  const liveReport = analyzeCookieFormat(live.netscape, 1_700_000_000_000);
  assert.equal(liveReport.expiredNames.includes("SID"), false);
  assert.ok((liveReport.sidExpiresAt ?? 0) > 1_700_000_000);
});
