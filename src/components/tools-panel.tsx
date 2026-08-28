import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkToolUpdates,
  updateTool,
  type ToolCheck,
  type ToolId,
  type ToolRow,
  type UpdateResult,
} from "@/lib/tool-updates";

/**
 * The Tools tab: what the extraction ladder is running, what is newest, and
 * an Update button for operators. yt-dlp updates take effect immediately (it
 * runs as a subprocess); the npm packages need a server restart to load.
 */

const STATUS_LABEL: Record<ToolRow["status"], string> = {
  current: "Up to date",
  behind: "Update available",
  ahead: "Ahead",
  unknown: "Registry unreachable",
  missing: "Not installed",
};

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ToolsPanel({ onStatus }: { onStatus?: (check: ToolCheck) => void } = {}) {
  const [check, setCheck] = useState<ToolCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<ToolId | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [showLog, setShowLog] = useState(false);
  const mounted = useRef(true);
  // Parents pass an inline callback; keep it in a ref so a re-render upstream
  // does not re-run the mount check.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      setChecking(true);
      setError(null);
      try {
        const next = await checkToolUpdates({ data: { force } });
        if (!mounted.current) return;
        setCheck(next);
        onStatusRef.current?.(next);
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : "Could not check registries.");
      } finally {
        if (mounted.current) setChecking(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runUpdate(id: ToolId) {
    setUpdating(id);
    setResult(null);
    setShowLog(false);
    try {
      const outcome = await updateTool({ data: { id } });
      if (!mounted.current) return;
      setResult(outcome);
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : "Update failed.";
      setResult({ id, ok: false, version: null, needsRestart: false, log: "", message });
      toast.error(message);
    } finally {
      if (mounted.current) setUpdating(null);
      // Re-read versions from disk after any attempt, success or not.
      void refresh(true);
    }
  }

  async function runUpdateAll() {
    const behind = (check?.rows ?? []).filter((row) => row.status === "behind");
    for (const row of behind) {
      if (!mounted.current) return;
      await runUpdate(row.id);
    }
  }

  const rows = check?.rows ?? [];
  const behindCount = rows.filter((row) => row.status === "behind").length;
  const busy = updating !== null || Boolean(check?.busy);
  const canUpdate = Boolean(check?.canUpdate) && !busy;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <p className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[var(--tracking-wide)] text-subtle">
          <span aria-hidden className="inline-block h-3 w-[3px] -skew-x-12 rounded-[1px] bg-accent" />
          Extractor tools
        </p>
        <h2 className="font-display text-2xl text-fg">Keep the ladder current.</h2>
        <p className="max-w-lg text-sm leading-relaxed text-muted">
          YouTube moves; these three follow it. When one falls behind, downloads start failing for
          reasons that look like bugs. Update from here — yt-dlp switches over at once, the npm
          packages load on the next restart.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {check && !check.canUpdate ? (
        <p className="rounded-md bg-elevated px-3 py-2 text-xs text-muted">{check.reason}</p>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {rows.map((row) => {
          const isUpdating = updating === row.id;
          const behind = row.status === "behind";
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{row.label}</p>
                <p className="text-xs text-muted">{row.role}</p>
              </div>
              <dl className="grid grid-cols-[auto_auto] gap-x-3 font-mono text-xs tabular-nums text-muted">
                <dt className="text-subtle">now</dt>
                <dd className="text-fg">{row.current ?? "—"}</dd>
                <dt className="text-subtle">latest</dt>
                <dd className={cn(behind ? "text-warn" : "text-fg")}>{row.latest ?? "—"}</dd>
              </dl>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border border-border bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                    row.status === "current" && "text-success",
                    row.status === "behind" && "text-warn",
                    (row.status === "missing" || row.status === "unknown") && "text-muted",
                    row.status === "ahead" && "text-muted",
                  )}
                  title={row.note}
                >
                  {STATUS_LABEL[row.status]}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={behind ? "default" : "outline"}
                  disabled={!canUpdate || (!behind && row.status !== "missing")}
                  aria-label={`Update ${row.label}`}
                  onClick={() => void runUpdate(row.id)}
                >
                  {isUpdating ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
                  {isUpdating ? "Installing" : row.status === "missing" ? "Install" : "Update"}
                </Button>
              </div>
            </li>
          );
        })}
        {!check && !error ? (
          <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Checking registries…
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" disabled={checking || updating !== null} onClick={() => void refresh(true)}>
          <RefreshCw className={cn(checking && "animate-spin")} />
          Check again
        </Button>
        {behindCount > 1 ? (
          <Button type="button" size="sm" disabled={!canUpdate} onClick={() => void runUpdateAll()}>
            <ArrowUpCircle />
            Update all ({behindCount})
          </Button>
        ) : null}
        {check ? (
          <span className="font-mono text-xs text-subtle">
            checked {formatTime(check.checkedAt)}
            {check.busy && updating === null ? " · an install is running elsewhere" : ""}
          </span>
        ) : null}
      </div>

      {result ? (
        <div
          className={cn(
            "space-y-2 rounded-xl border px-4 py-3 text-sm",
            result.ok ? "border-success/30 bg-success/5 text-fg" : "border-danger/30 bg-danger/5 text-fg",
          )}
        >
          <p>{result.message}</p>
          {result.needsRestart ? (
            <p className="text-xs text-warn">
              The running server still has the previous version loaded — restart it to switch.
            </p>
          ) : null}
          {result.log ? (
            <>
              <button
                type="button"
                className="cursor-pointer font-mono text-xs text-subtle underline-offset-2 hover:text-fg hover:underline"
                aria-expanded={showLog}
                onClick={() => setShowLog((value) => !value)}
              >
                {showLog ? "Hide log" : "Show log"}
              </button>
              {showLog ? (
                <pre className="max-h-64 overflow-auto rounded-md bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {result.log}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
