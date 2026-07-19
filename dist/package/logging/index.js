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
const createLogger = (_options, _logLevel) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxpQ0FBd0Q7QUFDeEQseUNBQStDO0FBQy9DLDRFQUE0RTtBQUM1RSwyRUFBMkU7QUFDM0UsdUVBQXVGO0FBS3ZGLE1BQU0sU0FBUyxHQUFRO0lBQ25CLE9BQU8sRUFBRSxDQUFDO0lBQ1YsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsQ0FBQztJQUNWLE1BQU0sRUFBRSxDQUFDO0lBQ1QsTUFBTSxFQUFFLENBQUM7SUFDVCxPQUFPLEVBQUUsQ0FBQztJQUNWLE9BQU8sRUFBRSxDQUFDO0NBQ2IsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFFLENBQUM7QUFFdkUsTUFBTSxZQUFZLEdBQUcsQ0FBQyxRQUFxRCxFQUFFLFNBQXFDLEVBQUUsRUFBRTtJQUV6SCxTQUFTLEdBQUcsU0FBUyxJQUFJLFFBQVEsQ0FBQztJQUVsQyxJQUFJLE9BQU8sUUFBUSxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQ2hDLFFBQVEsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFJLE9BQU8sUUFBUSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzlCLFFBQVEsR0FBRyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxDQUFDO0lBQ3RELENBQUM7SUFFRCw0Q0FBNEM7SUFDNUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDekQsUUFBUSxDQUFDLDRCQUE0QixHQUFHLElBQUksQ0FBQztJQUNqRCxDQUFDO0lBRUQsa0JBQWtCO0lBQ2xCLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUM5QixRQUFRLENBQUMsaUJBQWlCLEdBQUcsT0FBTyxDQUFDO0lBQ3pDLENBQUM7SUFFRCxNQUFNLE1BQU0sR0FBRyxJQUFJLGNBQU0sQ0FBQztRQUN0QixlQUFlLEVBQUUsS0FBSztRQUN0QixnQkFBZ0IsRUFBRSxDQUFFLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsY0FBYyxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxXQUFXLENBQUU7UUFDckwsK0JBQStCLEVBQUUsSUFBSTtRQUNyQyxlQUFlLEVBQUU7WUFDYiwyQkFBMkI7WUFDM0Isa0NBQWtDO1lBQ2xDLHlCQUF5QjtZQUN6Qix3QkFBd0I7WUFDeEIseUJBQXlCO1lBQ3pCLDhCQUE4QjtZQUM5QiwrQkFBK0I7WUFDL0IsK0JBQStCO1lBQy9CLDJCQUEyQjtZQUMzQiw4QkFBOEI7WUFDOUIsb0VBQW9FO1lBQ3BFLHNFQUFzRTtZQUN0RSwrQ0FBK0M7WUFDL0MsK0NBQStDO1lBQy9DLHFEQUFxRDtZQUNyRCxxREFBcUQ7WUFDckQsK0ZBQStGO1NBQ2xHO1FBQ0QsR0FBRyxRQUFRO1FBQ1gsdUNBQXVDO1FBQ3ZDLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxJQUFJLFFBQVE7S0FFMUMsQ0FBQyxDQUFDO0lBRUgsTUFBTSxDQUFDLGVBQWUsQ0FBQyw0QkFBaUIsQ0FBQyxDQUFDO0lBRTFDLHlCQUF5QixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBRWxDLE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUMsQ0FBQTtBQXhEWSxRQUFBLFlBQVksZ0JBd0R4QjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILFNBQVMseUJBQXlCLENBQUMsTUFBdUI7SUFDdEQsTUFBTSxTQUFTLEdBQUcsTUFFakIsQ0FBQztJQUNGLElBQUksT0FBTyxTQUFTLENBQUMsZ0JBQWdCLEtBQUssVUFBVSxFQUFFLENBQUM7UUFDbkQsa0ZBQWtGO1FBQ2xGLE9BQU87SUFDWCxDQUFDO0lBRUQsTUFBTSxZQUFZLEdBQUksTUFBTSxDQUFDLFFBQXNDLENBQUMsWUFBWSxJQUFJLE9BQU8sQ0FBQztJQUM1RixNQUFNLFdBQVcsR0FBRyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBRTVELE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxHQUFHO1FBQ3hCLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTO1FBQzVCLE9BQU8sRUFBRSxDQUFDLE1BQWUsRUFBRSxVQUFrQixFQUFFLFlBQW9CLEVBQUUsRUFBRTtZQUNuRSxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxZQUFZLENBQUMsQ0FBQztZQUMvRCxNQUFNLGFBQWEsR0FBRyxJQUFBLG9DQUEwQixHQUFFLEVBQUUsYUFBYSxDQUFDO1lBQ2xFLE1BQU0sSUFBSSxHQUFHLFFBQVEsRUFBRSxDQUFFLFlBQVksQ0FBRSxDQUFDO1lBQ3hDLElBQUksYUFBYSxJQUFJLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDcEQsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUM7WUFDdkMsQ0FBQztZQUNELE9BQU8sUUFBUSxDQUFDO1FBQ3BCLENBQUM7S0FDSixDQUFDO0FBQ04sQ0FBQztBQUVZLFFBQUEsYUFBYSxHQUFZLElBQUEsb0JBQVksRUFBQyxLQUFLLENBQUMsQ0FBQztBQUUxRCwyREFFb0M7QUFEaEMsMkdBQUEsV0FBVyxPQUFBO0FBR2YsdUNBTW9CO0FBTGhCLDZHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHVIQUFBLDJCQUEyQixPQUFBO0FBQzNCLG1IQUFBLHVCQUF1QixPQUFBO0FBQ3ZCLGtIQUFBLHNCQUFzQixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTG9nZ2VyLCBJTG9nT2JqLCBJU2V0dGluZ3NQYXJhbSB9IGZyb20gXCJ0c2xvZ1wiO1xuaW1wb3J0IHsgbG9ndHJhaWxUcmFuc3BvcnQgfSBmcm9tIFwiLi9sb2d0cmFpbFwiO1xuLy8gSW1wb3J0IHRoZSBjb25jcmV0ZSBsZWFmIG1vZHVsZSAobm90IHRoZSBiYXJyZWwpIHRvIGtlZXAgdGhpcyBjeWNsZS1mcmVlOlxuLy8gZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZSdzIG9ubHkgcnVudGltZSBkZXBlbmRlbmN5IGlzIG5vZGU6YXN5bmNfaG9va3MuXG5pbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCB9IGZyb20gXCIuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZVwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIElMb2dnZXIgZXh0ZW5kcyBMb2dnZXI8SUxvZ09iaj4ge1xufVxuXG5jb25zdCBsb2dMZXZlbHM6IGFueSA9IHtcbiAgICBcInNpbGx5XCI6IDAsXG4gICAgXCJ0cmFjZVwiOiAxLFxuICAgIFwiZGVidWdcIjogMixcbiAgICBcImluZm9cIjogMyxcbiAgICBcIndhcm5cIjogNCxcbiAgICBcImVycm9yXCI6IDUsXG4gICAgXCJmYXRhbFwiOiA2LFxufTtcblxuY29uc3QgbG9nTGV2ZWwgPSBsb2dMZXZlbHNbIChwcm9jZXNzLmVudi5MT0dfTEVWRUwgfHwgJ2luZm8nKS50b0xvd2VyQ2FzZSgpIF07XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoX29wdGlvbnM6IHN0cmluZyB8IEZ1bmN0aW9uIHwgSVNldHRpbmdzUGFyYW08SUxvZ09iaj4sIF9sb2dMZXZlbD86IDAgfCAxIHwgMiB8IDMgfCA0IHwgNSB8IDYpID0+IHtcblxuICAgIF9sb2dMZXZlbCA9IF9sb2dMZXZlbCA/PyBsb2dMZXZlbDtcblxuICAgIGlmICh0eXBlb2YgX29wdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBfb3B0aW9ucyA9IF9vcHRpb25zLm5hbWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBfb3B0aW9ucyA9PSAnc3RyaW5nJykge1xuICAgICAgICBfb3B0aW9ucyA9IHsgbmFtZTogX29wdGlvbnMsIG1pbkxldmVsOiBsb2dMZXZlbCB9O1xuICAgIH1cblxuICAgIC8vIHNob3cgbGluZSBudW1iZXIgb25seSBmb3IgZGVidWcgYW5kIHRyYWNlXG4gICAgaWYgKCFfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uICYmIGxvZ0xldmVsID4gMikge1xuICAgICAgICBfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGltZSBmb3JtYXRcbiAgICBpZiAoIV9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lKSB7XG4gICAgICAgIF9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lID0gJ2xvY2FsJztcbiAgICB9XG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgICAgc3R5bGVQcmV0dHlMb2dzOiBmYWxzZSxcbiAgICAgICAgbWFza1ZhbHVlc09mS2V5czogWyAncGFzc3dvcmQnLCAnY29uZmlybVBhc3N3b3JkJywgJ3NlY3JldCcsICd0b2tlbicsICdhcGlLZXknLCAnYWNjZXNzVG9rZW4nLCAncmVmcmVzaFRva2VuJywgJ2NsaWVudFNlY3JldCcsICdjbGllbnRJZCcsICdjbGllbnRUb2tlbicsICdjbGllbnRDb2RlJywgJ2NsaWVudEtleScgXSxcbiAgICAgICAgbWFza1ZhbHVlc09mS2V5c0Nhc2VJbnNlbnNpdGl2ZTogdHJ1ZSxcbiAgICAgICAgbWFza1ZhbHVlc1JlZ0V4OiBbXG4gICAgICAgICAgICAvcGFzc3dvcmRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY29uZmlybVBhc3N3b3JkXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL3NlY3JldFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC90b2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9hcGlLZXlcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvYWNjZXNzVG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvcmVmcmVzaFRva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NsaWVudFNlY3JldFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRJZFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRUb2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC8oW2EtekEtWjAtOV9dKmtleVthLXpBLVowLTlfXSopXFxzKjpcXHMqKD86WydcIl0pPyhbXidcIl0rKSg/OlsnXCJdKT8vZ2ksXG4gICAgICAgICAgICAvKFthLXpBLVowLTlfXSp0b2tlblthLXpBLVowLTlfXSopXFxzKjpcXHMqKD86WydcIl0pPyhbXidcIl0rKSg/OlsnXCJdKT8vZ2ksXG4gICAgICAgICAgICAvUFJJVkFURSBLRVktLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC9DRVJUSUZJQ0FURS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgL0JFR0lOIFBSSVZBVEUgS0VZLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvQkVHSU4gQ0VSVElGSUNBVEUtLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC8oPzprZXl8cHJpdmF0ZUtleXxwdWJsaWNLZXl8Y2VydGlmaWNhdGUpXFxzKjpcXHMqKFtcXHNcXFNdKj8pKD86XFxuXFxzKlxcbnxcXG5cXHMqW2EtekEtWl18XFxuXFxzKiR8JCkvZ2ksXG4gICAgICAgIF0sXG4gICAgICAgIC4uLl9vcHRpb25zLFxuICAgICAgICAvLyBlbnN1cmUgbWluIGxvZyBsZXZlbCBpcyBhbHdheXMgdGhlcmVcbiAgICAgICAgbWluTGV2ZWw6IF9vcHRpb25zLm1pbkxldmVsID8/IGxvZ0xldmVsLFxuXG4gICAgfSk7XG5cbiAgICBsb2dnZXIuYXR0YWNoVHJhbnNwb3J0KGxvZ3RyYWlsVHJhbnNwb3J0KTtcblxuICAgIGF0dGFjaENvcnJlbGF0aW9uSWRUb01ldGEobG9nZ2VyKTtcblxuICAgIHJldHVybiBsb2dnZXI7XG59XG5cbi8qKlxuICogRW5yaWNoIGV2ZXJ5IGxvZyBsaW5lJ3Mgc3RydWN0dXJlZCBgX21ldGFgIHdpdGggdGhlIGN1cnJlbnQgcmVxdWVzdC1zY29wZWRcbiAqIGBjb3JyZWxhdGlvbklkYCAod2hlbiBhbiBFeGVjdXRpb25Db250ZXh0IGlzIGFjdGl2ZSkuIFRoaXMgcnVucyAqYmVmb3JlKiB0c2xvZ1xuICogZW1pdHMgdGhlIEpTT04gbG9nIHRvIHRoZSBjb25zb2xlLCBzbyBkb3duc3RyZWFtIGZvcndhcmRlcnMgdGhhdCBsaWZ0IGBfbWV0YWBcbiAqIHNoaXAgYGNvcnJlbGF0aW9uSWRgIGFzIGEgZmlyc3QtY2xhc3MgZmllbGQgYWxvbmdzaWRlIHRoZSBleGlzdGluZyBgcmVxdWVzdElkYC5cbiAqXG4gKiBgY29ycmVsYXRpb25JZGAgaXMgdGhlIHNpbmdsZSBpZCBmdzI0IGFscmVhZHkgcHJvcGFnYXRlcyBlbmQtdG8tZW5kIGFjcm9zc1xuICogZXZlcnkgaG9wIOKAlCBvdmVyIEhUVFAgKGB4LWNvcnJlbGF0aW9uLWlkYCAvIFczQyBgdHJhY2VwYXJlbnRgKSBhbmQgb3ZlclxuICogU1FTL1NOUy9FdmVudEJyaWRnZSAobWVzc2FnZSBhdHRyaWJ1dGVzKS4gU3RhbXBpbmcgaXQgb250byBldmVyeSBsb2cgbGluZSBsZXRzXG4gKiBMb2d0cmFpbCBzdGl0Y2ggYSByZXF1ZXN0IGFjcm9zcyBzZXJ2aWNlcyB1c2luZyBvbmUgZmllbGQgdGhhdCBpcyBwcmVzZW50IG9uXG4gKiBBTEwgZW50cnkgcG9pbnRzIChBUEksIFNRUywgdGFzaywgbWFpbCksIGVhY2ggb2Ygd2hpY2ggZXN0YWJsaXNoZXMgdGhlXG4gKiBFeGVjdXRpb25Db250ZXh0IHZpYSBgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRgLlxuICpcbiAqIEJhY2t3YXJkLWNvbXBhdGlibGU6IGEgY29tcGxldGUgbm8tb3Agd2hlbiBubyBFeGVjdXRpb25Db250ZXh0IGlzIGVzdGFibGlzaGVkXG4gKiAobG9ncyBzaW1wbHkgY2Fycnkgbm8gYGNvcnJlbGF0aW9uSWRgKS4gVGhlIGV4aXN0aW5nIGByZXF1ZXN0SWRgIOKAlCBzdXJmYWNlZCBieVxuICogdGhlIGZvcndhcmRlciBmcm9tIHRoZSBBV1MgTGFtYmRhIGxvZyBwcmVmaXgg4oCUIGlzIHVudG91Y2hlZC5cbiAqXG4gKiBNZWNoYW5pc206IHRzbG9nIHJlYWRzIGBzZXR0aW5ncy5vdmVyd3JpdGUuYWRkTWV0YWAgZnJlc2ggb24gZXZlcnkgYGxvZygpYFxuICogY2FsbC4gV2UgZGVsZWdhdGUgdG8gdGhlIGxvZ2dlcidzIG93biBkZWZhdWx0IG1ldGEgYnVpbGRlciBhbmQgdGhlbiBzdGFtcCB0aGVcbiAqIGFtYmllbnQgYGNvcnJlbGF0aW9uSWRgIG9udG8gdGhlIHByb2R1Y2VkIGBfbWV0YWAuXG4gKi9cbmZ1bmN0aW9uIGF0dGFjaENvcnJlbGF0aW9uSWRUb01ldGEobG9nZ2VyOiBMb2dnZXI8SUxvZ09iaj4pOiB2b2lkIHtcbiAgICBjb25zdCBhbnlMb2dnZXIgPSBsb2dnZXIgYXMgdW5rbm93biBhcyB7XG4gICAgICAgIF9hZGRNZXRhVG9Mb2dPYmo6IChsb2dPYmo6IElMb2dPYmosIGxvZ0xldmVsSWQ6IG51bWJlciwgbG9nTGV2ZWxOYW1lOiBzdHJpbmcpID0+IGFueTtcbiAgICB9O1xuICAgIGlmICh0eXBlb2YgYW55TG9nZ2VyLl9hZGRNZXRhVG9Mb2dPYmogIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gRGVmZW5zaXZlOiB0c2xvZyBpbnRlcm5hbHMgY2hhbmdlZCDigJQgc2tpcCBlbnJpY2htZW50IHJhdGhlciB0aGFuIGJyZWFrIGxvZ2dpbmcuXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRhUHJvcGVydHkgPSAobG9nZ2VyLnNldHRpbmdzIGFzIHsgbWV0YVByb3BlcnR5Pzogc3RyaW5nIH0pLm1ldGFQcm9wZXJ0eSB8fCAnX21ldGEnO1xuICAgIGNvbnN0IGJhc2VBZGRNZXRhID0gYW55TG9nZ2VyLl9hZGRNZXRhVG9Mb2dPYmouYmluZChsb2dnZXIpO1xuXG4gICAgbG9nZ2VyLnNldHRpbmdzLm92ZXJ3cml0ZSA9IHtcbiAgICAgICAgLi4ubG9nZ2VyLnNldHRpbmdzLm92ZXJ3cml0ZSxcbiAgICAgICAgYWRkTWV0YTogKGxvZ09iajogSUxvZ09iaiwgbG9nTGV2ZWxJZDogbnVtYmVyLCBsb2dMZXZlbE5hbWU6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2l0aE1ldGEgPSBiYXNlQWRkTWV0YShsb2dPYmosIGxvZ0xldmVsSWQsIGxvZ0xldmVsTmFtZSk7XG4gICAgICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKT8uY29ycmVsYXRpb25JZDtcbiAgICAgICAgICAgIGNvbnN0IG1ldGEgPSB3aXRoTWV0YT8uWyBtZXRhUHJvcGVydHkgXTtcbiAgICAgICAgICAgIGlmIChjb3JyZWxhdGlvbklkICYmIG1ldGEgJiYgdHlwZW9mIG1ldGEgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgbWV0YS5jb3JyZWxhdGlvbklkID0gY29ycmVsYXRpb25JZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB3aXRoTWV0YTtcbiAgICAgICAgfSxcbiAgICB9O1xufVxuXG5leHBvcnQgY29uc3QgRGVmYXVsdExvZ2dlcjogSUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignWypdJyk7XG5cbmV4cG9ydCB7XG4gICAgTG9nRHVyYXRpb25cbn0gZnJvbSAnLi4vZGVjb3JhdG9ycy9sb2ctZHVyYXRpb24nO1xuXG5leHBvcnQge1xuICAgIGxvZ3RyYWlsVHJhbnNwb3J0LFxuICAgIHJlc29sdmVMb2d0cmFpbFZlY3RvckluZ2VzdCxcbiAgICBzZXRMb2d0cmFpbFZlY3RvckluZ2VzdCxcbiAgICBzaGlwTG9ndHJhaWxWZWN0b3JKc29uLFxuICAgIHR5cGUgTG9ndHJhaWxWZWN0b3JJbmdlc3RDb25maWcsXG59IGZyb20gJy4vbG9ndHJhaWwnO1xuIl19