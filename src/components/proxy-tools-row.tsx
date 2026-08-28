import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleX,
  Loader2,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { restoreFocusAfterCancel } from "@/lib/proxy-confirmation-focus";
import { cn } from "@/lib/utils";
import {
  displayRouteStatus,
  evidenceFreshness,
  type DisplayRouteStatus,
} from "@/lib/proxy-ui-presenters";
import { assertNever, type SafeProxyView } from "@/lib/proxy-operations";

const STATUS_ICONS = {
  disabled: Power,
  held: ShieldAlert,
  healthy: CheckCircle2,
  degraded: CircleAlert,
  blocked: CircleX,
  unreachable: CircleX,
  unsafe_tls: ShieldAlert,
  misconfigured: ShieldAlert,
  checking: Loader2,
  unknown: CircleAlert,
} satisfies Record<DisplayRouteStatus["key"], typeof CheckCircle2>;

const STATUS_TONES = {
  subtle: "text-subtle",
  accent: "text-accent",
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
} as const satisfies Record<DisplayRouteStatus["tone"], string>;

function evidenceAge(route: SafeProxyView): string {
  const freshness = evidenceFreshness(route);
  if (freshness !== "Evidence current") return freshness;
  if (route.lastCheckedAt === null) return freshness;
  return `Checked ${new Date(route.lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function stageLabel(stage: SafeProxyView["evidence"][number]["stage"]): string {
  switch (stage) {
    case "connection":
      return "Connection";
    case "tls":
      return "TLS";
    case "route_probe":
      return "Route probe";
    case "metadata":
      return "Metadata";
    case "media_range":
      return "Media range";
    default:
      return assertNever(stage);
  }
}

export function ProxyToolsRow({
  route,
  busy,
  canManage,
  isFirst,
  isLast,
  deletePending,
  onTest,
  onToggle,
  onMove,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  readonly route: SafeProxyView;
  readonly busy: string | null;
  readonly canManage: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly deletePending: boolean;
  readonly onTest: (route: SafeProxyView) => void;
  readonly onToggle: (route: SafeProxyView) => void;
  readonly onMove: (route: SafeProxyView, direction: "up" | "down") => void;
  readonly onRequestDelete: (route: SafeProxyView) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (route: SafeProxyView) => void;
}) {
  const status = displayRouteStatus(route);
  const working = busy !== null;
  const StatusIcon = STATUS_ICONS[status.key];
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);

  function cancelDelete(): void {
    onCancelDelete();
    restoreFocusAfterCancel(removeTriggerRef.current);
  }

  return (
    <li className="bg-bg/30 px-4 py-4 sm:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-elevated px-2 py-1 font-mono text-xs tabular-nums text-muted">
              {String(route.priority).padStart(2, "0")}
            </span>
            <span className="rounded-sm bg-elevated px-2 py-1 font-mono text-xs uppercase text-muted">
              {route.protocol}
            </span>
            <span className="min-w-0 break-all font-mono text-sm tabular-nums text-fg">
              {route.maskedLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className={cn("flex items-center gap-1.5 font-mono", STATUS_TONES[status.tone])}>
              <StatusIcon
                className={cn("size-4", route.verdict === "checking" && "animate-spin")}
              />
              {status.label}
            </span>
            <span className={cn("font-mono", route.stale ? "text-warn" : "text-subtle")}>
              {evidenceAge(route)}
            </span>
            {route.protocol === "socks5" ? (
              <span className="font-mono text-subtle">yt-dlp only</span>
            ) : null}
          </div>
          <details className="group rounded-md bg-elevated/60 shadow-[var(--shadow-border)]">
            <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 text-sm text-muted">
              <span>Stage evidence</span>
              <ChevronDown className="size-4 transition-transform duration-[var(--motion-quick)] group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-3 py-3">
              {route.evidence.length ? (
                <ul
                  className="grid gap-2 sm:grid-cols-2"
                  aria-label={`Evidence for route ${route.priority}`}
                >
                  {route.evidence.map((item) => (
                    <li
                      key={item.stage}
                      className="flex items-center justify-between gap-3 font-mono text-xs"
                    >
                      <span className="text-muted">{stageLabel(item.stage)}</span>
                      <span
                        className={cn(
                          item.outcome === "passed"
                            ? "text-success"
                            : item.outcome === "failed"
                              ? "text-danger"
                              : "text-subtle",
                        )}
                      >
                        {item.outcome}
                        {item.durationMs === null ? "" : ` · ${item.durationMs}ms`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-relaxed text-muted">
                  No durable stage evidence has been recorded for this route yet.
                </p>
              )}
            </div>
          </details>
        </div>
        {canManage ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-64 lg:justify-end">
            <Button
              type="button"
              size="default"
              variant="outline"
              disabled={working}
              onClick={() => onTest(route)}
            >
              {busy === `test:${route.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Test now
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={working || isFirst}
              aria-label={`Move route ${route.priority} up`}
              onClick={() => onMove(route, "up")}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={working || isLast}
              aria-label={`Move route ${route.priority} down`}
              onClick={() => onMove(route, "down")}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={route.enabled ? "ghost" : "outline"}
              disabled={working}
              aria-label={`${route.enabled ? "Disable" : "Enable"} route ${route.priority}`}
              onClick={() => onToggle(route)}
            >
              <Power />
            </Button>
            <Button
              ref={removeTriggerRef}
              type="button"
              size="icon"
              variant="ghost"
              disabled={working}
              aria-label={`Remove route ${route.priority}`}
              onClick={() => onRequestDelete(route)}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>
      {deletePending ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={`remove-route-${route.id}`}
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-3"
        >
          <p id={`remove-route-${route.id}`} className="text-sm text-fg">
            Remove this encrypted route and retain only its masked history?
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" autoFocus onClick={cancelDelete}>
              Keep route
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={working}
              onClick={() => onConfirmDelete(route)}
            >
              Remove route
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
