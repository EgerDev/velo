import { BotGuardClient } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { buildURL, getHeaders, parseLooseJSON, USER_AGENT } from "bgutils-js/utils";
import { createColdStartToken, WebPoMinter } from "bgutils-js/webpo";
import { JSDOM } from "jsdom";
import "@/lib/ipv4-bind.server";

type Minter = {
  mintAsWebsafeString: (binding: string) => Promise<string>;
};

type ChallengeResponse = {
  bgChallenge?: {
    program: string;
    globalName: string;
    interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string };
  };
};

export type PoTokenInfo = {
  token: string | null;
  method: "botguard" | "cold-start" | "none";
  error: string | null;
};

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

let minterPromise: Promise<Minter> | null = null;
let minterCreatedAt = 0;
let lastMinterError: string | null = null;
const tokenCache = new Map<string, { token: string; expires: number; method: PoTokenInfo["method"] }>();

const g = globalThis as unknown as Record<string, unknown>;
const originalGlobals = { window: g.window, self: g.self, document: g.document };
let bgWindow: (typeof globalThis & { yt?: { config_: unknown } }) | null = null;
let bgDom: { window: { close: () => void } } | null = null;
let bindChain = Promise.resolve();

function bindBgWindow() {
  if (!bgWindow) return;
  g.window = bgWindow;
  g.self = bgWindow;
  g.document = bgWindow.document;
}

function unbindBgWindow() {
  g.window = originalGlobals.window;
  g.self = originalGlobals.self;
  g.document = originalGlobals.document;
}

function withBgWindow<T>(fn: () => Promise<T>): Promise<T> {
  const run = bindChain.then(async () => {
    bindBgWindow();
    try {
      return await fn();
    } finally {
      unbindBgWindow();
    }
  });
  bindChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function stubCanvas(window: { HTMLCanvasElement?: { prototype: { getContext?: unknown } } }) {
  const proto = (window as unknown as { HTMLCanvasElement?: { prototype: { getContext?: unknown } } })
    .HTMLCanvasElement?.prototype;
  if (!proto || typeof proto.getContext === "function") return;
  proto.getContext = function getContext() {
    const _canvas = this as { width?: number; height?: number };
    return {
      canvas: this,
      fillStyle: "",
      strokeStyle: "",
      fillRect() {},
      clearRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      fillText() {},
      strokeText() {},
      measureText() {
        return { width: 0 };
      },
      drawImage() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        return { data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4), width: w, height: h };
      },
      putImageData() {},
      createImageData(w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      scale() {},
      translate() {},
      rotate() {},
      save() {},
      restore() {},
    };
  };
}

async function createMinter(): Promise<Minter> {
  try {
    bgDom?.window.close();
  } catch {
    /* already torn down */
  }
  bgDom = null;
  bgWindow = null;

  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
    userAgent: USER_AGENT,
    pretendToBeVisual: true,
  });
  const window = dom.window as unknown as typeof globalThis & { yt?: { config_: unknown } };
  stubCanvas(window);
  bgDom = dom;
  bgWindow = window;

  return withBgWindow(async () => {
    const pageResponse = await fetch("https://www.youtube.com/", {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": USER_AGENT,
      },
    });
    if (!pageResponse.ok) throw new Error(`YouTube homepage ${pageResponse.status}`);
    const pageHtml = await pageResponse.text();
    if (pageHtml.includes("Sign in to confirm") || pageHtml.length < 2000) {
      throw new Error("YouTube served a bot wall instead of BotGuard.");
    }

    const ytConfig = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)?.[1];
    if (!ytConfig) throw new Error("Missing ytcfg on homepage.");
    window.yt = { config_: JSON.parse(ytConfig) };

    const attestation = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
    if (!attestation) throw new Error("Missing BotGuard challenge (ytAtN).");
    const parsed = parseLooseJSON(attestation[1]) as { R?: ChallengeResponse };
    const challenge = parsed.R?.bgChallenge;
    if (!challenge) throw new Error("Missing bgChallenge program.");

    const interpreterUrl = challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    const script = await (await fetch(`https:${interpreterUrl}`)).text();
    if (!script.includes("function") && script.length < 100) throw new Error("Empty BotGuard VM script.");
    const vm = new Function("window", "self", "globalThis", "document", "location", "navigator", "yt", script);
    vm(window, window, window, window.document, window.location, window.navigator, window.yt);

    const botGuardClient = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: window,
    });

    const webPoSignalOutput: WebPoSignalOutput = [];
    const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput });
    if (!botguardResponse) throw new Error("BotGuard snapshot was empty.");

    const integrityTokenResponse = await fetch(buildURL("GenerateIT", true), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    if (!integrityTokenResponse.ok) throw new Error(`GenerateIT ${integrityTokenResponse.status}`);
    const integrityTokenJson = (await integrityTokenResponse.json()) as [string, number, number, string];
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityTokenJson;
    if (!integrityToken) throw new Error("Empty integrity token.");

    return await WebPoMinter.create(
      { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
      webPoSignalOutput,
    );
  });
}

