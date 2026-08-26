import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, Clock, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Wordmark } from "@/components/wordmark";
import { AccountChip } from "@/components/account-chip";
import { HistoryList } from "@/components/history-list";
import { SessionGuide, type BrowserTab } from "@/components/session-guide";
import { useCookieStore } from "@/lib/cookie-store";
import { describeSessionStatus, type SessionLevel } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import type { HistoryItem } from "@/lib/history-store";

type AppHeaderProps = {
  downloading: boolean;
  onOpenHistory: (item: HistoryItem) => void;
  onRedownloadHistory: (item: HistoryItem) => void;
  /** False until the client has hydrated — history is a browser-only store. */
  historyReady: boolean;
  /** Reveal the session panel further down the page. */
  onReviewSession: () => void;
};

const LEVEL_STYLES: Record<SessionLevel, { tone: string; Icon: typeof ShieldCheck }> = {
  ready: { tone: "text-success", Icon: ShieldCheck },
  expiring: { tone: "text-warn", Icon: ShieldAlert },
  expired: { tone: "text-danger", Icon: ShieldAlert },
  unusable: { tone: "text-danger", Icon: ShieldAlert },
  none: { tone: "text-subtle", Icon: ShieldQuestion },
};

/**
 * A dropdown anchored under the header. Hand-rolled rather than pulled from a
 * primitive so it can stay a plain button + region: it closes on outside click
 * and on Escape, and returns focus to its trigger.
 */
function HeaderMenu({
  label,
  icon,
  children,
  align = "right",
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors cursor-pointer",
          open ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg",
        )}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className={cn(
            "absolute top-full z-30 mt-2 w-[min(92vw,26rem)] rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-panel,0_16px_40px_rgba(0,0,0,0.45))]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function AppHeader({
  downloading,
  onOpenHistory,
  onRedownloadHistory,
  historyReady,
  onReviewSession,
}: AppHeaderProps) {
  const raw = useCookieStore((s) => s.raw);
  const [guideBrowser, setGuideBrowser] = useState<BrowserTab>("bookmarklet");
  // Recomputed per render from the jar in memory — no network, no polling.
  const status = describeSessionStatus(raw);
  const { tone, Icon } = LEVEL_STYLES[status.level];

  return (
    <header className="glass-nav sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
      <Wordmark />
      <nav aria-label="Session and library" className="flex items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={onReviewSession}
          title={status.detail}
          aria-label={`${status.label}. ${status.detail}`}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors cursor-pointer hover:bg-elevated/60",
            tone,
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="hidden sm:inline">{status.label}</span>
        </button>

        <HeaderMenu label="History" icon={<Clock className="size-4 shrink-0" />}>
          {historyReady ? (
            <HistoryList
              downloading={downloading}
              onOpen={onOpenHistory}
              onRedownload={onRedownloadHistory}
            />
          ) : (
            <p className="px-1 py-6 text-center text-xs text-muted">Loading your recent saves…</p>
          )}
        </HeaderMenu>

        <HeaderMenu label="Guide" icon={<BookOpen className="size-4 shrink-0" />}>
          <SessionGuide browser={guideBrowser} onBrowser={setGuideBrowser} />
        </HeaderMenu>

        <AccountChip />
      </nav>
    </header>
  );
}
