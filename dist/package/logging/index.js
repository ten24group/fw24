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
            const correlationId = (0, storage_1.getCurrentExecutionContext)()?.correlationId;
            const meta = withMeta?.[metaProperty];
            if (correlationId && meta && typeof meta === 'object') {
                meta.correlationId = correlationId;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxpQ0FBd0Q7QUFDeEQseUNBQStDO0FBQy9DLDRFQUE0RTtBQUM1RSwyRUFBMkU7QUFDM0UsdUVBQXVGO0FBS3ZGLE1BQU0sU0FBUyxHQUFRO0lBQ25CLE9BQU8sRUFBRSxDQUFDO0lBQ1YsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsQ0FBQztJQUNWLE1BQU0sRUFBRSxDQUFDO0lBQ1QsTUFBTSxFQUFFLENBQUM7SUFDVCxPQUFPLEVBQUUsQ0FBQztJQUNWLE9BQU8sRUFBRSxDQUFDO0NBQ2IsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFFLENBQUM7QUFFOUU7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxvQkFBb0IsR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLElBQUksS0FBSyxDQUM1RCxDQUFDO0FBRWpDLHNHQUFzRztBQUN0RyxTQUFTLGdCQUFnQixDQUFDLENBQVM7SUFDL0IsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQUUsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNsQyxNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2pDLE9BQU8sS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FB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TyxFQUFFLENBQUMsTUFBZSxFQUFFLFVBQWtCLEVBQUUsWUFBb0IsRUFBRSxFQUFFO1lBQ25FLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFlBQVksQ0FBQyxDQUFDO1lBQy9ELE1BQU0sYUFBYSxHQUFHLElBQUEsb0NBQTBCLEdBQUUsRUFBRSxhQUFhLENBQUM7WUFDbEUsTUFBTSxJQUFJLEdBQUcsUUFBUSxFQUFFLENBQUUsWUFBWSxDQUFFLENBQUM7WUFDeEMsSUFBSSxhQUFhLElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUNwRCxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztZQUN2QyxDQUFDO1lBQ0QsT0FBTyxRQUFRLENBQUM7UUFDcEIsQ0FBQztLQUNKLENBQUM7QUFDTixDQUFDO0FBRVksUUFBQSxhQUFhLEdBQVksSUFBQSxvQkFBWSxFQUFDLEtBQUssQ0FBQyxDQUFDO0FBRTFELDJEQUVvQztBQURoQywyR0FBQSxXQUFXLE9BQUE7QUFHZix1Q0FNb0I7QUFMaEIsNkdBQUEsaUJBQWlCLE9BQUE7QUFDakIsdUhBQUEsMkJBQTJCLE9BQUE7QUFDM0IsbUhBQUEsdUJBQXVCLE9BQUE7QUFDdkIsa0hBQUEsc0JBQXNCLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMb2dnZXIsIElMb2dPYmosIElTZXR0aW5nc1BhcmFtIH0gZnJvbSBcInRzbG9nXCI7XG5pbXBvcnQgeyBsb2d0cmFpbFRyYW5zcG9ydCB9IGZyb20gXCIuL2xvZ3RyYWlsXCI7XG4vLyBJbXBvcnQgdGhlIGNvbmNyZXRlIGxlYWYgbW9kdWxlIChub3QgdGhlIGJhcnJlbCkgdG8ga2VlcCB0aGlzIGN5Y2xlLWZyZWU6XG4vLyBleGVjdXRpb24tY29udGV4dC9zdG9yYWdlJ3Mgb25seSBydW50aW1lIGRlcGVuZGVuY3kgaXMgbm9kZTphc3luY19ob29rcy5cbmltcG9ydCB7IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC9zdG9yYWdlXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUxvZ2dlciBleHRlbmRzIExvZ2dlcjxJTG9nT2JqPiB7XG59XG5cbmNvbnN0IGxvZ0xldmVsczogYW55ID0ge1xuICAgIFwic2lsbHlcIjogMCxcbiAgICBcInRyYWNlXCI6IDEsXG4gICAgXCJkZWJ1Z1wiOiAyLFxuICAgIFwiaW5mb1wiOiAzLFxuICAgIFwid2FyblwiOiA0LFxuICAgIFwiZXJyb3JcIjogNSxcbiAgICBcImZhdGFsXCI6IDYsXG59O1xuXG5jb25zdCBsb2dMZXZlbCA9IGxvZ0xldmVsc1sgKHByb2Nlc3MuZW52LkxPR19MRVZFTCB8fCAnaW5mbycpLnRvTG93ZXJDYXNlKCkgXTtcblxuLyoqXG4gKiBTb3VyY2UtcG9zaXRpb24gY2FwdHVyZSBtb2RlIGZvciBcInBpbiB0aGUgZXhhY3QgY3VscHJpdFwiIGNvZGUgbGlua3MuIFNldCBieSB0aGUgZncyNCBmdW5jdGlvblxuICogY29uc3RydWN0IGZyb20gdGhlIGBsb2dTb3VyY2VQb3NpdGlvbmAgYXBwIGNvbmZpZyAoZGVmYXVsdCBgd2Fybi1lcnJvcmAsIG9ubHkgd2hlbiBzb3VyY2VtYXBzIGFyZSBvbik6XG4gKiAgIC0gYG9mZmAgICAgICAgIDogbmV2ZXIgY2FwdHVyZSBwb3NpdGlvbiAoY3VycmVudCBwcm9kIGJlaGF2aW91cikuXG4gKiAgIC0gYHdhcm4tZXJyb3JgIDogY2FwdHVyZSBgZmlsZTpsaW5lYCBPTkxZIGZvciB3YXJuL2Vycm9yL2ZhdGFsIOKAlCB0aGUgY3VscHJpdHMgd29ydGggcGlubmluZyDigJQgc29cbiAqICAgICAgICAgICAgICAgICAgICBob3QgaW5mby9kZWJ1ZyBwYXRocyBwYXkgbm90aGluZyAoY2FwdHVyZWQgbGF6aWx5IHBlci1jYWxsLCBzZWUgdGhlIHdyYXBwZXIgYmVsb3cpLlxuICogICAtIGBhbGxgICAgICAgICA6IHRzbG9nIGNhcHR1cmVzIHBvc2l0aW9uIGZvciBldmVyeSBlbWl0dGVkIGxvZyAobmF0aXZlIGBfbWV0YS5wYXRoYCkuXG4gKiBQb3NpdGlvbnMgb25seSByZXNvbHZlIHRvIHJlYWwgc291cmNlIHdoZW4gdGhlIExhbWJkYSBydW5zIHdpdGggYC0tZW5hYmxlLXNvdXJjZS1tYXBzYCAodGhlIGNvbnN0cnVjdFxuICogYWRkcyBpdCB3aGVuZXZlciB0aGlzIGlzIGVuYWJsZWQpLlxuICovXG5jb25zdCBTT1VSQ0VfUE9TSVRJT05fTU9ERSA9IChwcm9jZXNzLmVudi5MT0dfU09VUkNFX1BPU0lUSU9OPy50cmltKCkudG9Mb3dlckNhc2UoKSB8fCAnb2ZmJykgYXNcbiAgICAnb2ZmJyB8ICd3YXJuLWVycm9yJyB8ICdhbGwnO1xuXG4vKiogS2VlcCBhIHNvdXJjZSBwYXRoIGZyb20gaXRzIGxhc3QgYHNyYy9gIHNlZ21lbnQgc28gaXQgbWFwcyB0byBhIEdpdEh1YiBibG9iIHBhdGggKGJlc3QtZWZmb3J0KS4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxhdGl2ZVBhdGgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBpID0gcC5sYXN0SW5kZXhPZignL3NyYy8nKTtcbiAgICBpZiAoaSA+PSAwKSByZXR1cm4gcC5zbGljZShpICsgMSk7XG4gICAgY29uc3Qgc2xhc2ggPSBwLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgcmV0dXJuIHNsYXNoID49IDAgPyBwLnNsaWNlKHNsYXNoICsgMSkgOiBwO1xufVxuXG4vKipcbiAqIENhbGxlciBsb2NhdGlvbiBhcyBgc3JjL2ZpbGUudHM6bGluZWAgZnJvbSBhIGZyZXNoIHN0YWNrIChzb3VyY2UtbWFwcGVkIHdoZW4gYC0tZW5hYmxlLXNvdXJjZS1tYXBzYFxuICogaXMgb24pLiBTa2lwcyB0aGlzIG1vZHVsZSArIHRzbG9nICsgbm9kZV9tb2R1bGVzIGZyYW1lcyBzbyBpdCBwb2ludHMgYXQgdGhlIHJlYWwgY2FsbCBzaXRlLlxuICovXG5mdW5jdGlvbiBjYXB0dXJlU3JjTG9jKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qgc3RhY2sgPSBuZXcgRXJyb3IoKS5zdGFjaztcbiAgICBpZiAoIXN0YWNrKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGxpbmVzID0gc3RhY2suc3BsaXQoJ1xcbicpO1xuICAgIGZvciAobGV0IGkgPSAyOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgbSA9IGxpbmVzWyBpIF0ubWF0Y2goL1xcKD8oW15cXHMoKV0rXFwuW2NtXT9bdGpdcyk6KFxcZCspOlxcZCtcXCk/XFxzKiQvKTtcbiAgICAgICAgaWYgKG0gJiYgIS9ub2RlX21vZHVsZXN8Wy9cXFxcXWxvZ2dpbmdbL1xcXFxdaW5kZXh8dHNsb2cvLnRlc3QobVsgMSBdKSkge1xuICAgICAgICAgICAgcmV0dXJuIGAke3JlcG9SZWxhdGl2ZVBhdGgobVsgMSBdKX06JHttWyAyIF19YDtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgY29uc3QgY3JlYXRlTG9nZ2VyID0gKF9vcHRpb25zOiBzdHJpbmcgfCBGdW5jdGlvbiB8IElTZXR0aW5nc1BhcmFtPElMb2dPYmo+LCBfbG9nTGV2ZWw/OiAwIHwgMSB8IDIgfCAzIHwgNCB8IDUgfCA2KSA9PiB7XG5cbiAgICBfbG9nTGV2ZWwgPSBfbG9nTGV2ZWwgPz8gbG9nTGV2ZWw7XG5cbiAgICBpZiAodHlwZW9mIF9vcHRpb25zID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgX29wdGlvbnMgPSBfb3B0aW9ucy5uYW1lO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgX29wdGlvbnMgPT0gJ3N0cmluZycpIHtcbiAgICAgICAgX29wdGlvbnMgPSB7IG5hbWU6IF9vcHRpb25zLCBtaW5MZXZlbDogbG9nTGV2ZWwgfTtcbiAgICB9XG5cbiAgICAvLyBJbiBwcm9kIChpbmZvKykgdHNsb2cgaGlkZXMgcG9zaXRpb24gYnkgZGVmYXVsdC4gT25seSBsZXQgdHNsb2cgY2FwdHVyZSBpdCBuYXRpdmVseSBmb3IgbW9kZVxuICAgIC8vICdhbGwnOyAnd2Fybi1lcnJvcicgY2FwdHVyZXMgbGF6aWx5IHBlci1jYWxsIGJlbG93IChjaGVhcGVyKSwgJ29mZicgc3RheXMgaGlkZGVuLiBBbiBleHBsaWNpdFxuICAgIC8vIGNhbGxlci1wcm92aWRlZCB2YWx1ZSBhbHdheXMgd2lucy5cbiAgICBpZiAoX29wdGlvbnMuaGlkZUxvZ1Bvc2l0aW9uRm9yUHJvZHVjdGlvbiA9PT0gdW5kZWZpbmVkICYmIGxvZ0xldmVsID4gMikge1xuICAgICAgICBfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uID0gU09VUkNFX1BPU0lUSU9OX01PREUgIT09ICdhbGwnO1xuICAgIH1cblxuICAgIC8vIHNldCB0aW1lIGZvcm1hdFxuICAgIGlmICghX29wdGlvbnMucHJldHR5TG9nVGltZVpvbmUpIHtcbiAgICAgICAgX29wdGlvbnMucHJldHR5TG9nVGltZVpvbmUgPSAnbG9jYWwnO1xuICAgIH1cblxuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoe1xuICAgICAgICBzdHlsZVByZXR0eUxvZ3M6IGZhbHNlLFxuICAgICAgICBtYXNrVmFsdWVzT2ZLZXlzOiBbICdwYXNzd29yZCcsICdjb25maXJtUGFzc3dvcmQnLCAnc2VjcmV0JywgJ3Rva2VuJywgJ2FwaUtleScsICdhY2Nlc3NUb2tlbicsICdyZWZyZXNoVG9rZW4nLCAnY2xpZW50U2VjcmV0JywgJ2NsaWVudElkJywgJ2NsaWVudFRva2VuJywgJ2NsaWVudENvZGUnLCAnY2xpZW50S2V5JyBdLFxuICAgICAgICBtYXNrVmFsdWVzT2ZLZXlzQ2FzZUluc2Vuc2l0aXZlOiB0cnVlLFxuICAgICAgICBtYXNrVmFsdWVzUmVnRXg6IFtcbiAgICAgICAgICAgIC9wYXNzd29yZFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jb25maXJtUGFzc3dvcmRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvc2VjcmV0XFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL3Rva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2FwaUtleVxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9hY2Nlc3NUb2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9yZWZyZXNoVG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY2xpZW50U2VjcmV0XFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NsaWVudElkXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NsaWVudFRva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgLyhbYS16QS1aMC05X10qa2V5W2EtekEtWjAtOV9dKilcXHMqOlxccyooPzpbJ1wiXSk/KFteJ1wiXSspKD86WydcIl0pPy9naSxcbiAgICAgICAgICAgIC8oW2EtekEtWjAtOV9dKnRva2VuW2EtekEtWjAtOV9dKilcXHMqOlxccyooPzpbJ1wiXSk/KFteJ1wiXSspKD86WydcIl0pPy9naSxcbiAgICAgICAgICAgIC9QUklWQVRFIEtFWS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgL0NFUlRJRklDQVRFLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvQkVHSU4gUFJJVkFURSBLRVktLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC9CRUdJTiBDRVJUSUZJQ0FURS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgLyg/OmtleXxwcml2YXRlS2V5fHB1YmxpY0tleXxjZXJ0aWZpY2F0ZSlcXHMqOlxccyooW1xcc1xcU10qPykoPzpcXG5cXHMqXFxufFxcblxccypbYS16QS1aXXxcXG5cXHMqJHwkKS9naSxcbiAgICAgICAgXSxcbiAgICAgICAgLi4uX29wdGlvbnMsXG4gICAgICAgIC8vIGVuc3VyZSBtaW4gbG9nIGxldmVsIGlzIGFsd2F5cyB0aGVyZVxuICAgICAgICBtaW5MZXZlbDogX29wdGlvbnMubWluTGV2ZWwgPz8gbG9nTGV2ZWwsXG5cbiAgICB9KTtcblxuICAgIGxvZ2dlci5hdHRhY2hUcmFuc3BvcnQobG9ndHJhaWxUcmFuc3BvcnQpO1xuXG4gICAgYXR0YWNoQ29ycmVsYXRpb25JZFRvTWV0YShsb2dnZXIpO1xuXG4gICAgLy8gTW9kZSAnd2Fybi1lcnJvcic6IGNhcHR1cmUgc291cmNlIHBvc2l0aW9uIE9OTFkgZm9yIHdhcm4vZXJyb3IvZmF0YWwgKHRoZSBjdWxwcml0cyB3b3J0aCBwaW5uaW5nKSxcbiAgICAvLyBzbyBpbmZvL2RlYnVnIGhvdCBwYXRocyBwYXkgbm90aGluZy4gSW5qZWN0ZWQgYXMgYSBgX3NyY2xvY2AgYXJnIHRoYXQgdGhlIGZvcndhcmRlciBsaWZ0cyBpbnRvXG4gICAgLy8gY29kZUZpbGUvY29kZUxpbmUgKGFuZCBzdHJpcHMgZnJvbSB0aGUgc2hpcHBlZCBtZXNzYWdlKS5cbiAgICBpZiAoU09VUkNFX1BPU0lUSU9OX01PREUgPT09ICd3YXJuLWVycm9yJykge1xuICAgICAgICBmb3IgKGNvbnN0IGx2bCBvZiBbICd3YXJuJywgJ2Vycm9yJywgJ2ZhdGFsJyBdIGFzIGNvbnN0KSB7XG4gICAgICAgICAgICBjb25zdCBvcmlnID0gKGxvZ2dlciBhcyBhbnkpWyBsdmwgXS5iaW5kKGxvZ2dlcik7XG4gICAgICAgICAgICAobG9nZ2VyIGFzIGFueSlbIGx2bCBdID0gKC4uLmFyZ3M6IGFueVtdKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbG9jID0gY2FwdHVyZVNyY0xvYygpO1xuICAgICAgICAgICAgICAgIHJldHVybiBsb2MgPyBvcmlnKC4uLmFyZ3MsIHsgX3NyY2xvYzogbG9jIH0pIDogb3JpZyguLi5hcmdzKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9nZ2VyO1xufVxuXG4vKipcbiAqIEVucmljaCBldmVyeSBsb2cgbGluZSdzIHN0cnVjdHVyZWQgYF9tZXRhYCB3aXRoIHRoZSBjdXJyZW50IHJlcXVlc3Qtc2NvcGVkXG4gKiBgY29ycmVsYXRpb25JZGAgKHdoZW4gYW4gRXhlY3V0aW9uQ29udGV4dCBpcyBhY3RpdmUpLiBUaGlzIHJ1bnMgKmJlZm9yZSogdHNsb2dcbiAqIGVtaXRzIHRoZSBKU09OIGxvZyB0byB0aGUgY29uc29sZSwgc28gZG93bnN0cmVhbSBmb3J3YXJkZXJzIHRoYXQgbGlmdCBgX21ldGFgXG4gKiBzaGlwIGBjb3JyZWxhdGlvbklkYCBhcyBhIGZpcnN0LWNsYXNzIGZpZWxkIGFsb25nc2lkZSB0aGUgZXhpc3RpbmcgYHJlcXVlc3RJZGAuXG4gKlxuICogYGNvcnJlbGF0aW9uSWRgIGlzIHRoZSBzaW5nbGUgaWQgZncyNCBhbHJlYWR5IHByb3BhZ2F0ZXMgZW5kLXRvLWVuZCBhY3Jvc3NcbiAqIGV2ZXJ5IGhvcCDigJQgb3ZlciBIVFRQIChgeC1jb3JyZWxhdGlvbi1pZGAgLyBXM0MgYHRyYWNlcGFyZW50YCkgYW5kIG92ZXJcbiAqIFNRUy9TTlMvRXZlbnRCcmlkZ2UgKG1lc3NhZ2UgYXR0cmlidXRlcykuIFN0YW1waW5nIGl0IG9udG8gZXZlcnkgbG9nIGxpbmUgbGV0c1xuICogTG9ndHJhaWwgc3RpdGNoIGEgcmVxdWVzdCBhY3Jvc3Mgc2VydmljZXMgdXNpbmcgb25lIGZpZWxkIHRoYXQgaXMgcHJlc2VudCBvblxuICogQUxMIGVudHJ5IHBvaW50cyAoQVBJLCBTUVMsIHRhc2ssIG1haWwpLCBlYWNoIG9mIHdoaWNoIGVzdGFibGlzaGVzIHRoZVxuICogRXhlY3V0aW9uQ29udGV4dCB2aWEgYHJ1bldpdGhFeGVjdXRpb25Db250ZXh0YC5cbiAqXG4gKiBCYWNrd2FyZC1jb21wYXRpYmxlOiBhIGNvbXBsZXRlIG5vLW9wIHdoZW4gbm8gRXhlY3V0aW9uQ29udGV4dCBpcyBlc3RhYmxpc2hlZFxuICogKGxvZ3Mgc2ltcGx5IGNhcnJ5IG5vIGBjb3JyZWxhdGlvbklkYCkuIFRoZSBleGlzdGluZyBgcmVxdWVzdElkYCDigJQgc3VyZmFjZWQgYnlcbiAqIHRoZSBmb3J3YXJkZXIgZnJvbSB0aGUgQVdTIExhbWJkYSBsb2cgcHJlZml4IOKAlCBpcyB1bnRvdWNoZWQuXG4gKlxuICogTWVjaGFuaXNtOiB0c2xvZyByZWFkcyBgc2V0dGluZ3Mub3ZlcndyaXRlLmFkZE1ldGFgIGZyZXNoIG9uIGV2ZXJ5IGBsb2coKWBcbiAqIGNhbGwuIFdlIGRlbGVnYXRlIHRvIHRoZSBsb2dnZXIncyBvd24gZGVmYXVsdCBtZXRhIGJ1aWxkZXIgYW5kIHRoZW4gc3RhbXAgdGhlXG4gKiBhbWJpZW50IGBjb3JyZWxhdGlvbklkYCBvbnRvIHRoZSBwcm9kdWNlZCBgX21ldGFgLlxuICovXG5mdW5jdGlvbiBhdHRhY2hDb3JyZWxhdGlvbklkVG9NZXRhKGxvZ2dlcjogTG9nZ2VyPElMb2dPYmo+KTogdm9pZCB7XG4gICAgY29uc3QgYW55TG9nZ2VyID0gbG9nZ2VyIGFzIHVua25vd24gYXMge1xuICAgICAgICBfYWRkTWV0YVRvTG9nT2JqOiAobG9nT2JqOiBJTG9nT2JqLCBsb2dMZXZlbElkOiBudW1iZXIsIGxvZ0xldmVsTmFtZTogc3RyaW5nKSA9PiBhbnk7XG4gICAgfTtcbiAgICBpZiAodHlwZW9mIGFueUxvZ2dlci5fYWRkTWV0YVRvTG9nT2JqICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIERlZmVuc2l2ZTogdHNsb2cgaW50ZXJuYWxzIGNoYW5nZWQg4oCUIHNraXAgZW5yaWNobWVudCByYXRoZXIgdGhhbiBicmVhayBsb2dnaW5nLlxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbWV0YVByb3BlcnR5ID0gKGxvZ2dlci5zZXR0aW5ncyBhcyB7IG1ldGFQcm9wZXJ0eT86IHN0cmluZyB9KS5tZXRhUHJvcGVydHkgfHwgJ19tZXRhJztcbiAgICBjb25zdCBiYXNlQWRkTWV0YSA9IGFueUxvZ2dlci5fYWRkTWV0YVRvTG9nT2JqLmJpbmQobG9nZ2VyKTtcblxuICAgIGxvZ2dlci5zZXR0aW5ncy5vdmVyd3JpdGUgPSB7XG4gICAgICAgIC4uLmxvZ2dlci5zZXR0aW5ncy5vdmVyd3JpdGUsXG4gICAgICAgIGFkZE1ldGE6IChsb2dPYmo6IElMb2dPYmosIGxvZ0xldmVsSWQ6IG51bWJlciwgbG9nTGV2ZWxOYW1lOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdpdGhNZXRhID0gYmFzZUFkZE1ldGEobG9nT2JqLCBsb2dMZXZlbElkLCBsb2dMZXZlbE5hbWUpO1xuICAgICAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk/LmNvcnJlbGF0aW9uSWQ7XG4gICAgICAgICAgICBjb25zdCBtZXRhID0gd2l0aE1ldGE/LlsgbWV0YVByb3BlcnR5IF07XG4gICAgICAgICAgICBpZiAoY29ycmVsYXRpb25JZCAmJiBtZXRhICYmIHR5cGVvZiBtZXRhID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIG1ldGEuY29ycmVsYXRpb25JZCA9IGNvcnJlbGF0aW9uSWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gd2l0aE1ldGE7XG4gICAgICAgIH0sXG4gICAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IERlZmF1bHRMb2dnZXI6IElMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ1sqXScpO1xuXG5leHBvcnQge1xuICAgIExvZ0R1cmF0aW9uXG59IGZyb20gJy4uL2RlY29yYXRvcnMvbG9nLWR1cmF0aW9uJztcblxuZXhwb3J0IHtcbiAgICBsb2d0cmFpbFRyYW5zcG9ydCxcbiAgICByZXNvbHZlTG9ndHJhaWxWZWN0b3JJbmdlc3QsXG4gICAgc2V0TG9ndHJhaWxWZWN0b3JJbmdlc3QsXG4gICAgc2hpcExvZ3RyYWlsVmVjdG9ySnNvbixcbiAgICB0eXBlIExvZ3RyYWlsVmVjdG9ySW5nZXN0Q29uZmlnLFxufSBmcm9tICcuL2xvZ3RyYWlsJztcbiJdfQ==