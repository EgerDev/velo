import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-md bg-elevated px-4 text-base text-fg shadow-[var(--shadow-border)] outline-none transition-[box-shadow,background-color] duration-[var(--motion-quick)] placeholder:text-subtle focus-visible:shadow-[var(--shadow-border-hover)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
