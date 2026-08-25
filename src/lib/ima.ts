/**
 * YouTube IMA SDK is Google’s Interactive Media Ads player
 * (`imasdk.googleapis.com/js/sdkloader/ima3.js`). YouTube’s watch page uses it
 * for prerolls / DAI. It is not a download API and it cannot unlock 1080p.
 *
 * Client-side IMA: VAST over the content player.
 * DAI: ads stitched on the CDN (`dai.google.com`). Those bytes are ads.
 *
 * Save never loads ima3.js. Relays refuse IMA hosts so a preroll cannot win
 * the hop race. Nested `url=` / `adurl=` on a googlevideo wrapper still counts.
 */
const IMA_HOST =
  /(^|\.)((imasdk\.googleapis\.com)|(doubleclick\.net)|(googleadservices\.com)|(googlesyndication\.com)|(dai\.google\.com))$/i;

const IMA_PATH =
  /\/pagead(?:2)?(?:\/|$)|\/gampad\/|\/vpaid(?:\/|$)|[?&]vpaid=|(?:[?&/]|%2[fF])oad(?:=|%3[dD]|\/)|(?:[?&/]|%2[fF])ctier(?:=|%3[dD]|\/)L\b/i;

export function isImaHost(hostname: string): boolean {
  return IMA_HOST.test(hostname.toLowerCase());
}

function nestedTargets(raw: string): string[] {
  const out: string[] = [];
  const push = (value: string | null) => {
    if (!value || value === raw) return;
    try {
      out.push(decodeURIComponent(value));
    } catch {
      out.push(value);
    }
  };
  try {
    const parsed = /^https?:\/\//i.test(raw) ? new URL(raw) : null;
    const args = new URLSearchParams(parsed ? parsed.search : raw);
    for (const key of ["url", "adurl", "vasturl"]) push(args.get(key));
    const path = parsed?.pathname ?? "";
    const pathNested = /\/(url|adurl|vasturl)\/([^/]+)/i.exec(path);
    if (pathNested?.[2]) push(pathNested[2]);
  } catch {
    /* ignore */
  }
  return out;
}

export function isImaUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const text = raw.trim();
  if (!text) return false;
  try {
    if (/^https?:\/\//i.test(text)) {
      const parsed = new URL(text);
      if (isImaHost(parsed.hostname)) return true;
      if (IMA_PATH.test(parsed.pathname + parsed.search)) return true;
      if (/\.googlevideo\.com$/i.test(parsed.hostname) && /[?&](oad|ctier)=/i.test(parsed.search)) return true;
    }
  } catch {
    /* not a URL — still inspect nested params */
  }
  for (const nested of nestedTargets(text)) {
    if (isImaUrl(nested)) return true;
  }
  return false;
}

export const IMA_EXPLAIN =
  "YouTube IMA SDK (ima3.js) is the ad player — VAST prerolls and DAI stitches. It is not InnerTube and it is not a download path. Save never loads it; doubleclick / DAI hosts are dropped so a 15s ad cannot replace 1080p.";
