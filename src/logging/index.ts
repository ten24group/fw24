import { Logger, ILogObj, ISettingsParam } from "tslog";
import { logtrailTransport } from "./logtrail";
// Import the concrete leaf module (not the barrel) to keep this cycle-free:
// execution-context/storage's only runtime dependency is node:async_hooks.
import { getCurrentExecutionContext } from "../core/runtime/execution-context/storage";

export interface ILogger extends Logger<ILogObj> {
}

const logLevels: any = {
    "silly": 0,
    "trace": 1,
    "debug": 2,
    "info": 3,
    "warn": 4,
    "error": 5,
    "fatal": 6,
};

const logLevel = logLevels[ (process.env.LOG_LEVEL || 'info').toLowerCase() ];

/**
 * Source-position capture mode for "pin the exact culprit" code links. Set by the fw24 function
 * construct from the `logSourcePosition` app config (default `warn-error`, only when sourcemaps are on):
 *   - `off`        : never capture position (current prod behaviour).
 *   - `warn-error` : capture `file:line` ONLY for warn/error/fatal — the culprits worth pinning — so
 *                    hot info/debug paths pay nothing (captured lazily per-call, see the wrapper below).
 *   - `all`        : tslog captures position for every emitted log (native `_meta.path`).
 * Positions only resolve to real source when the Lambda runs with `--enable-source-maps` (the construct
 * adds it whenever this is enabled).
 */
const SOURCE_POSITION_MODE = (process.env.LOG_SOURCE_POSITION?.trim().toLowerCase() || 'off') as
    'off' | 'warn-error' | 'all';

/** Keep a source path from its last `src/` segment so it maps to a GitHub blob path (best-effort). */
function repoRelativePath(p: string): string {
    const i = p.lastIndexOf('/src/');
    if (i >= 0) return p.slice(i + 1);
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(slash + 1) : p;
}

/**
 * Caller location as `src/file.ts:line` from a fresh stack (source-mapped when `--enable-source-maps`
 * is on). Skips this module + tslog + node_modules frames so it points at the real call site.
 */
function captureSrcLoc(): string | undefined {
    const stack = new Error().stack;
    if (!stack) return undefined;
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const m = lines[ i ].match(/\(?([^\s()]+\.[cm]?[tj]s):(\d+):\d+\)?\s*$/);
        if (m && !/node_modules|[/\\]logging[/\\]index|tslog/.test(m[ 1 ])) {
            return `${repoRelativePath(m[ 1 ])}:${m[ 2 ]}`;
        }
    }
    return undefined;
}

