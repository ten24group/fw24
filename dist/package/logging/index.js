"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogDuration = exports.DefaultLogger = exports.createLogger = void 0;
const tslog_1 = require("tslog");
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
        maskValuesOfKeys: ['password', 'confirmPassword', 'secret', 'token', 'apiKey', 'accessToken', 'refreshToken', 'clientSecret', 'clientId', 'clientToken', 'clientCode', 'clientKey', 'clientSecret', 'clientId', 'clientToken', 'clientCode', 'clientKey'],
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
    return logger;
};
exports.createLogger = createLogger;
exports.DefaultLogger = (0, exports.createLogger)('[*]');
var log_duration_1 = require("../decorators/log-duration");
Object.defineProperty(exports, "LogDuration", { enumerable: true, get: function () { return log_duration_1.LogDuration; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxpQ0FBd0Q7QUFLeEQsTUFBTSxTQUFTLEdBQVE7SUFDbkIsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsQ0FBQztJQUNWLE9BQU8sRUFBRSxDQUFDO0lBQ1YsTUFBTSxFQUFFLENBQUM7SUFDVCxNQUFNLEVBQUUsQ0FBQztJQUNULE9BQU8sRUFBRSxDQUFDO0lBQ1YsT0FBTyxFQUFFLENBQUM7Q0FDYixDQUFDO0FBRUYsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUUsQ0FBQztBQUV2RSxNQUFNLFlBQVksR0FBRyxDQUFDLFFBQXFELEVBQUUsU0FBcUMsRUFBRSxFQUFFO0lBRXpILFNBQVMsR0FBRyxTQUFTLElBQUksUUFBUSxDQUFDO0lBRWxDLElBQUksT0FBTyxRQUFRLElBQUksVUFBVSxFQUFFLENBQUM7UUFDaEMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDN0IsQ0FBQztJQUVELElBQUksT0FBTyxRQUFRLElBQUksUUFBUSxFQUFFLENBQUM7UUFDOUIsUUFBUSxHQUFHLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLENBQUM7SUFDdEQsQ0FBQztJQUVELDRDQUE0QztJQUM1QyxJQUFJLENBQUMsUUFBUSxDQUFDLDRCQUE0QixJQUFJLFFBQVEsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN6RCxRQUFRLENBQUMsNEJBQTRCLEdBQUcsSUFBSSxDQUFDO0lBQ2pELENBQUM7SUFFRCxrQkFBa0I7SUFDbEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQzlCLFFBQVEsQ0FBQyxpQkFBaUIsR0FBRyxPQUFPLENBQUM7SUFDekMsQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLElBQUksY0FBTSxDQUFDO1FBQ3RCLGVBQWUsRUFBRSxLQUFLO1FBQ3RCLGdCQUFnQixFQUFFLENBQUUsVUFBVSxFQUFFLGlCQUFpQixFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBRSxjQUFjLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFFO1FBQzNQLCtCQUErQixFQUFFLElBQUk7UUFDckMsZUFBZSxFQUFFO1lBQ2IsMkJBQTJCO1lBQzNCLGtDQUFrQztZQUNsQyx5QkFBeUI7WUFDekIsd0JBQXdCO1lBQ3hCLHlCQUF5QjtZQUN6Qiw4QkFBOEI7WUFDOUIsK0JBQStCO1lBQy9CLCtCQUErQjtZQUMvQiwyQkFBMkI7WUFDM0IsOEJBQThCO1lBQzlCLG9FQUFvRTtZQUNwRSxzRUFBc0U7WUFDdEUsK0NBQStDO1lBQy9DLCtDQUErQztZQUMvQyxxREFBcUQ7WUFDckQscURBQXFEO1lBQ3JELCtGQUErRjtTQUNsRztRQUNELEdBQUcsUUFBUTtRQUNYLHVDQUF1QztRQUN2QyxRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVEsSUFBSSxRQUFRO0tBQzFDLENBQUMsQ0FBQztJQUVILE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUMsQ0FBQTtBQW5EWSxRQUFBLFlBQVksZ0JBbUR4QjtBQUVZLFFBQUEsYUFBYSxHQUFZLElBQUEsb0JBQVksRUFBQyxLQUFLLENBQUMsQ0FBQztBQUUxRCwyREFFb0M7QUFEaEMsMkdBQUEsV0FBVyxPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTG9nZ2VyLCBJTG9nT2JqLCBJU2V0dGluZ3NQYXJhbSB9IGZyb20gXCJ0c2xvZ1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIElMb2dnZXIgZXh0ZW5kcyBMb2dnZXI8SUxvZ09iaj4ge1xufVxuXG5jb25zdCBsb2dMZXZlbHM6IGFueSA9IHtcbiAgICBcInNpbGx5XCI6IDAsXG4gICAgXCJ0cmFjZVwiOiAxLFxuICAgIFwiZGVidWdcIjogMixcbiAgICBcImluZm9cIjogMyxcbiAgICBcIndhcm5cIjogNCxcbiAgICBcImVycm9yXCI6IDUsXG4gICAgXCJmYXRhbFwiOiA2LFxufTtcblxuY29uc3QgbG9nTGV2ZWwgPSBsb2dMZXZlbHNbIChwcm9jZXNzLmVudi5MT0dfTEVWRUwgfHwgJ2luZm8nKS50b0xvd2VyQ2FzZSgpIF07XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoX29wdGlvbnM6IHN0cmluZyB8IEZ1bmN0aW9uIHwgSVNldHRpbmdzUGFyYW08SUxvZ09iaj4sIF9sb2dMZXZlbD86IDAgfCAxIHwgMiB8IDMgfCA0IHwgNSB8IDYpID0+IHtcblxuICAgIF9sb2dMZXZlbCA9IF9sb2dMZXZlbCA/PyBsb2dMZXZlbDtcblxuICAgIGlmICh0eXBlb2YgX29wdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBfb3B0aW9ucyA9IF9vcHRpb25zLm5hbWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBfb3B0aW9ucyA9PSAnc3RyaW5nJykge1xuICAgICAgICBfb3B0aW9ucyA9IHsgbmFtZTogX29wdGlvbnMsIG1pbkxldmVsOiBsb2dMZXZlbCB9O1xuICAgIH1cblxuICAgIC8vIHNob3cgbGluZSBudW1iZXIgb25seSBmb3IgZGVidWcgYW5kIHRyYWNlXG4gICAgaWYgKCFfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uICYmIGxvZ0xldmVsID4gMikge1xuICAgICAgICBfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGltZSBmb3JtYXRcbiAgICBpZiAoIV9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lKSB7XG4gICAgICAgIF9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lID0gJ2xvY2FsJztcbiAgICB9XG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgICAgc3R5bGVQcmV0dHlMb2dzOiBmYWxzZSxcbiAgICAgICAgbWFza1ZhbHVlc09mS2V5czogWyAncGFzc3dvcmQnLCAnY29uZmlybVBhc3N3b3JkJywgJ3NlY3JldCcsICd0b2tlbicsICdhcGlLZXknLCAnYWNjZXNzVG9rZW4nLCAncmVmcmVzaFRva2VuJywgJ2NsaWVudFNlY3JldCcsICdjbGllbnRJZCcsICdjbGllbnRUb2tlbicsICdjbGllbnRDb2RlJywgJ2NsaWVudEtleScsICdjbGllbnRTZWNyZXQnLCAnY2xpZW50SWQnLCAnY2xpZW50VG9rZW4nLCAnY2xpZW50Q29kZScsICdjbGllbnRLZXknIF0sXG4gICAgICAgIG1hc2tWYWx1ZXNPZktleXNDYXNlSW5zZW5zaXRpdmU6IHRydWUsXG4gICAgICAgIG1hc2tWYWx1ZXNSZWdFeDogW1xuICAgICAgICAgICAgL3Bhc3N3b3JkXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NvbmZpcm1QYXNzd29yZFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9zZWNyZXRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvdG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvYXBpS2V5XFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2FjY2Vzc1Rva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL3JlZnJlc2hUb2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRTZWNyZXRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY2xpZW50SWRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY2xpZW50VG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvKFthLXpBLVowLTlfXSprZXlbYS16QS1aMC05X10qKVxccyo6XFxzKig/OlsnXCJdKT8oW14nXCJdKykoPzpbJ1wiXSk/L2dpLFxuICAgICAgICAgICAgLyhbYS16QS1aMC05X10qdG9rZW5bYS16QS1aMC05X10qKVxccyo6XFxzKig/OlsnXCJdKT8oW14nXCJdKykoPzpbJ1wiXSk/L2dpLFxuICAgICAgICAgICAgL1BSSVZBVEUgS0VZLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvQ0VSVElGSUNBVEUtLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC9CRUdJTiBQUklWQVRFIEtFWS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgL0JFR0lOIENFUlRJRklDQVRFLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvKD86a2V5fHByaXZhdGVLZXl8cHVibGljS2V5fGNlcnRpZmljYXRlKVxccyo6XFxzKihbXFxzXFxTXSo/KSg/OlxcblxccypcXG58XFxuXFxzKlthLXpBLVpdfFxcblxccyokfCQpL2dpLFxuICAgICAgICBdLFxuICAgICAgICAuLi5fb3B0aW9ucyxcbiAgICAgICAgLy8gZW5zdXJlIG1pbiBsb2cgbGV2ZWwgaXMgYWx3YXlzIHRoZXJlXG4gICAgICAgIG1pbkxldmVsOiBfb3B0aW9ucy5taW5MZXZlbCA/PyBsb2dMZXZlbCxcbiAgICB9KTtcblxuICAgIHJldHVybiBsb2dnZXI7XG59XG5cbmV4cG9ydCBjb25zdCBEZWZhdWx0TG9nZ2VyOiBJTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdbKl0nKTtcblxuZXhwb3J0IHtcbiAgICBMb2dEdXJhdGlvblxufSBmcm9tICcuLi9kZWNvcmF0b3JzL2xvZy1kdXJhdGlvbic7Il19