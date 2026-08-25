/**
 * Guest same-hop for this sandbox: YouTube’s player API records an internal
 * IPv6 while googlevideo sees NAT IPv4 → 403. A SOCKS5 hop makes both
 * Player + file must share one IP. socks5h sends DNS through the hop too,
 * so YouTube never sees this host’s resolver. Account cookies never go here.
 * Cloudflare Turnstile (cobalt.tools) cannot be minted on our origin — their
 * widget is hostname-bound — so this hop is the working guest path instead.
 *
 * Proved 24 Aug 2026: android + socks5 downloaded Me at the zoo (ftyp mp4).
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SOCKS_PROBE_URL = "https://redirector.googlevideo.com/generate_204";

const LIST_URL =
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.json";

const GOOD_FILE = join(tmpdir(), "velo-socks-good.json");
const DEAD_FILE = join(tmpdir(), "velo-socks-dead.json");
const CACHE_MS = 8 * 60_000;
const PROBE_MS = 8_000;
const DEAD_MS = 15 * 60_000;

async function readGood(): Promise<string[]> {
  try {
    const raw = await readFile(GOOD_FILE, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.map((item) => (typeof item === "string" ? normalizeSocksUrl(item) : null)).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

export async function markSocksGood(proxy: string) {
  const url = normalizeSocksUrl(proxy);
  if (!url) return;
  const prev = await readGood();
  const next = [url, ...prev.filter((item) => item !== url)].slice(0, 8);
  // These files can carry `user:pass@` for a credentialed hop, and tmpdir is
  // shared, so they must not be world-readable.
  await writeFile(GOOD_FILE, JSON.stringify(next), { encoding: "utf8", mode: 0o600 }).catch(
    () => undefined,
  );
  if (cache) {
    const existing = cache.socks.find((row) => row.url === url);
    if (existing) existing.deadUntil = 0;
    else cache.socks.unshift({ url, deadUntil: 0 });
  }
}
type Sock = { url: string; deadUntil: number };

let cache: { at: number; socks: Sock[] } | null = null;
let cursor = 0;
const inUse = new Set<string>();
let lock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readDead(): Promise<Record<string, number>> {
  try {
    const data = JSON.parse(await readFile(DEAD_FILE, "utf8")) as Record<string, number>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function normalizeSocksUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // SOCKS4 has no v5 handshake, so relabelling it `socks5h` just fails at
  // version negotiation later. Refuse it here where the reason is still visible.
  if (/^socks4a?:\/\//i.test(trimmed)) return null;
  const withScheme = /^(socks5h?|socks):\/\//i.test(trimmed) ? trimmed : `socks5://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!/^socks5h?$/i.test(url.protocol.replace(":", ""))) {
      url.protocol = "socks5:";
    }
    if (!url.hostname || !url.port) return null;
    if (!/^\d{1,5}$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535) return null;
    const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
    return `socks5h://${auth}${url.hostname}:${url.port}`;
  } catch {
    return null;
  }
}

function envProxy(): string | null {
  const raw = process.env.VELO_SOCKS_PROXY?.trim() || process.env.ALL_PROXY?.trim();
  return raw ? normalizeSocksUrl(raw) : null;
}

async function loadList(): Promise<string[]> {
  const extra = envProxy();
  const urls = extra ? [extra] : [];
  urls.push(...(await readGood()));
  try {
    const response = await fetch(LIST_URL, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return urls;
    const data = (await response.json()) as Array<{ proxy?: string } | string>;
    for (const row of data) {
      const raw = typeof row === "string" ? row : row.proxy;
      const url = raw ? normalizeSocksUrl(raw) : null;
      if (url) urls.push(url);
    }
  } catch {
    /* keep env proxy only */
  }
  return [...new Set(urls)];
}

function probe(proxy: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "curl",
      ["-sS", "-m", "7", "-o", "/dev/null", "-w", "%{http_code}", "-x", proxy, SOCKS_PROBE_URL],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, PROBE_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += String(chunk);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim() === "204");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function refresh(): Promise<Sock[]> {
  const dead = await readDead();
  const now = Date.now();
  const list = (await loadList()).filter((url) => (dead[url] ?? 0) < now);
  const live: Sock[] = [];
  const batch = 10;
  for (let i = 0; i < list.length && live.length < 6; i += batch) {
    const slice = list.slice(i, i + batch);
    const results = await Promise.all(slice.map(async (url) => ((await probe(url)) ? url : null)));
    for (const url of results) {
      if (url) live.push({ url, deadUntil: 0 });
    }
  }
  cache = { at: Date.now(), socks: live };
  cursor = 0;
  return live;
}

export async function takeSocks(count: number): Promise<string[]> {
  return withLock(async () => {
    const now = Date.now();
    if (!cache || now - cache.at > CACHE_MS) await refresh();
    const live = (cache?.socks ?? []).filter(
      (item) => item.deadUntil < Date.now() && !inUse.has(item.url),
    );
    if (!live.length) {
      if (!(cache && Date.now() - cache.at < 30_000)) await refresh();
    }
    const fresh = (cache?.socks ?? []).filter(
      (item) => item.deadUntil < Date.now() && !inUse.has(item.url),
    );
    const env = envProxy();
    const envDead = env
      ? cache?.socks.find((row) => row.url === env && row.deadUntil > Date.now())
      : null;
    const pool = fresh.length ? fresh : env && !envDead ? [{ url: env, deadUntil: 0 }] : [];
    const out: string[] = [];
    for (let i = 0; i < pool.length && out.length < count; i++) {
      const item = pool[(cursor + i) % pool.length];
      if (!item || inUse.has(item.url)) continue;
      inUse.add(item.url);
      out.push(item.url);
    }
    cursor += out.length;
    return out;
  });
}

export function releaseSocks(proxies: Iterable<string>): void {
  for (const proxy of proxies) inUse.delete(proxy);
}

export async function markSocksDead(proxy: string) {
  const url = normalizeSocksUrl(proxy);
  if (!url) return;
  const until = Date.now() + DEAD_MS;
  if (cache) {
    const item = cache.socks.find((row) => row.url === url);
    if (item) item.deadUntil = until;
  }
  inUse.delete(url);
  const dead = await readDead();
  // The source is a public free-proxy list, so without this the dead map grows
  // without bound; `refresh` filters expired rows but never removes them.
  for (const [key, at] of Object.entries(dead)) if (at < Date.now()) delete dead[key];
  dead[url] = until;
  await writeFile(DEAD_FILE, JSON.stringify(dead), { encoding: "utf8", mode: 0o600 }).catch(
    () => undefined,
  );
  const good = (await readGood()).filter((item) => item !== url);
  await writeFile(GOOD_FILE, JSON.stringify(good), { encoding: "utf8", mode: 0o600 }).catch(
    () => undefined,
  );
}
