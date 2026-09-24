import { createMiddleware } from "@tanstack/react-start";

/**
 * Auth middleware for server functions — the standard way to get the caller's
 * verified user id. The session cookie is same-origin and rides along
 * automatically; nothing is forwarded from the client.
 *
 * Use it on every server function that touches per-user data, and scope every
 * query by `context.userId`. Signed out → `UnauthorizedError` (401, see
 * `verify.server.ts`); a scripted cross-site request → `CrossSiteRequestError`
 * (403, see `isolation.server.ts`).
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // ONLY import `*.server` modules here. This file also ships to the client,
  // and a non-`.server` path would pull `@tanstack/react-start/server` (Node
  // `AsyncLocalStorage`) into the browser bundle.
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  // Reject scripted cross-site/sibling requests before touching per-user data.
  assertSameSiteRequest();
  const userId = await requireUserId();
  return next({ context: { userId } });
});
