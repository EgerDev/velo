import { useEffect, useState } from "react";
import { checkToolUpdates } from "@/lib/tool-updates";
import { anyBehind } from "@/lib/tool-versions";

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

export function useToolsBadge(signedIn: boolean) {
  const [toolsBehind, setToolsBehind] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    try {
      const last = Number(window.localStorage.getItem(TOOLS_CACHE_KEY) ?? 0);
      if (Date.now() - last < SIX_HOURS) {
        setToolsBehind(window.localStorage.getItem(`${TOOLS_CACHE_KEY}-behind`) === "1");
        return;
      }
    } catch {
      /* ignore */
    }
    let cancelled = false;
    void checkToolUpdates()
      .then((check) => {
        if (cancelled) return;
        const behind = anyBehind(check.rows);
        setToolsBehind(behind);
        rememberToolsCheck(behind);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return { toolsBehind, setToolsBehind };
}
