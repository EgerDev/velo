import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn("inline-flex items-baseline text-fg", className)}
      aria-label="Velo home"
    >
      <span className="font-display text-2xl tracking-[var(--tracking-display)]">Velo</span>
      {/* splice mark — a film cut, the brand device */}
      <span aria-hidden className="ml-1 inline-block h-[0.62em] w-[3px] -skew-x-12 self-center rounded-[1px] bg-accent" />
    </Link>
  );
}
