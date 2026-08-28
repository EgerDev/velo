import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { createHttpConnectProxy } from "./proxy-test-fixtures/http-connect.ts";
import { listenOnLoopback, closeServer } from "./proxy-test-fixtures/network.ts";
import { createSocks5Proxy } from "./proxy-test-fixtures/socks5.ts";
import { createRangeTarget, createStatusTarget } from "./proxy-test-fixtures/target.ts";
import {
  fetchThroughExplicitProxy,
  resolveProxyEndpoint,
  type ProxyOperationResult,
  type ProxyTransportError,
  type ProxyTransportResult,
} from "./proxy-transport.server.ts";

const TEN_KIB = 10 * 1024;
const BODY = Buffer.alloc(TEN_KIB + 512, 97);

function expectSuccess(result: ProxyTransportResult): Response {
  assert.equal(result.ok, true);
  if (!result.ok) throw new TypeError("Expected transport success.");
  return result.response;
}

function expectFailure(
  result: ProxyTransportResult | ProxyOperationResult<unknown>,
  code: ProxyTransportError["code"],
): void {
  assert.equal(result.ok, false);
  if (result.ok) throw new TypeError("Expected transport failure.");
  assert.equal(result.error.code, code);
}

for (const protocol of ["http", "socks5"] as const) {
  test(`${protocol} explicit route preserves Range and reads exactly 10 KiB`, async () => {
    // Given
    const target = await createRangeTarget(BODY);
    const proxy = protocol === "http" ? await createHttpConnectProxy() : await createSocks5Proxy();
    try {
      // When
      const result = await fetchThroughExplicitProxy({
        proxyUrl: proxy.url,
        targetUrl: target.url,
        headers: { range: `bytes=0-${TEN_KIB - 1}` },
        signal: AbortSignal.timeout(2_000),
        maxResponseBytes: TEN_KIB,
        allowPrivateProxyForTests: true,
      });

      // Then
      const response = expectSuccess(result);
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes 0-${TEN_KIB - 1}/${BODY.length}`);
      assert.equal((await response.arrayBuffer()).byteLength, TEN_KIB);
      await proxy.waitForClosedSocket();
      assert.equal(proxy.ledger().connects.length, 1);
      assert.ok(proxy.ledger().closedSockets >= 1);
      assert.equal(target.requests()[0]?.range, `bytes=0-${TEN_KIB - 1}`);
    } finally {
      await Promise.all([proxy.close(), target.close()]);
    }
  });
}

for (const protocol of ["http", "socks5"] as const) {
  test(`${protocol} explicit route authenticates without exposing credentials`, async () => {
    // Given
    const credentials = { username: "sentinel-user", password: "sentinel-password" } as const;
    const target = await createRangeTarget(BODY);
    const proxy = protocol === "http"
      ? await createHttpConnectProxy(credentials)
      : await createSocks5Proxy(credentials);
    try {
      // When
      const result = await fetchThroughExplicitProxy({
        proxyUrl: proxy.url,
        targetUrl: target.url,
        signal: AbortSignal.timeout(2_000),
        maxResponseBytes: BODY.length,
        allowPrivateProxyForTests: true,
      });

      // Then
      expectSuccess(result);
      assert.equal(proxy.ledger().authorization.length, 1);
      assert.doesNotMatch(JSON.stringify(result), /sentinel-user|sentinel-password/);
    } finally {
      await Promise.all([proxy.close(), target.close()]);
    }
  });
}

test("explicit route returns a redacted auth failure without direct fallback", async () => {
  // Given
  const target = await createRangeTarget(BODY);
  const proxy = await createHttpConnectProxy({ username: "right", password: "secret" });
  const wrongUrl = proxy.url.replace("right:secret", "sentinel-user:sentinel-password");
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: wrongUrl,
      targetUrl: target.url,
      signal: AbortSignal.timeout(2_000),
      maxResponseBytes: BODY.length,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "proxy_authentication_failed");
    assert.equal(target.requests().length, 0);
    assert.doesNotMatch(JSON.stringify(result), /sentinel-user|sentinel-password|right|secret/);
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("SOCKS explicit route returns a redacted auth failure", async () => {
  // Given
  const target = await createRangeTarget(BODY);
  const proxy = await createSocks5Proxy({ username: "right", password: "secret" });
  const wrongUrl = proxy.url.replace("right:secret", "sentinel-user:sentinel-password");
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: wrongUrl,
      targetUrl: target.url,
      signal: AbortSignal.timeout(2_000),
      maxResponseBytes: BODY.length,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "proxy_authentication_failed");
    assert.equal(target.requests().length, 0);
    assert.doesNotMatch(JSON.stringify(result), /sentinel-user|sentinel-password|right|secret/);
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("explicit route binds the validated proxy address", async () => {
  // Given
  const target = await createRangeTarget(BODY);
  const proxy = await createHttpConnectProxy();
  const hostnameUrl = proxy.url.replace("127.0.0.1", "proxy.invalid");
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: hostnameUrl,
      targetUrl: target.url,
      signal: AbortSignal.timeout(2_000),
      maxResponseBytes: BODY.length,
      lookup: async () => ["127.0.0.1"],
      allowPrivateProxyForTests: true,
    });

    // Then
    expectSuccess(result);
    assert.equal(proxy.ledger().connects.length, 1);
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("explicit route never falls back when the chosen proxy refuses connections", async () => {
  // Given
  const closedProxy = createServer();
  const port = await listenOnLoopback(closedProxy);
  await closeServer(closedProxy);
  const target = await createRangeTarget(BODY);
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: `http://127.0.0.1:${port}`,
      targetUrl: target.url,
      signal: AbortSignal.timeout(1_000),
      maxResponseBytes: BODY.length,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "connection_failed");
    assert.equal(target.requests().length, 0);
  } finally {
    await target.close();
  }
});

