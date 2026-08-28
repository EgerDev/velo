import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberToolsCheck } from "@/components/mode-tabs";
import { anyBehind } from "@/lib/tool-versions";
import type { ViewMode } from "@/lib/view-mode";
import type { ToolCheck } from "@/lib/tool-updates";

const BulkDownloader = lazy(() =>
  import("@/components/bulk-downloader").then((m) => ({ default: m.BulkDownloader })),
);
const TranscriptStudio = lazy(() =>
  import("@/components/transcript-studio").then((m) => ({ default: m.TranscriptStudio })),
);
const WatchPanel = lazy(() => import("@/components/watch-panel").then((m) => ({ default: m.WatchPanel })));
const ToolsPanel = lazy(() => import("@/components/tools-panel").then((m) => ({ default: m.ToolsPanel })));

export function HomeModes(props: {
  mode: ViewMode;
  url: string;
  preferredLang: string | null;
  batchIds: string[];
  signedIn: boolean;
  onOpenVideo: (url: string) => void;
  onToolsStatus: (check: ToolCheck) => void;
}) {
  const open = (singleUrl: string) => props.onOpenVideo(singleUrl);
  return (
    <Suspense fallback={<Skeleton className="mt-8 h-64 w-full rounded-2xl" />}>
      {props.mode === "transcript" ? (
        <div className="mt-8">
          <TranscriptStudio
            initialUrl={props.url}
            preferredLang={props.preferredLang}
            onOpenInDownloader={open}
          />
        </div>
      ) : props.mode === "bulk" ? (
        <div className="mt-8">
          <BulkDownloader
            initialIds={props.batchIds}
            signedIn={props.signedIn}
            onSelectSingleVideo={open}
          />
        </div>
      ) : props.mode === "tools" ? (
        <div className="mt-8">
          <ToolsPanel
            onStatus={(check) => {
              props.onToolsStatus(check);
              rememberToolsCheck(anyBehind(check.rows));
            }}
          />
        </div>
      ) : (
        <div className="mt-8">
          <WatchPanel onSelectVideo={open} />
        </div>
      )}
    </Suspense>
  );
}
