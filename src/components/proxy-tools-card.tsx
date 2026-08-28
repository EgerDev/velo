import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Network,
  Plus,
  Route,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProxyToolsHistory } from "@/components/proxy-tools-history";
import { ProxyToolsRow } from "@/components/proxy-tools-row";
import { cn } from "@/lib/utils";
import { restoreFocusAfterCancel } from "@/lib/proxy-confirmation-focus";
import {
  orderedProxyRoutes,
  proxyPoolSummary,
  validationRunControls,
} from "@/lib/proxy-ui-presenters";
import {
  addUserProxy,
  cancelProxyValidationRun,
  clearProxyHistory,
  getProxyValidationRun,
  listProxyHistoryPage,
  listProxyOperations,
  removeUserProxy,
  reorderProxyRoutes,
  resumeProxyValidationRun,
  setProxyRouteEnabled,
  startProxyValidationRun,
  testProxyValidation,
  type ProxyHistoryPage,
  type ProxyOperationsView,
  type ProxyProtocol,
} from "@/lib/user-proxy";
import type { SafeProxyView } from "@/lib/proxy-operations";

type RunProgress = {
  readonly runId: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
};

type ValidationRun = RunProgress & {
  readonly status: string;
  readonly nextCursor: number;
  readonly cancelRequested: boolean;
};

const EMPTY_HISTORY: ProxyHistoryPage = { items: [], nextCursor: null };

const ROUTE_STEPS = [
  { icon: Route, label: "Ordered pool" },
  { icon: CheckCircle2, label: "Manual validation" },
  { icon: Network, label: "Capability aware" },
] as const;

