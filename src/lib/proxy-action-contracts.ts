import { z } from "zod";

export type ProxyActionErrorCode = "forbidden" | "invalid_input" | "not_found" | "not_resumable" | "invalid_cursor" | "unavailable";
export class ProxyActionError extends Error {
  readonly code: ProxyActionErrorCode;
  constructor(code: ProxyActionErrorCode, message: string) { super(message); this.name = "ProxyActionError"; this.code = code; }
  toJSON(): { readonly code: ProxyActionErrorCode; readonly message: string } { return { code: this.code, message: this.message }; }
}

export type ProxyActionInvocation<Result> = {
  readonly userId: string;
  readonly gate: (userId: string) => Promise<void>;
  readonly run: () => Promise<Result>;
};

async function invokeProxyAction<Result>(invocation: ProxyActionInvocation<Result>): Promise<Result> {
  await invocation.gate(invocation.userId);
  return invocation.run();
}

/** The shared, injectable boundary used by every mutating/diagnostic proxy action. */
export const proxyActionHandlers = {
  listUserProxies: invokeProxyAction,
  addUserProxy: invokeProxyAction,
  removeUserProxy: invokeProxyAction,
  testUserProxy: invokeProxyAction,
  listProxyOperations: invokeProxyAction,
  runAllProxyValidations: invokeProxyAction,
  setProxyRouteEnabled: invokeProxyAction,
  reorderProxyRoutes: invokeProxyAction,
  clearProxyHistory: invokeProxyAction,
  testProxyValidation: invokeProxyAction,
  listProxyHistoryPage: invokeProxyAction,
  startProxyValidationRun: invokeProxyAction,
  resumeProxyValidationRun: invokeProxyAction,
  cancelProxyValidationRun: invokeProxyAction,
  getProxyValidationRun: invokeProxyAction,
} as const;
const historyQuerySchema = z.object({ limit: z.number().int().min(1).max(50).default(25), cursor: z.object({ createdAt: z.number().int().nonnegative(), id: z.string().uuid() }).optional(), status: z.enum(["unknown","checking","healthy","degraded","blocked","unreachable","unsafe_tls","misconfigured"]).optional(), protocol: z.enum(["http","socks5"]).optional(), from: z.number().int().nonnegative().optional(), to: z.number().int().nonnegative().optional() }).refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, { message: "Invalid date range" });
export function parseProxyHistoryQuery(input: unknown): z.infer<typeof historyQuerySchema> { return historyQuerySchema.parse(input); }
