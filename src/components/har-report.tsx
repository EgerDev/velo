import { useHarStore } from "@/lib/har-store";
import { cn } from "@/lib/utils";
import type { HarWaterfallKind } from "@/lib/har";

const KIND_COLOR: Record<HarWaterfallKind, string> = {
  watch: "bg-fg/70",
  player: "bg-accent",
  innertube: "bg-fg/40",
  media: "bg-success",
  cdn: "bg-success/60",
  other: "bg-subtle",
};

export function HarReport() {
  const waterfall = useHarStore((state) => state.waterfall);
  const headers = useHarStore((state) => state.headers);
  const spanMs = useHarStore((state) => state.spanMs);
  const playbacks = useHarStore((state) => state.playbacks);
  const warnings = useHarStore((state) => state.warnings);
  if (!headers && waterfall.length === 0) return null;

  return (
    <div className="space-y-4">
      {headers ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg">Request headers</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <Flag ok={headers.hasSid} label="SID" />
            <Flag ok={headers.hasSapisid} label="SAPISID" />
            <Flag ok={headers.hasLoginInfo} label="LOGIN_INFO" />
            <Flag ok={Boolean(headers.visitorId)} label="Visitor ID" />
          </div>
          <ul className="space-y-1 text-xs leading-relaxed text-muted">
            {headers.clientName ? (
              <li>
                Client {headers.clientName}
                {headers.clientVersion ? ` · ${headers.clientVersion}` : ""}
              </li>
            ) : null}
            {headers.origin ? <li>Origin {headers.origin}</li> : null}
            {headers.referer ? <li className="truncate">Referer {headers.referer}</li> : null}
            {headers.cookieNames.length ? <li>{headers.cookieNames.slice(0, 12).join(", ")}</li> : null}
            {headers.authorization ? <li className="truncate">Authorization {headers.authorization}</li> : null}
          </ul>
          {headers.interesting.length ? (
            <div className="max-h-28 overflow-auto rounded-md bg-elevated px-3 py-2 text-xs text-muted">
              {headers.interesting.map((item) => (
                <p key={`${item.name}:${item.value}`} className="truncate">
                  <span className="text-fg">{item.name}</span> {item.value}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {waterfall.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg">
            Network waterfall · {waterfall.length} YouTube requests · {Math.round(spanMs)} ms
          </p>
          <div className="space-y-1">
            {waterfall.map((row) => {
              const left = Math.min(92, (row.startedMs / spanMs) * 100);
              const width = Math.max(4, (row.durationMs / spanMs) * 100);
              return (
                <div key={`${row.index}:${row.url}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                  <span className="truncate text-xs uppercase tracking-wide text-subtle">{row.kind}</span>
                  <div className="relative h-2 rounded-full bg-elevated">
                    <span
                      className={cn("absolute top-0 h-2 rounded-full", KIND_COLOR[row.kind])}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-subtle">
                    {row.itag ? row.itag : row.status || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {playbacks.length ? (
        <p className="text-xs text-muted">
          Media itags {playbacks.map((item) => item.itag).join(", ")}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-danger">
          {warning}
        </p>
      ))}
    </div>
  );
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("rounded-sm px-2 py-1", ok ? "bg-success/15 text-success" : "bg-elevated text-subtle")}>
      {ok ? "Has" : "No"} {label}
    </span>
  );
}
