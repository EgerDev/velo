import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHar, isHarJson } from "./har.ts";
import { parseCookieImport } from "./cookies.ts";

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
