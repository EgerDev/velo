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

// Throwaway self-signed pair for 127.0.0.1 (valid to 2126); test-only.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg8IcVLpRQwkUUNzzY
fYmi3f8Lbnq2aYGHg3o8MfXLhKChRANCAASeZag+7Ek+pimxf/QENX5NRgvep+OP
Ex6wPLN6YQ/GiIyW7JShdFiYe5R5a6thIuU5yHwBPbaC0fydpOLBR+PS
-----END PRIVATE KEY-----`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBkDCCATagAwIBAgIUDHcRcquSuzxAmZy7qsIQ4YHQWIowCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MDkyMjIyNTAzOVoYDzIxMjYwODI5
MjI1MDM5WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASeZag+7Ek+pimxf/QENX5NRgvep+OPEx6wPLN6YQ/GiIyW7JShdFiY
e5R5a6thIuU5yHwBPbaC0fydpOLBR+PSo2QwYjAdBgNVHQ4EFgQUpcM9zPxcvhk1
HTvJ7bfkkVUpWaYwHwYDVR0jBBgwFoAUpcM9zPxcvhk1HTvJ7bfkkVUpWaYwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0gAMEUC
IQD+gV34oOMXmlMBqdKIFAylubBppuIPSxhocsnln1sHAwIgCPKgr79CTkK6Q3OW
Z0vZsMEeSCV7eHHOjgqs2pfEw1Q=
-----END CERTIFICATE-----`;

test("built-in fetch keeps response headers over TLS once the app dispatcher is installed", async () => {
  // undici 8.11 made HTTP/2 the default; over h2 Node's bundled fetch got a
  // response with no headers, so gzip stayed encoded and youtubei.js failed
  // every lookup with "Failed to get player id". Needs TLS + h2 to reproduce.
  const { createSecureServer } = await import("node:http2");
  const { gzipSync } = await import("node:zlib");
  pinIpv4();
  const body = "var scriptUrl = 'https://www.youtube.com/s/player/abc123/www-widgetapi.js';";
  const server = createSecureServer({ key: TEST_KEY, cert: TEST_CERT, allowHTTP1: true }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/javascript", "content-encoding": "gzip" });
    res.end(gzipSync(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prior = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`https://127.0.0.1:${port}/iframe_api`);
    assert.equal(res.headers.get("content-encoding"), "gzip");
    assert.equal(await res.text(), body);
  } finally {
    if (prior === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prior;
    server.close();
  }
});
