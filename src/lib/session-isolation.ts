import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { sessionTokenKey } from "@/lib/session-token";

/**
 * Keep only this login. Other sessions for the same person are dropped so a
 * previous device or copied token cannot stay signed in. IP / user-agent are
 * cleared — we do not log logins.
 */
export const isolateOwnSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getCookie } = await import("@tanstack/react-start/server");
    const { getSql } = await import("@/lib/db");
    const { SESSION_COOKIE_PREFIX } = await import("@/lib/auth/auth-config.server");
    const token = sessionTokenKey(getCookie(`${SESSION_COOKIE_PREFIX}.session_token`));
    if (!token) return { ok: false as const };
    const sql = await getSql();
    const like = `${token}.%`;
    await sql`
      delete from "session"
      where "userId" = ${context.userId}
        and token != ${token}
        and token not like ${like}
    `;
    await sql`
      update "session"
      set "ipAddress" = null, "userAgent" = null
      where "userId" = ${context.userId}
        and (token = ${token} or token like ${like})
    `;
    return { ok: true as const };
  });
