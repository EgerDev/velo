import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppErrorComponent({ error, reset }: ErrorComponentProps) {
  // Not `instanceof Error`: server-fn errors can arrive as plain { message } objects.
  const raw = (error as { message?: unknown } | null | undefined)?.message;
  const message =
    typeof raw === "string"
      ? raw
      : typeof error === "string"
        ? error
        : "An unexpected error occurred. Try reloading the page.";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="font-display text-2xl tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-muted">{message}</p>
      {/* A render error used to strand the user here with no way out but
          knowing to reload. reset() re-renders in place; reload is the fallback. */}
      <div className="mt-2 flex gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </main>
  );
}

/** A stale or mistyped link used to land on a bare "Not Found" with no way home. */
export function AppNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <p className="font-mono text-xs uppercase tracking-[var(--tracking-wide)] text-subtle">404</p>
      <h1 className="font-display text-2xl tracking-tight">This page doesn’t exist</h1>
      <p className="max-w-md text-sm text-muted">The link may be old or mistyped.</p>
      <Button asChild className="mt-2">
        <a href="/">Back to Velo</a>
      </Button>
    </main>
  );
}
