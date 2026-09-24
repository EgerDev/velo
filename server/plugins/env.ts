import { definePlugin } from "nitro";
import { loadServerEnv } from "../../src/lib/env.server.ts";

/**
 * Fail closed at boot (roadmap C1). The node-server entry runs Nitro plugins
 * before it listens, so an `EnvError` here exits the process with a non-zero
 * code instead of serving. (The SSR bundle loads lazily on the first request,
 * which is why this check cannot live at module scope in `src/`.)
 *
 * Only the production build runs this file, and that build is production
 * whatever the shell says: Node never sets NODE_ENV, and a forgotten one must
 * not switch on the development defaults (random secret, loopback origins, no
 * Better Auth rate limit).
 */
export default definePlugin(() => {
  process.env.NODE_ENV = "production";
  loadServerEnv();
});
