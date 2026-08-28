import { fetch as undiciFetch, ProxyAgent } from "undici";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isForbiddenAddress, ProxyTransportError, resolveProxyEndpoint } from "./proxy-transport.server.ts";

const agents = new Map<string, ProxyAgent>();
const YOUTUBE_TARGET_SUFFIXES = ["youtube.com", "googlevideo.com", "ytimg.com", "ggpht.com", "googleusercontent.com"] as const;

export async function closeProxyFetchAgents(): Promise<void> {
  const closing = [...agents.values()].map((agent) => agent.close());
  agents.clear();
  await Promise.all(closing);
}

export function pinnedProxyUri(proxyUrl: string, address: string): string {
  const pinned = new URL(proxyUrl);
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return pinned.toString();
}

function agentFor(proxyUrl: string, address: string, servername: string): ProxyAgent | null {
  const protocol = new URL(proxyUrl).protocol;
  if (protocol !== "http:" && protocol !== "https:") return null;
  const key = `${proxyUrl}|${address}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new ProxyAgent({ uri: pinnedProxyUri(proxyUrl, address), connect: { servername } });
    agents.set(key, agent);
  }
  return agent;
}

/** Fetch through an operator-owned HTTP proxy while preserving the request. */
export async function fetchWithHttpProxy(
  proxyUrl: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  options: {
    readonly lookup?: (hostname: string) => Promise<readonly string[]>;
    readonly targetLookup?: (hostname: string) => Promise<readonly string[]>;
    readonly allowPrivateProxyForTests?: boolean;
    readonly allowPrivateTargetForTests?: boolean;
  } = {},
): Promise<Response> {
  const target = new URL(input instanceof Request ? input.url : input);
  const localTargetOverride = options.allowPrivateTargetForTests === true && process.env.NODE_ENV !== "production";
  const allowedHost = YOUTUBE_TARGET_SUFFIXES.some((suffix) => target.hostname === suffix || target.hostname.endsWith(`.${suffix}`));
  if (!localTargetOverride && (!allowedHost || isIP(target.hostname) !== 0)) throw new ProxyTransportError("invalid_configuration", "The proxied target is not an allowed YouTube host.");
  if (!localTargetOverride) {
    const resolveTarget = options.targetLookup ?? (async (hostname: string) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((answer) => answer.address));
    let targetAddresses: readonly string[];
    try { targetAddresses = await resolveTarget(target.hostname); }
    catch { throw new ProxyTransportError("connection_failed", "The proxied target could not be resolved."); }
    if (targetAddresses.length === 0 || targetAddresses.some(isForbiddenAddress)) throw new ProxyTransportError("forbidden_proxy_address", "The proxied target resolves to a forbidden network range.");
  }
  const endpoint = await resolveProxyEndpoint(proxyUrl, options);
  if (!endpoint.ok) throw new ProxyTransportError(endpoint.error.code, endpoint.error.safeMessage);
  const agent = agentFor(proxyUrl, endpoint.value.address, endpoint.value.servername);
  if (!agent) return fetch(input, init);

  const request = new Request(input, init);
  const requestBody =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await undiciFetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: requestBody,
    signal: request.signal,
    redirect: request.redirect,
    dispatcher: agent,
  });
  const upstreamBody = upstream.body;
  const responseBody = upstreamBody
    ? new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of upstreamBody) {
              const value: unknown = chunk;
              if (!(value instanceof Uint8Array))
                throw new TypeError("Proxy returned a non-byte chunk.");
              controller.enqueue(value);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: () => upstreamBody.cancel(),
      })
    : null;
  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: Object.fromEntries(upstream.headers.entries()),
  });
}
