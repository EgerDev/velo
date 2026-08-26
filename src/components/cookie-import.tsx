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

export function CookieImport({ revealSignal = 0 }: { revealSignal?: number } = {}) {
  const { user, isPending } = useCurrentUserState();
  const raw = useCookieStore((state) => state.raw);
  const count = useCookieStore((state) => state.count);
  const error = useCookieStore((state) => state.error);
  const setRaw = useCookieStore((state) => state.setRaw);
  const clear = useCookieStore((state) => state.clear);

  const [open, setOpen] = useState(false);

  // The header's session chip scrolls here and bumps this counter, so the panel
  // is already expanded when the user arrives instead of needing a second click.
  useEffect(() => {
    if (revealSignal > 0) setOpen(true);
  }, [revealSignal]);
  const [activeTab, setActiveTab] = useState<ViewTab>("import");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [manualText, setManualText] = useState("");
  const [browser, setBrowser] = useState<BrowserTab>("bookmarklet");
  const [probeResult, setProbeResult] = useState<{
    // What YouTube actually said — see `validateVaultSession`. `latencyMs` is
    // null when no round trip completed, so the UI can't report a timeout as one.
    probe: "live" | "signed-out" | "unreachable";
    reason: string | null;
    latencyMs: number | null;
    count: number;
    hasSapisid?: boolean;
    hasSid?: boolean;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("cookie_sync") !== "1") return;
    setOpen(true);
    setActiveTab("paste");
    setStatus("Cookies were copied. Paste them here (⌘V / Ctrl+V).");
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);

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
    // Saving upserts the whole vault, so an import replaces whatever session is
    // already stored. Never do that silently — make the user say yes first.
    if (count > 0) {
      const replace = window.confirm(
        `Replace your ${count} saved YouTube session cookies with the ones from ${source}?`,
      );
      if (!replace) {
        setStatus("Import cancelled — your saved session was left unchanged.");
        return;
      }
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

  async function testConnection() {
    setProbing(true);
    try {
      const res = await validateVaultSession();
      if (!res.ok) {
        toast.error(res.error || "No active session in vault.");
        setProbeResult(null);
      } else {
        setProbeResult(res);
        if (res.probe === "live") {
          toast.success(`YouTube confirmed this session is signed in (${res.latencyMs}ms)`);
        } else if (res.probe === "signed-out") {
          toast.warning("YouTube served this session as signed out — re-export your cookies.");
        } else {
          toast.warning(res.reason ?? "Could not verify the session with YouTube.");
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
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-elevated/30 transition-colors"
        onClick={() => setOpen((value) => !value)}
      >
        {/* Optional panel: no accent colour until cookies are actually attached,
            so it never competes with the download button above it. */}
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          <Cookie className="size-4 text-subtle" />
          YouTube session
          {count > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 border border-success/30 px-2 py-0.5 font-mono text-[11px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {count} cookies
            </span>
          ) : (
            <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-subtle">
              optional
            </span>
          )}
        </span>
        <ChevronDown className={cn("size-4 text-subtle transition-transform duration-[var(--motion-quick)]", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="space-y-3 px-4 pb-4 border-t border-border pt-3.5">
          {/* Secondary nav: a quiet segmented control. The gold pill belongs to
              the page's primary mode switcher — repeating it here would make an
              optional panel look like the main event. */}
          <div
            role="tablist"
            aria-label="Session cookie tools"
            className="flex flex-wrap gap-0.5 rounded-lg bg-elevated/60 p-0.5 border border-border w-fit max-w-full"
          >
            {(
              [
                { id: "import", icon: Sparkles, label: "Import" },
                { id: "paste", icon: FileCode, label: "Paste" },
                { id: "health", icon: ShieldCheck, label: "Health" },
                { id: "guides", icon: HelpCircle, label: "Guides" },
              ] as const
            ).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={cn(
                  "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  activeTab === id
                    ? "bg-surface text-fg shadow-xs"
                    : "text-subtle hover:text-muted",
                )}
                onClick={() => setActiveTab(id)}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
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
            <div className="space-y-2.5">
              {/*
                Three ways in, side by side, so the row uses the panel's width
                instead of stacking sparse full-width blocks. The whole group is
                the drop target — a dedicated dropzone box would just be more
                empty space to look at.
              */}
              <div
                className={cn(
                  "rounded-lg border border-dashed p-1.5 transition-colors",
                  dragging ? "border-accent bg-accent/5" : "border-border",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                {busy ? (
                  <p className="px-3 py-6 text-center text-xs font-medium text-accent">
                    Importing session…
                  </p>
                ) : dragging ? (
                  <p className="px-3 py-6 text-center text-xs font-medium text-accent">
                    Drop the file to import it
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    {(
                      [
                        {
                          icon: FileUp,
                          label: "Choose a file",
                          hint: "or drop cookies.txt · .json · .har",
                          onClick: () => fileRef.current?.click(),
                        },
                        {
                          icon: Clipboard,
                          label: "Paste from clipboard",
                          hint: "if you already copied them",
                          onClick: () => void grab(),
                        },
                        {
                          icon: Bookmark,
                          label: "Bookmarklet",
                          hint: "export from YouTube in one click",
                          onClick: () => {
                            setActiveTab("guides");
                            setBrowser("bookmarklet");
                          },
                        },
                      ] as const
                    ).map(({ icon: Icon, label, hint, onClick }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={onClick}
                        className="flex items-start gap-2.5 rounded-md border border-transparent bg-elevated/40 p-2.5 text-left transition-colors cursor-pointer hover:border-border-strong hover:bg-elevated"
                      >
                        <Icon className="size-4 shrink-0 text-subtle mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium leading-tight text-fg">
                            {label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-tight text-subtle">
                            {hint}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MANUAL DIRECT PASTE */}
          {activeTab === "paste" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Paste your exported cookies</span>
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
                {busy ? "Saving…" : "Save cookies"}
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
                    Check your session
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    Asks YouTube whether your saved cookies still unlock full-resolution downloads.
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
                  {probing ? "Checking…" : "Check now"}
                </Button>
              </div>

              {probeResult ? (
                <div
                  className={cn(
                    "rounded-lg p-3 text-xs border space-y-1",
                    probeResult.probe === "live"
                      ? "bg-success/10 border-success/25 text-success"
                      : "bg-warn/10 border-warn/25 text-warn",
                  )}
                  role="status"
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    <Check className="size-4 stroke-[2.5]" />
                    {probeResult.probe === "live"
                      ? "YouTube confirmed this session"
                      : probeResult.probe === "signed-out"
                        ? "YouTube sees this as signed out"
                        : "Not verified"}
                  </p>
                  <p className="text-xs opacity-90">
                    {/* Only claim a round trip when one actually happened. */}
                    {probeResult.latencyMs != null
                      ? `Round-trip ${probeResult.latencyMs}ms · ${probeResult.count} cookies sent.`
                      : `${probeResult.count} cookies saved — not checked against YouTube.`}
                  </p>
                  {probeResult.reason ? <p className="text-xs opacity-80">{probeResult.reason}</p> : null}
                </div>
              ) : null}

              {raw && count > 0 ? <CookieFacts raw={raw} /> : (
                <div className="rounded-lg bg-surface border border-border p-3.5 text-center text-xs text-muted">
                  No cookies saved yet — add them from the <strong className="text-fg">Import</strong> or <strong className="text-fg">Paste</strong> tab.
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border pt-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-subtle">
              <Shield className="size-3 text-subtle" />
              <span>Encrypted, sent only to YouTube, never shared</span>
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
            report.hasSapisid ? "bg-success/15 text-success border border-success/30" : "bg-elevated text-subtle border border-border",
          )}
        >
          {report.hasSapisid ? <Check className="size-3" /> : "✕"} SAPISID (Auth)
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]",
            report.hasSid ? "bg-success/15 text-success border border-success/30" : "bg-elevated text-subtle border border-border",
          )}
        >
          {report.hasSid ? <Check className="size-3" /> : "✕"} SID (Google)
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]",
            report.hasLogin ? "bg-success/15 text-success border border-success/30" : "bg-elevated text-subtle border border-border",
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

