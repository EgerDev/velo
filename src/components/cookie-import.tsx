import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Bookmark,
  Check,
  ChevronDown,
  Clipboard,
  Cookie,
  FileCode,
  FileUp,
  HelpCircle,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCookieStore, scrubCookiePersist } from "@/lib/cookie-store";
import {
  parseCookieImport,
  analyzeCookieFormat,
  detectCookieFormat,
  COOKIE_TTL_EXPLAIN,
  SID_EXPLAIN,
} from "@/lib/cookies";
import { isHarJson, looksLikeSessionExport, parseHar } from "@/lib/har";
import { useHarStore } from "@/lib/har-store";
import { HarReport } from "@/components/har-report";
import { cn } from "@/lib/utils";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { clearVault, loadVault, saveVault, validateVaultSession } from "@/lib/vault";
import { SessionGuide, type BrowserTab } from "@/components/session-guide";
import { GUEST } from "@/lib/guest-copy";

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    types?: { description: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
  }) => Promise<Array<{ getFile: () => Promise<File> }>>;
};

type ViewTab = "import" | "paste" | "health" | "guides";

export function CookieImport() {
  const { user, isPending } = useCurrentUserState();
  const raw = useCookieStore((state) => state.raw);
  const count = useCookieStore((state) => state.count);
  const error = useCookieStore((state) => state.error);
  const setRaw = useCookieStore((state) => state.setRaw);
  const clear = useCookieStore((state) => state.clear);

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("import");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [manualText, setManualText] = useState("");
  const [browser, setBrowser] = useState<BrowserTab>("bookmarklet");
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    loggedIn: boolean;
    latencyMs: number;
    count: number;
    hasSapisid?: boolean;
    hasSid?: boolean;
    note?: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const lastClipRef = useRef("");

  useEffect(() => {
    scrubCookiePersist();
    if (isPending) return;
    if (!user) {
      clear();
      return;
    }
    clear();
    let cancelled = false;
    loadVault()
      .then((row) => {
        if (cancelled) return;
        if (row?.cookies) setRaw(row.cookies);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, isPending, clear, setRaw]);

  const persistRef = useRef<(text: string, source: string) => Promise<void>>(async () => undefined);

  async function persistText(text: string, source: string) {
    if (!user) {
      setStatus("Sign in to save YouTube credentials.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      if (isHarJson(text)) {
        const har = parseHar(text);
        useHarStore.getState().setFromParse(har);
        if (har.cookies) {
          const saved = await saveVault({ data: { cookies: har.cookies.netscape } });
          setRaw(har.cookies.netscape);
          const report = analyzeCookieFormat(har.cookies.netscape);
          const extra = report.issues[0] ? ` ${report.issues[0]}` : report.hasSapisid ? " Verified for 1080p & DASH." : "";
          setStatus(`Saved ${saved.count} cookies from ${source} (${report.format}).${extra}`);
          setManualText("");
          toast.success(`Imported ${saved.count} session cookies`);
          return;
        }
        if (har.playbacks.length) {
          setStatus("HAR contains media URLs but no cookies. Export again with sensitive data enabled.");
          return;
        }
      }
      const parsed = parseCookieImport(text);
      const saved = await saveVault({ data: { cookies: parsed.netscape } });
      setRaw(parsed.netscape);
      const report = analyzeCookieFormat(parsed.netscape);
      const extra = report.issues[0] ? ` ${report.issues[0]}` : " Credentials verified for yt-dlp.";
      setStatus(`Saved ${saved.count} cookies from ${source} (${report.format}).${extra}`);
      setManualText("");
      toast.success(`Imported ${saved.count} session cookies`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not import cookies.");
      toast.error(err instanceof Error ? err.message : "Failed to import cookies.");
    } finally {
      setBusy(false);
    }
  }
  persistRef.current = persistText;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin && event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; netscape?: string } | null;
      if (data?.source !== "velo-extension" || data.type !== "velo-youtube-cookies") return;
      if (typeof data.netscape !== "string") return;
      void persistRef.current(data.netscape, "the Velo extension");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    function onPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeSessionExport(text)) return;
      event.preventDefault();
      void persistRef.current(text, "paste");
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, user]);

  useEffect(() => {
    if (!open || !user) return;
    const timer = window.setInterval(() => {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (!text || text === lastClipRef.current || !looksLikeSessionExport(text)) return;
          lastClipRef.current = text;
          void persistRef.current(text, "clipboard");
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, user]);

  async function testConnection() {
    setProbing(true);
    try {
      const res = await validateVaultSession();
      if (!res.ok) {
        toast.error(res.error || "No active session in vault.");
        setProbeResult(null);
      } else {
        setProbeResult(res);
        if (res.loggedIn) {
          toast.success(`YouTube session confirmed active (${res.latencyMs}ms)`);
        } else {
          toast.warning("Session tokens saved, but YouTube reported visitor status.");
        }
      }
    } catch {
      toast.error("Failed to reach YouTube verification endpoint.");
    } finally {
      setProbing(false);
    }
  }

  async function wipe() {
    setBusy(true);
    setStatus(null);
    setProbeResult(null);
    try {
      clear();
      useHarStore.getState().clear();
      await clearVault();
      setStatus("Session cleared.");
      toast.success("Credentials cleared from vault");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not clear.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File is too large (>25MB). Please export a filtered HAR or text cookie export.");
      return;
    }
    await persistText(await file.text(), file.name);
  }

  async function grab() {
    setStatus("Looking on clipboard…");
    try {
      const text = await navigator.clipboard.readText();
      if (text && looksLikeSessionExport(text)) {
        await persistText(text, "clipboard");
        return;
      }
    } catch {
      /* file picker next */
    }
    const picker = (window as FilePickerWindow).showOpenFilePicker;
    try {
      if (picker) {
        const [handle] = await picker({
          types: [
            {
              description: "Cookie or HAR export",
              accept: { "text/plain": [".txt"], "application/json": [".json", ".har"] },
            },
          ],
        });
        await importFile(await handle.getFile());
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus(null);
        return;
      }
    }
    fileRef.current?.click();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void importFile(file);
      return;
    }
    const text = event.dataTransfer.getData("text/plain");
    if (text && looksLikeSessionExport(text)) void persistText(text, "drop");
  }

  const detectedManualFormat = useMemo(() => {
    if (!manualText.trim()) return null;
    return detectCookieFormat(manualText);
  }, [manualText]);

  if (isPending) {
    return <div className="panel mt-8 h-14 animate-pulse" />;
  }

  if (!user) {
    return (
      <div id="session-cookies" className="panel mt-8 px-5 py-5 scroll-mt-20">
        <p className="flex items-center gap-2 text-sm text-fg font-medium">
          <Lock className="size-4 text-muted" />
          {GUEST.vaultTitle}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{GUEST.vaultBody}</p>
        <Button asChild className="mt-4 h-11 w-full text-xs font-semibold">
          <Link to="/login">Sign in to add YouTube Credentials</Link>
        </Button>
      </div>
    );
  }

  return (
    <div id="session-cookies" className="panel mt-8 scroll-mt-20 overflow-hidden">
      {/* Header Bar */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left cursor-pointer hover:bg-elevated/30 transition-colors"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-fg">
          <Cookie className="size-4 text-accent" />
          YouTube Session Credentials
          {count > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {count} cookies active
            </span>
          ) : (
            <span className="rounded-full bg-elevated px-2.5 py-0.5 text-xs text-subtle">
              guest mode (unconfigured)
            </span>
          )}
        </span>
        <ChevronDown className={cn("size-4 text-subtle transition-transform duration-[var(--motion-quick)]", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="space-y-4 px-5 pb-5 border-t border-border pt-4">
          {/* Sub-Navigation Tabs */}
          <div className="flex flex-wrap gap-1 rounded-lg bg-elevated p-1 border border-border">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "import" ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg",
              )}
              onClick={() => setActiveTab("import")}
            >
              <Sparkles className="size-3.5" />
              Quick Import
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "paste" ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg",
              )}
              onClick={() => setActiveTab("paste")}
            >
              <FileCode className="size-3.5" />
              Direct Paste
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "health" ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg",
              )}
              onClick={() => setActiveTab("health")}
            >
              <ShieldCheck className="size-3.5" />
              Session Health & Verify
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "guides" ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg",
              )}
              onClick={() => setActiveTab("guides")}
            >
              <HelpCircle className="size-3.5" />
              Browser Guides
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,.har,text/plain,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.currentTarget.value = "";
            }}
          />

          {/* TAB 1: QUICK IMPORT */}
          {activeTab === "import" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 text-xs font-medium justify-center"
                  disabled={busy}
                  onClick={() => void grab()}
                >
                  <Clipboard className="size-3.5 mr-1.5" />
                  Grab from Clipboard
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 text-xs font-medium justify-center"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileUp className="size-3.5 mr-1.5" />
                  Upload .txt / .har
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 text-xs font-medium justify-center"
                  onClick={() => {
                    setActiveTab("guides");
                    setBrowser("bookmarklet");
                  }}
                >
                  <Bookmark className="size-3.5 mr-1.5 text-accent" />
                  1-Click Bookmarklet
                </Button>
              </div>

              {/* Drag and Drop Zone */}
              <button
                type="button"
                disabled={busy}
                className={cn(
                  "w-full rounded-lg bg-surface border-2 border-dashed border-border px-4 py-8 text-center text-xs text-muted hover:border-subtle hover:bg-elevated/40 transition-all cursor-pointer",
                  dragging && "border-accent text-fg bg-accent/10",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => void grab()}
              >
                {busy ? (
                  <span className="font-medium text-accent">Importing session…</span>
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <FileUp className="size-6 text-subtle" />
                    <span>Drop <strong className="text-fg">cookies.txt</strong>, <strong className="text-fg">.json</strong>, or <strong className="text-fg">.har</strong> here, or click to paste</span>
                  </span>
                )}
              </button>
            </div>
          )}

          {/* TAB 2: MANUAL DIRECT PASTE */}
          {activeTab === "paste" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Paste raw export tokens:</span>
                {detectedManualFormat ? (
                  <span className="rounded-full bg-accent/20 border border-accent/30 px-2 py-0.5 text-xs text-accent font-medium uppercase">
                    Format: {detectedManualFormat}
                  </span>
                ) : null}
              </div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Paste Netscape cookies.txt, Cookie-Editor JSON, DevTools table copy, or raw Cookie header here..."
                className="w-full h-32 rounded-lg bg-surface border border-border p-3 text-xs font-mono text-fg placeholder:text-subtle/50 focus:outline-none focus:border-accent"
              />
              <Button
                type="button"
                className="w-full h-10 text-xs font-semibold"
                disabled={!manualText.trim() || busy}
                onClick={() => void persistText(manualText, "manual paste")}
              >
                {busy ? "Parsing & Saving…" : "Save & Verify Credentials"}
              </Button>
            </div>
          )}

          {/* TAB 3: SESSION HEALTH & VERIFY */}
          {activeTab === "health" && (
            <div className="space-y-4">
              {/* Test Action Card */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg bg-elevated/70 border border-border p-3.5">
                <div>
                  <p className="text-xs font-semibold text-fg flex items-center gap-1.5">
                    <Activity className="size-4 text-accent" />
                    Live YouTube Session Verification
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    Probes YouTube's endpoint to test whether your saved tokens unlock full HD streams.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="text-xs shrink-0"
                  disabled={probing || count === 0}
                  onClick={() => void testConnection()}
                >
                  <RefreshCw className={cn("size-3.5 mr-1.5", probing && "animate-spin")} />
                  {probing ? "Testing…" : "Test Connection"}
                </Button>
              </div>

              {probeResult ? (
                <div
                  className={cn(
                    "rounded-lg p-3 text-xs border space-y-1",
                    probeResult.loggedIn
                      ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                      : "bg-amber-500/10 border-amber-500/25 text-amber-300",
                  )}
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    <Check className="size-4 stroke-[2.5]" />
                    {probeResult.loggedIn ? "Session Verified Active" : "Visitor Session Detected"}
                  </p>
                  <p className="text-xs opacity-90">
                    Round-trip latency: <strong className="font-mono">{probeResult.latencyMs}ms</strong> · Verified {probeResult.count} tokens.
                  </p>
                  {probeResult.note ? <p className="text-xs opacity-80">{probeResult.note}</p> : null}
                </div>
              ) : null}

              {raw && count > 0 ? <CookieFacts raw={raw} /> : (
                <div className="rounded-lg bg-surface border border-border p-3.5 text-center text-xs text-muted">
                  No cookies saved in your vault yet. Use <strong className="text-fg">Quick Import</strong> or <strong className="text-fg">Direct Paste</strong> to attach your YouTube session.
                </div>
              )}

              <HarReport />
            </div>
          )}

          {/* TAB 4: BROWSER GUIDES */}
          {activeTab === "guides" && (
            <SessionGuide browser={browser} onBrowser={setBrowser} />
          )}

          {/* Status & Error Feedbacks */}
          {error ? (
            <p className="rounded-md bg-danger/10 border border-danger/20 p-2.5 text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="rounded-md bg-surface border border-border p-2.5 text-xs text-fg">
              {status}
            </p>
          ) : null}

          {/* Security Guarantee & Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border pt-3.5 text-xs">
            <span className="flex items-center gap-1.5 text-subtle">
              <Shield className="size-3.5 text-muted" />
              <span>Encrypted in private database · Sent only to YouTube · Never shared</span>
            </span>
            {count > 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="text-xs h-8"
                disabled={busy}
                onClick={() => void wipe()}
              >
                <Trash2 className="size-3 mr-1" />
                Clear Session
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatWhen(unix: number) {
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function CookieFacts({ raw }: { raw: string }) {
  const report = analyzeCookieFormat(raw);
  const sidExpired = report.expiredNames.some((name) => name.toUpperCase() === "SID");
  const sidLine = sidExpired
    ? `SID expired${report.sidExpiresAt ? ` ${formatWhen(report.sidExpiresAt)}` : ""}. Sign in on youtube.com and export again.`
    : report.sidExpiresAt
      ? `SID expires ${formatWhen(report.sidExpiresAt)} (Google’s standard lifetime is ~2 years).`
      : report.hasSid
        ? "SID is present with no expiry in this file (session cookie)."
        : "No SID in this export — Google only creates it at sign-in.";

  return (
    <div className="space-y-3 rounded-lg bg-surface border border-border p-3.5 text-xs">
      <p className="font-semibold text-fg flex items-center justify-between">
        <span>Token Inventory & Health</span>
        <span className="font-mono text-subtle font-normal">{report.count} tokens ({report.format})</span>
      </p>

      {/* Token Badges */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]",
            report.hasSapisid ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-elevated text-subtle border border-border",
          )}
        >
          {report.hasSapisid ? <Check className="size-3" /> : "✕"} SAPISID (Auth)
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]",
            report.hasSid ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-elevated text-subtle border border-border",
          )}
        >
          {report.hasSid ? <Check className="size-3" /> : "✕"} SID (Google)
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]",
            report.hasLogin ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-elevated text-subtle border border-border",
          )}
        >
          {report.hasLogin ? <Check className="size-3" /> : "✕"} LOGIN_INFO
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-0.5 font-mono text-[11px] text-muted border border-border">
          {report.httpOnly} HttpOnly
        </span>
      </div>

      <div className="space-y-1 text-muted leading-relaxed">
        <p className="text-fg font-medium">{sidLine}</p>
        <p>{SID_EXPLAIN}</p>
        <p>{COOKIE_TTL_EXPLAIN}</p>
      </div>

      {report.expiredNames.length ? (
        <p className="rounded-md bg-danger/10 border border-danger/20 p-2 text-danger">
          Expired tokens: {report.expiredNames.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

