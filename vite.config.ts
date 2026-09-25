import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "velo:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[velo] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

// Dev binds loopback by default; VELO_DEV_HOST / VELO_DEV_PORT override it
// (e.g. VELO_DEV_HOST=0.0.0.0 to reach it from another device). strictPort: a
// busy port fails loudly instead of silently moving the origin auth expects.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: process.env.VELO_DEV_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.VELO_DEV_PORT) || 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  ssr: {
    external: ["youtubei.js", "bgutils-js", "jsdom", "@electric-sql/pglite"],
  },
  plugins: [
    pgliteBootstrapPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // `.output/server/index.mjs` (`npm start`). Listens on NITRO_PORT ?? PORT
            // (default 3000) and NITRO_HOST || HOST (default: all interfaces).
            preset: "node-server",
            // Auto-registers server/plugins/* — env.ts is the boot-time config
            // check. Nitro v3 defaults serverDir to false, so removing this
            // silently drops that check.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
