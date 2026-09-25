import { createServerFn } from "@tanstack/react-start";

/**
 * Whether Google sign-in is available on this server. Always true in
 * production (boot requires the Google credentials); false in development
 * until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 */
export const getSignInStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { authConfigured } = await import("./verify.server");
  return { google: authConfigured };
});
