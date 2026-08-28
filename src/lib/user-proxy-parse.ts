/**
 * Pure parsing/redaction/masking for user-configured proxies. Import-free on
 * purpose: unit tests run this file under plain `node --test`, and both the
 * client and the server modules share it.
 */

export type ProxyProtocol = "http" | "socks5";

export type UserProxyRow = {
  id: string;
  /** host:port — masked unless the caller may manage proxies. */
  display: string;
  protocol: ProxyProtocol;
  ok: boolean | null;
  exitIp: string | null;
  checkedAt: number | null;
};

export type UserProxyList = {
  rows: UserProxyRow[];
  canManage: boolean;
  reason: string | null;
};

export type ProxyProbe = {
  ok: boolean;
  exitIp: null | string;
  error: null | string;
};

export const PROXY_INPUT_MAX = 255;

/**
 * Accept `IP:PORT`, `user:pass@IP:PORT`, or a full URL whose scheme matches the
 * selector (http/https -> http; socks5/socks5h -> socks5). A bare string
 * follows the selector. Socks4 is rejected: it has no v5 handshake, so
 * relabelling it `socks5h` just fails at version negotiation — the same reason
 * socks-pool.server.ts refuses it.
 *
 * Returns the canonical proxy URL and a credential-free display string.
 */
export function normalizeUserProxy(
  raw: string,
  protocol: ProxyProtocol,
): { url: string; display: string } | null {
  const input = raw.trim().slice(0, PROXY_INPUT_MAX);
  if (!input) return null;

  // A supplied scheme must agree with the selector. Preserve HTTPS because it
  // describes the client-to-proxy transport; normalize socks5h because yt-dlp
  // applies remote DNS when it builds its own argv.
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(input);
  const suppliedScheme = schemeMatch?.[0].slice(0, -3).toLowerCase() ?? null;
  const outputScheme = (() => {
    if (!suppliedScheme) return protocol;
    if (protocol === "http" && (suppliedScheme === "http" || suppliedScheme === "https")) {
      return suppliedScheme;
    }
    if (protocol === "socks5" && (suppliedScheme === "socks5" || suppliedScheme === "socks5h")) {
      return "socks5";
    }
    return null;
  })();
  if (!outputScheme) return null;
  const bare = schemeMatch ? input.slice(schemeMatch[0].length) : input;

  const at = bare.lastIndexOf("@");
  const authority = at >= 0 ? bare.slice(at + 1) : bare;
  const creds = at >= 0 ? bare.slice(0, at) : "";

  const colon = authority.lastIndexOf(":");
  if (colon <= 0) return null;
  const host = authority.slice(0, colon).trim();
  // Truncate any accidental path/query the caller pasted.
  const port = authority
    .slice(colon + 1)
    .split(/[/?#]/)[0]
    .trim();
  if (!host || !/^\d{1,5}$/.test(port)) return null;
  const portNum = Number(port);
  if (portNum < 1 || portNum > 65535) return null;

  // Host may be ipv4, a hostname, or [ipv6].
  const looksLikeIpv4 = /^\d+(\.\d+){3}$/.test(host);
  const validIpv4 =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every((octet) => Number(octet) <= 255);
  const hostOk = looksLikeIpv4
    ? validIpv4
    : /^\[[0-9a-f:.]+\]$/i.test(host) ||
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
  if (!hostOk) return null;

  const credentialSeparator = creds.indexOf(":");
  if (creds && (credentialSeparator <= 0 || credentialSeparator === creds.length - 1)) return null;
  const credsPart = creds
    ? `${encodeURIComponent(creds.slice(0, credentialSeparator))}:${encodeURIComponent(creds.slice(credentialSeparator + 1))}`
    : "";
  const credsPrefix = creds ? `${credsPart}@` : "";
  return {
    url: `${outputScheme}://${credsPrefix}${host}:${port}`,
    display: `${host}:${port}`,
  };
}

/**
 * Mask a `host:port` display for non-operators. Keeps the first octet / label
 * so rows remain tellable apart, hides the rest.
 */
export function maskProxyDisplay(display: string): string {
  const colon = display.lastIndexOf(":");
  const host = colon >= 0 ? display.slice(0, colon) : display;
  const port = colon >= 0 ? display.slice(colon + 1) : "";
  if (host.startsWith("[")) return `[ipv6]:${port}`;
  const first = host.split(".")[0] ?? host;
  return `${first}.x.x:${port}`;
}

/**
 * Scrub proxy credentials (and any other full-authority URL) from an error
 * string before it reaches a client or the log. Mirrors the ytdlp-auth
 * redaction, which is not exported from that module.
 */
export function redactProxyUrl(text: string): string {
  return text.replace(/\b(socks[45]?[ah]?|https?):\/\/[^\s/]+/gi, "$1://***");
}

export function proxyUrlExists(
  rows: readonly { readonly url: string }[],
  candidate: string,
): boolean {
  return rows.some((row) => row.url === candidate);
}
