import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { TOOL_IDS, type ToolId, type ToolRow } from "@/lib/tool-versions";

export type { ToolRow, ToolId, ToolStatus } from "@/lib/tool-versions";
export type { UpdateResult } from "@/lib/tool-updates.server";

/**
 * Tools tab server functions. This file is dual client/server (the client
 * imports the server-fn handles), so every node-side module is imported
 * inside the handlers.
 */

export type ToolCheck = {
  rows: ToolRow[];
  /** Whether the caller may press Update. */
  canUpdate: boolean;
  /** Why not, when `canUpdate` is false. */
  reason: string | null;
  /** An install is running right now (from this or another tab). */
  busy: boolean;
  checkedAt: number;
};

/**
 * The operator gate. `authMiddleware` has already verified the session (or
 * resolved the dev user when auth is off); this only decides whether that
 * person is an operator. The email comes from the database by verified user
 * id, never from the client.
 */
async function operatorGate(userId: string): Promise<{ allowed: boolean; reason: string | null }> {
  const { authConfigured } = await import("@/lib/auth/verify.server");
  const { operatorDecision } = await import("@/lib/tool-versions");
  let email: string | null = null;
  let clientIp: string | null = null;
  if (!authConfigured) {
    // Socket address, not a forwardable header — a LAN peer cannot claim it.
    const { getRequestIP } = await import("@tanstack/react-start/server");
    try {
      clientIp = getRequestIP() ?? null;
    } catch {
      clientIp = null;
    }
  }
  if (authConfigured) {
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
  return decision.allowed ? { allowed: true, reason: null } : { allowed: false, reason: decision.reason };
}

export const checkToolUpdates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ force: z.boolean().optional() }).optional().parse(input))
  .handler(async ({ data, context }): Promise<ToolCheck> => {
    const { toolRows, updateInProgress } = await import("@/lib/tool-updates.server");
    const [rows, gate] = await Promise.all([toolRows(data?.force === true), operatorGate(context.userId)]);
    return {
      rows,
      canUpdate: gate.allowed,
      reason: gate.reason,
      busy: updateInProgress(),
      checkedAt: Date.now(),
    };
  });

export const updateTool = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: z.enum(TOOL_IDS) }).parse(input))
  .handler(async ({ data, context }) => {
    const gate = await operatorGate(context.userId);
    if (!gate.allowed) throw new Error(gate.reason ?? "Not allowed.");
    const { installTool } = await import("@/lib/tool-updates.server");
    return installTool(data.id as ToolId);
  });
