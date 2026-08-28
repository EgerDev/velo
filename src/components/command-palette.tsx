import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Film, ListPlus, FileText, Bell, Search, ShieldCheck, LogIn, Link2, RefreshCw } from "lucide-react";
import type { ViewMode } from "@/lib/view-mode";

/**
 * ⌘K command palette. Velo is effectively one page with a few modes plus a few
 * session actions, so the palette's job is fast keyboard navigation between
 * them — no routing, no server calls. It drives the same `Home` state the
 * segmented control does, so the two stay in lockstep.
 */

type Action = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  icon: typeof Film;
  run: () => void;
};

type CommandPaletteProps = {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  onFocusSearch: () => void;
  onReviewSession: () => void;
  signedIn: boolean;
  onSignIn: () => void;
};

const MODE_META: Record<ViewMode, { label: string; icon: typeof Film; hint: string }> = {
  single: { label: "Single video", icon: Film, hint: "Resolve one link" },
  bulk: { label: "Bulk & playlists", icon: ListPlus, hint: "Queue many at once" },
  transcript: { label: "Transcript", icon: FileText, hint: "Captions & AI summary" },
  watch: { label: "Channels", icon: Bell, hint: "Follow channel feeds" },
  tools: { label: "Tools", icon: RefreshCw, hint: "Extractor versions" },
};

const MODE_ORDER: ViewMode[] = ["single", "bulk", "transcript", "watch", "tools"];

export function CommandPalette({
  mode,
  onMode,
  onFocusSearch,
  onReviewSession,
  signedIn,
  onSignIn,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const act = (run: () => void) => () => {
    setOpen(false);
    // Let the dialog finish closing before we move focus (e.g. into the link
    // field), so focus-return doesn't fight the input focus.
    setTimeout(run, 0);
  };

  // Tools needs a session (its server fn is auth-gated) — don't offer it to guests.
  const modeActions: Action[] = MODE_ORDER.filter((m) => m !== mode && (m !== "tools" || signedIn)).map((m) => ({
    id: `mode-${m}`,
    label: `Go to ${MODE_META[m].label}`,
    hint: MODE_META[m].hint,
    keywords: [m, MODE_META[m].label],
    icon: MODE_META[m].icon,
    run: () => onMode(m),
  }));

  const generalActions: Action[] = [
    {
      id: "focus-search",
      label: "Paste a link & fetch",
      hint: "Jump to the link field",
      keywords: ["url", "video", "download", "search", "paste"],
      icon: mode === "single" ? Search : Link2,
      run: () => {
        if (mode !== "single") onMode("single");
        onFocusSearch();
      },
    },
    {
      id: "review-session",
      label: "Review YouTube session",
      hint: "Cookie status & import",
      keywords: ["cookies", "session", "sign-in", "login", "account"],
      icon: ShieldCheck,
      run: onReviewSession,
    },
    ...(signedIn
      ? []
      : [
          {
            id: "sign-in",
            label: "Sign in to Velo",
            hint: "Higher caps & synced history",
            keywords: ["account", "login", "auth"],
            icon: LogIn,
            run: onSignIn,
          } as Action,
        ]),
  ];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      className="velo-cmdk"
      overlayClassName="velo-cmdk-overlay"
      contentClassName="velo-cmdk-content"
    >
      <Command.Input placeholder="Search commands…" className="velo-cmdk-input" />
      <Command.List className="velo-cmdk-list">
        <Command.Empty className="velo-cmdk-empty">No matching command.</Command.Empty>
        <Command.Group heading="Switch mode" className="velo-cmdk-group">
          {modeActions.map((action) => (
            <CommandRow key={action.id} action={action} onRun={act(action.run)} />
          ))}
        </Command.Group>
        <Command.Group heading="Actions" className="velo-cmdk-group">
          {generalActions.map((action) => (
            <CommandRow key={action.id} action={action} onRun={act(action.run)} />
          ))}
        </Command.Group>
      </Command.List>
      <div className="velo-cmdk-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate
        </span>
        <span>
          <kbd>↵</kbd> to run · <kbd>esc</kbd> to close
        </span>
      </div>
    </Command.Dialog>
  );
}

function CommandRow({ action, onRun }: { action: Action; onRun: () => void }) {
  const Icon = action.icon;
  return (
    <Command.Item
      value={`${action.label} ${(action.keywords ?? []).join(" ")}`}
      onSelect={onRun}
      className="velo-cmdk-item"
    >
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="velo-cmdk-item-label">{action.label}</span>
      {action.hint ? <span className="velo-cmdk-item-hint">{action.hint}</span> : null}
    </Command.Item>
  );
}
