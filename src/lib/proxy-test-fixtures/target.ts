import { createServer, type Server } from "node:http";
import { closeServer, listenOnLoopback } from "./network.ts";

export type TargetFixture = {
  readonly url: string;
  readonly requests: () => readonly { readonly range: string | undefined }[];
  readonly waitForRequest: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export async function createRangeTarget(
  body: Buffer,
  behavior: "respond" | "hang" = "respond",
): Promise<TargetFixture> {
  const requests: { readonly range: string | undefined }[] = [];
  let notifyRequest: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { notifyRequest = resolve; });
  const server: Server = createServer((request, response) => {
    const range = request.headers.range;
    requests.push({ range });
    notifyRequest?.();
    if (behavior === "hang") return;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (match) {
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), body.length - 1);
      const slice = body.subarray(start, end + 1);
      response.writeHead(206, {
        "accept-ranges": "bytes",
        "content-length": String(slice.length),
        "content-range": `bytes ${start}-${end}/${body.length}`,
      });
      response.end(slice);
      return;
    }
    response.writeHead(200, { "content-length": String(body.length) });
    response.end(body);
  });
  const port = await listenOnLoopback(server);
  return {
    url: `http://127.0.0.1:${port}/media`,
    requests: () => [...requests],
    waitForRequest: () => firstRequest,
    close: async () => {
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

export async function createStatusTarget(status: number): Promise<TargetFixture> {
  const requests: { readonly range: string | undefined }[] = [];
  let notifyRequest: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { notifyRequest = resolve; });
  const server: Server = createServer((request, response) => {
    requests.push({ range: request.headers.range });
    notifyRequest?.();
    response.writeHead(status, { "x-fixture-status": String(status) });
    response.end();
  });
  const port = await listenOnLoopback(server);
  return {
    url: `http://127.0.0.1:${port}/status`, requests: () => [...requests],
    waitForRequest: () => firstRequest,
    close: async () => { server.closeAllConnections(); await closeServer(server); },
  };
}