export const createLogger = (_options: string | Function | ISettingsParam<ILogObj>, _logLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {

    _logLevel = _logLevel ?? logLevel;

    if (typeof _options == 'function') {
        _options = _options.name;
    }

    if (typeof _options == 'string') {
        _options = { name: _options, minLevel: logLevel };
    }

    // In prod (info+) tslog hides position by default. Only let tslog capture it natively for mode
    // 'all'; 'warn-error' captures lazily per-call below (cheaper), 'off' stays hidden. An explicit
    // caller-provided value always wins.
    if (_options.hideLogPositionForProduction === undefined && logLevel > 2) {
        _options.hideLogPositionForProduction = SOURCE_POSITION_MODE !== 'all';
    }

    // set time format
    if (!_options.prettyLogTimeZone) {
        _options.prettyLogTimeZone = 'local';
    }

    const logger = new Logger({
        // In Lambda (and when LOG_FORMAT=json) emit structured JSON so the log-forwarder can lift fields
        // (correlationId, business ids via liftFields, codeFile/codeLine). tslog's default 'pretty' output
        // bakes args into the message string and CANNOT be lifted. Locally, keep readable pretty output.
        type: (process.env.AWS_LAMBDA_FUNCTION_NAME || (process.env.LOG_FORMAT || '').toLowerCase() === 'json')
            ? 'json'
            : 'pretty',
        stylePrettyLogs: false,
        maskValuesOfKeys: [ 'password', 'confirmPassword', 'secret', 'token', 'apiKey', 'accessToken', 'refreshToken', 'clientSecret', 'clientId', 'clientToken', 'clientCode', 'clientKey' ],
        maskValuesOfKeysCaseInsensitive: true,
        maskValuesRegEx: [
            /password\s*:\s*([^\s]+)/gi,
            /confirmPassword\s*:\s*([^\s]+)/gi,
            /secret\s*:\s*([^\s]+)/gi,
            /token\s*:\s*([^\s]+)/gi,
            /apiKey\s*:\s*([^\s]+)/gi,
            /accessToken\s*:\s*([^\s]+)/gi,
            /refreshToken\s*:\s*([^\s]+)/gi,
            /clientSecret\s*:\s*([^\s]+)/gi,
            /clientId\s*:\s*([^\s]+)/gi,
            /clientToken\s*:\s*([^\s]+)/gi,
            /([a-zA-Z0-9_]*key[a-zA-Z0-9_]*)\s*:\s*(?:['"])?([^'"]+)(?:['"])?/gi,
            /([a-zA-Z0-9_]*token[a-zA-Z0-9_]*)\s*:\s*(?:['"])?([^'"]+)(?:['"])?/gi,
            /PRIVATE KEY-----\s*([\s\S]*?)(?:-----END|$)/gi,
            /CERTIFICATE-----\s*([\s\S]*?)(?:-----END|$)/gi,
            /BEGIN PRIVATE KEY-----\s*([\s\S]*?)(?:-----END|$)/gi,
            /BEGIN CERTIFICATE-----\s*([\s\S]*?)(?:-----END|$)/gi,
            /(?:key|privateKey|publicKey|certificate)\s*:\s*([\s\S]*?)(?:\n\s*\n|\n\s*[a-zA-Z]|\n\s*$|$)/gi,
        ],
        ..._options,
        // ensure min log level is always there
        minLevel: _options.minLevel ?? logLevel,

    });

    logger.attachTransport(logtrailTransport);

    attachCorrelationIdToMeta(logger);

    // Mode 'warn-error': capture source position ONLY for warn/error/fatal (the culprits worth pinning),
    // so info/debug hot paths pay nothing. Injected as a `_srcloc` arg that the forwarder lifts into
    // codeFile/codeLine (and strips from the shipped message).
    if (SOURCE_POSITION_MODE === 'warn-error') {
        for (const lvl of [ 'warn', 'error', 'fatal' ] as const) {
            const orig = (logger as any)[ lvl ].bind(logger);
            (logger as any)[ lvl ] = (...args: any[]) => {
                const loc = captureSrcLoc();
                return loc ? orig(...args, { _srcloc: loc }) : orig(...args);
            };
        }
    }

    return logger;
}

/**
 * Enrich every log line's structured `_meta` with the current request-scoped
 * `correlationId` (when an ExecutionContext is active). This runs *before* tslog
 * emits the JSON log to the console, so downstream forwarders that lift `_meta`
 * ship `correlationId` as a first-class field alongside the existing `requestId`.
 *
 * `correlationId` is the single id fw24 already propagates end-to-end across
 * every hop — over HTTP (`x-correlation-id` / W3C `traceparent`) and over
 * SQS/SNS/EventBridge (message attributes). Stamping it onto every log line lets
 * Logtrail stitch a request across services using one field that is present on
 * ALL entry points (API, SQS, task, mail), each of which establishes the
 * ExecutionContext via `runWithExecutionContext`.
 *
 * Backward-compatible: a complete no-op when no ExecutionContext is established
 * (logs simply carry no `correlationId`). The existing `requestId` — surfaced by
 * the forwarder from the AWS Lambda log prefix — is untouched.
 *
 * Mechanism: tslog reads `settings.overwrite.addMeta` fresh on every `log()`
 * call. We delegate to the logger's own default meta builder and then stamp the
 * ambient `correlationId` onto the produced `_meta`.
 */
function attachCorrelationIdToMeta(logger: Logger<ILogObj>): void {
    const anyLogger = logger as unknown as {
        _addMetaToLogObj: (logObj: ILogObj, logLevelId: number, logLevelName: string) => any;
    };
    if (typeof anyLogger._addMetaToLogObj !== 'function') {
        // Defensive: tslog internals changed — skip enrichment rather than break logging.
        return;
    }

    const metaProperty = (logger.settings as { metaProperty?: string }).metaProperty || '_meta';
    const baseAddMeta = anyLogger._addMetaToLogObj.bind(logger);

    logger.settings.overwrite = {
        ...logger.settings.overwrite,
        addMeta: (logObj: ILogObj, logLevelId: number, logLevelName: string) => {
            const withMeta = baseAddMeta(logObj, logLevelId, logLevelName);
            const execCtx = getCurrentExecutionContext();
            const meta = withMeta?.[ metaProperty ];
            if (meta && typeof meta === 'object') {
                if (execCtx?.correlationId) meta.correlationId = execCtx.correlationId;
                // Additive only — does not change what correlationId itself means (still strictly
                // per-invocation, see api-gateway-controller.ts). This just also exposes the upstream
                // link on the log line, so a downstream aggregator (e.g. Logtrail's cross-service
                // signature linking) can match a caller's own correlationId against a callee's causedBy
                // without either side changing its existing per-invocation identity.
                if (execCtx?.causedBy) meta.causedBy = execCtx.causedBy;
                // Who made this request, not which request — same additive stamping, distinct concern
                // from correlationId/causedBy. May be client-supplied/unverified (see
                // Actor.clientSuppliedActor on api-gateway-controller.ts) — never rely on this for
                // authorization, observability only.
                if (execCtx?.actor?.actorId) meta.actorId = execCtx.actor.actorId;
            }
            return withMeta;
        },
    };
}

export const DefaultLogger: ILogger = createLogger('[*]');

export {
    LogDuration
} from '../decorators/log-duration';

export {
    logtrailTransport,
    resolveLogtrailVectorIngest,
    setLogtrailVectorIngest,
    shipLogtrailVectorJson,
    type LogtrailVectorIngestConfig,
} from './logtrail';
