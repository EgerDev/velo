import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSocksUrl, SOCKS_PROBE_URL } from "./socks-pool.server.ts";

test("normalizeSocksUrl accepts host:port and socks5 URLs", () => {
  assert.equal(normalizeSocksUrl("10.0.0.1:1080"), "socks5h://10.0.0.1:1080");
  assert.equal(normalizeSocksUrl("socks5://10.0.0.1:1080"), "socks5h://10.0.0.1:1080");
  assert.equal(normalizeSocksUrl("socks://10.0.0.1:1080"), "socks5h://10.0.0.1:1080");
  assert.equal(normalizeSocksUrl("not a proxy"), null);
  assert.equal(normalizeSocksUrl("socks5://host:99999"), null);
});

test("SOCKS health probe hits googlevideo, not youtube.com", () => {
  assert.match(SOCKS_PROBE_URL, /googlevideo\.com\/generate_204/);
  assert.doesNotMatch(SOCKS_PROBE_URL, /youtube\.com/);
});
