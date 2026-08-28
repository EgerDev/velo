/**
 * Node-side half of user proxies: DB rows, the undici ProxyAgent, and the
 * curl-based probe. Pure parsing/redaction lives in user-proxy.ts so the
 * client can import it; this module must never be imported client-side.
 */

import type { ProxyCapability, ProxyId } from "./proxy-operations";
import {
  createUserProxyCompatibilityFacade,
  type CompatibilityProxyRow,
  type ProxySecretLease,
} from "./user-proxy-compatibility.server";
import { assertProxyVaultReady, fingerprintSecret } from "./vault-crypto";

export type StoredProxy = CompatibilityProxyRow;

export class ProxyRepositoryUnavailableError extends Error {
  readonly code = "proxy_repository_unavailable";
  constructor() { super("The proxy route repository is unavailable."); this.name = "ProxyRepositoryUnavailableError"; }
}

async function repository() {
  const [{ getProxyDatabase }, { createUserProxyRepository }] = await Promise.all([
    import("./user-proxy-repository-db.server"),
    import("./user-proxy-repository.server"),
  ]);
  return createUserProxyRepository(await getProxyDatabase());
}

export function invalidateProxyCache(): void {
  // Compatibility no-op: the database is authoritative.
}

export async function getUserProxies(): Promise<StoredProxy[]> {
  return [...(await createUserProxyCompatibilityFacade(await repository()).list())];
}

/** First database-eligible proxy, else null. */
export async function userProxyLadder(capability: ProxyCapability): Promise<readonly ProxySecretLease[]> {
  try {
    const store = await repository();
    const [{ selectProxyRoutes }, { ProxySecretLease }] = await Promise.all([
      import("./proxy-selector.server"), import("./user-proxy-compatibility.server"),
    ]);
    return selectProxyRoutes(await store.list(), capability)
      .filter((route) => route.kind === "proxy")
      .map((route) => new ProxySecretLease(store, route.id, route.protocol));
  } catch (error: unknown) {
    if (error instanceof ProxyRepositoryUnavailableError) throw error;
    if (error instanceof Error) throw new ProxyRepositoryUnavailableError();
    throw error;
  }
}

export async function activeUserProxy(capability: ProxyCapability = "ytdlp"): Promise<ProxySecretLease | null> {
  return (await userProxyLadder(capability))[0] ?? null;
}

export async function userProxyById(id: ProxyId): Promise<ProxySecretLease | null> {
  return createUserProxyCompatibilityFacade(await repository()).byId(id);
}

/**
 * fetch() that rides the active http(s) user proxy when one is configured.
 * HTTP proxies cover metadata and media; SOCKS remains yt-dlp-only.
 */
export async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const ladder = await userProxyLadder("metadata");
  if (ladder.length === 0) return fetch(input, init);
  const [{ fetchWithHttpProxy }, { attemptSelectedRoutes }] = await Promise.all([
    import("@/lib/proxy-fetch.server"), import("./proxy-selector.server"),
  ]);
  let lastError: Error | null = null;
  const selected = [...ladder.map((route) => ({ kind: "proxy", id: route.id, protocol: route.protocol, trusted: true } as const)), { kind: "direct", trusted: false } as const];
  const outcome = await attemptSelectedRoutes<Response>(selected, async (choice) => {
    if (choice.kind === "direct") return { ok: true, value: await fetch(input, init) };
    if (choice.kind === "free_socks") return { ok: false };
    const route = ladder.find((candidate) => candidate.id === choice.id);
    if (route === undefined) return { ok: false };
    try {
      const response = await route.run((url) => fetchWithHttpProxy(url, input, init));
      return response === null ? { ok: false } : { ok: true, value: response };
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      lastError = error; return { ok: false };
    }
  });
  if (outcome.result !== null) return outcome.result;
  throw new ProxyRouteUnavailableError(lastError);
}

export class ProxyRouteUnavailableError extends Error {
  constructor(cause: Error | null) {
    super("Every configured proxy route and direct fallback failed.", cause === null ? undefined : { cause });
    this.name = "ProxyRouteUnavailableError";
  }
}

/** Compatibility projection of the staged validator. Never exposes the URL. */
export async function probeProxy(
  url: string,
): Promise<{ ok: boolean; exitIp: string | null; error: string | null }> {
  assertProxyVaultReady();
  const { validateProxyRoute } = await import("./proxy-validator.server");
  const result = await validateProxyRoute(url);
  return { ok: result.classification.verdict === "healthy", exitIp: null, error: result.errorCode };
}

export async function saveUserProxy(normalized: { url: string; display: string }): Promise<void> {
  await (await repository()).add(normalized.url);
}

export async function deleteUserProxy(id: string): Promise<void> {
  const { ProxyIdSchema } = await import("./proxy-operations");
  await (await repository()).delete(ProxyIdSchema.parse(id));
}

export async function rememberProxyProbe(
  url: string,
  ok: boolean,
  exitIp: string | null,
): Promise<void> {
  const store = await repository();
  const routeRef = fingerprintSecret(url);
  const row = (await store.list()).find((candidate) => candidate.routeRef === routeRef);
  if (row !== undefined) await store.rememberVerdict(row.id, { ok, exitIp });
}
