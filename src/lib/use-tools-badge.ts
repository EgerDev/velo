import { useEffect, useState } from "react";
import { rememberToolsCheck, TOOLS_CACHE_KEY } from "@/components/mode-tabs";
import { checkToolUpdates } from "@/lib/tool-updates";
import { anyBehind } from "@/lib/tool-versions";

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