function safeFailure(scope: "load" | "add" | "mutation" | "run"): string {
  switch (scope) {
    case "load":
      return "The route vault could not be loaded.";
    case "add":
      return "The route could not be saved. Check the input and try again.";
    case "mutation":
      return "That route change did not complete. Refresh and try again.";
    case "run":
      return "The requested check did not complete. Existing evidence remains available.";
    default:
      return assertNever(scope);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected state: ${String(value)}`);
}

export function ProxyToolsCard() {
  const [view, setView] = useState<ProxyOperationsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<ProxyProtocol>("http");
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [historyPage, setHistoryPage] = useState<ProxyHistoryPage>(EMPTY_HISTORY);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const mounted = useRef(true);
  const cardRef = useRef<HTMLElement | null>(null);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await listProxyOperations();
      const nextHistory = next.canManage
        ? await listProxyHistoryPage({ data: { limit: 50 } })
        : EMPTY_HISTORY;
      if (!mounted.current) return;
      setView(next);
      setHistoryPage(nextHistory);
      setLoadError(null);
    } catch {
      if (mounted.current) setLoadError(safeFailure("load"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function readRun(runId: string): Promise<ValidationRun | null> {
    const next = await getProxyValidationRun({ data: { runId } });
    if (!mounted.current) return null;
    setRun(next);
    return next;
  }

  async function runAdd(): Promise<void> {
    const input = value.trim();
    if (!input) return;
    setBusy("add");
    try {
      // This is the only client boundary that carries a submitted route. The
      // server action encrypts it; this component never renders or stores it.
      await addUserProxy({ data: { proxy: input, protocol } });
      if (!mounted.current) return;
      setValue("");
      setRevealed(false);
      toast.success("Route saved. Run a full check when you are ready.");
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("add"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runTest(route: SafeProxyView): Promise<void> {
    setBusy(`test:${route.id}`);
    try {
      const progress = await testProxyValidation({ data: { id: route.id } });
      const result = await readRun(progress.runId);
      if (!mounted.current || result === null) return;
      toast.success(
        result.failed ? "Check recorded with attention needed." : "Route check recorded.",
      );
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("run"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runAll(): Promise<void> {
    setBusy("all");
    try {
      const progress = await startProxyValidationRun({ data: {} });
      const result = await readRun(progress.runId);
      if (!mounted.current || result === null) return;
      toast.success(
        result.failed
          ? "Pool check recorded with attention needed."
          : "Pool check progress recorded.",
      );
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("run"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runResume(): Promise<void> {
    if (run === null) return;
    setBusy("resume");
    try {
      const progress = await resumeProxyValidationRun({ data: { runId: run.runId } });
      const result = await readRun(progress.runId);
      if (!mounted.current || result === null) return;
      toast.success(
        result.completed === result.total
          ? "All route checks are complete."
          : "The next validation batch is recorded.",
      );
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("run"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runCancel(): Promise<void> {
    if (run === null) return;
    setBusy("cancel");
    try {
      await cancelProxyValidationRun({ data: { runId: run.runId } });
      const result = await readRun(run.runId);
      if (!mounted.current || result === null) return;
      toast.success("Validation run cancelled.");
    } catch {
      if (mounted.current) toast.error(safeFailure("run"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runToggle(route: SafeProxyView): Promise<void> {
    setBusy(`toggle:${route.id}`);
    try {
      await setProxyRouteEnabled({ data: { id: route.id, enabled: !route.enabled } });
      if (!mounted.current) return;
      toast.success(route.enabled ? "Route disabled." : "Route enabled.");
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("mutation"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runMove(route: SafeProxyView, direction: "up" | "down"): Promise<void> {
    const routes = orderedProxyRoutes(view?.routes ?? []);
    const index = routes.findIndex((item) => item.id === route.id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= routes.length) return;
    const next = [...routes];
    const swapped = next[target];
    if (swapped === undefined) return;
    next[target] = route;
    next[index] = swapped;
    setBusy(`move:${route.id}`);
    try {
      await reorderProxyRoutes({ data: { ids: next.map((item) => item.id) } });
      if (!mounted.current) return;
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("mutation"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runRemove(route: SafeProxyView): Promise<void> {
    setBusy(`remove:${route.id}`);
    try {
      await removeUserProxy({ data: { id: route.id } });
      if (!mounted.current) return;
      setDeleteId(null);
      toast.success("Route removed. Sanitized history remains.");
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("mutation"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function runClearHistory(): Promise<void> {
    setBusy("history");
    try {
      await clearProxyHistory({ data: { confirm: true } });
      if (!mounted.current) return;
      setClearPending(false);
      setHistoryPage(EMPTY_HISTORY);
      toast.success("Validation history cleared.");
      restoreFocusAfterCancel(cardRef.current);
      await refresh();
    } catch {
      if (mounted.current) toast.error(safeFailure("mutation"));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function loadMoreHistory(): Promise<void> {
    if (historyPage.nextCursor === null) return;
    setHistoryLoading(true);
    try {
      const next = await listProxyHistoryPage({
        data: { limit: 50, cursor: historyPage.nextCursor },
      });
      if (!mounted.current) return;
      setHistoryPage((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }));
    } catch {
      if (mounted.current) toast.error("More sanitized history could not be loaded.");
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }

  function cancelClearHistory(): void {
    setClearPending(false);
    restoreFocusAfterCancel(clearTriggerRef.current);
  }

  const routes = useMemo(() => orderedProxyRoutes(view?.routes ?? []), [view?.routes]);
  const pool = useMemo(() => proxyPoolSummary(routes), [routes]);
  const canManage = Boolean(view?.canManage);
  const noRoutes = view !== null && routes.length === 0;
  const runControls = validationRunControls(run);

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby="private-route-title"
      className="panel overflow-hidden"
    >
      <div className="space-y-6 p-4 sm:p-6">
        <header className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[var(--tracking-wide)] text-subtle">
              <span
                aria-hidden
                className="inline-block h-3 w-[3px] -skew-x-12 rounded-[1px] bg-accent"
              />
              Proxy operations
            </p>
            <h3 id="private-route-title" className="font-display text-xl text-fg">
              A deliberate route vault, not an automatic bypass.
            </h3>
            <p className="max-w-xl text-sm leading-relaxed text-muted">
              Checks run when you request them; results are marked stale after one hour. Each saved
              route stays encrypted and only its masked reference is shown here.
            </p>
          </div>
          <div className="flex w-fit items-center gap-2 rounded-md bg-elevated px-3 py-2 font-mono text-xs text-muted shadow-[var(--shadow-border)]">
            <ShieldCheck className="size-4 text-success" />
            Credentials stay encrypted
          </div>
        </header>

        <div className="grid grid-cols-3 overflow-hidden rounded-lg bg-elevated/70 shadow-[var(--shadow-border)]">
          {ROUTE_STEPS.map(({ icon: Icon, label }, index) => (
            <div
              key={label}
              className="flex min-w-0 items-center justify-center gap-2 border-r border-border px-2 py-3 text-center text-xs text-muted last:border-r-0"
            >
              <Icon
                className={cn("hidden size-4 shrink-0 sm:block", index === 0 && "text-accent")}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {loadError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-3 text-sm text-danger">
            {loadError}
          </p>
        ) : null}

        {view ? (
          <div
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border shadow-[var(--shadow-border)] sm:grid-cols-5"
            aria-label="Proxy pool summary"
          >
            {[
              ["healthy", pool.healthy, "text-success"],
              ["degraded", pool.degraded, "text-warn"],
              ["attention", pool.blocked, "text-danger"],
              ["stale", pool.stale, "text-warn"],
              ["disabled", pool.disabled, "text-subtle"],
            ].map(([label, count, tone], index) => (
              <div
                key={label}
                className={cn("bg-surface px-3 py-3", index === 4 && "col-span-2 sm:col-span-1")}
              >
                <p className="font-mono text-xs uppercase text-subtle">{label}</p>
                <p className={cn("mt-1 font-display text-2xl tabular-nums", tone)}>{count}</p>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="h-22 animate-pulse rounded-lg bg-elevated"
            aria-label="Loading route summary"
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="lg"
            disabled={!canManage || busy !== null || routes.length === 0}
            onClick={() => void runAll()}
          >
            {busy === "all" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {busy === "all" ? "Running checks" : "Run all checks"}
          </Button>
          {runControls.canResume ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void runResume()}
            >
              {busy === "resume" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {busy === "resume" ? "Continuing" : "Continue checks"}
            </Button>
          ) : null}
          {runControls.canCancel ? (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void runCancel()}
            >
              {busy === "cancel" ? <Loader2 className="animate-spin" /> : null}
              {runControls.cancelLabel}
            </Button>
          ) : null}
          {run ? (
            <p aria-live="polite" className="font-mono text-xs text-muted">
              {run.status} · completed {run.completed}/{run.total} · {run.failed} need attention ·
              next cursor {run.nextCursor}
            </p>
          ) : (
            <p className="font-mono text-xs text-subtle">Manual only · no scheduled checks</p>
          )}
        </div>
        {run && run.completed < run.total ? (
          <p className="-mt-3 text-xs leading-relaxed text-muted">
            This run processes up to eight routes per operator action. Continue it when you are
            ready; nothing runs in the background.
          </p>
        ) : null}

        {view && !canManage ? (
          <div className="flex items-start gap-3 rounded-lg bg-elevated px-4 py-4">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-subtle" />
            <div>
              <p className="text-sm font-medium text-fg">Route controls are locked</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {view.reason ?? "This workspace does not permit proxy management."}
              </p>
            </div>
          </div>
        ) : null}

        {routes.length ? (
          <ol
            aria-label="Ordered proxy route vault"
            className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]"
          >
            {routes.map((route, index) => (
              <ProxyToolsRow
                key={route.id}
                route={route}
                busy={busy}
                canManage={canManage}
                isFirst={index === 0}
                isLast={index === routes.length - 1}
                deletePending={deleteId === route.id}
                onTest={(target) => void runTest(target)}
                onToggle={(target) => void runToggle(target)}
                onMove={(target, direction) => void runMove(target, direction)}
                onRequestDelete={(target) => setDeleteId(target.id)}
                onCancelDelete={() => setDeleteId(null)}
                onConfirmDelete={(target) => void runRemove(target)}
              />
            ))}
          </ol>
        ) : null}

        {noRoutes ? (
          <div className="flex items-start gap-3 rounded-lg bg-bg/40 px-4 py-4 shadow-[var(--shadow-border)]">
            <Route className="mt-0.5 size-5 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-medium text-fg">No saved routes</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The direct route remains available. Add a proxy you control only when it is
                appropriate for your network.
              </p>
            </div>
          </div>
        ) : null}

        {canManage ? (
          <form
            className="space-y-3 border-t border-border pt-6"
            onSubmit={(event) => {
              event.preventDefault();
              void runAdd();
            }}
          >
            <div>
              <label htmlFor="proxy-address" className="text-sm font-medium text-fg">
                Add a private route
              </label>
              <p id="proxy-help" className="mt-1 text-xs text-muted">
                Use IP:PORT or user:password@IP:PORT. The value stays concealed after it is saved.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div
                className="grid grid-cols-2 overflow-hidden rounded-md bg-elevated shadow-[var(--shadow-border)]"
                role="group"
                aria-label="Proxy protocol"
              >
                {(["http", "socks5"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={protocol === option}
                    className={cn(
                      "min-h-12 px-3 font-mono text-xs uppercase transition-colors duration-[var(--motion-quick)]",
                      protocol === option ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                    )}
                    onClick={() => setProtocol(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="relative min-w-0">
                <Input
                  id="proxy-address"
                  type={revealed ? "text" : "password"}
                  className="pr-12 font-mono"
                  placeholder="203.0.113.10:8080"
                  aria-describedby="proxy-help"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-subtle transition-colors duration-[var(--motion-quick)] hover:text-fg"
                  aria-label={revealed ? "Hide route input" : "Show route input"}
                  aria-pressed={revealed}
                  onClick={() => setRevealed((current) => !current)}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto"
                disabled={busy !== null || !value.trim()}
              >
                {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />}
                {busy === "add" ? "Saving" : "Add route"}
              </Button>
            </div>
          </form>
        ) : null}

        {clearPending ? (
          <div
            role="alertdialog"
            aria-modal="false"
            aria-labelledby="clear-route-history-title"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3"
          >
            <p id="clear-route-history-title" className="text-sm text-fg">
              Clear retained validation checks while keeping route deletion history?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                autoFocus
                onClick={cancelClearHistory}
              >
                Keep history
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void runClearHistory()}
              >
                Clear checks
              </Button>
            </div>
          </div>
        ) : null}
        <ProxyToolsHistory
          history={historyPage.items}
          canManage={canManage}
          clearing={busy === "history"}
          hasMore={historyPage.nextCursor !== null}
          loadingMore={historyLoading}
          onLoadMore={() => void loadMoreHistory()}
          clearTriggerRef={clearTriggerRef}
          onClear={() => setClearPending(true)}
        />
      </div>
    </section>
  );
}
