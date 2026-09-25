import { PROTOCOL_CAPABILITIES, compareProxyPriority, type ProxyCapability, type ProxyId, type SafeProxyView } from "./proxy-operations.ts";

export type SelectedRoute =
  | { readonly kind: "proxy"; readonly id: ProxyId; readonly protocol: SafeProxyView["protocol"]; readonly trusted: true }
  | { readonly kind: "direct"; readonly trusted: false };

export function selectProxyRoutes(
  routes: readonly SafeProxyView[],
  capability: ProxyCapability,
): readonly SelectedRoute[] {
  const configured = [...routes]
    .filter((route) => route.enabled && route.eligible && PROTOCOL_CAPABILITIES[route.protocol].some((item: ProxyCapability) => item === capability))
    .sort(compareProxyPriority)
    .map((route) => ({ kind: "proxy", id: route.id, protocol: route.protocol, trusted: true }) satisfies SelectedRoute);
  return [...configured, { kind: "direct", trusted: false }];
}

export type RouteAttempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };
export type AttemptLedger<T> = { readonly result: T | null; readonly attempted: readonly SelectedRoute[] };
export type AttemptPolicy = { readonly allowDirectFallback?: boolean };

export async function attemptSelectedRoutes<T>(routes: readonly SelectedRoute[], attempt: (route: SelectedRoute) => Promise<RouteAttempt<T>>, policy: AttemptPolicy = {}): Promise<AttemptLedger<T>> {
  const attempted: SelectedRoute[] = [];
  for (const route of routes) {
    if (route.kind === "direct" && policy.allowDirectFallback === false) continue;
    attempted.push(route);
    const outcome = await attempt(route);
    if (outcome.ok) return { result: outcome.value, attempted };
  }
  return { result: null, attempted };
}
