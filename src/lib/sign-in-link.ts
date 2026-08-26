import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  rateLimited,
  signInLinkAvailability,
  signInLinkDenial,
  type RateState,
  type SignInLinkAvailability,
} from "@/lib/sign-in-link-policy";

/**
 * The token is handed back to the caller rather than emailed, so this endpoint
 * is only as safe as the gate in front of it. See `sign-in-link-policy` for the
 * rules and the environment variables that open it.
 */
async function availability(): Promise<SignInLinkAvailability> {
  const { authConfigured } = await import("@/lib/auth/server");
  return signInLinkAvailability({
    override: process.env.VELO_SIGNIN_LINK,
    allowlist: process.env.VELO_SIGNIN_LINK_EMAILS,
    authConfigured,
  });
}

/** Per-process throttle; minting writes a user row and a verification row. */
const attempts: RateState = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL_LIMIT = 5;
const PER_IP_LIMIT = 10;

async function throttle(email: string): Promise<void> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { clientIp } = await import("@/lib/guest-limit.server");
  let ip = "unknown";
  try {
    const request = getRequest();
    if (request) ip = clientIp(request);
  } catch {
    // No request context (a direct server-side call) — the per-email limit
    // still applies.
  }
  const now = Date.now();
  // Evaluate both so a tripped IP doesn't stop the address from being counted.
  const ipHit = rateLimited(attempts, `ip:${ip}`, now, PER_IP_LIMIT, RATE_WINDOW_MS);
  const emailHit = rateLimited(attempts, `email:${email}`, now, PER_EMAIL_LIMIT, RATE_WINDOW_MS);
  if (ipHit || emailHit) {
    throw new Error("Too many sign-in link requests. Wait a few minutes, then try again.");
  }
}

/** Whether the login page should offer the sign-in-link option at all. */
export const signInLinkStatus = createServerFn({ method: "GET" }).handler(async () => {
  const available = await availability();
  return { enabled: available.enabled, restricted: available.allowlist.length > 0 };
});

const emailSchema = z
  .object({
    email: z.string().trim().email().max(200),
    origin: z.string().max(200).optional(),
  })
  .transform((value) => ({
    email: value.email.toLowerCase(),
    origin: value.origin,
  }));

const tokenSchema = z.object({
  token: z.string().min(16).max(128),
});

function displayName(email: string) {
  return email.split("@")[0] || "Velo";
}

async function hashToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

export const requestSignInLink = createServerFn({ method: "POST" })
  .validator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data }) => {
    const available = await availability();
    const denial = signInLinkDenial(data.email, available);
    // Refuse before touching the database: minting upserts a user row for the
    // address, so an ungated endpoint also creates accounts on demand.
    if (denial) throw new Error(denial);
    await throttle(data.email);
    const { randomBytes } = await import("node:crypto");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const userId = randomBytes(16).toString("hex");
    const token = randomBytes(24).toString("hex");
    const tokenHash = await hashToken(token);
    const name = displayName(data.email);
    await sql`
      insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, ${name}, ${data.email}, true, now(), now())
      on conflict ("email") do update set "updatedAt" = now()
    `;
    await sql`delete from "verification" where identifier = ${`velo-link:${data.email}`}`;
    const verificationId = randomBytes(16).toString("hex");
    await sql`
      insert into "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      values (${verificationId}, ${`velo-link:${data.email}`}, ${tokenHash}, now() + interval '15 minutes', now(), now())
    `;
    const path = `/login?link=${token}`;
    return { path, expiresMinutes: 15 };
  });

export const redeemSignInLink = createServerFn({ method: "POST" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    // Also gated: a token minted before the operator closed the flow must not
    // still be spendable afterwards.
    const available = await availability();
    if (!available.enabled) throw new Error(available.reason);
    const { randomBytes } = await import("node:crypto");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const tokenHash = await hashToken(data.token);
    const rows = await sql<{ identifier: string; value: string }>`
      select identifier, value from "verification"
      where value = ${tokenHash} and "expiresAt" > now()
      limit 1
    `;
    const row = rows[0];
    if (!row?.identifier.startsWith("velo-link:")) {
      throw new Error("That sign-in link is invalid or expired.");
    }
    const email = row.identifier.slice("velo-link:".length);
    // Spend the token before deciding — a refused redeem must not leave a live
    // token behind for another attempt.
    await sql`delete from "verification" where value = ${tokenHash}`;
    const denial = signInLinkDenial(email, available);
    if (denial) throw new Error(denial);
    const users = await sql<{ id: string }>`
      select id from "user" where email = ${email} limit 1
    `;
    const user = users[0];
    if (!user) throw new Error("No account for that sign-in link.");
    const sessionId = randomBytes(16).toString("hex");
    const sessionToken = randomBytes(32).toString("hex");
    await sql`
      delete from "session" where "userId" = ${user.id}
    `;
    await sql`
      insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
      values (${sessionId}, now() + interval '7 days', ${sessionToken}, now(), now(), ${user.id})
    `;
    return { token: sessionToken };
  });
