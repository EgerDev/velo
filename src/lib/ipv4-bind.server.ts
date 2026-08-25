/**
 * YouTube stamps `ip=` on videoplayback to whoever called the player API.
 * Dual-path hosts (ULA IPv6 + NAT IPv4) 403 unless player and CDN share a family.
 * Direct hops: pin IPv4. SOCKS hops: omit --force-ipv4; socks5h owns family.
 */
import dns from "node:dns";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";

export const IPV4_BIND = "ipv4first" as const;

let pinned = false;

export function pinIpv4(): typeof IPV4_BIND {
  if (pinned) return IPV4_BIND;
  pinned = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* Node < 17 */
  }
  try {
    net.setDefaultAutoSelectFamily(false);
  } catch {
    /* Node without Happy Eyeballs toggle */
  }
  try {
    const origLookup = dns.lookup.bind(dns);
    dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
      if (typeof options === "function") {
        return origLookup(hostname, { family: 4 }, options as never);
      }
      const opts =
        typeof options === "number" ? { family: 4 } : { ...(options as object), family: 4 };
      return origLookup(hostname, opts as never, callback as never);
    }) as typeof dns.lookup;
  } catch {
    /* lookup pin is best-effort */
  }
  try {
    const require = createRequire(import.meta.url);
    const undici = require("undici") as {
      Agent: new (opts: { connect: { family: number; autoSelectFamily: boolean } }) => unknown;
      setGlobalDispatcher: (dispatcher: unknown) => void;
    };
    undici.setGlobalDispatcher(new undici.Agent({ connect: { family: 4, autoSelectFamily: false } }));
  } catch {
    /* undici not resolvable — dns/net pins still apply */
  }
  return IPV4_BIND;
}

pinIpv4();

/** RFC 4193 ULA fc00::/7 (includes fd00::/8, e.g. fda3:…). */
export function isUlaAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!trimmed.includes(":")) return false;
  return trimmed.startsWith("fc") || trimmed.startsWith("fd");
}

export function isNonRoutableV6(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!trimmed.includes(":")) return false;
  if (isUlaAddress(trimmed)) return true;
  if (trimmed === "::1" || trimmed.startsWith("::1")) return true;
  if (trimmed.startsWith("fe8") || trimmed.startsWith("fe9") || trimmed.startsWith("fea") || trimmed.startsWith("feb")) {
    return true;
  }
  return false;
}

export function playbackIp(raw: string): string | null {
  try {
    const fromUrl = new URL(raw.includes("://") ? raw : `https://x/?${raw}`);
    const ip = fromUrl.searchParams.get("ip");
    if (ip) return ip;
  } catch {
    /* fall through */
  }
  return raw.match(/[?&]ip=([^&\s"'<>]+)/i)?.[1] ?? null;
}

export function detectIpv6Mismatch(text: string): boolean {
  const ip = playbackIp(text);
  if (ip && (ip.includes(":") || isUlaAddress(ip))) return true;
  const unable = /unable to download/i.test(text);
  const v6Talk = /ipv6|force-ipv6|network is unreachable|no remote ipv4/i.test(text);
  const v6Literal = /(?:^|[^\d.])(?:[0-9a-f]{1,4}:){2,}[0-9a-f:.]+/i.test(text);
  if (unable && (v6Talk || v6Literal)) return true;
  if (/HTTP Error 403|403: Forbidden/i.test(text) && (v6Talk || v6Literal || (ip?.includes(":") ?? false))) {
    return true;
  }
  return false;
}

export type Ipv6Diagnosis = {
  happyEyeballs: boolean | null;
  dnsOrder: string | null;
  v4: string[];
  v6: string[];
  hasUla: boolean;
  hasGlobalV6: boolean;
  mismatchRisk: boolean;
  playbackIp: string | null;
  hint: string | null;
};

export function ipv6Hint(): string {
  return "YouTube signed this file to a different network path than the one fetching it. Save already retries through a matching hop — wait a moment and try again.";
}

export function diagnoseIpv6(opts?: { playbackUrl?: string; stderr?: string }): Ipv6Diagnosis {
  const v4: string[] = [];
  const v6: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const row of addrs ?? []) {
      if (row.internal) continue;
      if (row.family === "IPv4" || (row.family as unknown) === 4) v4.push(row.address);
      if (row.family === "IPv6" || (row.family as unknown) === 6) v6.push(row.address);
    }
  }
  const hasUla = v6.some(isUlaAddress);
  const hasGlobalV6 = v6.some((ip) => !isNonRoutableV6(ip));
  let happyEyeballs: boolean | null = null;
  let dnsOrder: string | null = null;
  try {
    happyEyeballs = net.getDefaultAutoSelectFamily();
  } catch {
    happyEyeballs = null;
  }
  try {
    dnsOrder = dns.getDefaultResultOrder();
  } catch {
    dnsOrder = null;
  }
  const stamped = opts?.playbackUrl ? playbackIp(opts.playbackUrl) : null;
  const logMismatch = opts?.stderr ? detectIpv6Mismatch(opts.stderr) : false;
  const stampedBad = Boolean(stamped && (stamped.includes(":") || isUlaAddress(stamped)));
  const mismatchRisk = logMismatch || stampedBad || hasUla || (hasGlobalV6 && happyEyeballs !== false);
  return {
    happyEyeballs,
    dnsOrder,
    v4,
    v6,
    hasUla,
    hasGlobalV6,
    mismatchRisk,
    playbackIp: stamped,
    hint: mismatchRisk ? ipv6Hint() : null,
  };
}
