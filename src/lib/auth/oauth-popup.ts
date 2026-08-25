/** Google blocks OAuth inside iframes. Use a popup in preview / framed apps. */
export function shouldUseOAuthPopup(hostname: string, framed: boolean): boolean {
  const host = hostname.toLowerCase();
  if (host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com")) return true;
  return framed;
}
