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
    const { decryptCookies } = await import("@/lib/vault-crypto");
    const sql = await getSql();
    const rows = await sql<{ cookies: string; cookie_count: number }>`
      select cookies, cookie_count from youtube_vault where user_id = ${context.userId} limit 1
    `;
    const vault = rows[0];
    if (!vault) return null;
    // Stored encrypted at rest (or as a legacy plaintext row); only the
    // in-memory copy handed back here is cleartext.
    return { ...vault, cookies: decryptCookies(vault.cookies) };
  });

export const saveVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cookiesSchema.parse(input))
  .handler(async ({ context, data }) => {
    const parsed = parseCookieImport(data.cookies);
    const { getSql } = await import("@/lib/db");
    const { encryptCookies } = await import("@/lib/vault-crypto");
    const sql = await getSql();
    // The raw jar is a live Google session credential — encrypt it before it
    // touches the datastore (see vault-crypto for the envelope + key config).
    const storedCookies = encryptCookies(parsed.netscape);
    await sql`
      insert into youtube_vault (user_id, cookies, cookie_count, updated_at)
      values (${context.userId}, ${storedCookies}, ${parsed.count}, now())
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
    const { decryptCookies } = await import("@/lib/vault-crypto");
    const cookies = decryptCookies(vault.cookies);
    const report = analyzeCookieFormat(cookies);
    const parsed = parseCookieImport(cookies);

    const local = {
      count: parsed.count,
      hasSapisid: report.hasSapisid,
      hasSid: report.hasSid,
      hasLogin: report.hasLogin,
      format: report.format,
      sidExpiresAt: report.sidExpiresAt,
      expiredNames: report.expiredNames,
    };

    // `probe` says what YOUTUBE told us, and nothing else. It used to fall back
    // to "do the cookie names look right", which meant a timeout, an error
    // status, and an explicit LOGGED_IN:false all rendered as a verified live
    // session — the check could not fail. Cookie shape is reported separately
    // so the UI can say "saved but unverified" instead of inventing a verdict.
    const startedAt = Date.now();
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
      const latencyMs = Date.now() - startedAt;
      if (!resp.ok) {
        return {
          ok: true as const,
          probe: "unreachable" as const,
          reason: `YouTube answered ${resp.status}.`,
          latencyMs,
          ...local,
        };
      }
      const html = await resp.text();
      const flag = /"LOGGED_IN"\s*:\s*(true|false)/.exec(html)?.[1];
      if (flag === "true") {
        return { ok: true as const, probe: "live" as const, reason: null, latencyMs, ...local };
      }
      if (flag === "false") {
        return {
          ok: true as const,
          probe: "signed-out" as const,
          reason: "YouTube served this request as a signed-out visitor.",
          latencyMs,
          ...local,
        };
      }
      return {
        ok: true as const,
        probe: "unreachable" as const,
        reason: "YouTube's reply did not say whether the session is signed in.",
        latencyMs,
        ...local,
      };
    } catch {
      return {
        ok: true as const,
        probe: "unreachable" as const,
        reason: "Could not reach YouTube from the server (timed out).",
        // No answer means no round trip to report — a timeout is not latency.
        latencyMs: null,
        ...local,
      };
    }
  });
