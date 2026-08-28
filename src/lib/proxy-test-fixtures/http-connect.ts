import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { closeServer, listenOnLoopback } from "./network.ts";

export type ProxyLedger = {
  readonly connects: readonly string[];
  readonly authorization: readonly string[];
  readonly closedSockets: number;
};

export type ProxyFixture = {
  readonly url: string;
  readonly ledger: () => ProxyLedger;
  readonly waitForClosedSocket: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export async function createHttpConnectProxy(credentials?: {
  readonly username: string;
  readonly password: string;
}): Promise<ProxyFixture> {
  const connects: string[] = [];
  const authorization: string[] = [];
  const sockets = new Set<Socket>();
  let closedSockets = 0;
  let notifyClosed: (() => void) | undefined;
  const firstClosed = new Promise<void>((resolve) => { notifyClosed = resolve; });
  const expected = credentials
    ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`
    : null;
  const server = createServer((_request, response) => {
    response.writeHead(405).end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      closedSockets += 1;
      notifyClosed?.();
    });
  });
  server.on("connect", (request, clientSocket, head) => {
    connects.push(request.url ?? "");
    const supplied = request.headers["proxy-authorization"] ?? "";
    authorization.push(Array.isArray(supplied) ? supplied.join(",") : supplied);
    if (expected !== null && supplied !== expected) {
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      return;
    }
    const authority = new URL(`http://${request.url ?? "invalid"}`);
    const upstream = connect(Number(authority.port), authority.hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.once("error", () => clientSocket.destroy());
  });
  const port = await listenOnLoopback(server);
  const auth = credentials
    ? `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@`
    : "";
  return {
    url: `http://${auth}127.0.0.1:${port}`,
    ledger: () => ({ connects: [...connects], authorization: [...authorization], closedSockets }),
    waitForClosedSocket: () => firstClosed,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}
