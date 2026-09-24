/** Fail closed: production must not boot with auth enabled but no broker client. */
export function assertAuthConfiguredForProduction(input: {
  nodeEnv: string | undefined;
  authDisabled: boolean;
  authConfigured: boolean;
}): void {
  if (input.nodeEnv === "production" && !input.authDisabled && !input.authConfigured) {
    throw new Error("[auth] GROK_AUTH_CLIENT_ID/GROK_AUTH_CLIENT_SECRET are required in production.");
  }
}