function getMinter(): Promise<Minter> {
  if (minterPromise && Date.now() - minterCreatedAt < TOKEN_TTL_MS) {
    return minterPromise;
  }
  minterCreatedAt = Date.now();
  const pending = createMinter()
    .then((minter) => {
      lastMinterError = null;
      return minter;
    })
    .catch((err) => {
      if (minterPromise === pending) {
        minterPromise = null;
        minterCreatedAt = 0;
      }
      lastMinterError = err instanceof Error ? err.message : "BotGuard minter failed.";
      throw err;
    });
  minterPromise = pending;
  return pending;
}

export async function mintDualPoTokens(opts: {
  visitor?: string | null;
  videoId?: string | null;
}): Promise<{ player: string | null; gvs: string | null; method: PoTokenInfo["method"]; error: string | null }> {
  /**
   * Bindings (yt-dlp 2026.08 + html5_generate_content_po_token):
   * - player and GVS both bind to the video id
   * - yt-dlp #12090 wants distinct tokens per context even with the same binding
   * visitor_data is a separate extractor-arg, not the player token.
   * Sequential: both mints share one JSDOM + globalThis bind.
   */
  const binding = opts.videoId;
  if (!binding) {
    return { player: null, gvs: null, method: "none", error: null };
  }
  const player = await mintPoTokenDetailed(binding, "player");
  const gvs = await mintPoTokenDetailed(binding, "gvs");
  return {
    player: player.token,
    gvs: gvs.token,
    method: player.method !== "none" ? player.method : gvs.method,
    error: player.error || gvs.error,
  };
}

export async function mintContentPoToken(videoId: string): Promise<string | null> {
  const info = await mintPoTokenDetailed(videoId, "gvs");
  return info.token;
}

const mintInflight = new Map<string, Promise<PoTokenInfo>>();

export async function mintPoTokenDetailed(videoId: string, slot: "player" | "gvs" | "content" = "content"): Promise<PoTokenInfo> {
  const cacheKey = `${slot}:${videoId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return { token: cached.token, method: cached.method, error: null };
  }

  let pending = mintInflight.get(cacheKey);
  if (!pending) {
    pending = mintPoTokenUncached(videoId, slot, cacheKey).finally(() => {
      if (mintInflight.get(cacheKey) === pending) mintInflight.delete(cacheKey);
    });
    mintInflight.set(cacheKey, pending);
  }
  return pending;
}

async function mintPoTokenUncached(
  videoId: string,
  slot: "player" | "gvs" | "content",
  cacheKey: string,
): Promise<PoTokenInfo> {
  const again = tokenCache.get(cacheKey);
  if (again && again.expires > Date.now()) {
    return { token: again.token, method: again.method, error: null };
  }

  try {
    const minter = await getMinter();
    const token = await withBgWindow(() => minter.mintAsWebsafeString(videoId));
    if (!token || token.length < 20) throw new Error("Minted token was too short.");
    tokenCache.set(cacheKey, {
      token,
      method: "botguard",
      expires: Date.now() + 4 * 60 * 60 * 1000,
    });
    return { token, method: "botguard", error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : lastMinterError || "BotGuard failed.";
    try {
      const token = createColdStartToken(videoId);
      tokenCache.set(cacheKey, {
        token,
        method: "cold-start",
        expires: Date.now() + 30 * 60 * 1000,
      });
      return { token, method: "cold-start", error };
    } catch {
      return { token: null, method: "none", error };
    }
  }
}

export function stampPoToken(url: string, pot: string | null | undefined): string {
  if (!pot) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("pot", pot);
    parsed.searchParams.set("potc", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}
