import { Buffer } from "node:buffer";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { z } from "zod";

const transportInputSchema = z.object({
  proxyUrl: z.string().max(2_048), targetUrl: z.string().max(8_192),
  method: z.string().max(24).optional(), allowPrivateProxyForTests: z.boolean().optional(),
  maxResponseBytes: z.number().int().positive().max(64 * 1024 * 1024).brand<"ResponseByteLimit">(),
});

export const PROXY_TRANSPORT_ERROR_CODES = [
  "invalid_configuration", "forbidden_proxy_address", "proxy_authentication_failed", "connection_failed", "timeout", "aborted", "tls_error", "malformed_response", "response_too_large",
] as const;

export type ProxyTransportErrorCode = (typeof PROXY_TRANSPORT_ERROR_CODES)[number];
export class ProxyTransportError extends Error {
  readonly code: ProxyTransportErrorCode; readonly safeMessage: string;

  constructor(code: ProxyTransportErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = "ProxyTransportError"; this.code = code; this.safeMessage = safeMessage;
  }
}

export type ProxyOperationResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly error: ProxyTransportError };
export type ProxyTransportResult = { readonly ok: true; readonly response: Response } |
  { readonly ok: false; readonly error: ProxyTransportError };

export type ProxyTransportInput = {
  readonly proxyUrl: string; readonly targetUrl: string;
  readonly method?: string; readonly headers?: HeadersInit;
  readonly body?: string | Uint8Array;
  readonly signal: AbortSignal; readonly maxResponseBytes: number;
  /** Local deterministic fixtures only; ignored when NODE_ENV=production. */
  readonly allowPrivateProxyForTests?: boolean;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
};
type ValidatedTransportInput = Omit<ProxyTransportInput, "maxResponseBytes"> & { readonly maxResponseBytes: z.infer<typeof transportInputSchema>["maxResponseBytes"] };

type ResolvedProxy = {
  readonly protocol: "http:" | "https:" | "socks5:" | "socks5h:";
  readonly address: string; readonly port: number; readonly servername: string;
  readonly username: string; readonly password: string;
};

const fail = (code: ProxyTransportErrorCode, message: string): { readonly ok: false; readonly error: ProxyTransportError } =>
  ({ ok: false, error: new ProxyTransportError(code, message) });
function assertNever(value: never): never { throw new ProxyTransportError("invalid_configuration", `Unsupported protocol: ${String(value)}`); }

function isForbiddenIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const first = octets[0] ?? 0; const second = octets[1] ?? 0; const third = octets[2] ?? 0;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && ((second === 0 && third === 0) || (second === 0 && third === 2) || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113);
}

export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isForbiddenIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("2001:db8") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
}

function parseProxyUrl(raw: string): URL | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "socks5:" && url.protocol !== "socks5h:") return null;
  if (url.hostname.length === 0 || url.port.length === 0) return null;
  return url;
}

export async function resolveProxyEndpoint(
  proxyUrl: string,
  options: {
    readonly lookup?: (hostname: string) => Promise<readonly string[]>;
    readonly allowPrivateProxyForTests?: boolean;
  } = {},
): Promise<ProxyOperationResult<ResolvedProxy>> {
  const proxy = parseProxyUrl(proxyUrl);
  if (proxy === null) return fail("invalid_configuration", "The proxy route configuration is invalid.");
  const resolver = options.lookup ?? (async (hostname: string) => {
    const answers = await dnsLookup(hostname, { all: true, verbatim: true }); return answers.map((answer) => answer.address);
  });
  let addresses: readonly string[];
  try {
    addresses = isIP(proxy.hostname) === 0 ? await resolver(proxy.hostname) : [proxy.hostname];
  } catch (error: unknown) {
    if (error instanceof Error) return fail("connection_failed", "The proxy endpoint could not be resolved.");
    throw error;
  }
  if (addresses.length === 0) return fail("connection_failed", "The proxy endpoint could not be resolved.");
  const privateOverride = options.allowPrivateProxyForTests === true && process.env.NODE_ENV !== "production";
  if (!privateOverride && addresses.some(isForbiddenAddress)) return fail("forbidden_proxy_address", "The proxy endpoint resolves to a forbidden network range.");
  const address = addresses[0];
  if (address === undefined) return fail("connection_failed", "The proxy endpoint could not be resolved.");
  const protocol = proxy.protocol;
  if (protocol !== "http:" && protocol !== "https:" && protocol !== "socks5:" && protocol !== "socks5h:") {
    return fail("invalid_configuration", "The proxy route configuration is invalid.");
  }
  try {
    return { ok: true, value: {
      protocol, address, servername: proxy.hostname, port: Number(proxy.port),
      username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password),
    } };
  } catch (error: unknown) {
    if (error instanceof URIError) return fail("invalid_configuration", "The proxy route configuration is invalid.");
    throw error;
  }
}

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}
const responseBody = (status: number, chunks: readonly Uint8Array[]): BodyInit | null => status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks);

