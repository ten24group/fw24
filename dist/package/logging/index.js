"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shipLogtrailVectorJson = exports.setLogtrailVectorIngest = exports.resolveLogtrailVectorIngest = exports.logtrailTransport = exports.LogDuration = exports.DefaultLogger = exports.createLogger = void 0;
const tslog_1 = require("tslog");
const logtrail_1 = require("./logtrail");
// Import the concrete leaf module (not the barrel) to keep this cycle-free:
// execution-context/storage's only runtime dependency is node:async_hooks.
const storage_1 = require("../core/runtime/execution-context/storage");
const logLevels = {
    "silly": 0,
    "trace": 1,
    "debug": 2,
    "info": 3,
    "warn": 4,
    "error": 5,
    "fatal": 6,
};
const logLevel = logLevels[(process.env.LOG_LEVEL || 'info').toLowerCase()];
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
const SOURCE_POSITION_MODE = (process.env.LOG_SOURCE_POSITION?.trim().toLowerCase() || 'off');
/** Keep a source path from its last `src/` segment so it maps to a GitHub blob path (best-effort). */
function repoRelativePath(p) {
    const i = p.lastIndexOf('/src/');
    if (i >= 0)
        return p.slice(i + 1);
    const slash = p.lastIndexOf('/');
    return slash >= 0 ? p.slice(slash + 1) : p;
}
/**
 * Caller location as `src/file.ts:line` from a fresh stack (source-mapped when `--enable-source-maps`
 * is on). Skips this module + tslog + node_modules frames so it points at the real call site.
 */
