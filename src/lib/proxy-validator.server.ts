import {
  ByteCountSchema, MillisecondsSchema, classifyValidation,
  type Classification, type SafeErrorCode, type StageEvidence, type ValidationStage,
} from "./proxy-operations.ts";
import { fetchThroughExplicitProxy, type ProxyTransportErrorCode } from "./proxy-transport.server.ts";
import { z } from "zod";

const TEN_KIB = 10 * 1024;
const DEFAULT_VIDEO = "jNQXAC9IVRw";
export const PRODUCTION_VALIDATION_TARGETS = {
  routeProbeUrl: "https://redirector.googlevideo.com/generate_204",
  metadataUrl: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
} as const;
const DEFAULTS = PRODUCTION_VALIDATION_TARGETS;
const STAGE_BUDGETS = { route_probe: 5_000, metadata: 8_000, media_range: 8_000 } as const;
const MetadataSchema = z.object({
  videoId: z.string().optional(), mediaUrl: z.string().url().optional(),
  videoDetails: z.object({ videoId: z.string() }).optional(),
  streamingData: z.object({ formats: z.array(z.object({ url: z.string().url().optional() })).optional(), adaptiveFormats: z.array(z.object({ url: z.string().url().optional() })).optional() }).optional(),
});

function budgetFor(stage: ValidationStage): number {
  switch (stage) {
    case "connection": case "tls": case "route_probe": return STAGE_BUDGETS.route_probe;
    case "metadata": return STAGE_BUDGETS.metadata;
    case "media_range": return STAGE_BUDGETS.media_range;
    default: return stage satisfies never;
  }
}

export type ValidationOptions = {
  readonly videoId?: string; readonly routeProbeUrl?: string; readonly metadataUrl?: string;
  readonly timeoutMs?: number; readonly signal?: AbortSignal; readonly allowPrivateProxyForTests?: boolean;
};
export type ProxyValidation = {
  readonly classification: Classification; readonly errorCode: SafeErrorCode | null;
  readonly evidence: readonly StageEvidence[];
};

function skipped(stage: ValidationStage): StageEvidence {
  return { stage, outcome: "skipped", code: null, durationMs: null, httpStatus: null, bytesRead: null };
}

function safeCode(code: ProxyTransportErrorCode): SafeErrorCode {
  switch (code) {
    case "timeout": return "timeout";
    case "aborted": return "caller_abort";
    case "tls_error": return "certificate_invalid";
    case "proxy_authentication_failed": return "proxy_authentication_failed";
    case "invalid_configuration": return "invalid_configuration";
    case "forbidden_proxy_address": return "forbidden_proxy_address";
    case "connection_failed": case "malformed_response": case "response_too_large": return "connect_failed";
    default: return code satisfies never;
  }
}

function classificationFor(code: SafeErrorCode | null): Classification {
  if (code === null) return classifyValidation({ kind: "full_pass" });
  switch (code) {
    case "timeout": return classifyValidation({ kind: "timeout" });
    case "caller_abort": return classifyValidation({ kind: "caller_abort" });
    case "certificate_invalid": return classifyValidation({ kind: "certificate" });
    case "credential_missing": return classifyValidation({ kind: "credential_missing" });
    case "proxy_authentication_failed": return classifyValidation({ kind: "proxy_authentication_failed" });
    case "invalid_configuration": return classifyValidation({ kind: "invalid_configuration" });
    case "forbidden_proxy_address": return classifyValidation({ kind: "forbidden_proxy_address" });
    case "media_range_invalid": return classifyValidation({ kind: "media_range" });
    case "route_forbidden": return classifyValidation({ kind: "route_forbidden" });
    default: return classifyValidation({ kind: "connection" });
  }
}

