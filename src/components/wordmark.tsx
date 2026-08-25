import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn("inline-flex items-center text-fg", className)}
      aria-label="Velo home"
    >
      <span className="font-display text-2xl tracking-[var(--tracking-display)]">Velo</span>
    </Link>
  );
}
