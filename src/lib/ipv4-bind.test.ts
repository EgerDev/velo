import assert from "node:assert/strict";
import { test } from "node:test";
import dns from "node:dns";
import net from "node:net";
import { IPV4_BIND, pinIpv4, isUlaAddress, diagnoseIpv6, ipv6Hint } from "./ipv4-bind.server.ts";
import { downloadHint } from "./download-error.ts";
import { normalizeSocksUrl } from "./socks-pool.server.ts";
import { ytdlpArgv, ytdlpFamilyArgs } from "./ytdlp-auth.ts";
import { IPV6_TROUBLESHOOT } from "./youtube.ts";

test("IPv4 is preferred so player and CDN see the same family", () => {
  assert.equal(IPV4_BIND, "ipv4first");
  pinIpv4();
  assert.equal(net.getDefaultAutoSelectFamily(), false);
  assert.equal(dns.getDefaultResultOrder(), "ipv4first");
});

test("guest 403 hint points at the matching hop, not cookies first", () => {
  const hint = downloadHint("blocked", true);
  assert.match(hint, /matching hop/i);
  assert.doesNotMatch(hint, /cookies\.txt/i);
  assert.match(ipv6Hint(), /matching hop/i);
});

test("SOCKS URLs resolve DNS on the hop (socks5h)", () => {
  const url = normalizeSocksUrl("socks5://203.0.113.9:1080");
  assert.equal(url, "socks5h://203.0.113.9:1080");
});

test("direct hops pin IPv4; SOCKS hops omit --force-ipv4 and keep socks5h", () => {
  const direct = ytdlpArgv({ dir: "/tmp/x", id: "jNQXAC9IVRw", itag: 18, client: "web_embedded" });
  assert.ok(direct.includes("--force-ipv4"));
  assert.equal(direct.includes("--proxy"), false);
  assert.deepEqual(ytdlpFamilyArgs(), ["--force-ipv4"]);

  const proxied = ytdlpArgv({
    dir: "/tmp/x",
    id: "jNQXAC9IVRw",
    itag: 18,
    client: "android",
    proxy: "socks5://203.0.113.9:1080",
  });
  assert.equal(proxied.includes("--force-ipv4"), false);
  assert.equal(proxied[proxied.indexOf("--proxy") + 1], "socks5h://203.0.113.9:1080");
});

test("ULA playback ip is a mismatch; IPv4 is not", () => {
  assert.equal(isUlaAddress("fda3:9b4d:1::aa"), true);
  assert.equal(isUlaAddress("203.0.113.9"), false);
  const diag = diagnoseIpv6({
    playbackUrl: "https://r1.googlevideo.com/videoplayback?ip=fda3:9b4d:1::aa&itag=18",
  });
  assert.equal(diag.mismatchRisk, true);
  assert.match(diag.hint ?? "", /matching hop/i);
  assert.equal(IPV6_TROUBLESHOOT.length, 3);
});
