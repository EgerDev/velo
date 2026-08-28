import { ChevronDown, Copy, Download, FileCode, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BulkExportMenu(props: {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  onScript: () => void;
  onUrls: () => void;
  onJson: () => void;
}) {
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => props.setOpen(!props.open)}
        className="cursor-pointer gap-1.5 text-xs h-8"
      >
        <Download className="size-3.5" />
        Export Queue
        <ChevronDown className="size-3 text-subtle" />
      </Button>
      {props.open ? (
        <div className="absolute right-0 mt-1 w-56 rounded-xl border border-border bg-elevated/95 backdrop-blur-md p-1.5 shadow-xl z-30 text-xs">
          <button
            type="button"
            onClick={props.onScript}
            className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
          >
            <FileCode className="size-4 text-accent shrink-0" />
            <div>
              <div className="font-medium text-fg">yt-dlp Bash Script</div>
              <div className="text-[10px] text-muted">Runs anti-throttle batch locally</div>
            </div>
          </button>
          <button
            type="button"
            onClick={props.onUrls}
            className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
          >
            <FileText className="size-4 text-accent shrink-0" />
            <div>
              <div className="font-medium text-fg">Clean URL List</div>
              <div className="text-[10px] text-muted">For IDM, JDownloader, aria2</div>
            </div>
          </button>
          <button
            type="button"
            onClick={props.onJson}
            className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-accent/15 hover:text-accent cursor-pointer transition-colors"
          >
            <Copy className="size-4 text-accent shrink-0" />
            <div>
              <div className="font-medium text-fg">JSON Metadata</div>
              <div className="text-[10px] text-muted">Titles, URLs, and status</div>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  );
}