function captureSrcLoc() {
    const stack = new Error().stack;
    if (!stack)
        return undefined;
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const m = lines[i].match(/\(?([^\s()]+\.[cm]?[tj]s):(\d+):\d+\)?\s*$/);
        if (m && !/node_modules|[/\\]logging[/\\]index|tslog/.test(m[1])) {
            return `${repoRelativePath(m[1])}:${m[2]}`;
        }
    }
    return undefined;
}
const createLogger = (_options, _logLevel) => {
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
    const logger = new tslog_1.Logger({
        // In Lambda (and when LOG_FORMAT=json) emit structured JSON so the log-forwarder can lift fields
        // (correlationId, business ids via liftFields, codeFile/codeLine). tslog's default 'pretty' output
        // bakes args into the message string and CANNOT be lifted. Locally, keep readable pretty output.
        type: (process.env.AWS_LAMBDA_FUNCTION_NAME || (process.env.LOG_FORMAT || '').toLowerCase() === 'json')
            ? 'json'
            : 'pretty',
        stylePrettyLogs: false,
        maskValuesOfKeys: ['password', 'confirmPassword', 'secret', 'token', 'apiKey', 'accessToken', 'refreshToken', 'clientSecret', 'clientId', 'clientToken', 'clientCode', 'clientKey'],
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
    logger.attachTransport(logtrail_1.logtrailTransport);
    attachCorrelationIdToMeta(logger);
    // Mode 'warn-error': capture source position ONLY for warn/error/fatal (the culprits worth pinning),
    // so info/debug hot paths pay nothing. Injected as a `_srcloc` arg that the forwarder lifts into
    // codeFile/codeLine (and strips from the shipped message).
    if (SOURCE_POSITION_MODE === 'warn-error') {
        for (const lvl of ['warn', 'error', 'fatal']) {
            const orig = logger[lvl].bind(logger);
            logger[lvl] = (...args) => {
                const loc = captureSrcLoc();
                return loc ? orig(...args, { _srcloc: loc }) : orig(...args);
            };
        }
    }
    return logger;
};
exports.createLogger = createLogger;
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
function attachCorrelationIdToMeta(logger) {
    const anyLogger = logger;
    if (typeof anyLogger._addMetaToLogObj !== 'function') {
        // Defensive: tslog internals changed — skip enrichment rather than break logging.
        return;
    }
    const metaProperty = logger.settings.metaProperty || '_meta';
    const baseAddMeta = anyLogger._addMetaToLogObj.bind(logger);
    logger.settings.overwrite = {
        ...logger.settings.overwrite,
        addMeta: (logObj, logLevelId, logLevelName) => {
            const withMeta = baseAddMeta(logObj, logLevelId, logLevelName);
            const execCtx = (0, storage_1.getCurrentExecutionContext)();
            const meta = withMeta?.[metaProperty];
            if (meta && typeof meta === 'object') {
                if (execCtx?.correlationId)
                    meta.correlationId = execCtx.correlationId;
                // Additive only — does not change what correlationId itself means (still strictly
                // per-invocation, see api-gateway-controller.ts). This just also exposes the upstream
                // link on the log line, so a downstream aggregator (e.g. Logtrail's cross-service
                // signature linking) can match a caller's own correlationId against a callee's causedBy
                // without either side changing its existing per-invocation identity.
                if (execCtx?.causedBy)
                    meta.causedBy = execCtx.causedBy;
                // Who made this request, not which request — same additive stamping, distinct concern
                // from correlationId/causedBy. Prefers the unverified client-supplied id (see
                // Actor.clientSuppliedActorId on api-gateway-controller.ts) when present — it's the
                // more useful "who" for triage on SigV4/anonymous routes — else falls back to the
                // auth-verified actorId (IAM ARN / 'anonymous'). Observability only either way, never
                // for authorization — that distinction lives on the Actor object itself, not here.
                const stampedActorId = execCtx?.actor?.clientSuppliedActorId || execCtx?.actor?.actorId;
                if (stampedActorId)
                    meta.actorId = stampedActorId;
            }
            return withMeta;
        },
    };
}
exports.DefaultLogger = (0, exports.createLogger)('[*]');
var log_duration_1 = require("../decorators/log-duration");
Object.defineProperty(exports, "LogDuration", { enumerable: true, get: function () { return log_duration_1.LogDuration; } });
var logtrail_2 = require("./logtrail");
Object.defineProperty(exports, "logtrailTransport", { enumerable: true, get: function () { return logtrail_2.logtrailTransport; } });
Object.defineProperty(exports, "resolveLogtrailVectorIngest", { enumerable: true, get: function () { return logtrail_2.resolveLogtrailVectorIngest; } });
Object.defineProperty(exports, "setLogtrailVectorIngest", { enumerable: true, get: function () { return logtrail_2.setLogtrailVectorIngest; } });
Object.defineProperty(exports, "shipLogtrailVectorJson", { enumerable: true, get: function () { return logtrail_2.shipLogtrailVectorJson; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxpQ0FBd0Q7QUFDeEQseUNBQStDO0FBQy9DLDRFQUE0RTtBQUM1RSwyRUFBMkU7QUFDM0UsdUVBQXVGO0FBS3ZGLE1BQU0sU0FBUyxHQUFRO0lBQ25CLE9BQU8sRUFBRSxDQUFDO0lBQ1YsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsQ0FBQztJQUNWLE1BQU0sRUFBRSxDQUFDO0lBQ1QsTUFBTSxFQUFFLENBQUM7SUFDVCxPQUFPLEVBQUUsQ0FBQztJQUNWLE9BQU8sRUFBRSxDQUFDO0NBQ2IsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFFLENBQUM7QUFFOUU7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxvQkFBb0IsR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLElBQUksS0FBSyxDQUM1RCxDQUFDO0FBRWpDLHNHQUFzRztBQUN0RyxTQUFTLGdCQUFnQixDQUFDLENBQVM7SUFDL0IsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQUUsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNsQyxNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2pDLE9BQU8sS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FB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QUFDO1lBQ3RELENBQUM7WUFDRCxPQUFPLFFBQVEsQ0FBQztRQUNwQixDQUFDO0tBQ0osQ0FBQztBQUNOLENBQUM7QUFFWSxRQUFBLGFBQWEsR0FBWSxJQUFBLG9CQUFZLEVBQUMsS0FBSyxDQUFDLENBQUM7QUFFMUQsMkRBRW9DO0FBRGhDLDJHQUFBLFdBQVcsT0FBQTtBQUdmLHVDQU1vQjtBQUxoQiw2R0FBQSxpQkFBaUIsT0FBQTtBQUNqQix1SEFBQSwyQkFBMkIsT0FBQTtBQUMzQixtSEFBQSx1QkFBdUIsT0FBQTtBQUN2QixrSEFBQSxzQkFBc0IsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IExvZ2dlciwgSUxvZ09iaiwgSVNldHRpbmdzUGFyYW0gfSBmcm9tIFwidHNsb2dcIjtcbmltcG9ydCB7IGxvZ3RyYWlsVHJhbnNwb3J0IH0gZnJvbSBcIi4vbG9ndHJhaWxcIjtcbi8vIEltcG9ydCB0aGUgY29uY3JldGUgbGVhZiBtb2R1bGUgKG5vdCB0aGUgYmFycmVsKSB0byBrZWVwIHRoaXMgY3ljbGUtZnJlZTpcbi8vIGV4ZWN1dGlvbi1jb250ZXh0L3N0b3JhZ2UncyBvbmx5IHJ1bnRpbWUgZGVwZW5kZW5jeSBpcyBub2RlOmFzeW5jX2hvb2tzLlxuaW1wb3J0IHsgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3N0b3JhZ2VcIjtcblxuZXhwb3J0IGludGVyZmFjZSBJTG9nZ2VyIGV4dGVuZHMgTG9nZ2VyPElMb2dPYmo+IHtcbn1cblxuY29uc3QgbG9nTGV2ZWxzOiBhbnkgPSB7XG4gICAgXCJzaWxseVwiOiAwLFxuICAgIFwidHJhY2VcIjogMSxcbiAgICBcImRlYnVnXCI6IDIsXG4gICAgXCJpbmZvXCI6IDMsXG4gICAgXCJ3YXJuXCI6IDQsXG4gICAgXCJlcnJvclwiOiA1LFxuICAgIFwiZmF0YWxcIjogNixcbn07XG5cbmNvbnN0IGxvZ0xldmVsID0gbG9nTGV2ZWxzWyAocHJvY2Vzcy5lbnYuTE9HX0xFVkVMIHx8ICdpbmZvJykudG9Mb3dlckNhc2UoKSBdO1xuXG4vKipcbiAqIFNvdXJjZS1wb3NpdGlvbiBjYXB0dXJlIG1vZGUgZm9yIFwicGluIHRoZSBleGFjdCBjdWxwcml0XCIgY29kZSBsaW5rcy4gU2V0IGJ5IHRoZSBmdzI0IGZ1bmN0aW9uXG4gKiBjb25zdHJ1Y3QgZnJvbSB0aGUgYGxvZ1NvdXJjZVBvc2l0aW9uYCBhcHAgY29uZmlnIChkZWZhdWx0IGB3YXJuLWVycm9yYCwgb25seSB3aGVuIHNvdXJjZW1hcHMgYXJlIG9uKTpcbiAqICAgLSBgb2ZmYCAgICAgICAgOiBuZXZlciBjYXB0dXJlIHBvc2l0aW9uIChjdXJyZW50IHByb2QgYmVoYXZpb3VyKS5cbiAqICAgLSBgd2Fybi1lcnJvcmAgOiBjYXB0dXJlIGBmaWxlOmxpbmVgIE9OTFkgZm9yIHdhcm4vZXJyb3IvZmF0YWwg4oCUIHRoZSBjdWxwcml0cyB3b3J0aCBwaW5uaW5nIOKAlCBzb1xuICogICAgICAgICAgICAgICAgICAgIGhvdCBpbmZvL2RlYnVnIHBhdGhzIHBheSBub3RoaW5nIChjYXB0dXJlZCBsYXppbHkgcGVyLWNhbGwsIHNlZSB0aGUgd3JhcHBlciBiZWxvdykuXG4gKiAgIC0gYGFsbGAgICAgICAgIDogdHNsb2cgY2FwdHVyZXMgcG9zaXRpb24gZm9yIGV2ZXJ5IGVtaXR0ZWQgbG9nIChuYXRpdmUgYF9tZXRhLnBhdGhgKS5cbiAqIFBvc2l0aW9ucyBvbmx5IHJlc29sdmUgdG8gcmVhbCBzb3VyY2Ugd2hlbiB0aGUgTGFtYmRhIHJ1bnMgd2l0aCBgLS1lbmFibGUtc291cmNlLW1hcHNgICh0aGUgY29uc3RydWN0XG4gKiBhZGRzIGl0IHdoZW5ldmVyIHRoaXMgaXMgZW5hYmxlZCkuXG4gKi9cbmNvbnN0IFNPVVJDRV9QT1NJVElPTl9NT0RFID0gKHByb2Nlc3MuZW52LkxPR19TT1VSQ0VfUE9TSVRJT04/LnRyaW0oKS50b0xvd2VyQ2FzZSgpIHx8ICdvZmYnKSBhc1xuICAgICdvZmYnIHwgJ3dhcm4tZXJyb3InIHwgJ2FsbCc7XG5cbi8qKiBLZWVwIGEgc291cmNlIHBhdGggZnJvbSBpdHMgbGFzdCBgc3JjL2Agc2VnbWVudCBzbyBpdCBtYXBzIHRvIGEgR2l0SHViIGJsb2IgcGF0aCAoYmVzdC1lZmZvcnQpLiAqL1xuZnVuY3Rpb24gcmVwb1JlbGF0aXZlUGF0aChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGkgPSBwLmxhc3RJbmRleE9mKCcvc3JjLycpO1xuICAgIGlmIChpID49IDApIHJldHVybiBwLnNsaWNlKGkgKyAxKTtcbiAgICBjb25zdCBzbGFzaCA9IHAubGFzdEluZGV4T2YoJy8nKTtcbiAgICByZXR1cm4gc2xhc2ggPj0gMCA/IHAuc2xpY2Uoc2xhc2ggKyAxKSA6IHA7XG59XG5cbi8qKlxuICogQ2FsbGVyIGxvY2F0aW9uIGFzIGBzcmMvZmlsZS50czpsaW5lYCBmcm9tIGEgZnJlc2ggc3RhY2sgKHNvdXJjZS1tYXBwZWQgd2hlbiBgLS1lbmFibGUtc291cmNlLW1hcHNgXG4gKiBpcyBvbikuIFNraXBzIHRoaXMgbW9kdWxlICsgdHNsb2cgKyBub2RlX21vZHVsZXMgZnJhbWVzIHNvIGl0IHBvaW50cyBhdCB0aGUgcmVhbCBjYWxsIHNpdGUuXG4gKi9cbmZ1bmN0aW9uIGNhcHR1cmVTcmNMb2MoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBFcnJvcigpLnN0YWNrO1xuICAgIGlmICghc3RhY2spIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgbGluZXMgPSBzdGFjay5zcGxpdCgnXFxuJyk7XG4gICAgZm9yIChsZXQgaSA9IDI7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBtID0gbGluZXNbIGkgXS5tYXRjaCgvXFwoPyhbXlxccygpXStcXC5bY21dP1t0al1zKTooXFxkKyk6XFxkK1xcKT9cXHMqJC8pO1xuICAgICAgICBpZiAobSAmJiAhL25vZGVfbW9kdWxlc3xbL1xcXFxdbG9nZ2luZ1svXFxcXF1pbmRleHx0c2xvZy8udGVzdChtWyAxIF0pKSB7XG4gICAgICAgICAgICByZXR1cm4gYCR7cmVwb1JlbGF0aXZlUGF0aChtWyAxIF0pfToke21bIDIgXX1gO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoX29wdGlvbnM6IHN0cmluZyB8IEZ1bmN0aW9uIHwgSVNldHRpbmdzUGFyYW08SUxvZ09iaj4sIF9sb2dMZXZlbD86IDAgfCAxIHwgMiB8IDMgfCA0IHwgNSB8IDYpID0+IHtcblxuICAgIF9sb2dMZXZlbCA9IF9sb2dMZXZlbCA/PyBsb2dMZXZlbDtcblxuICAgIGlmICh0eXBlb2YgX29wdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBfb3B0aW9ucyA9IF9vcHRpb25zLm5hbWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBfb3B0aW9ucyA9PSAnc3RyaW5nJykge1xuICAgICAgICBfb3B0aW9ucyA9IHsgbmFtZTogX29wdGlvbnMsIG1pbkxldmVsOiBsb2dMZXZlbCB9O1xuICAgIH1cblxuICAgIC8vIEluIHByb2QgKGluZm8rKSB0c2xvZyBoaWRlcyBwb3NpdGlvbiBieSBkZWZhdWx0LiBPbmx5IGxldCB0c2xvZyBjYXB0dXJlIGl0IG5hdGl2ZWx5IGZvciBtb2RlXG4gICAgLy8gJ2FsbCc7ICd3YXJuLWVycm9yJyBjYXB0dXJlcyBsYXppbHkgcGVyLWNhbGwgYmVsb3cgKGNoZWFwZXIpLCAnb2ZmJyBzdGF5cyBoaWRkZW4uIEFuIGV4cGxpY2l0XG4gICAgLy8gY2FsbGVyLXByb3ZpZGVkIHZhbHVlIGFsd2F5cyB3aW5zLlxuICAgIGlmIChfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uID09PSB1bmRlZmluZWQgJiYgbG9nTGV2ZWwgPiAyKSB7XG4gICAgICAgIF9vcHRpb25zLmhpZGVMb2dQb3NpdGlvbkZvclByb2R1Y3Rpb24gPSBTT1VSQ0VfUE9TSVRJT05fTU9ERSAhPT0gJ2FsbCc7XG4gICAgfVxuXG4gICAgLy8gc2V0IHRpbWUgZm9ybWF0XG4gICAgaWYgKCFfb3B0aW9ucy5wcmV0dHlMb2dUaW1lWm9uZSkge1xuICAgICAgICBfb3B0aW9ucy5wcmV0dHlMb2dUaW1lWm9uZSA9ICdsb2NhbCc7XG4gICAgfVxuXG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgICAgIC8vIEluIExhbWJkYSAoYW5kIHdoZW4gTE9HX0ZPUk1BVD1qc29uKSBlbWl0IHN0cnVjdHVyZWQgSlNPTiBzbyB0aGUgbG9nLWZvcndhcmRlciBjYW4gbGlmdCBmaWVsZHNcbiAgICAgICAgLy8gKGNvcnJlbGF0aW9uSWQsIGJ1c2luZXNzIGlkcyB2aWEgbGlmdEZpZWxkcywgY29kZUZpbGUvY29kZUxpbmUpLiB0c2xvZydzIGRlZmF1bHQgJ3ByZXR0eScgb3V0cHV0XG4gICAgICAgIC8vIGJha2VzIGFyZ3MgaW50byB0aGUgbWVzc2FnZSBzdHJpbmcgYW5kIENBTk5PVCBiZSBsaWZ0ZWQuIExvY2FsbHksIGtlZXAgcmVhZGFibGUgcHJldHR5IG91dHB1dC5cbiAgICAgICAgdHlwZTogKHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRSB8fCAocHJvY2Vzcy5lbnYuTE9HX0ZPUk1BVCB8fCAnJykudG9Mb3dlckNhc2UoKSA9PT0gJ2pzb24nKVxuICAgICAgICAgICAgPyAnanNvbidcbiAgICAgICAgICAgIDogJ3ByZXR0eScsXG4gICAgICAgIHN0eWxlUHJldHR5TG9nczogZmFsc2UsXG4gICAgICAgIG1hc2tWYWx1ZXNPZktleXM6IFsgJ3Bhc3N3b3JkJywgJ2NvbmZpcm1QYXNzd29yZCcsICdzZWNyZXQnLCAndG9rZW4nLCAnYXBpS2V5JywgJ2FjY2Vzc1Rva2VuJywgJ3JlZnJlc2hUb2tlbicsICdjbGllbnRTZWNyZXQnLCAnY2xpZW50SWQnLCAnY2xpZW50VG9rZW4nLCAnY2xpZW50Q29kZScsICdjbGllbnRLZXknIF0sXG4gICAgICAgIG1hc2tWYWx1ZXNPZktleXNDYXNlSW5zZW5zaXRpdmU6IHRydWUsXG4gICAgICAgIG1hc2tWYWx1ZXNSZWdFeDogW1xuICAgICAgICAgICAgL3Bhc3N3b3JkXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NvbmZpcm1QYXNzd29yZFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9zZWNyZXRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvdG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvYXBpS2V5XFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2FjY2Vzc1Rva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL3JlZnJlc2hUb2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRTZWNyZXRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY2xpZW50SWRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY2xpZW50VG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvKFthLXpBLVowLTlfXSprZXlbYS16QS1aMC05X10qKVxccyo6XFxzKig/OlsnXCJdKT8oW14nXCJdKykoPzpbJ1wiXSk/L2dpLFxuICAgICAgICAgICAgLyhbYS16QS1aMC05X10qdG9rZW5bYS16QS1aMC05X10qKVxccyo6XFxzKig/OlsnXCJdKT8oW14nXCJdKykoPzpbJ1wiXSk/L2dpLFxuICAgICAgICAgICAgL1BSSVZBVEUgS0VZLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvQ0VSVElGSUNBVEUtLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC9CRUdJTiBQUklWQVRFIEtFWS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgL0JFR0lOIENFUlRJRklDQVRFLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvKD86a2V5fHByaXZhdGVLZXl8cHVibGljS2V5fGNlcnRpZmljYXRlKVxccyo6XFxzKihbXFxzXFxTXSo/KSg/OlxcblxccypcXG58XFxuXFxzKlthLXpBLVpdfFxcblxccyokfCQpL2dpLFxuICAgICAgICBdLFxuICAgICAgICAuLi5fb3B0aW9ucyxcbiAgICAgICAgLy8gZW5zdXJlIG1pbiBsb2cgbGV2ZWwgaXMgYWx3YXlzIHRoZXJlXG4gICAgICAgIG1pbkxldmVsOiBfb3B0aW9ucy5taW5MZXZlbCA/PyBsb2dMZXZlbCxcblxuICAgIH0pO1xuXG4gICAgbG9nZ2VyLmF0dGFjaFRyYW5zcG9ydChsb2d0cmFpbFRyYW5zcG9ydCk7XG5cbiAgICBhdHRhY2hDb3JyZWxhdGlvbklkVG9NZXRhKGxvZ2dlcik7XG5cbiAgICAvLyBNb2RlICd3YXJuLWVycm9yJzogY2FwdHVyZSBzb3VyY2UgcG9zaXRpb24gT05MWSBmb3Igd2Fybi9lcnJvci9mYXRhbCAodGhlIGN1bHByaXRzIHdvcnRoIHBpbm5pbmcpLFxuICAgIC8vIHNvIGluZm8vZGVidWcgaG90IHBhdGhzIHBheSBub3RoaW5nLiBJbmplY3RlZCBhcyBhIGBfc3JjbG9jYCBhcmcgdGhhdCB0aGUgZm9yd2FyZGVyIGxpZnRzIGludG9cbiAgICAvLyBjb2RlRmlsZS9jb2RlTGluZSAoYW5kIHN0cmlwcyBmcm9tIHRoZSBzaGlwcGVkIG1lc3NhZ2UpLlxuICAgIGlmIChTT1VSQ0VfUE9TSVRJT05fTU9ERSA9PT0gJ3dhcm4tZXJyb3InKSB7XG4gICAgICAgIGZvciAoY29uc3QgbHZsIG9mIFsgJ3dhcm4nLCAnZXJyb3InLCAnZmF0YWwnIF0gYXMgY29uc3QpIHtcbiAgICAgICAgICAgIGNvbnN0IG9yaWcgPSAobG9nZ2VyIGFzIGFueSlbIGx2bCBdLmJpbmQobG9nZ2VyKTtcbiAgICAgICAgICAgIChsb2dnZXIgYXMgYW55KVsgbHZsIF0gPSAoLi4uYXJnczogYW55W10pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsb2MgPSBjYXB0dXJlU3JjTG9jKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGxvYyA/IG9yaWcoLi4uYXJncywgeyBfc3JjbG9jOiBsb2MgfSkgOiBvcmlnKC4uLmFyZ3MpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2dnZXI7XG59XG5cbi8qKlxuICogRW5yaWNoIGV2ZXJ5IGxvZyBsaW5lJ3Mgc3RydWN0dXJlZCBgX21ldGFgIHdpdGggdGhlIGN1cnJlbnQgcmVxdWVzdC1zY29wZWRcbiAqIGBjb3JyZWxhdGlvbklkYCAod2hlbiBhbiBFeGVjdXRpb25Db250ZXh0IGlzIGFjdGl2ZSkuIFRoaXMgcnVucyAqYmVmb3JlKiB0c2xvZ1xuICogZW1pdHMgdGhlIEpTT04gbG9nIHRvIHRoZSBjb25zb2xlLCBzbyBkb3duc3RyZWFtIGZvcndhcmRlcnMgdGhhdCBsaWZ0IGBfbWV0YWBcbiAqIHNoaXAgYGNvcnJlbGF0aW9uSWRgIGFzIGEgZmlyc3QtY2xhc3MgZmllbGQgYWxvbmdzaWRlIHRoZSBleGlzdGluZyBgcmVxdWVzdElkYC5cbiAqXG4gKiBgY29ycmVsYXRpb25JZGAgaXMgdGhlIHNpbmdsZSBpZCBmdzI0IGFscmVhZHkgcHJvcGFnYXRlcyBlbmQtdG8tZW5kIGFjcm9zc1xuICogZXZlcnkgaG9wIOKAlCBvdmVyIEhUVFAgKGB4LWNvcnJlbGF0aW9uLWlkYCAvIFczQyBgdHJhY2VwYXJlbnRgKSBhbmQgb3ZlclxuICogU1FTL1NOUy9FdmVudEJyaWRnZSAobWVzc2FnZSBhdHRyaWJ1dGVzKS4gU3RhbXBpbmcgaXQgb250byBldmVyeSBsb2cgbGluZSBsZXRzXG4gKiBMb2d0cmFpbCBzdGl0Y2ggYSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcyB1c2luZyBvbmUgZmllbGQgdGhhdCBpcyBwcmVzZW50IG9uXG4gKiBBTEwgZW50cnkgcG9pbnRzIChBUEksIFNRUywgdGFzaywgbWFpbCksIGVhY2ggb2Ygd2hpY2ggZXN0YWJsaXNoZXMgdGhlXG4gKiBFeGVjdXRpb25Db250ZXh0IHZpYSBgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRgLlxuICpcbiAqIEJhY2t3YXJkLWNvbXBhdGlibGU6IGEgY29tcGxldGUgbm8tb3Agd2hlbiBubyBFeGVjdXRpb25Db250ZXh0IGlzIGVzdGFibGlzaGVkXG4gKiAobG9ncyBzaW1wbHkgY2Fycnkgbm8gYGNvcnJlbGF0aW9uSWRgKS4gVGhlIGV4aXN0aW5nIGByZXF1ZXN0SWRgIOKAlCBzdXJmYWNlZCBieVxuICogdGhlIGZvcndhcmRlciBmcm9tIHRoZSBBV1MgTGFtYmRhIGxvZyBwcmVmaXgg4oCUIGlzIHVudG91Y2hlZC5cbiAqXG4gKiBNZWNoYW5pc206IHRzbG9nIHJlYWRzIGBzZXR0aW5ncy5vdmVyd3JpdGUuYWRkTWV0YWAgZnJlc2ggb24gZXZlcnkgYGxvZygpYFxuICogY2FsbC4gV2UgZGVsZWdhdGUgdG8gdGhlIGxvZ2dlcidzIG93biBkZWZhdWx0IG1ldGEgYnVpbGRlciBhbmQgdGhlbiBzdGFtcCB0aGVcbiAqIGFtYmllbnQgYGNvcnJlbGF0aW9uSWRgIG9udG8gdGhlIHByb2R1Y2VkIGBfbWV0YWAuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaENvcnJlbGF0aW9uSWRUb01ldGEobG9nZ2VyOiBMb2dnZXI8SUxvZ09iaj4pOiB2b2lkIHtcbiAgICBjb25zdCBhbnlMb2dnZXIgPSBsb2dnZXIgYXMgdW5rbm93biBhcyB7XG4gICAgICAgIF9hZGRNZXRhVG9Mb2dPYmo6IChsb2dPYmo6IElMb2dPYmosIGxvZ0xldmVsSWQ6IG51bWJlciwgbG9nTGV2ZWxOYW1lOiBzdHJpbmcpID0+IGFueTtcbiAgICB9O1xuICAgIGlmICh0eXBlb2YgYW55TG9nZ2VyLl9hZGRNZXRhVG9Mb2dPYmogIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gRGVmZW5zaXZlOiB0c2xvZyBpbnRlcm5hbHMgY2hhbmdlZCDigJQgc2tpcCBlbnJpY2htZW50IHJhdGhlciB0aGFuIGJyZWFrIGxvZ2dpbmcuXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRhUHJvcGVydHkgPSAobG9nZ2VyLnNldHRpbmdzIGFzIHsgbWV0YVByb3BlcnR5Pzogc3RyaW5nIH0pLm1ldGFQcm9wZXJ0eSB8fCAnX21ldGEnO1xuICAgIGNvbnN0IGJhc2VBZGRNZXRhID0gYW55TG9nZ2VyLl9hZGRNZXRhVG9Mb2dPYmouYmluZChsb2dnZXIpO1xuXG4gICAgbG9nZ2VyLnNldHRpbmdzLm92ZXJ3cml0ZSA9IHtcbiAgICAgICAgLi4ubG9nZ2VyLnNldHRpbmdzLm92ZXJ3cml0ZSxcbiAgICAgICAgYWRkTWV0YTogKGxvZ09iajogSUxvZ09iaiwgbG9nTGV2ZWxJZDogbnVtYmVyLCBsb2dMZXZlbE5hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2l0aE1ldGEgPSBiYXNlQWRkTWV0YShsb2dPYmosIGxvZ0xldmVsSWQsIGxvZ0xldmVsTmFtZSk7XG4gICAgICAgICAgICBjb25zdCBleGVjQ3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgICAgIGNvbnN0IG1ldGEgPSB3aXRoTWV0YT8uWyBtZXRhUHJvcGVydHkgXTtcbiAgICAgICAgICAgIGlmIChtZXRhICYmIHR5cGVvZiBtZXRhID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIGlmIChleGVjQ3R4Py5jb3JyZWxhdGlvbklkKSBtZXRhLmNvcnJlbGF0aW9uSWQgPSBleGVjQ3R4LmNvcnJlbGF0aW9uSWQ7XG4gICAgICAgICAgICAgICAgLy8gQWRkaXRpdmUgb25seSDigJQgZG9lcyBub3QgY2hhbmdlIHdoYXQgY29ycmVsYXRpb25JZCBpdHNlbGYgbWVhbnMgKHN0aWxsIHN0cmljdGx5XG4gICAgICAgICAgICAgICAgLy8gcGVyLWludm9jYXRpb24sIHNlZSBhcGktZ2F0ZXdheS1jb250cm9sbGVyLnRzKS4gVGhpcyBqdXN0IGFsc28gZXhwb3NlcyB0aGUgdXBzdHJlYW1cbiAgICAgICAgICAgICAgICAvLyBsaW5rIG9uIHRoZSBsb2cgbGluZSwgc28gYSBkb3duc3RyZWFtIGFnZ3JlZ2F0b3IgKGUuZy4gTG9ndHJhaWwncyBjcm9zcy1zZXJ2aWNlXG4gICAgICAgICAgICAgICAgLy8gc2lnbmF0dXJlIGxpbmtpbmcpIGNhbiBtYXRjaCBhIGNhbGxlcidzIG93biBjb3JyZWxhdGlvbklkIGFnYWluc3QgYSBjYWxsZWUncyBjYXVzZWRCeVxuICAgICAgICAgICAgICAgIC8vIHdpdGhvdXQgZWl0aGVyIHNpZGUgY2hhbmdpbmcgaXRzIGV4aXN0aW5nIHBlci1pbnZvY2F0aW9uIGlkZW50aXR5LlxuICAgICAgICAgICAgICAgIGlmIChleGVjQ3R4Py5jYXVzZWRCeSkgbWV0YS5jYXVzZWRCeSA9IGV4ZWNDdHguY2F1c2VkQnk7XG4gICAgICAgICAgICAgICAgLy8gV2hvIG1hZGUgdGhpcyByZXF1ZXN0LCBub3Qgd2hpY2ggcmVxdWVzdCDigJQgc2FtZSBhZGRpdGl2ZSBzdGFtcGluZywgZGlzdGluY3QgY29uY2VyblxuICAgICAgICAgICAgICAgIC8vIGZyb20gY29ycmVsYXRpb25JZC9jYXVzZWRCeS4gUHJlZmVycyB0aGUgdW52ZXJpZmllZCBjbGllbnQtc3VwcGxpZWQgaWQgKHNlZVxuICAgICAgICAgICAgICAgIC8vIEFjdG9yLmNsaWVudFN1cHBsaWVkQWN0b3JJZCBvbiBhcGktZ2F0ZXdheS1jb250cm9sbGVyLnRzKSB3aGVuIHByZXNlbnQg4oCUIGl0J3MgdGhlXG4gICAgICAgICAgICAgICAgLy8gbW9yZSB1c2VmdWwgXCJ3aG9cIiBmb3IgdHJpYWdlIG9uIFNpZ1Y0L2Fub255bW91cyByb3V0ZXMg4oCUIGVsc2UgZmFsbHMgYmFjayB0byB0aGVcbiAgICAgICAgICAgICAgICAvLyBhdXRoLXZlcmlmaWVkIGFjdG9ySWQgKElBTSBBUk4gLyAnYW5vbnltb3VzJykuIE9ic2VydmFiaWxpdHkgb25seSBlaXRoZXIgd2F5LCBuZXZlclxuICAgICAgICAgICAgICAgIC8vIGZvciBhdXRob3JpemF0aW9uIOKAlCB0aGF0IGRpc3RpbmN0aW9uIGxpdmVzIG9uIHRoZSBBY3RvciBvYmplY3QgaXRzZWxmLCBub3QgaGVyZS5cbiAgICAgICAgICAgICAgICBjb25zdCBzdGFtcGVkQWN0b3JJZCA9IGV4ZWNDdHg/LmFjdG9yPy5jbGllbnRTdXBwbGllZEFjdG9ySWQgfHwgZXhlY0N0eD8uYWN0b3I/LmFjdG9ySWQ7XG4gICAgICAgICAgICAgICAgaWYgKHN0YW1wZWRBY3RvcklkKSBtZXRhLmFjdG9ySWQgPSBzdGFtcGVkQWN0b3JJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB3aXRoTWV0YTtcbiAgICAgICAgfSxcbiAgICB9O1xufVxuXG5leHBvcnQgY29uc3QgRGVmYXVsdExvZ2dlcjogSUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignWypdJyk7XG5cbmV4cG9ydCB7XG4gICAgTG9nRHVyYXRpb25cbn0gZnJvbSAnLi4vZGVjb3JhdG9ycy9sb2ctZHVyYXRpb24nO1xuXG5leHBvcnQge1xuICAgIGxvZ3RyYWlsVHJhbnNwb3J0LFxuICAgIHJlc29sdmVMb2d0cmFpbFZlY3RvckluZ2VzdCxcbiAgICBzZXRMb2d0cmFpbFZlY3RvckluZ2VzdCxcbiAgICBzaGlwTG9ndHJhaWxWZWN0b3JKc29uLFxuICAgIHR5cGUgTG9ndHJhaWxWZWN0b3JJbmdlc3RDb25maWcsXG59IGZyb20gJy4vbG9ndHJhaWwnO1xuIl19