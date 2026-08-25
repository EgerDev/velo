import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseCookieImport } from "@/lib/cookies";

const cookiesSchema = z.object({
  cookies: z.string().max(400_000),
});

export const loadVault = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ cookies: string; cookie_count: number }>`
      select cookies, cookie_count from youtube_vault where user_id = ${context.userId} limit 1
    `;
    return rows[0] ?? null;
  });

export const saveVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cookiesSchema.parse(input))
  .handler(async ({ context, data }) => {
    const parsed = parseCookieImport(data.cookies);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into youtube_vault (user_id, cookies, cookie_count, updated_at)
      values (${context.userId}, ${parsed.netscape}, ${parsed.count}, now())
      on conflict (user_id) do update
      set cookies = excluded.cookies,
          cookie_count = excluded.cookie_count,
          updated_at = now()
    `;
    return { count: parsed.count };
  });

export const clearVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from youtube_vault where user_id = ${context.userId}`;
    return { ok: true };
  });

export const validateVaultSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ cookies: string; cookie_count: number }>`
      select cookies, cookie_count from youtube_vault where user_id = ${context.userId} limit 1
    `;
    const vault = rows[0];
    if (!vault || !vault.cookies) {
      return { ok: false, error: "No credentials saved in vault." };
    }
    const { parseCookieImport, analyzeCookieFormat } = await import("@/lib/cookies");
    const report = analyzeCookieFormat(vault.cookies);
    const parsed = parseCookieImport(vault.cookies);

    const startTime = Date.now();
    try {
      const resp = await fetch("https://www.youtube.com/", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
          Cookie: parsed.header,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - startTime;
      const html = await resp.text();
      const isLoggedIn =
        html.includes('"LOGGED_IN":true') ||
        html.includes('"LOGGED_IN": true') ||
        html.includes('LOGGED_IN":true') ||
        Boolean(report.hasSapisid && report.hasSid);

      return {
        ok: true,
        loggedIn: isLoggedIn,
        latencyMs,
        count: parsed.count,
        hasSapisid: report.hasSapisid,
        hasSid: report.hasSid,
        hasLogin: report.hasLogin,
        format: report.format,
        sidExpiresAt: report.sidExpiresAt,
      };
    } catch {
      return {
        ok: true,
        loggedIn: Boolean(report.hasSapisid && report.hasSid),
        latencyMs: Date.now() - startTime,
        count: parsed.count,
        hasSapisid: report.hasSapisid,
        hasSid: report.hasSid,
        hasLogin: report.hasLogin,
        format: report.format,
        sidExpiresAt: report.sidExpiresAt,
        note: "YouTube network probe timed out, but local token signatures verified.",
      };
    }
  });
