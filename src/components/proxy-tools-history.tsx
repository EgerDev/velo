import { type RefObject, useState } from "react";
import { History, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProxyHistory } from "@/lib/user-proxy-repository.server";

const EVENT_FILTERS = ["all", "added", "enabled", "disabled", "validated", "deleted"] as const;
type EventFilter = (typeof EVENT_FILTERS)[number];
type DateFilter = "all" | "today" | "7d" | "older";

function isDateFilter(value: string): value is DateFilter {
  return value === "all" || value === "today" || value === "7d" || value === "older";
}

function isProtocolFilter(value: string): value is "all" | ProxyHistory["protocol"] {
  return value === "all" || value === "http" || value === "socks5";
}

function eventLabel(eventType: ProxyHistory["eventType"]): string {
  switch (eventType) {
    case "added":
      return "Added";
    case "updated":
      return "Updated";
    case "enabled":
      return "Enabled";
    case "disabled":
      return "Disabled";
    case "reordered":
      return "Reordered";
    case "validated":
      return "Validated";
    case "deleted":
      return "Deleted";
    default:
      return assertNever(eventType);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected history event: ${String(value)}`);
}

export function ProxyToolsHistory({
  history,
  canManage,
  clearing,
  hasMore,
  loadingMore,
  onLoadMore,
  clearTriggerRef,
  onClear,
}: {
  readonly history: readonly ProxyHistory[];
  readonly canManage: boolean;
  readonly clearing: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly clearTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly onClear: () => void;
}) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [protocol, setProtocol] = useState<"all" | ProxyHistory["protocol"]>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const now = Date.now();
  const rows = history.filter((row) => {
    const age = now - row.createdAt;
    const dateMatch =
      date === "all" ||
      (date === "today" && age < 86_400_000) ||
      (date === "7d" && age < 604_800_000) ||
      (date === "older" && age >= 604_800_000);
    return (
      dateMatch &&
      (filter === "all" || row.eventType === filter) &&
      (protocol === "all" || row.protocol === protocol)
    );
  });

  return (
    <section
      aria-labelledby="proxy-history-title"
      className="rounded-xl bg-surface shadow-[var(--shadow-border)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <History className="mt-0.5 size-5 text-accent" />
          <div>
            <h4 id="proxy-history-title" className="font-display text-lg text-fg">
              Sanitized route history
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Only masked route references and safe outcomes are retained.
            </p>
          </div>
        </div>
        {canManage && history.length ? (
          <Button
            ref={clearTriggerRef}
            type="button"
            size="sm"
            variant="ghost"
            disabled={clearing}
            onClick={onClear}
          >
            {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}Clear checks
          </Button>
        ) : null}
      </header>
      <div
        className="flex gap-2 overflow-x-auto border-b border-border px-4 py-3 sm:px-5"
        role="group"
        aria-label="Filter route history"
      >
        {EVENT_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={cn(
              "min-h-11 shrink-0 rounded-md px-3 font-mono text-xs uppercase transition-colors duration-[var(--motion-quick)]",
              filter === option
                ? "bg-accent text-accent-fg"
                : "bg-elevated text-muted hover:text-fg",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-5">
        <select
          aria-label="Filter history by protocol"
          value={protocol}
          onChange={(event) => {
            if (isProtocolFilter(event.target.value)) setProtocol(event.target.value);
          }}
          className="min-h-11 rounded-md bg-elevated px-3 font-mono text-xs text-fg shadow-[var(--shadow-border)]"
        >
          <option value="all">All protocols</option>
          <option value="http">HTTP</option>
          <option value="socks5">SOCKS5</option>
        </select>
        <select
          aria-label="Filter history by date"
          value={date}
          onChange={(event) => {
            if (isDateFilter(event.target.value)) setDate(event.target.value);
          }}
          className="min-h-11 rounded-md bg-elevated px-3 font-mono text-xs text-fg shadow-[var(--shadow-border)]"
        >
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="older">Older</option>
        </select>
      </div>
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase text-muted">
                  {eventLabel(row.eventType)} · {row.protocol}
                </p>
                <p className="mt-1 break-all font-mono text-sm text-fg">{row.maskedLabel}</p>
              </div>
              <p className="font-mono text-xs text-subtle">
                {row.verdict ?? row.errorCode ?? "Recorded"} ·{" "}
                {new Date(row.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-sm text-muted sm:px-5">
          No matching history is retained yet.
        </div>
      )}
      {hasMore ? (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Button
            type="button"
            size="default"
            variant="outline"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? <Loader2 className="animate-spin" /> : null}Load 50 more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
