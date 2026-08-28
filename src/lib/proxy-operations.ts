import { z } from "zod";

export const PROTOCOLS = ["http", "socks5"] as const;
export type ProxyProtocol = (typeof PROTOCOLS)[number];
export const CAPABILITIES = ["metadata", "media", "ytdlp"] as const;
export type ProxyCapability = (typeof CAPABILITIES)[number];
export const VALIDATION_STAGES = ["connection", "tls", "route_probe", "metadata", "media_range"] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];
export const VERDICTS = ["unknown", "checking", "healthy", "degraded", "blocked", "unreachable", "unsafe_tls", "misconfigured"] as const;
export type ProxyVerdict = (typeof VERDICTS)[number];

export const ProxyIdSchema = z.string().min(1).max(64).brand("ProxyId");
export type ProxyId = z.infer<typeof ProxyIdSchema>;
export const PrioritySchema = z.number().int().positive().brand("Priority");
export type Priority = z.infer<typeof PrioritySchema>;
export const EpochMillisecondsSchema = z.number().int().nonnegative().brand("EpochMilliseconds");
export type EpochMilliseconds = z.infer<typeof EpochMillisecondsSchema>;
export const MillisecondsSchema = z.number().int().nonnegative().brand("Milliseconds");
export type Milliseconds = z.infer<typeof MillisecondsSchema>;
export const ByteCountSchema = z.number().int().nonnegative().brand("ByteCount");
export type ByteCount = z.infer<typeof ByteCountSchema>;

export const PROTOCOL_CAPABILITIES = {
  http: ["metadata", "media", "ytdlp"],
  socks5: ["ytdlp"],
} as const satisfies Readonly<Record<ProxyProtocol, readonly ProxyCapability[]>>;

export const SAFE_ERROR_CODES = ["connect_failed", "dns_failed", "connection_refused", "timeout", "certificate_invalid", "hostname_mismatch", "chain_invalid", "bot_wall", "login_required", "route_forbidden", "media_range_invalid", "optional_stage_failed", "credential_missing", "credential_undecryptable", "key_unstable", "proxy_authentication_failed", "invalid_configuration", "forbidden_proxy_address", "content_private", "content_age_restricted", "content_members_only", "content_deleted", "caller_abort"] as const;
export type SafeErrorCode = (typeof SAFE_ERROR_CODES)[number];
export const STAGE_OUTCOMES = ["passed", "failed", "skipped"] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

type StageEvidenceBase = {
  readonly stage: ValidationStage;
  readonly durationMs: Milliseconds | null;
  readonly httpStatus: number | null;
  readonly bytesRead: ByteCount | null;
};
export type StageEvidence = StageEvidenceBase & (
  | { readonly outcome: "passed" | "skipped"; readonly code: null }
  | { readonly outcome: "failed"; readonly code: SafeErrorCode }
);

export type ValidationOutcome =
  | { readonly kind: "never_checked" }
  | { readonly kind: "active_check" }
  | { readonly kind: "full_pass" }
  | { readonly kind: "connection" | "dns" | "refusal" | "timeout" }
  | { readonly kind: "certificate" | "hostname" | "chain" }
  | { readonly kind: "bot_wall" | "login_required" | "route_forbidden" }
  | { readonly kind: "media_range" | "optional_stage" }
  | { readonly kind: "credential_missing" | "credential_undecryptable" | "key_unstable" | "proxy_authentication_failed" | "invalid_configuration" | "forbidden_proxy_address" }
  | { readonly kind: "content_private" | "content_age_restricted" | "content_members_only" | "content_deleted" | "caller_abort" };

export type Classification =
  | { readonly attribution: "route"; readonly verdict: "healthy" | "degraded" | "blocked" | "unreachable" | "unsafe_tls" }
  | { readonly attribution: "configuration"; readonly verdict: "misconfigured" }
  | { readonly attribution: "content"; readonly verdict: null }
  | { readonly attribution: "none"; readonly verdict: "unknown" | "checking" };

export function classifyValidation(outcome: ValidationOutcome): Classification {
  switch (outcome.kind) {
    case "never_checked": return { attribution: "none", verdict: "unknown" };
    case "active_check": return { attribution: "none", verdict: "checking" };
    case "full_pass": return { attribution: "route", verdict: "healthy" };
    case "connection": case "dns": case "refusal": case "timeout":
      return { attribution: "route", verdict: "unreachable" };
    case "certificate": case "hostname": case "chain":
      return { attribution: "route", verdict: "unsafe_tls" };
    case "bot_wall": case "login_required": case "route_forbidden":
      return { attribution: "route", verdict: "blocked" };
    case "media_range": case "optional_stage":
      return { attribution: "route", verdict: "degraded" };
    case "credential_missing": case "credential_undecryptable": case "key_unstable": case "proxy_authentication_failed": case "invalid_configuration": case "forbidden_proxy_address":
      return { attribution: "configuration", verdict: "misconfigured" };
    case "content_private": case "content_age_restricted": case "content_members_only": case "content_deleted": case "caller_abort":
      return { attribution: "content", verdict: null };
    default: return assertNever(outcome);
  }
}

