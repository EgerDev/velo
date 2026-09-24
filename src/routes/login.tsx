import { useState } from "react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { signInWithGoogle } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { describeAuthError, describeOAuthSearch, type AuthErrorInfo } from "@/lib/capture-auth-token";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { GUEST } from "@/lib/guest-copy";

type LoginSearch = { error?: string; error_description?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === "string" ? search.error : undefined,
    error_description: typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: Login,
});

function Login() {
  const search = Route.useSearch();
  const { user, isPending } = useCurrentUserState();
  const [error, setError] = useState<AuthErrorInfo | null>(
    describeOAuthSearch(search.error, search.error_description),
  );
  const [busy, setBusy] = useState(false);

  if (!isPending && user) return <Navigate to="/" />;

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      // Success leaves this page for Google; nothing after this line runs then.
      await signInWithGoogle({ callbackURL: "/", errorCallbackURL: "/login" });
    } catch (err) {
      setError(describeAuthError(err instanceof Error ? err.message : ""));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
      <a
        href="#signin"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to sign in
      </a>
      <div id="signin" className="mx-auto w-full max-w-md">
        <Wordmark />
        <h1 className="mt-10 font-display text-3xl leading-[var(--leading-display)] tracking-[var(--tracking-display)] text-fg sm:text-4xl">
          Sign in
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{GUEST.login}</p>

        {error ? (
          <div className="panel mt-6 px-4 py-4" role="alert" aria-live="assertive">
            <p className="text-sm text-danger">{error.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{error.detail}</p>
            <p className="mt-1 text-xs text-fg">{error.action}</p>
          </div>
        ) : null}

        <div className="mt-8">
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full gap-2"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void handleGoogle()}
          >
            <GoogleMark />
            {busy ? "Opening Google…" : "Continue with Google"}
          </Button>
        </div>

        <Link to="/" className="mt-10 block text-sm text-muted">
          {GUEST.continueGuest}
        </Link>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
