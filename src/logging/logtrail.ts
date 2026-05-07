/**
 * Ships tslog entries to Logtrail's Vector HTTP source (JSON).
 * Matches ten24group/logtrail-infra `sources.http_in` + `transforms.parse_and_enrich`:
 * POST JSON body with `service`, `level`, `host`, `message` (see vector.toml embedded in template.yaml).
 *
 * Separate from Grafana Loki's native push API (`/loki/api/v1/push`); infra forwards Vector → local Loki.
 */
import type { ILogObj, ILogObjMeta } from "tslog";

/** Default tslog meta key (matches tslog defaults). */
const TSLOG_META = "_meta" as const;

export interface LogtrailVectorIngestConfig {
    /** Vector `http_server` base URL — same value as Logtrail frontend `VITE_INGEST_HTTP_URL` (no trailing slash). */
    ingestHttpUrl: string;
    /**
     * Loki label `service` — Events "System" in Logtrail UI. Stable, low cardinality.
     * Mapped from JSON field `service` (Vector also accepts `app` / `appname`).
     */
    service: string;
    /**
     * Loki label `host`. Prefer `AWS_LAMBDA_FUNCTION_NAME` in Lambda or set `LOGTRAIL_LOKI_HOST` for non-Lambda runners.
     * Vector turns empty into `unknown` if omitted; fw24 resolves per request when unset here.
     */
    host?: string;
    /** If set, sends `x-api-key` when your ingest front (e.g. API Gateway) requires it. */
    xApiKey?: string;
}

let ingestOverride: LogtrailVectorIngestConfig | undefined;

/** Tests / programmatic wiring. Overrides env. Pass `null` to clear. */
export function setLogtrailVectorIngest(config: LogtrailVectorIngestConfig | null): void {
    ingestOverride = config ?? undefined;
}

function trimBase(url: string): string {
    return url.replace(/\/+$/, "");
}

function resolveEnvIngest(): LogtrailVectorIngestConfig | undefined {
    const ingestHttpUrl = process.env.LOGTRAIL_INGEST_HTTP_URL?.trim();
    const service = process.env.LOGTRAIL_SERVICE?.trim();
    if (!ingestHttpUrl || !service) return undefined;

    const host = process.env.LOGTRAIL_LOKI_HOST?.trim();
    const xApiKey = process.env.LOGTRAIL_INGEST_X_API_KEY?.trim();
    return {
        ingestHttpUrl: trimBase(ingestHttpUrl),
        service,
        ...(host ? { host } : {}),
        ...(xApiKey ? { xApiKey } : {}),
    };
}

/** Effective Vector HTTP ingest configuration, or undefined if ingestion is disabled. */
export function resolveLogtrailVectorIngest(): LogtrailVectorIngestConfig | undefined {
    if (ingestOverride?.ingestHttpUrl?.trim() && ingestOverride.service?.trim()) {
        const c = ingestOverride;
        return {
            ingestHttpUrl: trimBase(c.ingestHttpUrl.trim()),
            service: c.service.trim(),
            ...(c.host?.trim() ? { host: c.host.trim() } : {}),
            ...(c.xApiKey?.trim() ? { xApiKey: c.xApiKey.trim() } : {}),
        };
    }
    return resolveEnvIngest();
}

function resolvedHost(cfg: LogtrailVectorIngestConfig): string {
    if (cfg.host?.trim()) return cfg.host.trim();
    const fn = process.env.AWS_LAMBDA_FUNCTION_NAME?.trim();
    if (fn) return fn;
    const h = process.env.HOSTNAME?.trim();
    return h ?? "unknown";
}

/**
 * Fire-and-forget POST of one Vector JSON object (`service`, `level`, `host`, `message`).
 * Used by tslog transport and observability Logtrail backend.
 */
export function shipLogtrailVectorJson(payload: {
    level: string;
    message: string;
    /** Overrides Loki `service` label when ingest is configured */
    service?: string;
}): void {
    const cfg = resolveLogtrailVectorIngest();
    if (!cfg) return;
    const msg = payload.message.trim();
    if (!msg) return;

    const service = payload.service?.trim() ? payload.service.trim() : cfg.service;
    const body = JSON.stringify({
        service,
        host: resolvedHost(cfg),
        level: payload.level,
        message: msg,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.xApiKey) headers[ "x-api-key" ] = cfg.xApiKey;

    void fetch(cfg.ingestHttpUrl, { method: "POST", headers, body }).catch(() => { });
}

function serializeLogPayload(logObj: ILogObj & ILogObjMeta): string {
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(logObj, (_k, v: unknown) => {
            if (typeof v === "bigint") return v.toString();
            if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
            if (v && typeof v === "object") {
                if (seen.has(v as object)) return "[Circular]";
                seen.add(v as object);
            }
            return v;
        });
    } catch {
        return JSON.stringify({ _fw24: "serialization_failed" });
    }
}

function levelFromTslog(logObj: ILogObj & ILogObjMeta): string {
    const meta = logObj as Record<string, unknown>;
    const blob = meta[ TSLOG_META ];
    if (blob && typeof blob === "object" && blob !== null && "logLevelName" in blob) {
        const ln = (blob as { logLevelName?: unknown }).logLevelName;
        if (typeof ln === "string" && ln.trim()) return ln.trim().toLowerCase();
    }
    return "info";
}

/** Fire-and-forget POST to Vector. Attach with logger.attachTransport(...) */
export function logtrailTransport(logObj: ILogObj & ILogObjMeta): void {
    const message = serializeLogPayload(logObj);
    shipLogtrailVectorJson({
        level: levelFromTslog(logObj),
        message,
    });
}