export type ProxyHealthState = {
  readonly verdict: ProxyVerdict;
  readonly hardFailures: number;
  readonly fullPasses: number;
  readonly eligible: boolean;
  readonly enabled: boolean;
  readonly lastCheckedAt: EpochMilliseconds | null;
};

export const INITIAL_PROXY_HEALTH: ProxyHealthState = {
  verdict: "unknown", hardFailures: 0, fullPasses: 0, eligible: true, enabled: true, lastCheckedAt: null,
};

export function transitionHealth(state: ProxyHealthState, result: Classification): ProxyHealthState {
  switch (result.attribution) {
    case "content": return state;
    case "configuration": return { ...state, verdict: result.verdict, hardFailures: 0, fullPasses: 0, eligible: false };
    case "none": return { ...state, verdict: result.verdict };
    case "route": return transitionRouteVerdict(state, result.verdict);
    default: return assertNever(result);
  }
}

function transitionRouteVerdict(state: ProxyHealthState, verdict: Extract<Classification, { readonly attribution: "route" }>["verdict"]): ProxyHealthState {
  switch (verdict) {
    case "blocked": case "unreachable": case "unsafe_tls": {
      const hardFailures = state.hardFailures + 1;
      return { ...state, verdict, hardFailures, fullPasses: 0, eligible: state.eligible && hardFailures < 2 };
    }
    case "degraded": return { ...state, verdict, hardFailures: 0, fullPasses: 0 };
    case "healthy": {
      const fullPasses = state.fullPasses + 1;
      if (fullPasses < 2) return { ...state, verdict, hardFailures: state.eligible ? 0 : state.hardFailures, fullPasses };
      return { ...state, verdict, hardFailures: 0, fullPasses: 0, eligible: true };
    }
    default: return assertNever(verdict);
  }
}

export function setRouteEnabled(state: ProxyHealthState, enabled: boolean): ProxyHealthState {
  return { ...state, enabled };
}

export function isRouteUsable(state: ProxyHealthState): boolean {
  return state.enabled && state.eligible;
}

export type Clock = { readonly now: () => EpochMilliseconds };
export function isEvidenceStale(lastCheckedAt: EpochMilliseconds | null, clock: Clock): boolean {
  return lastCheckedAt !== null && clock.now() - lastCheckedAt >= 3_600_000;
}

export type SafeProxyView = {
  readonly id: ProxyId;
  readonly routeRef: string;
  readonly maskedLabel: string;
  readonly protocol: ProxyProtocol;
  readonly priority: Priority;
  readonly enabled: boolean;
  readonly eligible: boolean;
  readonly verdict: ProxyVerdict;
  readonly stale: boolean;
  readonly lastCheckedAt: EpochMilliseconds | null;
  readonly evidence: readonly StageEvidence[];
};

export function toSafeProxyView(route: SafeProxyView): SafeProxyView {
  const { id, routeRef, maskedLabel, protocol, priority, enabled, eligible, verdict, stale, lastCheckedAt, evidence } = route;
  return { id, routeRef, maskedLabel, protocol, priority, enabled, eligible, verdict, stale, lastCheckedAt, evidence: evidence.map(sanitizeEvidence) };
}

function sanitizeEvidence(item: StageEvidence): StageEvidence {
  const { stage, durationMs, httpStatus, bytesRead } = item;
  switch (item.outcome) {
    case "passed": return { stage, outcome: item.outcome, durationMs, code: item.code, httpStatus, bytesRead };
    case "failed": return { stage, outcome: item.outcome, durationMs, code: item.code, httpStatus, bytesRead };
    case "skipped": return { stage, outcome: item.outcome, durationMs, code: item.code, httpStatus, bytesRead };
    default: return assertNever(item);
  }
}

export function compareProxyPriority(left: Pick<SafeProxyView, "priority" | "id">, right: Pick<SafeProxyView, "priority" | "id">): number {
  const byPriority = left.priority - right.priority;
  return byPriority !== 0 ? byPriority : left.id.localeCompare(right.id);
}

const ProxyHealthStateSchema = z.object({
  verdict: z.enum(VERDICTS), hardFailures: z.number().int().nonnegative(), fullPasses: z.number().int().nonnegative(), eligible: z.boolean(), enabled: z.boolean(), lastCheckedAt: EpochMillisecondsSchema.nullable(),
}).readonly();
export type ParseHealthFailure = { readonly kind: "invalid_proxy_health_state" };
export type ParseHealthResult = { readonly ok: true; readonly value: ProxyHealthState } | { readonly ok: false; readonly error: ParseHealthFailure };
export function parseProxyHealthState(input: unknown): ParseHealthResult {
  const parsed = ProxyHealthStateSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: { kind: "invalid_proxy_health_state" } };
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected proxy domain variant: ${String(value)}`);
}
