import { Link } from "@tanstack/react-router";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { GUEST } from "@/lib/guest-copy";

export function AccountChip() {
  const { isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="h-8 w-24 shrink-0 animate-pulse rounded-full bg-elevated" />;
  }
  return (
    <div className="flex min-w-0 items-center gap-3 text-fg">
      <SignedOut>
        <span className="hidden text-xs text-subtle sm:inline">{GUEST.chip}</span>
        <Link
          to="/login"
          className="glass inline-flex h-11 items-center rounded-md px-4 text-sm font-medium text-fg transition-[transform,box-shadow] duration-[var(--motion-quick)] hover:shadow-[var(--shadow-border-hover)] active:scale-[0.96]"
        >
          Sign in
        </Link>
      </SignedOut>
      <SignedIn>
        <div className="max-w-[min(16rem,50vw)] truncate">
          <UserButton />
        </div>
      </SignedIn>
    </div>
  );
}
