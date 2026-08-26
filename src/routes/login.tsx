import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, Navigate, useNavigate, useRouter } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  applySessionBearer,
  describeAuthError,
  describeOAuthSearch,
  emailAuthFetchOptions,
  type AuthErrorInfo,
} from "@/lib/capture-auth-token";
import { redeemSignInLink, requestSignInLink, signInLinkStatus } from "@/lib/sign-in-link";
import { isolateOwnSession } from "@/lib/session-isolation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/wordmark";
import { GUEST } from "@/lib/guest-copy";

type LoginSearch = { error?: string; error_description?: string; link?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === "string" ? search.error : undefined,
    error_description: typeof search.error_description === "string" ? search.error_description : undefined,
    link: typeof search.link === "string" ? search.link : undefined,
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"signin" | "signup" | "link">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthErrorInfo | null>(
    describeOAuthSearch(search.error, search.error_description),
  );
  const [busy, setBusy] = useState<"oauth" | "email" | "link" | null>(null);
  const [oauthId, setOauthId] = useState<string | null>(null);
  const [magicPath, setMagicPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Sign-in links are only offered where the server allows them — this app
  // can't send email, so the token comes back to the caller and the flow stays
  // gated. Assume off until told otherwise so the option never flashes in.
  const [linkOffered, setLinkOffered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signInLinkStatus()
      .then((status) => {
        if (!cancelled) setLinkOffered(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setLinkOffered(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!search.link) return;
    let cancelled = false;
    setBusy("link");
    redeemSignInLink({ data: { token: search.link } })
      .then(async (result) => {
        if (cancelled) return;
        applySessionBearer(result.token);
        try {
          await authClient.getSession();
        } catch {
          /* store recovers */
        }
        try {
          await isolateOwnSession();
        } catch {
          /* still signed in */
        }
        await router.invalidate();
        await navigate({ to: "/" });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeAuthError(err instanceof Error ? err.message : "That sign-in link failed."));
        setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [search.link, navigate, router]);

  if (!isPending && user) return <Navigate to="/" />;

  async function finishEmailSession() {
    try {
      await authClient.getSession();
    } catch {
      /* session store recovers */
    }
    try {
      await isolateOwnSession();
    } catch {
      /* still signed in */
    }
    await router.invalidate();
    await navigate({ to: "/" });
  }

  async function handleOAuth(providerId: string) {
    setError(null);
    setBusy("oauth");
    setOauthId(providerId);
    try {
      await signIn(providerId, { callbackURL: "/", errorCallbackURL: "/login?error=oauth" });
      await finishEmailSession();
    } catch (err) {
      setError(describeAuthError(err instanceof Error ? err.message : "Google sign-in failed."));
    } finally {
      setBusy(null);
      setOauthId(null);
    }
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "link") {
      setBusy("link");
      try {
        const result = await requestSignInLink({
          data: { email: email.trim(), origin: window.location.origin },
        });
        setMagicPath(result.path);
      } catch (err) {
        setError(describeAuthError(err instanceof Error ? err.message : "Could not create a sign-in link."));
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy("email");
    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.trim().split("@")[0] || "Velo",
          fetchOptions: emailAuthFetchOptions,
        });
        if (result.error) {
          const message = result.error.message || "Could not create account.";
          if (/already exists/i.test(message)) setMode("signin");
          throw new Error(message);
        }
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          fetchOptions: emailAuthFetchOptions,
        });
        if (result.error) throw new Error(result.error.message || "Could not sign in.");
      }
      await finishEmailSession();
    } catch (err) {
      setError(describeAuthError(err instanceof Error ? err.message : "Sign-in failed."));
    } finally {
      setBusy(null);
    }
  }

  const magicHref = magicPath ? `${typeof window !== "undefined" ? window.location.origin : ""}${magicPath}` : "";

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
          {mode === "signup" ? "Create an account" : mode === "link" ? "Email a sign-in link" : "Sign in"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{GUEST.login}</p>

        {error ? (
          <div className="panel mt-6 px-4 py-4" role="alert" aria-live="assertive">
            <p className="text-sm text-danger">{error.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{error.detail}</p>
            <p className="mt-1 text-xs text-fg">{error.action}</p>
          </div>
        ) : null}

        {authEnabled ? (
          <div className="mt-8 space-y-3">
            {GROK_PROVIDERS.map((provider) => (
              <Button
                key={provider.providerId}
                type="button"
                variant="secondary"
                className="h-12 w-full gap-2"
                disabled={busy !== null}
                onClick={() => void handleOAuth(provider.providerId)}
              >
                <ProviderMark id={provider.providerId} />
                {busy === "oauth" && oauthId === provider.providerId
                  ? `Finish ${provider.label} in the pop-up…`
                  : `Continue with ${provider.label}`}
              </Button>
            ))}

            <div className="flex items-center gap-3 py-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-subtle">or email</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <form className="space-y-3" onSubmit={(event) => void handleEmail(event)}>
              {mode === "signup" ? (
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Name</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Name"
                    autoComplete="name"
                    className="h-12"
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-xs text-muted">Email</span>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@email.com"
                  autoComplete="email"
                  inputMode="email"
                  className="h-12"
                />
              </label>
              {mode !== "link" ? (
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Password</span>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className="h-12"
                  />
                </label>
              ) : (
                <p className="text-xs leading-relaxed text-muted">
                  We can’t send email from this preview. You’ll get a one-time link to copy — it signs
                  you in on this browser for 15 minutes.
                </p>
              )}
              {magicPath ? (
                <div className="space-y-2 rounded-md bg-elevated px-3 py-3 text-xs text-muted shadow-[var(--shadow-border)]">
                  <p className="break-all text-fg">{magicHref}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 w-full"
                    onClick={() => {
                      void navigator.clipboard.writeText(magicHref).then(() => setCopied(true));
                    }}
                  >
                    {copied ? "Copied" : "Copy sign-in link"}
                  </Button>
                </div>
              ) : null}
              {error && busy !== "oauth" ? null : null}
              <Button type="submit" className="h-12 w-full" disabled={busy !== null}>
                {busy === "email" || busy === "link"
                  ? "Working…"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "link"
                      ? "Create sign-in link"
                      : "Sign in with email"}
              </Button>
            </form>

            <div className="space-y-1 pt-1 text-center text-sm text-muted">
              {linkOffered || mode === "link" ? (
                <button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setMode(mode === "link" ? "signin" : "link");
                    setError(null);
                    setMagicPath(null);
                  }}
                >
                  {mode === "link" ? "Use a password instead" : "Email me a sign-in link"}
                </button>
              ) : null}
              {mode !== "link" ? (
                <button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setMode(mode === "signup" ? "signin" : "signup");
                    setError(null);
                  }}
                >
                  {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted">Sign-in is disabled.</p>
        )}

        <Link to="/" className="mt-10 block text-sm text-muted">
          {GUEST.continueGuest}
        </Link>
      </div>
    </main>
  );
}

function ProviderMark({ id }: { id: string }) {
  if (id.includes("google")) {
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
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.09l-4.77-6.23L6.2 22H2.94l8.02-9.16L1.5 2h6.24l4.31 5.7L18.244 2Zm-1.07 18.05h1.7L7.01 3.86H5.19l11.98 16.19Z"
      />
    </svg>
  );
}
