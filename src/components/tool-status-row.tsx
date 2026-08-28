import { ArrowUpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolRow } from "@/lib/tool-updates";

const STATUS_LABEL: Record<ToolRow["status"], string> = {
  current: "Up to date",
  behind: "Update available",
  ahead: "Ahead",
  unknown: "Registry unreachable",
  missing: "Not installed",
};

export function ToolStatusRow({
  row,
  canUpdate,
  isUpdating,
  onUpdate,
}: {
  readonly row: ToolRow;
  readonly canUpdate: boolean;
  readonly isUpdating: boolean;
  readonly onUpdate: () => void;
}) {
  const behind = row.status === "behind";
  const actionable = behind || row.status === "missing";
  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-fg">{row.label}</p>
          <span
            className={cn(
              "font-mono text-xs",
              row.status === "current" && "text-success",
              row.status === "behind" && "text-warn",
              (row.status === "missing" || row.status === "unknown" || row.status === "ahead") &&
                "text-muted",
            )}
            title={row.note}
          >
            {STATUS_LABEL[row.status]}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{row.role}</p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <dl className="grid grid-cols-[auto_auto] gap-x-3 font-mono text-xs tabular-nums">
          <dt className="text-subtle">installed</dt>
          <dd className="text-fg">{row.current ?? "—"}</dd>
          <dt className="text-subtle">latest</dt>
          <dd className={cn(behind ? "text-warn" : "text-fg")}>{row.latest ?? "—"}</dd>
        </dl>
        {canUpdate && actionable ? (
          <Button
            type="button"
            size="default"
            variant={behind ? "default" : "outline"}
            aria-label={`Update ${row.label}`}
            onClick={onUpdate}
          >
            {isUpdating ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
            {isUpdating ? "Installing" : row.status === "missing" ? "Install" : "Update"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
