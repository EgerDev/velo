import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, CheckCircle2, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProxyToolsCard } from "@/components/proxy-tools-card";
import { ToolStatusRow } from "@/components/tool-status-row";
import { cn } from "@/lib/utils";
import {
  checkToolUpdates,
  updateTool,
  type ToolCheck,
  type ToolId,
  type UpdateResult,
} from "@/lib/tool-updates";

/**
 * The Tools tab: what the extraction ladder is running, what is newest, and
 * an Update button for operators. yt-dlp updates take effect immediately (it
 * runs as a subprocess); the npm packages need a server restart to load.
 */

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

  const refresh = useCallback(async (force = false) => {
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
  }, []);

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

  const healthyCount = rows.filter(
    (row) => row.status === "current" || row.status === "ahead",
  ).length;

  return (
    <section className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-6">
        <header className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[var(--tracking-wide)] text-subtle">
              <span
                aria-hidden
                className="inline-block h-3 w-[3px] -skew-x-12 rounded-[1px] bg-accent"
              />
              Runtime health
            </p>
            <h2 className="font-display text-2xl text-fg">Keep the extraction path healthy.</h2>
            <p className="max-w-lg text-sm leading-relaxed text-muted">
              Velo checks the three moving parts that track YouTube. Version checks are safe to run
              anytime; package installs remain an operator action.
            </p>
          </div>
          {check ? (
            <div className="flex w-fit items-center gap-2 rounded-md bg-elevated px-3 py-2 font-mono text-xs text-muted shadow-[var(--shadow-border)]">
              <CheckCircle2 className={cn("size-4", behindCount ? "text-warn" : "text-success")} />
              {healthyCount}/{rows.length} healthy
            </div>
          ) : null}
        </header>

        {error ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <ToolStatusRow
                key={row.id}
                row={row}
                canUpdate={canUpdate}
                isUpdating={updating === row.id}
                onUpdate={() => void runUpdate(row.id)}
              />
            ))}
            {!check && !error ? (
              <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> Checking registries…
              </li>
            ) : null}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="default"
            disabled={checking || updating !== null}
            onClick={() => void refresh(true)}
          >
            <RefreshCw className={cn(checking && "animate-spin")} />
            Check versions
          </Button>
          {behindCount > 1 ? (
            <Button
              type="button"
              size="default"
              disabled={!canUpdate}
              onClick={() => void runUpdateAll()}
            >
              <ArrowUpCircle />
              Update all ({behindCount})
            </Button>
          ) : null}
          {check ? (
            <span className="font-mono text-xs text-subtle">
              Checked {formatTime(check.checkedAt)}
            </span>
          ) : null}
        </div>

        {check && !check.canUpdate ? (
          <div className="flex items-start gap-3 rounded-lg bg-elevated px-4 py-3">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-subtle" />
            <div>
              <p className="text-sm font-medium text-fg">Package installs are locked</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Version checks stay available. Installing executable updates is reserved for the
                workspace operator.
              </p>
            </div>
          </div>
        ) : null}

        {result ? (
          <div
            className={cn(
              "space-y-2 rounded-xl border px-4 py-3 text-sm",
              result.ok
                ? "border-success/30 bg-success/5 text-fg"
                : "border-danger/30 bg-danger/5 text-fg",
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

        <ProxyToolsCard />
      </div>
    </section>
  );
}
