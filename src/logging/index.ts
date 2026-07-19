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

export const createLogger = (_options: string | Function | ISettingsParam<ILogObj>, _logLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {

    _logLevel = _logLevel ?? logLevel;

    if (typeof _options == 'function') {
        _options = _options.name;
    }

    if (typeof _options == 'string') {
        _options = { name: _options, minLevel: logLevel };
    }

    // show line number only for debug and trace
    if (!_options.hideLogPositionForProduction && logLevel > 2) {
        _options.hideLogPositionForProduction = true;
    }

    // set time format
    if (!_options.prettyLogTimeZone) {
        _options.prettyLogTimeZone = 'local';
    }

    const logger = new Logger({
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
            const correlationId = getCurrentExecutionContext()?.correlationId;
            const meta = withMeta?.[ metaProperty ];
            if (correlationId && meta && typeof meta === 'object') {
                meta.correlationId = correlationId;
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
