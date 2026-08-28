import { getRequestIP } from "@tanstack/react-start/server";
import { authConfigured } from "@/lib/auth/verify.server";
import { operatorDecision, proxyManagementDecision } from "@/lib/tool-versions";

export type OperatorGate = {
  allowed: boolean;
  reason: string | null;
};

/**
 * Decide whether the verified user may mutate operator-managed runtime state.
 * This lives in a server-only module so client-facing server-function handles
 * never expose request, database, or environment APIs to Vite's client graph.
 */
export async function operatorGate(userId: string): Promise<OperatorGate> {
  let email: string | null = null;
  let clientIp: string | null = null;
  if (!authConfigured) {
    try {
      // Socket address, not a forwardable header — a LAN peer cannot claim it.
      clientIp = getRequestIP() ?? null;
    } catch {
      clientIp = null;
    }
  } else {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ email: string | null; emailVerified: boolean }>`
      select email, "emailVerified" from "user" where id = ${userId} limit 1`;
    email = rows[0]?.emailVerified ? (rows[0].email ?? null) : null;
  }
  const decision = operatorDecision({
    authConfigured,
    email,
    allowlist: process.env.VELO_ADMIN_EMAILS,
    clientIp,
    allowLocalInstall: process.env.VELO_ALLOW_TOOL_INSTALL === "1",
  });
  return decision.allowed
    ? { allowed: true, reason: null }
    : { allowed: false, reason: decision.reason };
}

/**
 * Proxy credentials are configuration, not executable package installation.
 * Keep their permission decision separate so the local workspace can expose
 * the proxy form while update buttons remain locked.
 */
export async function proxyManagementGate(userId: string): Promise<OperatorGate> {
  const operator = await operatorGate(userId);
  const decision = proxyManagementDecision({
    authConfigured,
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    operator: operator.allowed
      ? { allowed: true }
      : { allowed: false, reason: operator.reason ?? "Not allowed." },
  });
  return decision.allowed
    ? { allowed: true, reason: null }
    : { allowed: false, reason: decision.reason };
}