test("explicit route enforces the response byte cap", async () => {
  // Given
  const target = await createRangeTarget(BODY);
  const proxy = await createSocks5Proxy();
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: proxy.url,
      targetUrl: target.url,
      signal: AbortSignal.timeout(2_000),
      maxResponseBytes: TEN_KIB,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "response_too_large");
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("explicit route abort closes the proxied socket", async () => {
  // Given
  const target = await createRangeTarget(BODY, "hang");
  const proxy = await createSocks5Proxy();
  const controller = new AbortController();
  const pending = fetchThroughExplicitProxy({
    proxyUrl: proxy.url,
    targetUrl: target.url,
    signal: controller.signal,
    maxResponseBytes: BODY.length,
    allowPrivateProxyForTests: true,
  });
  await target.waitForRequest();

  try {
    // When
    controller.abort();
    const result = await pending;

    // Then
    expectFailure(result, "aborted");
    await proxy.waitForClosedSocket();
    assert.ok(proxy.ledger().closedSockets >= 1);
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("explicit route reports a bounded timeout", async () => {
  // Given
  const sockets = new Set<import("node:net").Socket>();
  const proxyServer = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const port = await listenOnLoopback(proxyServer);
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: `http://127.0.0.1:${port}`,
      targetUrl: "http://example.test/",
      signal: AbortSignal.timeout(100),
      maxResponseBytes: 100,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "timeout");
  } finally {
    for (const socket of sockets) socket.destroy();
    await closeServer(proxyServer);
  }
});

test("explicit route classifies malformed proxy responses", async () => {
  // Given
  const sockets = new Set<import("node:net").Socket>();
  const proxyServer = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.end("not-http\r\n\r\n");
  });
  const port = await listenOnLoopback(proxyServer);
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: `http://127.0.0.1:${port}`,
      targetUrl: "http://example.test/",
      signal: AbortSignal.timeout(1_000),
      maxResponseBytes: 100,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "malformed_response");
  } finally {
    for (const socket of sockets) socket.destroy();
    await closeServer(proxyServer);
  }
});

