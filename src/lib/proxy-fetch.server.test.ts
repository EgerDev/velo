import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as makeRequest, type Server } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { closeProxyFetchAgents, fetchWithHttpProxy, pinnedProxyUri } from "./proxy-fetch.server.ts";
import { ProxyTransportError } from "./proxy-transport.server.ts";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP.");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
}

test("metadata POSTs preserve method, body, and headers through the configured HTTP proxy", async () => {
  let proxyConnects = 0;
  const target = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.setHeader("connection", "close");
      response.end(
        JSON.stringify({
          method: request.method,
          marker: request.headers["x-test-marker"],
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });
  const targetPort = await listen(target);

  const proxy = createServer((request, response) => {
    proxyConnects += 1;
    const upstream = makeRequest(
      request.url ?? "",
      {
        method: request.method,
        headers: request.headers,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    request.pipe(upstream);
  });
  proxy.on("connect", (request, clientSocket, head) => {
    proxyConnects += 1;
    const [host, rawPort] = (request.url ?? "").split(":");
    const upstream = connect(Number(rawPort), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  });
  const proxyPort = await listen(proxy);

  try {
    const response = await fetchWithHttpProxy(
      `http://127.0.0.1:${proxyPort}`,
      `http://127.0.0.1:${targetPort}/player`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-marker": "same-hop" },
        body: '{"videoId":"jNQXAC9IVRw"}',
        signal: AbortSignal.timeout(5_000),
      },
      { allowPrivateProxyForTests: true, allowPrivateTargetForTests: true },
    );
    const payload: unknown = await response.json();
    assert.equal(proxyConnects, 1);
    assert.deepEqual(payload, {
      method: "POST",
      marker: "same-hop",
      body: '{"videoId":"jNQXAC9IVRw"}',
    });
  } finally {
    await closeProxyFetchAgents();
    await Promise.all([close(proxy), close(target)]);
  }
});

test("active proxy fetch rejects private and DNS-rebinding endpoints before creating an agent", async () => {
  const target = "https://www.youtube.com/youtubei/v1/player";
  await assert.rejects(
    () => fetchWithHttpProxy("http://proxy.example:8080", target, undefined, { lookup: async () => ["93.184.216.34", "127.0.0.1"], targetLookup: async () => ["93.184.216.34"] }),
    (error: unknown) => error instanceof ProxyTransportError && error.code === "forbidden_proxy_address",
  );
  await assert.rejects(
    () => fetchWithHttpProxy("http://169.254.169.254:8080", target, undefined, { targetLookup: async () => ["93.184.216.34"] }),
    (error: unknown) => error instanceof ProxyTransportError && error.code === "forbidden_proxy_address",
  );
});

test("active proxy fetch rejects non-YouTube, IP-literal, and target rebinding destinations", async () => {
  const proxyOptions = { lookup: async () => ["93.184.216.34"] };
  await assert.rejects(() => fetchWithHttpProxy("http://proxy.example:8080", "http://127.0.0.1/private", undefined, proxyOptions), (error: unknown) => error instanceof ProxyTransportError && error.code === "invalid_configuration");
  await assert.rejects(() => fetchWithHttpProxy("http://proxy.example:8080", "https://example.com/private", undefined, proxyOptions), (error: unknown) => error instanceof ProxyTransportError && error.code === "invalid_configuration");
  await assert.rejects(() => fetchWithHttpProxy("http://proxy.example:8080", "https://www.youtube.com/youtubei/v1/player", undefined, { ...proxyOptions, targetLookup: async () => ["93.184.216.34", "10.0.0.1"] }), (error: unknown) => error instanceof ProxyTransportError && error.code === "forbidden_proxy_address");
});

test("resolved proxy URI pins the socket endpoint while preserving credentials and port", () => {
  const pinned = new URL(pinnedProxyUri("https://user:pass@proxy.example:8443", "93.184.216.34"));
  assert.equal(pinned.hostname, "93.184.216.34"); assert.equal(pinned.port, "8443");
  assert.equal(pinned.username, "user"); assert.equal(pinned.password, "pass");
});
