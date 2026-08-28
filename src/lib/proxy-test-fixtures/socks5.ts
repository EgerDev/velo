import { Buffer } from "node:buffer";
import { createServer, connect, type Socket } from "node:net";
import { closeServer, listenOnLoopback } from "./network.ts";
import type { ProxyFixture, ProxyLedger } from "./http-connect.ts";

function readOnce(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once("data", resolve);
    socket.once("error", reject);
  });
}

async function acceptClient(
  socket: Socket,
  credentials: { readonly username: string; readonly password: string } | undefined,
  connects: string[],
  authorization: string[],
  sockets: Set<Socket>,
): Promise<void> {
  const greeting = await readOnce(socket);
  const method = credentials ? 2 : 0;
  if (greeting[0] !== 5 || !greeting.subarray(2).includes(method)) {
    socket.end(Buffer.from([5, 255]));
    return;
  }
  socket.write(Buffer.from([5, method]));
  if (credentials) {
    const auth = await readOnce(socket);
    const usernameLength = auth[1] ?? 0;
    const passwordLength = auth[2 + usernameLength] ?? 0;
    const username = auth.subarray(2, 2 + usernameLength).toString();
    const password = auth.subarray(3 + usernameLength, 3 + usernameLength + passwordLength).toString();
    authorization.push(`${username}:${password}`);
    if (username !== credentials.username || password !== credentials.password) {
      socket.end(Buffer.from([1, 1]));
      return;
    }
    socket.write(Buffer.from([1, 0]));
  }
  const request = await readOnce(socket);
  if (request[0] !== 5 || request[1] !== 1) {
    socket.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
    return;
  }
  const addressType = request[3];
  const host = addressType === 1
    ? `${request[4]}.${request[5]}.${request[6]}.${request[7]}`
    : request.subarray(5, 5 + (request[4] ?? 0)).toString();
  const portOffset = addressType === 1 ? 8 : 5 + (request[4] ?? 0);
  const port = request.readUInt16BE(portOffset);
  connects.push(`${host}:${port}`);
  const upstream = connect(port, host, () => {
    socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  sockets.add(upstream);
  upstream.once("close", () => sockets.delete(upstream));
  upstream.once("error", () => socket.destroy());
}

export async function createSocks5Proxy(credentials?: {
  readonly username: string;
  readonly password: string;
}): Promise<ProxyFixture> {
  const connects: string[] = [];
  const authorization: string[] = [];
  const sockets = new Set<Socket>();
  let closedSockets = 0;
  let notifyClosed: (() => void) | undefined;
  const firstClosed = new Promise<void>((resolve) => { notifyClosed = resolve; });
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      closedSockets += 1;
      notifyClosed?.();
    });
    void acceptClient(socket, credentials, connects, authorization, sockets).catch((error: unknown) => {
      if (error instanceof Error) socket.destroy(error);
      else socket.destroy();
    });
  });
  const port = await listenOnLoopback(server);
  const auth = credentials
    ? `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@`
    : "";
  return {
    url: `socks5://${auth}127.0.0.1:${port}`,
    ledger: (): ProxyLedger => ({ connects: [...connects], authorization: [...authorization], closedSockets }),
    waitForClosedSocket: () => firstClosed,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}
