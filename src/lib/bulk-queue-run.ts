import { toast } from "sonner";
import type { MutableRefObject } from "react";
import type { BulkItem, BulkQueueOptions } from "@/lib/bulk-download";

export async function startBulkQueue(opts: {
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  setIsPaused: (v: boolean) => void;
  isProcessingRef: MutableRefObject<boolean>;
  isPausedRef: MutableRefObject<boolean>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  runRef: MutableRefObject<number>;
  itemsRef: MutableRefObject<BulkItem[]>;
  queueOptions: BulkQueueOptions;
  mutate: (fn: (prev: BulkItem[]) => BulkItem[]) => void;
  processItem: (item: BulkItem) => Promise<void>;
}) {
  if (opts.isProcessing) return;
  opts.setIsProcessing(true);
  opts.setIsPaused(false);
  opts.isProcessingRef.current = true;
  opts.isPausedRef.current = false;
  opts.abortControllerRef.current = new AbortController();
  const run = ++opts.runRef.current;
  toast.info(`Starting batch download queue (Concurrency: ${opts.queueOptions.maxConcurrency})...`);
  if (opts.itemsRef.current.some((i) => i.preset === "transcript")) {
    toast.info("Captions-only items are export-only — use Export → yt-dlp script.");
  }
  const runWorker = async () => {
    while (opts.runRef.current === run && opts.isProcessingRef.current && !opts.isPausedRef.current) {
      const current = opts.itemsRef.current;
      const downloadingCount = current.filter((i) => i.status === "downloading").length;
      const nextItem =
        downloadingCount < opts.queueOptions.maxConcurrency
          ? (current.find(
              (i) =>
                i.preset !== "transcript" &&
                (i.status === "ready" ||
                  i.status === "pending" ||
                  (i.status === "failed" && i.retryCount < opts.queueOptions.maxRetries)),
            ) ?? null)
          : null;
      if (!nextItem) {
        const activeCount = opts.itemsRef.current.filter(
          (i) => i.status === "downloading" || i.status === "resolving",
        ).length;
        if (activeCount === 0) break;
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      const claimedId = nextItem.id;
      opts.mutate((prev) =>
        prev.map((item) => (item.id === claimedId ? { ...item, status: "downloading", progress: 5 } : item)),
      );
      await opts.processItem(nextItem);
      await new Promise((r) => setTimeout(r, opts.queueOptions.staggerDelayMs));
    }
  };
  const workers = Array.from({ length: opts.queueOptions.maxConcurrency }, async (_, i) => {
    if (i > 0) await new Promise((r) => setTimeout(r, opts.queueOptions.staggerDelayMs * i));
    return runWorker();
  });
  await Promise.all(workers);
  if (opts.runRef.current !== run || !opts.isProcessingRef.current) return;
  opts.setIsProcessing(false);
  toast.success("Batch download queue completed!");
}
