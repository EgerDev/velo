import { once } from "node:events";
import type { Server } from "node:net";

export async function listenOnLoopback(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("Fixture server did not bind to TCP.");
  }
  return address.port;
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}
