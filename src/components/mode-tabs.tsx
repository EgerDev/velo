import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bell, FileText, Film, ListPlus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/view-mode";

export const MODE_TABS = [
  { mode: "single", icon: Film, label: "Single video" },
  { mode: "bulk", icon: ListPlus, label: "Bulk & playlists" },
  { mode: "transcript", icon: FileText, label: "Transcript", chip: "AI" },
  { mode: "watch", icon: Bell, label: "Channels" },
  { mode: "tools", icon: RefreshCw, label: "Tools" },
] as const;

export type ModeTab = (typeof MODE_TABS)[number];

export const TOOLS_CACHE_KEY = "velo-tools-checked";

/** Six-hour cache behind the Tools tab's attention dot. */
export function rememberToolsCheck(behind: boolean) {
  try {
    window.localStorage.setItem(TOOLS_CACHE_KEY, String(Date.now()));
    window.localStorage.setItem(`${TOOLS_CACHE_KEY}-behind`, behind ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Centered segmented control with a gold pill that slides between tabs.
 * While traveling, the pill skews like the splice mark in the wordmark.
 */
export function ModeTabs({
  tabs,
  value,
  onChange,
  attention,
}: {
  tabs: readonly ModeTab[];
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  attention?: ViewMode | null;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const slideTimer = useRef<number | undefined>(undefined);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [sliding, setSliding] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const active = list.querySelector<HTMLElement>("[data-active='true']");
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    for (const tab of list.querySelectorAll("button")) observer.observe(tab);
    document.fonts?.ready.then(update).catch(() => undefined);
    return () => observer.disconnect();
  }, [value]);

  useEffect(() => () => window.clearTimeout(slideTimer.current), []);

  function select(mode: ViewMode) {
    if (mode !== value) {
      setSliding(true);
      window.clearTimeout(slideTimer.current);
      slideTimer.current = window.setTimeout(() => setSliding(false), 400);
    }
    onChange(mode);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.mode === value);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    select(next.mode);
    listRef.current?.querySelector<HTMLElement>(`[data-mode='${next.mode}']`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Downloader mode"
      ref={listRef}
      onKeyDown={onKeyDown}
      className="relative mx-auto mt-7 flex w-fit max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-border bg-elevated/70 p-1 shadow-xs"
    >
      {pill ? (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-1 top-1 z-0 rounded-xl bg-accent shadow-sm transition-[left,width,transform] duration-[var(--motion-medium)] ease-[var(--ease-smooth-out)]",
            sliding && "-skew-x-6",
          )}
          style={{ left: pill.left, width: pill.width }}
        />
      ) : null}
      {tabs.map(({ mode, icon: Icon, label, ...tab }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            tabIndex={active ? 0 : -1}
            data-active={active}
            data-mode={mode}
            onClick={() => select(mode)}
            className={cn(
              "relative z-10 flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-medium)]",
              active ? "text-accent-fg" : "text-muted hover:text-fg",
              active && !pill && "bg-accent",
            )}
          >
            <span className="relative">
              <Icon className="size-3.5 shrink-0" />
              {attention === mode && !active ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 size-1.5 rounded-full bg-accent ring-2 ring-elevated"
                />
              ) : null}
            </span>
            {attention === mode ? <span className="sr-only">(update available)</span> : null}
            <span className={cn(!active && "hidden sm:inline")}>{label}</span>
            {"chip" in tab && tab.chip ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors duration-[var(--motion-medium)]",
                  active ? "bg-accent-fg/20 text-accent-fg" : "hidden bg-accent/15 text-accent sm:inline",
                )}
              >
                {tab.chip}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
