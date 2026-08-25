/** Better Auth cookie is `token` or `token.signature`. Compare on the token id. */
export function sessionTokenKey(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const dot = trimmed.indexOf(".");
  return (dot > 0 ? trimmed.slice(0, dot) : trimmed).trim();
}

export function readSessionTokenFromHeaders(headers: Headers): string {
  const auth = headers.get("authorization") ?? headers.get("Authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return sessionTokenKey(auth.slice(7));
  return "";
}
