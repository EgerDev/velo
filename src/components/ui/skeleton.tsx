import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
        className={cn("shimmer rounded-md bg-elevated", className)}
      {...props}
    />
  );
}

export { Skeleton };
