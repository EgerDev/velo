import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HybridStep } from "@/lib/hybrid-download";

const ICON = {
  pending: Circle,
  running: Loader2,
  ok: Check,
  fail: X,
  skip: Minus,
} as const;

export function StepLog({ steps }: { steps: HybridStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="mt-4 space-y-0 border-l border-border pl-4">
      {steps.map((step) => {
        const Icon = ICON[step.status];
        return (
          <li key={step.id} className="relative py-1.5 text-xs">
            <span className="absolute -left-5 top-2 grid size-3.5 place-items-center bg-surface">
              <Icon
                className={cn(
                  "size-3.5",
                  step.status === "running" && "animate-spin text-fg",
                  step.status === "ok" && "text-fg",
                  step.status === "fail" && "text-danger",
                  (step.status === "pending" || step.status === "skip") && "text-subtle",
                )}
              />
            </span>
            <span className="min-w-0">
              <span className={step.status === "fail" ? "text-danger" : "text-muted"}>{step.label}</span>
              {step.detail ? (
                <span className="mt-0.5 block text-subtle">{step.detail}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}