import type { ReactNode } from "react";
import { Toaster } from "sonner";

/**
 * App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
 *
 *   <AuthProvider><Outlet /></AuthProvider>
 *
 * Better Auth's React client (`@/lib/auth/client`) needs no context provider —
 * its `useSession()` works standalone — so this only mounts the app-wide toaster.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          className:
            "!bg-elevated !text-fg !border-0 !shadow-[var(--shadow-border)] !font-sans",
        }}
      />
    </>
  );
}
