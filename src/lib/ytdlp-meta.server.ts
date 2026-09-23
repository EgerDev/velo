import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture } from "@/lib/ytdlp-proc.server";
import {
  ensurePython,
  ensurePySocks,
  ensureImpersonate,
  directYtdlpOpen,
  markDirectYtdlpBlocked,
} from "@/lib/ytdlp-python.server";
import { markSocksDead, markSocksGood, releaseSocks, takeSocks } from "@/lib/socks-pool.server";
import { ytdlpJsonToFormats, type YtDlpJsonFormat } from "@/lib/ytdlp-formats";
import type { VideoFormat } from "@/lib/youtube";
import { acquireYtdlpSlot } from "@/lib/download-pool.server";
import { mapYtdlpExit, pythonBin } from "@/lib/ytdlp-auth";
import { JSON_STDOUT_MAX } from "@/lib/ytdlp-proc.server";
import { attemptYtdlpMetadataLadder } from "@/lib/ytdlp-meta-routing";

const TMP_PREFIX = "velo-ytdl-";
const FORMAT_TTL_MS = 10 * 60_000;
const FORMAT_EMPTY_TTL_MS = 90_000;
const formatCache = new Map<string, { value: VideoFormat[]; expires: number }>();
const formatInflight = new Map<string, Promise<VideoFormat[]>>();
const formatSweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of formatCache) if (entry.expires <= now) formatCache.delete(id);
}, 10 * 60 * 1000);
formatSweep.unref?.();

type Hop = { readonly proxy?: string; readonly markDead: () => void; readonly markGood: () => void };

/**
 * One metadata ladder stage. A saved route is tried once; the free stage tries
 * direct while it is open (see directYtdlpOpen), then one pool SOCKS hop.
 * `tryHop` returns a result to end the stage, or null to move to the next hop.
 */
async function runHops<T>(saved: Hop | null, tryHop: (hop: Hop) => Promise<T | null>): Promise<T | null> {
  if (saved) return tryHop(saved);
  if (directYtdlpOpen()) {
    const hit = await tryHop({ markDead: markDirectYtdlpBlocked, markGood: () => undefined });
    if (hit !== null) return hit;
  }
  const socks = await takeSocks(1);
  const proxy = socks[0];
  if (!proxy) return null;
  try {
    return await tryHop({ proxy, markDead: () => markSocksDead(proxy), markGood: () => markSocksGood(proxy) });
  } finally {
    releaseSocks(socks);
  }
}

/** A saved (operator) route as a hop; its verdicts go to the route store. */
function savedHop(route: { mark: (v: { ok: boolean; exitIp: null }) => Promise<unknown> }, url: string): Hop {
  return {
    proxy: url,
    markDead: () => void route.mark({ ok: false, exitIp: null }),
    markGood: () => void route.mark({ ok: true, exitIp: null }),
  };
}

