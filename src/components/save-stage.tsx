import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StepLog } from "@/components/step-log";
import type { OfferedFile } from "@/lib/download-client";
import { downloadViaHybrid, type HybridStep } from "@/lib/hybrid-download";
import { beginBuilderSave } from "@/lib/builder-save";
import { downloadViaBuilder } from "@/lib/builder-download";
import { cookiesForDownload, useCookieStore } from "@/lib/cookie-store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { classifyDownloadError, downloadHint, isUserAbort, shouldEscalateSave } from "@/lib/download-error";
import { isRetryable, withRetry } from "@/lib/retry";
import { GUEST } from "@/lib/guest-copy";

type SaveStageProps = {
  files: OfferedFile[];
  videoId?: string | null;
  thumbnail?: string | null;
  onClose: () => void;
};

export function SaveStage({ files, videoId, thumbnail, onClose }: SaveStageProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to save — Full HD with audio in one file.");
  const [hint, setHint] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<OfferedFile | null>(null);
  const [steps, setSteps] = useState<HybridStep[]>([]);
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user);
  const abortRef = useRef<AbortController | null>(null);
  const cookieCount = useCookieStore((state) => state.count);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);
  const video = files.find((f) => f.kind === "video" || f.kind === "av");
  const quality = video?.qualityLabel ?? files[0]?.qualityLabel ?? "Original";
  const embed = videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`
    : null;

  async function handleSave(file: OfferedFile) {
    if (!videoId) {
      toast.error("Fetch the video again first.");
      return;
    }
    if (isPending) {
      toast.error("Still checking your session.");
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const pendingSave = beginBuilderSave(file.filename);
    setBusy(file.filename);
    setFailedFile(null);
    setHint(null);
    setSteps([]);
    try {
      await withRetry(
        async () => {
          if (abort.signal.aborted) throw new Error("aborted");
          try {
            await downloadViaBuilder({
              videoId,
              filename: file.filename,
              itag: file.itag,
              cookies: cookiesForDownload(signedIn),
              pendingSave,
              signal: abort.signal,
              onProgress: (progress) => {
                if (abort.signal.aborted) return;
                setStatus(`${progress.label} (${progress.percent}%)`);
                if (progress.steps) setSteps(progress.steps);
              },
              onSteps: (next) => {
                if (!abort.signal.aborted) setSteps(next);
              },
            });
          } catch (err) {
            if (isUserAbort(err, abort.signal)) throw err;
            if (!shouldEscalateSave(err)) throw classifyDownloadError(err);
            await downloadViaHybrid({
              videoId,
              itag: file.itag,
              filename: file.filename,
              cookies: cookiesForDownload(signedIn),
              pendingSave,
              signal: abort.signal,
              onProgress: (label, percent) => {
                if (abort.signal.aborted) return;
                setStatus(`${label} (${percent}%)`);
              },
              onSteps: (next) => {
                if (!abort.signal.aborted) setSteps(next);
              },
            });
          }
        },
        {
          attempts: 3,
          baseMs: 600,
          maxMs: 2400,
          retryOn: isRetryable,
          onRetry: (attempt, err, waitMs) => {
            const why = err instanceof Error ? err.message : "failed";
            setStatus(`Retry ${attempt + 1}/3 in ${Math.round(waitMs / 100) / 10}s · ${why}`);
          },
        },
      );
      setStatus(`Saved ${file.filename}`);
      toast.success(`Saved ${file.qualityLabel}`);
    } catch (err) {
      if (isUserAbort(err, abort.signal)) {
        return;
      }
      const error = classifyDownloadError(err);
      setFailedFile(file);
      setHint(downloadHint(error.code, !signedIn, error.retryAfterSec));
      setStatus(
        error.code === "queue"
          ? GUEST.busy
          : error.retryAfterSec
            ? `${error.message} · wait ${error.retryAfterSec}s`
            : error.message,
      );
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel rise mt-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <p className="font-display text-2xl tracking-[var(--tracking-display)] text-fg">{quality} ready</p>
          <p className={`mt-1 text-sm ${failedFile ? "text-danger" : "text-muted"}`}>{status}</p>
          {hint ? <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => {
            abortRef.current?.abort();
            onClose();
          }}
        >
          <X />
        </Button>
      </div>

      <div className="space-y-4 p-5 pt-4">
        <div className="overflow-hidden rounded-md bg-elevated">
          {embed ? (
            <iframe
              title={`${quality} preview`}
              src={embed}
              className="aspect-video w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : thumbnail ? (
            <img src={thumbnail} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <div className="aspect-video w-full bg-elevated" />
          )}
        </div>

        <StepLog steps={steps} />

        <div className="flex flex-col gap-2 sm:flex-row">
          {files.map((file) => (
            <Button
              key={file.filename}
              className="h-12 flex-1"
              variant={file.kind === "audio" ? "secondary" : "default"}
              disabled={Boolean(busy)}
              onClick={() => void handleSave(file)}
            >
              <Download />
              {busy === file.filename ? "Saving…" : `Save ${file.qualityLabel}`}
            </Button>
          ))}
          {failedFile ? (
            <Button
              className="h-12"
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => void handleSave(failedFile)}
            >
              <RotateCcw />
              Retry
            </Button>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-subtle">
          {files.map((file) => file.filename).join("  ·  ")}
          {signedIn
            ? cookieCount > 0
              ? `  ·  ${cookieCount} cookies on this save`
              : `  ·  ${GUEST.saveSigned}`
            : `  ·  ${GUEST.save}`}
        </p>
        <p className="text-xs leading-relaxed text-subtle">
          Velo’s own chain: nsig even on “plain” URLs, dual PO token, cver/rn/keepalive,
          YouTube client headers, same-hop IP, then HLS stitch if progressive is SABR.
        </p>
      </div>
    </div>
  );
}