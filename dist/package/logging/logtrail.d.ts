/**
 * Ships tslog entries to Logtrail's Vector HTTP source (JSON).
 * Matches ten24group/logtrail-infra `sources.http_in` + `transforms.parse_and_enrich`:
 * POST JSON body with `service`, `level`, `host`, `message` (see vector.toml embedded in template.yaml).
 *
 * Separate from Grafana Loki's native push API (`/loki/api/v1/push`); infra forwards Vector → local Loki.
 */
import type { ILogObj, ILogObjMeta } from "tslog";
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
/** Tests / programmatic wiring. Overrides env. Pass `null` to clear. */
export declare function setLogtrailVectorIngest(config: LogtrailVectorIngestConfig | null): void;
/** Effective Vector HTTP ingest configuration, or undefined if ingestion is disabled. */
export declare function resolveLogtrailVectorIngest(): LogtrailVectorIngestConfig | undefined;
/**
 * Fire-and-forget POST of one Vector JSON object (`service`, `level`, `host`, `message`).
 * Used by tslog transport and observability Logtrail backend.
 */
export declare function shipLogtrailVectorJson(payload: {
    level: string;
    message: string;
    /** Overrides Loki `service` label when ingest is configured */
    service?: string;
}): void;
/** Fire-and-forget POST to Vector. Attach with logger.attachTransport(...) */
export declare function logtrailTransport(logObj: ILogObj & ILogObjMeta): void;