async function socksRequest(input: ValidatedTransportInput, proxy: ResolvedProxy): Promise<Response> {
  const host = proxy.address.includes(":") ? `[${proxy.address}]` : proxy.address;
  const auth = proxy.username.length > 0
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  const agent = new SocksProxyAgent(`socks5h://${auth}${host}:${proxy.port}`);
  const target = new URL(input.targetUrl);
  const requester = target.protocol === "https:" ? httpsRequest : httpRequest;
  try {
    return await new Promise<Response>((resolve, reject) => {
      const headers = input.headers === undefined ? undefined : Object.fromEntries(new Headers(input.headers).entries());
      let cleanupUpstream: (() => void) | undefined;
      const request = requester(target, { method: input.method ?? "GET", headers, agent, signal: input.signal }, (upstream) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const cleanup = (): void => {
          request.removeListener("error", onRequestError);
          upstream.removeListener("data", onData); upstream.removeListener("error", onUpstreamError);
          upstream.removeListener("end", onEnd);
        };
        cleanupUpstream = cleanup;
        const onUpstreamError = (error: Error): void => { cleanup(); reject(error); };
        const onData = (chunk: Buffer): void => {
          total += chunk.byteLength;
          if (total > input.maxResponseBytes) {
            upstream.destroy(new ProxyTransportError("response_too_large", "The proxied response exceeded the byte limit."));
            return;
          } chunks.push(chunk);
        };
        const onEnd = (): void => {
          const status = upstream.statusCode ?? 502;
          try {
            cleanup(); resolve(new Response(responseBody(status, chunks), {
              status, statusText: upstream.statusMessage, headers: responseHeaders(upstream.headers),
            }));
          } catch (error: unknown) {
            if (!(error instanceof Error)) throw error;
            onUpstreamError(new ProxyTransportError("malformed_response", "The proxy returned a malformed response."));
          }
        };
        upstream.on("data", onData); upstream.once("error", onUpstreamError); upstream.once("end", onEnd);
      });
      const onRequestError = (error: Error): void => {
        request.removeListener("error", onRequestError); cleanupUpstream?.(); reject(error);
      };
      request.once("error", onRequestError);
      if (input.body !== undefined) request.write(input.body);
      request.end();
    });
  } finally {
    agent.destroy();
  }
}

function classify(error: Error, signal: AbortSignal): { readonly ok: false; readonly error: ProxyTransportError } {
  if (error instanceof ProxyTransportError) return { ok: false, error };
  if (signal.aborted) {
    return fail(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "timeout" : "aborted",
      signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "The proxy request timed out." : "The proxy request was aborted.");
  }
  const describe = (current: Error, depth: number): string => {
    const status = "statusCode" in current ? String(current.statusCode) : "";
    const nested = depth < 4 && current.cause instanceof Error ? describe(current.cause, depth + 1) : "";
    return `${current.name} ${current.message} ${status} ${nested}`;
  };
  const details = describe(error, 0);
  if (/407|authenticat/i.test(details)) return fail("proxy_authentication_failed", "The proxy rejected its credentials.");
  if (/certificate|tls|ssl|wrong version|eproto/i.test(details)) return fail("tls_error", "The proxied TLS connection was rejected.");
  if (/http parser|expected http|invalid.*response|hpe_/i.test(details)) return fail("malformed_response", "The proxy returned a malformed response.");
  return fail("connection_failed", "The explicit proxy route could not complete the request.");
}

export async function fetchThroughExplicitProxy(input: ProxyTransportInput): Promise<ProxyTransportResult> {
  const parsed = transportInputSchema.safeParse(input);
  if (!parsed.success || !URL.canParse(input.targetUrl)) return fail("invalid_configuration", "The proxy request configuration is invalid.");
  const targetProtocol = new URL(input.targetUrl).protocol;
  if (targetProtocol !== "http:" && targetProtocol !== "https:") return fail("invalid_configuration", "The proxy request configuration is invalid.");
  const validated = { ...input, maxResponseBytes: parsed.data.maxResponseBytes } satisfies ValidatedTransportInput;
  const endpoint = await resolveProxyEndpoint(input.proxyUrl, { lookup: input.lookup, allowPrivateProxyForTests: input.allowPrivateProxyForTests });
  if (!endpoint.ok) return endpoint;
  try {
    const protocol = endpoint.value.protocol;
    switch (protocol) {
      case "socks5:": case "socks5h:":
        return { ok: true, response: await socksRequest(validated, endpoint.value) };
      case "http:": case "https:": break;
      default: return assertNever(protocol);
    }
    const host = endpoint.value.address.includes(":") ? `[${endpoint.value.address}]` : endpoint.value.address;
    const token = endpoint.value.username.length > 0
      ? `Basic ${Buffer.from(`${endpoint.value.username}:${endpoint.value.password}`).toString("base64")}`
      : undefined;
    const agent = new ProxyAgent({
      uri: `${endpoint.value.protocol}//${host}:${endpoint.value.port}`, token, proxyTunnel: true,
      proxyTls: endpoint.value.protocol === "https:" ? { servername: endpoint.value.servername } : undefined,
    });
    try {
      const headers = validated.headers === undefined ? undefined : Object.fromEntries(new Headers(validated.headers).entries());
      const upstream = await undiciFetch(validated.targetUrl, {
        method: validated.method ?? "GET", headers, body: validated.body,
        signal: validated.signal, dispatcher: agent,
      });
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (upstream.body !== null) for await (const chunk of upstream.body) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array)) throw new TypeError("Proxy returned a non-byte chunk.");
        total += value.byteLength;
        if (total > validated.maxResponseBytes) {
          await upstream.body.cancel();
          throw new ProxyTransportError("response_too_large", "The proxied response exceeded the byte limit.");
        }
        chunks.push(value);
      }
      const response = new Response(responseBody(upstream.status, chunks), {
        status: upstream.status, statusText: upstream.statusText, headers: upstream.headers,
      });
      return { ok: true, response };
    } finally {
      await agent.destroy();
    }
  } catch (error: unknown) {
    if (error instanceof Error) return classify(error, validated.signal);
    throw error;
  }
}
