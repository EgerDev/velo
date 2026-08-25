import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    await sql`delete from "verification" where value = ${tokenHash}`;
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
