// Relative, not aliased: this module is covered by `node --test`, which has no
// bundler to resolve `@/`.
import { analyzeCookieFormat } from "./cookies.ts";

/**
 * The at-a-glance state of the saved YouTube session, for the header chip.
 *
 * Deliberately derived from the cookie jar itself, not from the network probe
 * in `validateVaultSession`: the jar is already in memory, so this costs
 * nothing and can't flap, and it answers the question that actually predicts a
 * failed download — "is this session still good?" — before the user starts one.
 *
 * `expiring` exists because YouTube's SID carries a real expiry: warning while
 * it is still usable is the whole point of reading expiry at all.
 */
export type SessionLevel = "none" | "unreadable" | "incomplete" | "expired" | "expiring" | "ready";

export type SessionStatus = {
  level: SessionLevel;
  /** Chip text. Short enough to sit in a header. */
  label: string;
  /** Fuller sentence for the tooltip / accessible name. */
  detail: string;
  count: number;
};

/** Warn once the session has less than this left. */
export const SESSION_EXPIRING_MS = 3 * 24 * 60 * 60 * 1000;

/** The cookies without which YouTube treats the request as a signed-out visitor. */
const CRITICAL = ["SID", "SAPISID", "__SECURE-1PSID", "__SECURE-3PSID"];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeSessionStatus(raw: string, now = Date.now()): SessionStatus {
  if (!raw.trim()) {
    return {
      level: "none",
      label: "No session",
      detail: "No YouTube cookies saved. Full HD and members-only videos need one.",
      count: 0,
    };
  }

  const report = analyzeCookieFormat(raw, now);
  if (report.count === 0) {
    return {
      level: "unreadable",
      label: "Session unreadable",
      detail: report.issues[0] ?? "That cookie export could not be read.",
      count: 0,
    };
  }

  const expiredCritical = report.expiredNames.filter((name) =>
    CRITICAL.includes(name.toUpperCase()),
  );
  if (expiredCritical.length > 0) {
    return {
      level: "expired",
      label: "Session expired",
      detail: `${expiredCritical.join(", ")} expired. Re-export from a signed-in YouTube tab.`,
      count: report.count,
    };
  }

  if (!report.hasSid && !report.hasSapisid) {
    return {
      level: "incomplete",
      label: "Session incomplete",
      detail: "No SID or SAPISID — YouTube will treat this as signed out.",
      count: report.count,
    };
  }

  const expiresAt = report.sidExpiresAt;
  // A SID whose instant has already passed is expired, not "ends in 0 hours".
  if (expiresAt != null && expiresAt * 1000 <= now) {
    return {
      level: "expired",
      label: "Session expired",
      detail: "SID expired. Re-export from a signed-in YouTube tab.",
      count: report.count,
    };
  }
  if (expiresAt && expiresAt * 1000 - now < SESSION_EXPIRING_MS) {
    const remainingMs = Math.max(0, expiresAt * 1000 - now);
    const hoursRounded = Math.round(remainingMs / (60 * 60 * 1000));
    // Under half an hour, rounding to hours says "0 hours" while the cookie
    // is still inside the window. Say the minutes that are actually left.
    const left =
      hoursRounded >= 24
        ? plural(Math.max(1, Math.round(hoursRounded / 24)), "day", "days")
        : hoursRounded >= 1
          ? plural(hoursRounded, "hour", "hours")
          : plural(Math.max(1, Math.round(remainingMs / (60 * 1000))), "minute", "minutes");
    return {
      level: "expiring",
      label: `Session ends in ${left}`,
      detail: `Your SID cookie expires in ${left}. Re-export before it does.`,
      count: report.count,
    };
  }

  return {
    level: "ready",
    label: "Session ready",
    detail: `${plural(report.count, "cookie", "cookies")} saved${
      expiresAt ? ` · SID valid until ${new Date(expiresAt * 1000).toLocaleDateString()}` : ""
    }.`,
    count: report.count,
  };
}
