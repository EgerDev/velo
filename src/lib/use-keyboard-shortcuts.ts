import { useEffect } from "react";

export type ShortcutHandlers = {
  onFocusSearch?: () => void;
  onDownload?: () => void;
  onSwitchMode?: (mode: "single" | "bulk" | "transcript") => void;
  onSelectTab?: (tab: "video" | "audio" | "transcript") => void;
  onToggleHelp?: () => void;
  onClear?: () => void;
};

/**
 * Global Keyboard Navigation Hook for Velo
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.getAttribute("role") === "textbox");

      // 1. Esc: Clear / Escape
      if (e.key === "Escape") {
        handlers.onClear?.();
        return;
      }

      // 2. Cmd+K / Ctrl+K or '/' (when not typing) to focus search
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !isInput)) {
        e.preventDefault();
        handlers.onFocusSearch?.();
        return;
      }

      // 3. Cmd+Enter / Ctrl+Enter: Trigger Download
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handlers.onDownload?.();
        return;
      }

      // Ignore single character shortcuts if user is typing in an input
      if (isInput) return;

      // 4. '1', '2', '3' for View Mode
      if (e.key === "1") {
        e.preventDefault();
        handlers.onSwitchMode?.("single");
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        handlers.onSwitchMode?.("bulk");
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        handlers.onSwitchMode?.("transcript");
        return;
      }

      // 5. 'v', 'a', 't' for subtabs
      if (e.key === "v" || e.key === "V") {
        handlers.onSelectTab?.("video");
        return;
      }
      if (e.key === "a" || e.key === "A") {
        handlers.onSelectTab?.("audio");
        return;
      }
      if (e.key === "t" || e.key === "T") {
        handlers.onSelectTab?.("transcript");
        return;
      }

      // 6. '?' for Help Cheat Sheet
      if (e.key === "?") {
        e.preventDefault();
        handlers.onToggleHelp?.();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers, enabled]);
}
