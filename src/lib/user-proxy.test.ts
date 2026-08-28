import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maskProxyDisplay,
  normalizeUserProxy,
  proxyUrlExists,
  redactProxyUrl,
} from "./user-proxy-parse.ts";

test("bare IP:PORT follows the protocol selector", () => {
  assert.deepEqual(normalizeUserProxy("203.0.113.9:8080", "http"), {
    url: "http://203.0.113.9:8080",
    display: "203.0.113.9:8080",
  });
  assert.deepEqual(normalizeUserProxy("203.0.113.9:1080", "socks5"), {
    url: "socks5://203.0.113.9:1080",
    display: "203.0.113.9:1080",
  });
});

test("user:pass@IP:PORT keeps credentials in the url, not the display", () => {
  const parsed = normalizeUserProxy("alice:s3cret@203.0.113.9:8080", "http");
  assert.equal(parsed?.url, "http://alice:s3cret@203.0.113.9:8080");
  assert.equal(parsed?.display, "203.0.113.9:8080");
  assert.equal(parsed?.display.includes("s3cret"), false);
});

test("a matching scheme prefix is preserved or normalized", () => {
  assert.equal(
    normalizeUserProxy("https://u:p@5.6.7.8:8443", "http")?.url,
    "https://u:p@5.6.7.8:8443",
  );
  assert.equal(
    normalizeUserProxy("socks5h://5.6.7.8:1080", "socks5")?.url,
    "socks5://5.6.7.8:1080",
  );
});

test("a mismatched or unsupported scheme is rejected", () => {
  assert.equal(normalizeUserProxy("socks5://u:p@5.6.7.8:1080", "http"), null);
  assert.equal(normalizeUserProxy("http://5.6.7.8:8080", "socks5"), null);
  assert.equal(normalizeUserProxy("socks4://5.6.7.8:1080", "socks5"), null);
});

test("proxy auth requires both a username and password", () => {
  assert.equal(normalizeUserProxy("alice@203.0.113.9:8080", "http"), null);
  assert.equal(normalizeUserProxy(":secret@203.0.113.9:8080", "http"), null);
  assert.equal(normalizeUserProxy("alice:@203.0.113.9:8080", "http"), null);
});

test("hostnames and bracketed ipv6 are accepted", () => {
  assert.equal(
    normalizeUserProxy("proxy.example.com:3128", "http")?.display,
    "proxy.example.com:3128",
  );
  assert.equal(normalizeUserProxy("[2001:db8::1]:8118", "http")?.display, "[2001:db8::1]:8118");
});

test("ipv4 octets outside the address range are rejected", () => {
  assert.equal(normalizeUserProxy("999.999.999.999:8080", "http"), null);
  assert.equal(normalizeUserProxy("256.1.1.1:8080", "http"), null);
});

test("garbage is rejected", () => {
  assert.equal(normalizeUserProxy("", "http"), null);
  assert.equal(normalizeUserProxy("203.0.113.9", "http"), null);
  assert.equal(normalizeUserProxy("203.0.113.9:0", "http"), null);
  assert.equal(normalizeUserProxy("203.0.113.9:99999", "http"), null);
  assert.equal(normalizeUserProxy("203.0.113.9:port", "http"), null);
  assert.equal(normalizeUserProxy("java-script:alert(1)", "http"), null);
});

test("long input is capped, whitespace tolerated", () => {
  assert.equal(normalizeUserProxy(`1.1.1.1:8080${"a".repeat(300)}`, "http"), null);
  assert.equal(normalizeUserProxy("  1.2.3.4:80  ", "http")?.display, "1.2.3.4:80");
});

test("maskProxyDisplay hides all but the first octet", () => {
  assert.equal(maskProxyDisplay("34.12.98.7:9021"), "34.x.x:9021");
  assert.equal(maskProxyDisplay("proxy.example.com:3128"), "proxy.x.x:3128");
  assert.equal(maskProxyDisplay("[2001:db8::1]:8118"), "[ipv6]:8118");
});

test("redactProxyUrl masks full authorities but keeps paths", () => {
  assert.equal(
    redactProxyUrl(
      "connect socks5://bob:hunter2@10.0.0.1:1080 failed then http://carol:pw@host:80/x?y=1",
    ),
    "connect socks5://*** failed then http://***/x?y=1",
  );
});

test("an already-saved canonical proxy is not inserted twice", () => {
  const url = "http://user:pass@127.0.0.1:8080";
  assert.equal(proxyUrlExists([{ url }], url), true);
  assert.equal(proxyUrlExists([{ url }], "http://127.0.0.1:8080"), false);
});