test("explicit route classifies invalid target TLS", async () => {
  // Given
  const target = await createRangeTarget(BODY);
  const proxy = await createHttpConnectProxy();
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: proxy.url,
      targetUrl: target.url.replace("http:", "https:"),
      signal: AbortSignal.timeout(1_000),
      maxResponseBytes: 100,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "tls_error");
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});

test("proxy endpoint resolution rejects forbidden IPv4 and IPv6 ranges", async () => {
  // Given
  const forbidden = ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "fd00::1", "fe80::1"];

  // When
  const results = await Promise.all(forbidden.map((address) => resolveProxyEndpoint(
    "http://proxy.example:8080",
    { lookup: async () => [address], allowPrivateProxyForTests: false },
  )));

  // Then
  for (const result of results) expectFailure(result, "forbidden_proxy_address");
});

test("proxy endpoint resolution rejects a hostname with a rebinding answer", async () => {
  // Given
  const lookup = async (): Promise<readonly string[]> => ["93.184.216.34", "127.0.0.1"];

  // When
  const result = await resolveProxyEndpoint(
    "socks5://sentinel-user:sentinel-password@proxy.example:1080",
    { lookup, allowPrivateProxyForTests: false },
  );

  // Then
  expectFailure(result, "forbidden_proxy_address");
  assert.doesNotMatch(JSON.stringify(result), /sentinel-user|sentinel-password/);
});

test("production ignores the local private-address override", async () => {
  // Given
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    // When
    const result = await resolveProxyEndpoint(
      "http://127.0.0.1:8080",
      { allowPrivateProxyForTests: true },
    );

    // Then
    expectFailure(result, "forbidden_proxy_address");
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("explicit route rejects unsupported target protocols", async () => {
  // Given
  const controller = new AbortController();

  // When
  const result = await fetchThroughExplicitProxy({
    proxyUrl: "http://proxy.example:8080",
    targetUrl: "file:///etc/passwd",
    signal: controller.signal,
    maxResponseBytes: 100,
    lookup: async () => ["93.184.216.34"],
  });

  // Then
  expectFailure(result, "invalid_configuration");
});

for (const protocol of ["http", "socks5"] as const) {
  for (const status of [204, 205, 304] as const) {
    test(`${protocol} explicit route returns a null body for status ${status}`, async () => {
      // Given
      const target = await createStatusTarget(status);
      const proxy = protocol === "http" ? await createHttpConnectProxy() : await createSocks5Proxy();
      try {
        // When
        const result = await fetchThroughExplicitProxy({
          proxyUrl: proxy.url,
          targetUrl: target.url,
          signal: AbortSignal.timeout(2_000),
          maxResponseBytes: 100,
          allowPrivateProxyForTests: true,
        });

        // Then
        const response = expectSuccess(result);
        assert.equal(response.status, status);
        assert.equal(response.body, null);
        assert.equal(response.headers.get("x-fixture-status"), String(status));
        await proxy.waitForClosedSocket();
        assert.ok(proxy.ledger().closedSockets >= 1);
      } finally {
        await Promise.all([proxy.close(), target.close()]);
      }
    });
  }
}

test("SOCKS explicit route turns Response construction failures into typed cleanup", async () => {
  // Given
  const target = await createStatusTarget(600);
  const proxy = await createSocks5Proxy();
  try {
    // When
    const result = await fetchThroughExplicitProxy({
      proxyUrl: proxy.url,
      targetUrl: target.url,
      signal: AbortSignal.timeout(2_000),
      maxResponseBytes: 100,
      allowPrivateProxyForTests: true,
    });

    // Then
    expectFailure(result, "malformed_response");
    await proxy.waitForClosedSocket();
    assert.ok(proxy.ledger().closedSockets >= 1);
  } finally {
    await Promise.all([proxy.close(), target.close()]);
  }
});
