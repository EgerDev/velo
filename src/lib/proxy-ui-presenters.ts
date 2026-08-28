import { compareProxyPriority, type ProxyVerdict, type SafeProxyView } from "./proxy-operations.ts";

export type ProxyPoolSummary = {
  readonly healthy: number;
  readonly degraded: number;
  readonly blocked: number;
  readonly stale: number;
  readonly disabled: number;
};

export type DisplayRouteStatus = {
  readonly key: ProxyVerdict | "disabled" | "held";
  readonly label: string;
  readonly tone: "subtle" | "accent" | "success" | "warn" | "danger";
};

export type ValidationRunControls = {
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly cancelLabel: "Cancel run" | "Cancel remaining checks";
};

export function orderedProxyRoutes(routes: readonly SafeProxyView[]): readonly SafeProxyView[] {
  return [...routes].sort(compareProxyPriority);
}

export function proxyPoolSummary(routes: readonly SafeProxyView[]): ProxyPoolSummary {
  return {
    healthy: routes.filter(
      (route) => route.verdict === "healthy" && route.enabled && route.eligible,
    ).length,
    degraded: routes.filter((route) => route.verdict === "degraded").length,
    blocked: routes.filter(
      (route) =>
        route.verdict === "blocked" ||
        route.verdict === "unreachable" ||
        route.verdict === "unsafe_tls",
    ).length,
    stale: routes.filter((route) => route.stale).length,
    disabled: routes.filter((route) => !route.enabled).length,
  };
}

export function validationRunControls(
  run: {
    readonly status: string;
    readonly total: number;
    readonly completed: number;
    readonly cancelRequested: boolean;
  } | null,
): ValidationRunControls {
  const unfinished = run !== null && run.completed < run.total;
  const canResume =
    unfinished &&
    !run.cancelRequested &&
    (run.status === "pending" || run.status === "partial" || run.status === "failed");
  const canCancel =
    unfinished && !run.cancelRequested && run.status !== "completed" && run.status !== "cancelled";
  return {
    canResume,
    canCancel,
    cancelLabel:
      run?.status === "partial" || run?.status === "failed"
        ? "Cancel remaining checks"
        : "Cancel run",
  };
}

export function evidenceFreshness(
  route: Pick<SafeProxyView, "lastCheckedAt" | "stale">,
): "No completed check" | "Evidence older than one hour" | "Evidence current" {
  if (route.lastCheckedAt === null) return "No completed check";
  return route.stale ? "Evidence older than one hour" : "Evidence current";
}

export function displayRouteStatus(
  route: Pick<SafeProxyView, "enabled" | "eligible" | "verdict">,
): DisplayRouteStatus {
  if (!route.enabled) return { key: "disabled", label: "Disabled", tone: "subtle" };
  if (!route.eligible) return { key: "held", label: "Held from routing", tone: "warn" };
  switch (route.verdict) {
    case "healthy":
      return { key: route.verdict, label: "Healthy", tone: "success" };
    case "degraded":
      return { key: route.verdict, label: "Degraded", tone: "warn" };
    case "blocked":
      return { key: route.verdict, label: "Blocked", tone: "danger" };
    case "unreachable":
      return { key: route.verdict, label: "Unreachable", tone: "danger" };
    case "unsafe_tls":
      return { key: route.verdict, label: "TLS unsafe", tone: "danger" };
    case "misconfigured":
      return { key: route.verdict, label: "Needs configuration", tone: "warn" };
    case "checking":
      return { key: route.verdict, label: "Checking", tone: "accent" };
    case "unknown":
      return { key: route.verdict, label: "Not checked", tone: "subtle" };
    default:
      return assertNever(route.verdict);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected proxy verdict: ${String(value)}`);
}