export async function fetchSubtitlesViaYtdlp(opts: {
  id: string;
  /** The language code of the caption track to fetch. */
  lang: string;
  /** If set, fetch the auto-translated version into this language. */
  tlang?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!(await ensurePython()).ok) return null;
  const release = await acquireYtdlpSlot(opts.signal);
  try {
    await ensurePySocks().catch(() => undefined);
    const impersonate = await ensureImpersonate().catch(() => false);

    let dual: { gvs: string | null; player: string | null } = { gvs: null, player: null };
    try {
      const { mintDualPoTokens } = await import("@/lib/po-token.server");
      dual = await mintDualPoTokens({ videoId: opts.id });
    } catch {
      /* captions may work without POT */
    }

    const {
      extractorArgs,
      ytdlpHeaderArgs,
      ytdlpImpersonateArgs,
      ytdlpFamilyArgs: familyArgs,
    } = await import("@/lib/ytdlp-auth");

    // The subtitle language to request. For translations, yt-dlp lists
    // auto-translated tracks under automatic_captions keyed by the *target*
    // language code, so `--sub-langs <tlang>` with `--write-auto-subs` fetches
    // the translated version directly.
    const { sanitizeSubLang, subLangsArg } = await import("@/lib/ytdlp-subs");
    const subLang = sanitizeSubLang(opts.tlang || opts.lang);
    const subLangs = subLangsArg(opts.lang, opts.tlang);
    const clients = ["web_embedded", "tv_simply"];

    // The operator's proxy rides first, then the free stage (runHops).
    const { userProxyLadder } = await import("@/lib/user-proxy.server");
    const userRoutes = await userProxyLadder("ytdlp");
    const tryHop = async ({ proxy, markDead, markGood }: Hop): Promise<string | null> => {
      for (const client of clients) {
        if (opts.signal?.aborted) return null;
        const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
        try {
          const result = await runCapture(
            pythonBin(),
            [
              "-m",
              "yt_dlp",
              "--no-js-runtimes",
              "--js-runtimes",
              "node",
              ...familyArgs(proxy),
              ...(proxy ? ["--proxy", proxy] : []),
              ...ytdlpHeaderArgs(),
              ...(impersonate ? ytdlpImpersonateArgs(client) : []),
              "--remote-components",
              "ejs:github",
              "--extractor-args",
              extractorArgs(client, dual.gvs ?? undefined, null, dual.player ?? undefined),
              "--no-playlist",
              "--skip-download",
              "--write-subs",
              "--write-auto-subs",
              "--sub-format",
              "vtt",
              "--sub-langs",
              subLangs,
              "-o",
              `${dir}/sub`,
              `https://www.youtube.com/watch?v=${opts.id}`,
            ],
            30_000,
            opts.signal,
          );

          if (result.code !== 0) {
            const fail = mapYtdlpExit(result.code, result.stderr, {
              signal: result.signal,
              timedOut: result.timedOut,
            });
            if (fail.next === "next-socks") {
              markDead();
              break;
            }
            continue;
          }

          // yt-dlp writes subtitle files as `sub.<lang>.vtt`
          const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
          if (!files.length) continue;

          // Pick the target language file or the first matching .vtt file
          const matchingFile =
            files.find((f) => f.toLowerCase().includes(subLang.toLowerCase())) ?? files[0];
          const vtt = await readFile(join(dir, matchingFile), "utf8");
          if (vtt.trim().length > 10) {
            markGood();
            return vtt;
          }
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      return null;
    };
    return attemptYtdlpMetadataLadder(
      userRoutes,
      (up, url) => runHops(savedHop(up, url), tryHop),
      () => runHops(null, tryHop),
      (result) => result !== null,
    );
  } finally {
    release();
  }
}

async function listYtdlpFormatsOnce(id: string): Promise<VideoFormat[]> {
  // Best-effort enrichment: no Python means no extra formats, but it should not
  // cost a pool slot, a SOCKS hop and a PO token mint to find that out.
  if (!(await ensurePython()).ok) return [];
  const release = await acquireYtdlpSlot();
  try {
    await ensurePySocks().catch(() => undefined);
    const impersonate = await ensureImpersonate().catch(() => false);
    let dual: { gvs: string | null; player: string | null } = { gvs: null, player: null };
    try {
      const { mintDualPoTokens } = await import("@/lib/po-token.server");
      dual = await mintDualPoTokens({ videoId: id });
    } catch {
      /* list without POT */
    }
    const {
      extractorArgs,
      ytdlpHeaderArgs,
      ytdlpImpersonateArgs,
      ytdlpFamilyArgs: familyArgs,
    } = await import("@/lib/ytdlp-auth");
    const { THROTTLE_FLAGS } = await import("@/lib/throttle");
    const clients = ["web_embedded", "tv_simply"];

    // Same first-hop rule as the download ladder: the operator's proxy before
    // any free-SOCKS hop, so formats/captions do not fail on a blocked origin
    // while downloads through the same proxy succeed.
    const { userProxyLadder } = await import("@/lib/user-proxy.server");
    const userRoutes = await userProxyLadder("ytdlp");
    // null = next hop; [] = stop this stage (aborted, or output too big to retry).
    const tryHop = async ({ proxy, markDead, markGood }: Hop): Promise<VideoFormat[] | null> => {
      for (const client of clients) {
        try {
          const result = await runCapture(
            pythonBin(),
            [
              "-m",
              "yt_dlp",
              "--no-js-runtimes",
              "--js-runtimes",
              "node",
              ...familyArgs(proxy),
              ...(proxy ? ["--proxy", proxy] : []),
              ...ytdlpHeaderArgs(),
              ...(impersonate ? ytdlpImpersonateArgs(client) : []),
              "--remote-components",
              "ejs:github",
              "--extractor-args",
              extractorArgs(client, dual.gvs ?? undefined, null, dual.player ?? undefined),
              "--newline",
              ...THROTTLE_FLAGS,
              "-J",
              "--no-download",
              `https://www.youtube.com/watch?v=${id}`,
            ],
            40_000,
            undefined,
            JSON_STDOUT_MAX,
          );
          if (result.code !== 0 || result.timedOut) {
            const fail = mapYtdlpExit(result.code, result.stderr, {
              signal: result.signal,
              timedOut: result.timedOut,
            });
            if (fail.next === "next-socks") {
              markDead();
              break;
            }
            continue;
          }
          if (result.truncated) {
            // Not the hop's fault and not fixable by retrying: every client and
            // hop would overflow identically. Say so and stop instead of
            // failing four runs with an opaque SyntaxError.
            console.warn(`[ytdlp] -J output exceeded ${JSON_STDOUT_MAX} bytes for ${id}`);
            return [];
          }
          const json = JSON.parse(result.stdout) as { formats?: YtDlpJsonFormat[] };
          const mapped = ytdlpJsonToFormats(json.formats ?? []);
          if (mapped.length) {
            markGood();
            formatCache.set(id, { value: mapped, expires: Date.now() + FORMAT_TTL_MS });
            return mapped;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (/abort/i.test(message)) return [];
          if (/timed out|proxy|Unable to connect/i.test(message)) {
            markDead();
            break;
          }
        }
      }
      return null;
    };
    return (await attemptYtdlpMetadataLadder(
      userRoutes,
      (up, url) => runHops(savedHop(up, url), tryHop),
      () => runHops(null, tryHop),
      (result) => result !== null && result.length > 0,
    )) ?? [];
  } finally {
    release();
  }
}

export async function listYtdlpFormats(id: string, signal?: AbortSignal): Promise<VideoFormat[]> {
  if (signal?.aborted) return [];
  const hit = formatCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  let shared = formatInflight.get(id);
  if (!shared) {
    shared = listYtdlpFormatsOnce(id).finally(() => {
      if (formatInflight.get(id) === shared) formatInflight.delete(id);
    });
    formatInflight.set(id, shared);
  }
  const mapped = await shared;
  // Negative-cache the empty outcome: re-running yt-dlp -J over SOCKS on every
  // resolve of the same id holds a pool slot for nothing.
  if (!mapped.length) formatCache.set(id, { value: [], expires: Date.now() + FORMAT_EMPTY_TTL_MS });
  if (signal?.aborted) return [];
  return mapped;
}
