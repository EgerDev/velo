import type { ProxyId } from "./proxy-operations.ts";
import { attemptSelectedRoutes } from "./proxy-selector.server.ts";
import type { ProxyProtocol } from "./user-proxy-parse.ts";

export type YtdlpMetadataRoute = {
  readonly id: ProxyId;
  readonly protocol: ProxyProtocol;
  readonly run: <Result>(use: (url: string) => Promise<Result>) => Promise<Result | null>;
  readonly mark: (input: { readonly ok: boolean; readonly exitIp: string | null }) => Promise<void>;
};

/** One saved-first attempt adapter shared by yt-dlp captions and format metadata. */
export async function attemptYtdlpMetadataLadder<Result>(
  userRoutes: readonly YtdlpMetadataRoute[],
  attemptSaved: (route: YtdlpMetadataRoute, url: string) => Promise<Result>,
  attemptFree: () => Promise<Result>,
  usable: (result: Result) => boolean,
): Promise<Result | null> {
  const selected = [
    ...userRoutes.map((route) => ({ kind: "proxy", id: route.id, protocol: route.protocol, trusted: true } as const)),
    { kind: "free_socks", url: "pool", trusted: false } as const,
    { kind: "direct", trusted: false } as const,
  ];
  const outcome = await attemptSelectedRoutes(selected, async (choice) => {
    if (choice.kind === "free_socks") {
      const result = await attemptFree();
      return usable(result) ? { ok: true as const, value: result } : { ok: false as const };
    }
    if (choice.kind === "direct") return { ok: false as const };
    const route = userRoutes.find((candidate) => candidate.id === choice.id);
    if (route === undefined) return { ok: false as const };
    const result = await route.run((url) => attemptSaved(route, url));
    return result !== null && usable(result) ? { ok: true as const, value: result } : { ok: false as const };
  }, { allowDirectFallback: false });
  return (outcome.result ?? null) as Result | null;
}
