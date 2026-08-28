import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHar, isHarJson } from "./har.ts";
import { analyzeCookieFormat, parseCookieImport } from "./cookies.ts";

const HAR = {
  log: {
    version: "1.2",
    creator: { name: "Chrome", version: "128" },
    entries: [
      {
        request: {
          url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          headers: [
            { name: "Cookie", value: "SID=sidtoken; SAPISID=saptoken" },
            { name: "Referer", value: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
          ],
          cookies: [{ name: "VISITOR_INFO1_LIVE", value: "visitor", domain: ".youtube.com" }],
        },
        response: {
          headers: [{ name: "set-cookie", value: "YSC=ysctoken; Domain=.youtube.com; Path=/; Secure" }],
        },
      },
      {
        request: {
          url: "https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&itag=137&mime=video%2Fmp4&clen=12345&id=o-abc",
          queryString: [{ name: "itag", value: "137" }],
          headers: [{ name: "cookie", value: "SID=sidtoken" }],
        },
        response: { content: { mimeType: "video/mp4" } },
      },
      {
        request: {
          url: "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4&clen=999",
          headers: [],
        },
      },
    ],
  },
};

test("isHarJson detects HAR payloads", () => {
  assert.equal(isHarJson(JSON.stringify(HAR)), true);
  assert.equal(isHarJson('{"cookies":[]}'), false);
});

test("parseHar reads cookies, Set-Cookie, video ids, and googlevideo itags", () => {
  const har = parseHar(JSON.stringify(HAR));
  assert.ok(har.cookies);
  assert.ok(har.cookies.count >= 3);
  assert.match(har.cookies.header, /SID=sidtoken/);
  assert.match(har.cookies.header, /YSC=ysctoken/);
  assert.deepEqual(har.videoIds, ["jNQXAC9IVRw"]);
  assert.equal(har.playbacks.length, 2);
  assert.equal(har.playbacks[0]?.itag, 137);
  assert.equal(har.playbacks[0]?.kind, "video");
  assert.equal(har.playbacks[1]?.itag, 140);
  assert.equal(har.playbacks[1]?.kind, "audio");
  assert.ok(har.waterfall.some((row) => row.kind === "watch"));
  assert.ok(har.waterfall.some((row) => row.kind === "media" && row.itag === 137));
  assert.equal(har.headers.hasSid, true);
  assert.equal(har.headers.hasSapisid, true);
  assert.ok(har.headers.cookieNames.includes("SID"));
});

test("HAR cookies keep their real expiry instead of a session marker", () => {
  const withExpiry = {
    log: {
      entries: [
        {
          request: {
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            cookies: [
              // HAR 1.2 writes expiry as an ISO-8601 date string.
              { name: "SID", value: "sidtoken", domain: ".youtube.com", expires: "2033-05-18T03:33:19.000Z" },
            ],
            headers: [{ name: "Cookie", value: "SAPISID=saptoken" }],
          },
          response: {
            headers: [
              {
                name: "set-cookie",
                value: "LOGIN_INFO=logintoken; Domain=.youtube.com; Path=/; Secure; HttpOnly; Expires=Wed, 18 May 2033 03:33:19 GMT",
              },
            ],
          },
        },
      ],
    },
  };
  const har = parseHar(JSON.stringify(withExpiry));
  assert.ok(har.cookies);
  // Real expiry in the jar's fifth column, not the hardcoded 0 it used to write.
  assert.match(har.cookies.netscape, /^\.youtube\.com\tTRUE\t\/\tTRUE\t1999999999\tSID\tsidtoken$/m);
  // Set-Cookie flags survive too.
  assert.match(har.cookies.netscape, /^#HttpOnly_\.youtube\.com\tTRUE\t\/\tTRUE\t1999999999\tLOGIN_INFO\t/m);
  // A bare Cookie header genuinely has no recoverable expiry.
  assert.match(har.cookies.netscape, /^\.youtube\.com\tTRUE\t\/\tTRUE\t0\tSAPISID\t/m);

  // The staleness report can finally see a dead session through the HAR path.
  const stale = {
    log: {
      entries: [
        {
          request: {
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            cookies: [
              { name: "SID", value: "old", domain: ".youtube.com", expires: "2001-09-09T01:46:40.000Z" },
              { name: "SAPISID", value: "sap", domain: ".youtube.com", expires: "2033-05-18T03:33:19.000Z" },
            ],
          },
        },
      ],
    },
  };
  const report = analyzeCookieFormat(parseHar(JSON.stringify(stale)).cookies!.netscape);
  assert.deepEqual(report.expiredNames, ["SID"]);
  assert.ok(report.issues.some((issue) => /Expired: SID/.test(issue)));
});

test("a rotated cookie keeps its newest value, not the first one seen", () => {
  // YouTube rotates LOGIN_INFO while the tab stays open, so a capture can span
  // a rotation. Shipping the first sighting shipped a dead session that still
  // looked fresh.
  const rotating = {
    log: {
      entries: [
        {
          request: { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
          response: {
            headers: [
              { name: "set-cookie", value: "LOGIN_INFO=first; Domain=.youtube.com; Max-Age=63072000" },
            ],
          },
        },
        {
          request: { url: "https://www.youtube.com/youtubei/v1/player" },
          response: {
            headers: [
              { name: "set-cookie", value: "LOGIN_INFO=second; Domain=.youtube.com; Max-Age=63072000" },
            ],
          },
        },
        // A later bare Cookie header has the current value but no expiry — it
        // must not wipe the date the Set-Cookie already established.
        {
          request: {
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            headers: [{ name: "Cookie", value: "LOGIN_INFO=second" }],
          },
        },
      ],
    },
  };
  const har = parseHar(JSON.stringify(rotating));
  assert.ok(har.cookies);
  assert.match(har.cookies.header, /LOGIN_INFO=second/);
  assert.doesNotMatch(har.cookies.header, /LOGIN_INFO=first/);
  const row = har.cookies.netscape
    .split("\n")
    .find((line) => line.includes("LOGIN_INFO"));
  assert.ok(row, "expected a LOGIN_INFO row");
  const expires = Number(row!.split("\t")[4]);
  assert.ok(expires > Math.floor(Date.now() / 1000), "expiry should survive the bare Cookie header");
});

test("parseHar mines video ids only from YouTube-family URLs", () => {
  // A real youtube.com capture is full of third-party requests whose `?v=`
  // cache-busters and `/v/` asset paths look like ids. Minting ids from them
  // also mis-attributes the following googlevideo playback.
  const entry = (url: string, extra: Record<string, unknown> = {}) => ({
    request: { url, headers: [], ...extra },
    response: { status: 200, headers: [] },
  });
  const mixed = {
    log: {
      entries: [
        entry("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { queryString: [{ name: "v", value: "dQw4w9WgXcQ" }] }),
        entry("https://cdn.example.net/app/bundle.js?v=20240826abcdef", {
          queryString: [{ name: "v", value: "20240826abcdef" }],
        }),
        entry("https://static.example.org/v/abcdefghijk/x.png", { queryString: [{ name: "v", value: "abcdefghijk" }] }),
        entry("https://rr1---sn-abc.googlevideo.com/videoplayback?itag=137&mime=video%2Fmp4&clen=1000"),
      ],
    },
  };
  const har = parseHar(mixed);
  assert.deepEqual(har.videoIds, ["dQw4w9WgXcQ"]);
  assert.equal(har.playbacks.length, 1);
  assert.equal(har.playbacks[0]?.videoId, "dQw4w9WgXcQ");

  // A longer token is not a truncated id, even on youtube.com.
  const longToken = {
    log: {
      entries: [
        entry("https://www.youtube.com/s/player/base.js?v=20240826abcdef"),
        entry("https://rr1---sn-abc.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4&clen=1000"),
      ],
    },
  };
  assert.deepEqual(parseHar(longToken).videoIds, []);
});

test("parseHar attributes a playback to the most recently seen id, not the Set's last insertion", () => {
  // Watch A, then B, then back to A: A's playback belongs to A.
  const entry = (url: string) => ({ request: { url, headers: [] }, response: { status: 200, headers: [] } });
  const revisit = {
    log: {
      entries: [
        entry("https://www.youtube.com/watch?v=AAAAAAAAAAA"),
        entry("https://www.youtube.com/watch?v=BBBBBBBBBBB"),
        entry("https://www.youtube.com/watch?v=AAAAAAAAAAA"),
        entry("https://rr1---sn-abc.googlevideo.com/videoplayback?itag=137&mime=video%2Fmp4&clen=1000"),
      ],
    },
  };
  const har = parseHar(revisit);
  assert.deepEqual(har.videoIds, ["AAAAAAAAAAA", "BBBBBBBBBBB"]);
  assert.equal(har.playbacks[0]?.videoId, "AAAAAAAAAAA");
});

test("parseHar warns when cookies are redacted", () => {
  const redacted = {
    log: {
      entries: [
        {
          request: {
            url: "https://www.youtube.com/youtubei/v1/player",
            headers: [{ name: "Cookie", value: "[REDACTED]" }],
          },
        },
      ],
    },
  };
  assert.throws(() => parseHar(JSON.stringify(redacted)), /sensitive data/i);
});

test("parseCookieImport still accepts HAR JSON", () => {
  const parsed = parseCookieImport(JSON.stringify(HAR));
  assert.ok(parsed.count >= 2);
  assert.match(parsed.header, /SID=sidtoken/);
});
