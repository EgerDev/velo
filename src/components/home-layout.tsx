import type { ReactNode, RefObject } from "react";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { CookieImport } from "@/components/cookie-import";
import { ModeTabs } from "@/components/mode-tabs";
import { GUEST } from "@/lib/guest-copy";
import type { ViewMode } from "@/lib/view-mode";
import type { HistoryItem } from "@/lib/history-store";
import type { ModeTab } from "@/components/mode-tabs";

export function HomeLayout(props: {
  downloading: boolean;
  hydrated: boolean;
  isPending: boolean;
  signedIn: boolean;
  activeMode: ViewMode;
  modeTabs: readonly ModeTab[];
  toolsBehind: boolean;
  sessionReveal: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpenHistory: (item: HistoryItem) => void;
  onRedownloadHistory: (item: HistoryItem) => void;
  onMode: (mode: ViewMode) => void;
  onReviewSession: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <a
        href="#download"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to download
      </a>
      <AppHeader
        downloading={props.downloading}
        onOpenHistory={(item) => void props.onOpenHistory(item)}
        onRedownloadHistory={(item) => void props.onRedownloadHistory(item)}
        historyReady={props.hydrated && !props.isPending}
        onReviewSession={props.onReviewSession}
      />
      <CommandPalette
        mode={props.activeMode}
        onMode={props.onMode}
        onFocusSearch={() => {
          let tries = 0;
          const focus = () => {
            const input = props.searchInputRef.current;
            if (input) {
              input.focus();
              input.select();
            } else if (tries++ < 5) {
              requestAnimationFrame(focus);
            }
          };
          requestAnimationFrame(focus);
        }}
        onReviewSession={props.onReviewSession}
        signedIn={props.signedIn}
        onSignIn={() => {
          window.location.href = "/login";
        }}
      />
      <main id="download" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <div className="stagger max-w-xl">
          <p className="flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[var(--tracking-wide)] text-subtle">
            <span aria-hidden className="inline-block h-3 w-[3px] -skew-x-12 rounded-[1px] bg-accent" />
            YouTube downloader
          </p>
          <h1 className="mt-3 font-display text-3xl leading-[var(--leading-display)] tracking-[var(--tracking-display)] text-fg sm:text-4xl">
            Keep the cut.
          </h1>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-muted">{GUEST.hero}</p>
        </div>
        <ModeTabs
          tabs={props.modeTabs}
          value={props.activeMode}
          onChange={props.onMode}
          attention={props.toolsBehind ? "tools" : null}
        />
        {props.children}
        <div id="session" className="scroll-mt-24">
          <CookieImport revealSignal={props.sessionReveal} />
        </div>
      </main>
    </div>
  );
}
