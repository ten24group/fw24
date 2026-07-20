import { Stack } from 'aws-cdk-lib';
import { type IFilterPattern, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Fw24 } from '../core/fw24';
import { FW24Construct, FW24ConstructOutput } from '../interfaces/construct';
import { IConstructConfig } from '../interfaces/construct-config';
/**
 * App-owned noise / severity rules, applied per log line inside the forwarder Lambda (layers 2–4 of the
 * pipeline; see `LogForwarderConstruct`). Each list is an array of regex source strings, matched
 * case-insensitively against the normalized message. These are complementary to any global severity/
 * noise handling a shared Vector ingest may also run — this layer lets each app own its own rules and,
 * for `drop`, saves ingest bandwidth by removing noise at the source.
 */
export interface LogForwarderNoiseRules {
    /** Error-ish lines matching these are downgraded to `warn` (tagged `reclassified: "benign"`). */
    benign?: string[];
    /** Lines matching these are dropped entirely — never shipped. */
    drop?: string[];
    /** Lines matching these are downgraded to `debug` (tagged `reclassified: "noise"`). */
    downgrade?: string[];
    /**
     * When true (default), the built-in {@link DEFAULT_LOG_NOISE_RULES} are merged with the lists above.
     * Set false to use ONLY the lists you provide (or none).
     */
    useDefaults?: boolean;
}
export interface LogForwarderConstructConfig extends IConstructConfig {
    /** Vector/Logtrail HTTP JSON ingest URL. Defaults to `FORWARDER_INGEST_URL` at deploy time. */
    ingestHttpUrl?: string;
    /**
     * Base `service` label for shipped logs (env is folded in). Usually omit — defaults to the fw24
     * app name (`APP_NAME`); override with this option or `FORWARDER_SERVICE`.
     */
    service?: string;
    /**
     * Stage/owner label (e.g. `develop`, `prod`, `sandbox-nitin`) — folded into the `service` label
     * (`myservice-develop`) and emitted as `env` so develop/prod/per-developer logs are distinguishable
     * in Logtrail. Usually omit — defaults to the fw24 environment (`APP_ENVIRONMENT`); override with
     * this option or `FORWARDER_ENV`.
     */
    env?: string;
    /** Optional `x-api-key` when the ingest front requires it. Defaults to `FORWARDER_INGEST_X_API_KEY`. */
    xApiKey?: string;
    /** Batch wire format — must match your Vector http source decoding. Default: `json-array`. */
    batchFormat?: 'ndjson' | 'json-array';
    /** Max uncompressed bytes per POST (the forwarder splits larger batches). Default: 1,000,000. */
    maxBatchBytes?: number;
    /** CloudWatch subscription-filter pattern — the volume/cost lever (e.g. only WARN/ERROR). Default: all events. */
    filterPattern?: IFilterPattern;
    /** Extra function construct-path substrings to skip (never subscribe). */
    excludeFunctionPathSubstrings?: string[];
    /** App-owned noise/severity rules applied inside the forwarder (layers 2–4). */
    noise?: LogForwarderNoiseRules;
    /**
     * Structured fields to lift from tslog args into queryable top-level record fields, so Logtrail can
     * follow one request across services or filter "all logs for order 991". Only fields the app actually
     * logs as structured args (e.g. `logger.info('charge failed', { orderId, correlationId })`) are lifted
     * — the forwarder never scrapes free text. {@link DEFAULT_LIFT_FIELDS} (correlationId) is merged in
     * unless {@link liftFieldDefaults} is false.
     */
    liftFields?: string[];
    /** Merge {@link DEFAULT_LIFT_FIELDS} with {@link liftFields}. Default true. Set false to lift ONLY your list. */
    liftFieldDefaults?: boolean;
    /**
     * Record keys to DROP before shipping, to cut ingest/storage size on low-value fields. Merged with
     * {@link DEFAULT_DROP_FIELDS} (logStream, logGroup, source_type, reason) unless {@link dropFieldDefaults}
     * is false. `host` (derived from logGroup/logStream) is always kept, and core keys can never be dropped.
     */
    dropFields?: string[];
    /** Merge {@link DEFAULT_DROP_FIELDS} with {@link dropFields}. Default true. Set false to drop ONLY your list. */
    dropFieldDefaults?: boolean;
    /**
     * Release/version stamped on every shipped line (`version` field) so behavior changes can be attributed
     * to a deploy. Resolved AUTOMATICALLY so neither the app nor CI has to maintain it (see
     * {@link LogForwarderConstruct.resolveVersion}): explicit value / `FORWARDER_VERSION` → the CI commit
     * (`GITHUB_SHA`, set automatically by GitHub Actions) → the app's `package.json` version → omitted.
     * Only set this to force a specific value.
     */
    version?: string;
    /**
     * Which construct tree to subscribe.
     * - `'stack'` (default): the forwarder's stack and any nested stacks under it (covers the common
     *   satellite app, including per-controller nested stacks parented to the default stack).
     * - `'app'`: the whole CDK app — use when a backend has independent top-level stacks (e.g. a separate
     *   `persistent`/data stack). Note this creates cross-stack subscription→forwarder references, so
     *   verify synth doesn't introduce a cyclic stack dependency.
     */
    subscribeScope?: 'stack' | 'app';
    /** Forwarder function memory (MB). Default 256. */
    memorySize?: number;
    /** Forwarder function timeout (seconds). Default 30. */
    timeoutSeconds?: number;
    /**
     * Cap forwarder concurrency to protect the ingest from a log storm. Opt-in: reserving concurrency
     * subtracts from the account's shared pool, so a bad value can fail deploys in constrained accounts.
     * Recommended in prod (e.g. 10–20).
     */
    reservedConcurrency?: number;
    /** Forwarder's own log retention. Default: one week. */
    logRetention?: RetentionDays;
}
/**
 * Curated, generally-safe default noise/severity rules — mirrors the Logtrail Vector "A1" list so a
 * backend gets sensible log hygiene out of the box. Merge-in by default; override via
 * {@link LogForwarderNoiseRules.useDefaults}. Exported so apps can inspect / extend the lists.
 */