export async function validateProxyRoute(proxyUrl: string, options: ValidationOptions = {}): Promise<ProxyValidation> {
  const stages: readonly ValidationStage[] = ["connection", "tls", "route_probe", "metadata", "media_range"];
  const videoId = options.videoId ?? DEFAULT_VIDEO;
  const totalDeadline = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const callerSignal = options.signal === undefined ? totalDeadline : AbortSignal.any([totalDeadline, options.signal]);
  const evidence: StageEvidence[] = [];
  let mediaUrl: string | null = null;
  const targets = [options.routeProbeUrl ?? DEFAULTS.routeProbeUrl, options.metadataUrl ?? DEFAULTS.metadataUrl] as const;
  for (let index = 0; index < 3; index += 1) {
    const stage = stages[index + 2]; if (stage === undefined) break;
    const targetUrl = stage === "media_range" ? mediaUrl ?? "" : targets[index] ?? "";
    const started = performance.now();
    const media = stage === "media_range";
    const stageBudget = options.timeoutMs ?? budgetFor(stage);
    const deadline = AbortSignal.timeout(stageBudget);
    const signal = AbortSignal.any([deadline, callerSignal]);
    const metadata = stage === "metadata";
    const result = await fetchThroughExplicitProxy({ proxyUrl, targetUrl, signal,
      method: metadata ? "POST" : "GET",
      headers: media ? { range: `bytes=0-${TEN_KIB - 1}` } : metadata ? { "content-type": "application/json" } : undefined,
      body: metadata ? JSON.stringify({ videoId, context: { client: { clientName: "WEB", clientVersion: "2.20260827.00.00", hl: "en" } } }) : undefined,
      maxResponseBytes: media ? TEN_KIB : 64 * 1024,
      allowPrivateProxyForTests: options.allowPrivateProxyForTests });
    const durationMs = MillisecondsSchema.parse(Math.max(0, Math.round(performance.now() - started)));
    if (!result.ok) {
      const code = safeCode(result.error.code);
      evidence.push({ stage, outcome: "failed", code, durationMs, httpStatus: null, bytesRead: null });
      if (index === 0) {
        const failedStage: ValidationStage = code === "certificate_invalid" ? "tls" : "connection";
        return { classification: classificationFor(code), errorCode: code,
          evidence: stages.map((item) => item === failedStage
            ? { stage: item, outcome: "failed", code, durationMs, httpStatus: null, bytesRead: null }
            : skipped(item)) };
      }
      return { classification: classificationFor(code), errorCode: code,
        evidence: [passed("connection"), passed("tls"), ...evidence, ...stages.slice(index + 3).map(skipped)] };
    }
    const body = new Uint8Array(await result.response.arrayBuffer());
    const bytes = ByteCountSchema.parse(body.byteLength);
    let statusValid = stage === "route_probe" ? result.response.status === 204 : result.response.status >= 200 && result.response.status < 300;
    if (stage === "metadata") {
      try {
        const parsed = MetadataSchema.safeParse(JSON.parse(new TextDecoder().decode(body)));
        const returnedId = parsed.success ? parsed.data.videoId ?? parsed.data.videoDetails?.videoId : undefined;
        const formats = parsed.success ? [...(parsed.data.streamingData?.formats ?? []), ...(parsed.data.streamingData?.adaptiveFormats ?? [])] : [];
        mediaUrl = parsed.success ? parsed.data.mediaUrl ?? formats.find((format) => format.url !== undefined)?.url ?? null : null;
        statusValid = statusValid && returnedId === videoId && mediaUrl !== null;
      } catch (error: unknown) {
        if (!(error instanceof SyntaxError)) throw error;
        statusValid = false;
      }
    }
    if (media) {
      const contentRange = result.response.headers.get("content-range") ?? "";
      statusValid = targetUrl === mediaUrl && result.response.status === 206 && /^bytes 0-\d+\/\d+$/.test(contentRange) && bytes > 0 && bytes <= TEN_KIB;
    }
    if (!statusValid) {
      const code: SafeErrorCode = media ? "media_range_invalid" : "route_forbidden";
      evidence.push({ stage, outcome: "failed", code, durationMs, httpStatus: result.response.status, bytesRead: bytes });
      return { classification: classificationFor(code), errorCode: code,
        evidence: [passed("connection"), passed("tls"), ...evidence, ...stages.slice(index + 3).map(skipped)] };
    }
    evidence.push({ stage, outcome: "passed", code: null, durationMs, httpStatus: result.response.status, bytesRead: bytes });
  }
  return { classification: classifyValidation({ kind: "full_pass" }), errorCode: null,
    evidence: [passed("connection"), passed("tls"), ...evidence] };
}

function passed(stage: ValidationStage): StageEvidence {
  return { stage, outcome: "passed", code: null, durationMs: null, httpStatus: null, bytesRead: null };
}
