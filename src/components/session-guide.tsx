import { useState } from "react";
import {
  Bookmark,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  Laptop,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const VELO_EXTENSION_ZIP = "/extensions/velo-session.zip";

export const INGEST_BOOKMARKLET_CODE = `javascript:(function(){window.open('https://'+window.location.host+'/?v='+encodeURIComponent(window.location.href));})();`;

export function getIngestBookmarkletCode(origin?: string): string {
  if (typeof window !== "undefined" && !origin && window.location?.origin) {
    origin = window.location.origin;
  }
  if (origin) {
    return `javascript:(function(){window.open('${origin}/?v='+encodeURIComponent(window.location.href));})();`;
  }
  return INGEST_BOOKMARKLET_CODE;
}

/** Open-source exporters that keep cookies on-device (yt-dlp community standard). */
const TOOLS = {
  cookiesTxtLocally: {
    chrome: "https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
    firefox: "https://addons.mozilla.org/firefox/addon/get-cookies-txt-locally/",
    edge: "https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
  },
  cookieEditor: {
    chrome: "https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm",
    firefox: "https://addons.mozilla.org/firefox/addon/cookie-editor/",
    safari: "https://apps.apple.com/app/cookie-editor/id6446926210",
    edge: "https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhmignadilhkjeln",
    site: "https://cookie-editor.com/",
  },
  editThisCookie: "https://chromewebstore.google.com/detail/editthiscookie-v3/ojfebgpkimhlhcblbalbfjblapadhbol",
  cookieQuickManager: "https://addons.mozilla.org/firefox/addon/cookie-quick-manager/",
} as const;

export const BOOKMARKLET_CODE = `javascript:(function(){try{if(!location.hostname.includes('youtube.com')){alert('⚠️ Please open youtube.com while logged in before clicking this bookmarklet.');return;}var c=document.cookie;if(!c){alert('⚠️ No cookies found. Make sure you are signed into YouTube in this browser tab.');return;}var arr=c.split('; ').map(function(pair){var idx=pair.indexOf('=');return{domain:'.youtube.com',name:idx>-1?pair.substring(0,idx):pair,value:idx>-1?pair.substring(idx+1):'',path:'/',secure:true};});var json=JSON.stringify(arr);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(json).then(function(){alert('✅ YouTube cookies copied to clipboard!\\n\\nSwitch back to Velo and paste.');}).catch(function(){prompt('Copy your YouTube cookies below:',json);});}else{prompt('Copy your YouTube cookies below:',json);}}catch(e){alert('Export error: '+e.message);}})();`;

export type BrowserTab = "bookmarklet" | "chrome" | "safari" | "firefox" | "edge" | "mobile";

export function SessionGuide({
  browser = "bookmarklet",
  onBrowser,
}: {
  browser: BrowserTab;
  onBrowser: (tab: BrowserTab) => void;
}) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedIngestCode, setCopiedIngestCode] = useState(false);

  const ingestCode = typeof window !== "undefined" ? getIngestBookmarkletCode() : INGEST_BOOKMARKLET_CODE;

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET_CODE);
      setCopiedCode(true);
      toast.success("Cookie exporter bookmarklet code copied to clipboard");
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      toast.error("Could not copy bookmarklet code.");
    }
  };

  const copyIngestBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(ingestCode);
      setCopiedIngestCode(true);
      toast.success("'Open in Velo' bookmarklet code copied to clipboard");
      setTimeout(() => setCopiedIngestCode(false), 2500);
    } catch {
      toast.error("Could not copy bookmarklet code.");
    }
  };

  const tabs: Array<{ id: BrowserTab; label: string; icon: typeof Globe }> = [
    { id: "bookmarklet", label: "1-Click (All)", icon: Sparkles },
    { id: "chrome", label: "Chrome / Brave", icon: Globe },
    { id: "safari", label: "Safari", icon: Compass },
    { id: "firefox", label: "Firefox", icon: Flame },
    { id: "edge", label: "Edge", icon: Laptop },
    { id: "mobile", label: "Mobile (iOS/Android)", icon: Smartphone },
  ];

  return (
    <div className="space-y-4 rounded-lg bg-surface border border-border p-4">
      <div className="flex flex-wrap gap-1 rounded-lg bg-elevated p-1 border border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = browser === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-[var(--motion-quick)] cursor-pointer",
                active
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-muted hover:text-fg",
              )}
              onClick={() => onBrowser(tab.id)}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {browser === "bookmarklet" && (
        <div className="space-y-3.5 text-xs">
          <div className="rounded-md bg-accent/10 border border-accent/20 p-3 text-fg">
            <p className="font-semibold text-accent-fg flex items-center gap-1.5">
              <Sparkles className="size-4 text-accent" />
              Universal 1-Click Bookmarklet (Works on Any Browser)
            </p>
            <p className="mt-1 text-muted leading-relaxed">
              Drag the button below to your browser's Bookmarks bar, or copy the code to create a bookmark manually.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={BOOKMARKLET_CODE}
              onClick={(e) => {
                e.preventDefault();
                void copyBookmarklet();
              }}
              title="Drag this button to your Bookmarks Bar"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-fg shadow-sm hover:opacity-90 transition-opacity cursor-grab active:cursor-grabbing"
            >
              <Bookmark className="size-4 fill-current" />
              Export YouTube Cookies (Drag to Bookmarks)
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 text-xs"
              onClick={() => void copyBookmarklet()}
            >
              {copiedCode ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
              {copiedCode ? "Copied!" : "Copy Code"}
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">How to use it:</p>
            <ol className="space-y-1.5 text-muted pl-4 list-decimal">
              <li>Open <strong className="text-fg">youtube.com</strong> in your browser and ensure you are logged in.</li>
              <li>Click the <strong className="text-fg">"Export YouTube Cookies"</strong> bookmarklet in your bookmarks bar.</li>
              <li>A confirmation popup will appear: <em className="text-fg">"Cookies copied to clipboard!"</em></li>
              <li>Switch back to <strong className="text-fg">Velo</strong> and click <strong className="text-fg">"Paste from clipboard"</strong> (or press Ctrl+V / Cmd+V).</li>
            </ol>
          </div>
        </div>
      )}

      {browser === "chrome" && (
        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="font-medium text-fg">Option 1 (Recommended): Get cookies.txt LOCALLY</p>
            <p className="text-muted leading-relaxed">
              Open-source extension that extracts cookies locally on your machine without telemetry.
            </p>
            <Button asChild className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookiesTxtLocally.chrome} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Get cookies.txt LOCALLY (Chrome Web Store)
              </a>
            </Button>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-fg">Option 2: Cookie-Editor Extension</p>
            <p className="text-muted leading-relaxed">
              Sign in on youtube.com, click Cookie-Editor, click <strong>Export → Export as JSON</strong>, then paste into Velo.
            </p>
            <Button asChild variant="secondary" className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookieEditor.chrome} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Cookie-Editor (Chrome Web Store)
              </a>
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">Option 3: DevTools (No Extensions Needed)</p>
            <ol className="space-y-1 text-muted pl-4 list-decimal">
              <li>On youtube.com, press <kbd className="font-mono bg-surface px-1 rounded">F12</kbd> or <kbd className="font-mono bg-surface px-1 rounded">Cmd+Option+I</kbd>.</li>
              <li>Go to <strong className="text-fg">Application → Storage → Cookies → https://www.youtube.com</strong>.</li>
              <li>Click anywhere in the table, press <kbd className="font-mono bg-surface px-1 rounded">Cmd+A / Ctrl+A</kbd>, then <kbd className="font-mono bg-surface px-1 rounded">Cmd+C / Ctrl+C</kbd>.</li>
              <li>Paste directly into Velo's paste box.</li>
            </ol>
          </div>
        </div>
      )}

      {browser === "safari" && (
        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="font-medium text-fg">Option 1 (Fastest): Use the 1-Click Bookmarklet</p>
            <p className="text-muted leading-relaxed">
              Works instantly on Safari for macOS, iOS, and iPadOS without needing App Store extensions.
            </p>
            <Button
              type="button"
              variant="default"
              className="h-9 w-full justify-start text-xs"
              onClick={() => void copyBookmarklet()}
            >
              <Copy className="size-3.5 mr-1.5" />
              Copy Safari Bookmarklet Code
            </Button>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-fg">Option 2: Cookie-Editor for Safari (Mac App Store)</p>
            <p className="text-muted leading-relaxed">
              Official Safari extension available directly from Apple's App Store.
            </p>
            <Button asChild variant="secondary" className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookieEditor.safari} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Get Cookie-Editor on Mac App Store
              </a>
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">Option 3: Safari Web Inspector (macOS)</p>
            <ol className="space-y-1 text-muted pl-4 list-decimal">
              <li>In Safari menu: <strong className="text-fg">Settings → Advanced → Check "Show features for web developers"</strong>.</li>
              <li>Open youtube.com and press <kbd className="font-mono bg-surface px-1 rounded">Option+Cmd+I</kbd>.</li>
              <li>Click <strong className="text-fg">Storage → Cookies → youtube.com</strong>.</li>
              <li>Select all rows, copy (<kbd className="font-mono bg-surface px-1 rounded">Cmd+C</kbd>), and paste into Velo.</li>
            </ol>
          </div>
        </div>
      )}

      {browser === "firefox" && (
        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="font-medium text-fg">Option 1 (Recommended): Cookie-Editor for Firefox</p>
            <p className="text-muted leading-relaxed">
              Works on both Firefox Desktop and Firefox for Android.
            </p>
            <Button asChild className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookieEditor.firefox} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Cookie-Editor (Firefox Add-ons)
              </a>
            </Button>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-fg">Option 2: Get cookies.txt LOCALLY</p>
            <Button asChild variant="secondary" className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookiesTxtLocally.firefox} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Get cookies.txt LOCALLY (Firefox Add-ons)
              </a>
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">Option 3: Firefox Storage Inspector (No Extension)</p>
            <ol className="space-y-1 text-muted pl-4 list-decimal">
              <li>On youtube.com, press <kbd className="font-mono bg-surface px-1 rounded">F12</kbd> or <kbd className="font-mono bg-surface px-1 rounded">Ctrl+Shift+I</kbd>.</li>
              <li>Click <strong className="text-fg">Storage → Cookies → https://www.youtube.com</strong>.</li>
              <li>Select the cookie list, copy, and paste into Velo.</li>
            </ol>
          </div>
        </div>
      )}

      {browser === "edge" && (
        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <p className="font-medium text-fg">Option 1: Cookie-Editor for Microsoft Edge</p>
            <Button asChild className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookieEditor.edge} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Cookie-Editor (Edge Add-ons Store)
              </a>
            </Button>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-fg">Option 2: Get cookies.txt LOCALLY for Edge</p>
            <Button asChild variant="secondary" className="h-9 w-full justify-start text-xs">
              <a href={TOOLS.cookiesTxtLocally.edge} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5 mr-1.5" />
                Install Get cookies.txt LOCALLY (Edge Add-ons)
              </a>
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">Option 3: Edge Developer Tools</p>
            <ol className="space-y-1 text-muted pl-4 list-decimal">
              <li>On youtube.com, press <kbd className="font-mono bg-surface px-1 rounded">F12</kbd>.</li>
              <li>Navigate to <strong className="text-fg">Application → Storage → Cookies → youtube.com</strong>.</li>
              <li>Select all rows, copy (<kbd className="font-mono bg-surface px-1 rounded">Ctrl+C</kbd>), and paste into Velo.</li>
            </ol>
          </div>
        </div>
      )}

      {browser === "mobile" && (
        <div className="space-y-4 text-xs">
          <div className="space-y-2 rounded-md bg-accent/10 border border-accent/20 p-3 text-fg">
            <p className="font-semibold text-accent-fg flex items-center gap-1.5">
              <Smartphone className="size-4 text-accent" />
              Mobile Safari (iOS) & Mobile Chrome (Android)
            </p>
            <p className="mt-1 text-muted leading-relaxed">
              The easiest way on phone or tablet is adding the 1-Click Bookmarklet.
            </p>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">iPhone & iPad (Safari):</p>
            <ol className="space-y-1.5 text-muted pl-4 list-decimal">
              <li>Bookmark this page in Safari. Name it <strong className="text-fg">"Export YouTube Cookies"</strong>.</li>
              <li>Tap <strong className="text-fg">"Copy Code"</strong> below.</li>
              <li>Edit your bookmarks in Safari, tap the bookmark you just made, and replace the URL with the copied code.</li>
              <li>Open <strong className="text-fg">youtube.com</strong> in Safari while logged in, tap your address bar, and type/select the bookmark.</li>
              <li>Switch back to Velo and tap <strong className="text-fg">"Paste from clipboard"</strong>.</li>
            </ol>
            <Button
              type="button"
              className="mt-2 h-9 w-full text-xs"
              onClick={() => void copyBookmarklet()}
            >
              <Copy className="size-3.5 mr-1.5" />
              Copy Mobile Bookmarklet Code
            </Button>
          </div>

          <div className="space-y-2 rounded-md bg-elevated/60 p-3 border border-border">
            <p className="font-medium text-fg">Android (Firefox):</p>
            <p className="text-muted">
              Firefox for Android allows installing the Cookie-Editor extension directly from the Add-ons manager.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

