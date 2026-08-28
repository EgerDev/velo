import { CheckCircle2, Loader2, Play, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BulkItem } from "@/lib/bulk-download";

export function BulkQueueItem(props: {
  item: BulkItem;
  index: number;
  onOpen?: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const { item, index } = props;
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-xl transition-colors",
        item.status === "downloading"
          ? "bg-accent/10 border border-accent/30"
          : item.status === "completed"
            ? "bg-success/5 hover:bg-success/10"
            : item.status === "failed"
              ? "bg-danger/5 hover:bg-danger/10"
              : "hover:bg-elevated/60",
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-[11px] font-mono text-subtle w-5 shrink-0 text-center">{index + 1}</span>
        <div className="relative size-12 rounded-lg overflow-hidden bg-black/40 shrink-0 border border-border/50">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt={item.title || item.id} className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="size-full flex items-center justify-center text-muted">
              <Play className="size-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => props.onOpen?.(item.url)}
            className="font-medium text-xs text-fg hover:text-accent cursor-pointer truncate text-left"
          >
            {item.title || `Video ID: ${item.id}`}
          </button>
          <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5 font-mono">
            <span>{item.author || "YouTube"}</span>
            {item.durationFormatted ? (
              <>
                <span>·</span>
                <span>{item.durationFormatted}</span>
              </>
            ) : null}
            {item.sizeFormatted ? (
              <>
                <span>·</span>
                <span>{item.sizeFormatted}</span>
              </>
            ) : null}
          </div>
          {item.error ? <p className="text-[11px] text-danger truncate mt-0.5">{item.error}</p> : null}
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-8 sm:pl-0">
        <div className="flex items-center gap-2">
          {item.status === "downloading" ? (
            <div className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-accent" />
              <span className="text-xs font-mono font-medium text-accent">{item.progress}%</span>
            </div>
          ) : item.status === "completed" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" />
              Done
            </span>
          ) : item.status === "failed" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
              <XCircle className="size-3.5" />
              Failed
            </span>
          ) : item.status === "resolving" ? (
            <span className="inline-flex items-center gap-1 text-xs text-subtle">
              <Loader2 className="size-3 animate-spin" />
              Checking...
            </span>
          ) : (
            <span className="text-xs text-subtle font-mono">Ready</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => props.onRemove(item.id)}
          disabled={item.status === "downloading"}
          className="text-subtle hover:text-danger p-1 rounded-md cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-subtle"
          title={item.status === "downloading" ? "Pause the queue to remove an active download" : "Remove from queue"}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