export declare const DEFAULT_LOG_NOISE_RULES: Required<Omit<LogForwarderNoiseRules, 'useDefaults'>>;
/**
 * Fields lifted from tslog args into queryable record fields by default. `correlationId` is fw24's
 * cross-service trace id, so lifting it out of the box lets Logtrail follow a request across services
 * the moment an app logs it. Apps add their own business ids (orderId, userId, …) via `liftFields`.
 */
export declare const DEFAULT_LIFT_FIELDS: string[];
/**
 * Low-value record keys dropped by default to cut ingest/storage size. `host` is derived from
 * logGroup/logStream and kept, so dropping the raw group/stream loses nothing actionable.
 */
export declare const DEFAULT_DROP_FIELDS: string[];
/**
 * Out-of-band log shipping for every Lambda in the app.
 *
 * Attaches a CloudWatch Logs subscription filter to each function's log group (via an Aspect), routing
 * batched, gzipped events to a single tiny forwarder Lambda that ships them to a Vector/Logtrail HTTP
 * ingest. Nothing runs in the app request path (functions only write stdout), so log volume never
 * degrades request latency and there are no per-log HTTP calls from the handlers.
 *
 * Inside the forwarder, each line runs through a 4-step pipeline: NORMALIZE (peel Lambda prefix, lift
 * fw24 tslog JSON, strip ANSI) → RECLASSIFY benign errors → DROP noise → DOWNGRADE noise. Steps 2–4 are
 * app-owned rule lists (see {@link LogForwarderNoiseRules} / {@link DEFAULT_LOG_NOISE_RULES}).
 *
 * Deploy-time config is read from `FORWARDER_*` env when not passed explicitly. `FORWARDER_*` is used
 * (never `LOGTRAIL_*`) on purpose: setting `LOGTRAIL_*` in the deploy shell would activate fw24's
 * in-process log transport and leak local CDK/synth logs to the ingest.
 */
export declare class LogForwarderConstruct implements FW24Construct {
    private readonly config;
    readonly fw24: Fw24;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(config?: LogForwarderConstructConfig);
    private resolveNoiseEnv;
    /** App-declared fields to lift, merged with {@link DEFAULT_LIFT_FIELDS} unless liftFieldDefaults is false. */
    /**
     * Resolve the version stamp automatically — no app code or CI wiring to maintain:
     *   explicit config / `FORWARDER_VERSION` → `GITHUB_SHA` (auto in GitHub Actions, first 12) →
     *   the app's package.json version (auto-bumped by release CI, read at synth) → '' (omitted).
     */
    private resolveVersion;
    private resolveLiftFields;
    /** Record keys to drop, merged with {@link DEFAULT_DROP_FIELDS} unless dropFieldDefaults is false. */
    private resolveDropFields;
    construct(): Promise<void>;
}
