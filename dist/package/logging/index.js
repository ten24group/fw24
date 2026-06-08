"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shipLogtrailVectorJson = exports.setLogtrailVectorIngest = exports.resolveLogtrailVectorIngest = exports.logtrailTransport = exports.LogDuration = exports.DefaultLogger = exports.createLogger = void 0;
const tslog_1 = require("tslog");
const logtrail_1 = require("./logtrail");
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
    return logger;
};
exports.createLogger = createLogger;
exports.DefaultLogger = (0, exports.createLogger)('[*]');
var log_duration_1 = require("../decorators/log-duration");
Object.defineProperty(exports, "LogDuration", { enumerable: true, get: function () { return log_duration_1.LogDuration; } });
var logtrail_2 = require("./logtrail");
Object.defineProperty(exports, "logtrailTransport", { enumerable: true, get: function () { return logtrail_2.logtrailTransport; } });
Object.defineProperty(exports, "resolveLogtrailVectorIngest", { enumerable: true, get: function () { return logtrail_2.resolveLogtrailVectorIngest; } });
Object.defineProperty(exports, "setLogtrailVectorIngest", { enumerable: true, get: function () { return logtrail_2.setLogtrailVectorIngest; } });
Object.defineProperty(exports, "shipLogtrailVectorJson", { enumerable: true, get: function () { return logtrail_2.shipLogtrailVectorJson; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxpQ0FBd0Q7QUFDeEQseUNBQStDO0FBSy9DLE1BQU0sU0FBUyxHQUFRO0lBQ25CLE9BQU8sRUFBRSxDQUFDO0lBQ1YsT0FBTyxFQUFFLENBQUM7SUFDVixPQUFPLEVBQUUsQ0FBQztJQUNWLE1BQU0sRUFBRSxDQUFDO0lBQ1QsTUFBTSxFQUFFLENBQUM7SUFDVCxPQUFPLEVBQUUsQ0FBQztJQUNWLE9BQU8sRUFBRSxDQUFDO0NBQ2IsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFFLENBQUM7QUFFdkUsTUFBTSxZQUFZLEdBQUcsQ0FBQyxRQUFxRCxFQUFFLFNBQXFDLEVBQUUsRUFBRTtJQUV6SCxTQUFTLEdBQUcsU0FBUyxJQUFJLFFBQVEsQ0FBQztJQUVsQyxJQUFJLE9BQU8sUUFBUSxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQ2hDLFFBQVEsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFJLE9BQU8sUUFBUSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzlCLFFBQVEsR0FBRyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxDQUFDO0lBQ3RELENBQUM7SUFFRCw0Q0FBNEM7SUFDNUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyw0QkFBNEIsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDekQsUUFBUSxDQUFDLDRCQUE0QixHQUFHLElBQUksQ0FBQztJQUNqRCxDQUFDO0lBRUQsa0JBQWtCO0lBQ2xCLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUM5QixRQUFRLENBQUMsaUJBQWlCLEdBQUcsT0FBTyxDQUFDO0lBQ3pDLENBQUM7SUFFRCxNQUFNLE1BQU0sR0FBRyxJQUFJLGNBQU0sQ0FBQztRQUN0QixlQUFlLEVBQUUsS0FBSztRQUN0QixnQkFBZ0IsRUFBRSxDQUFFLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsY0FBYyxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxXQUFXLENBQUU7UUFDckwsK0JBQStCLEVBQUUsSUFBSTtRQUNyQyxlQUFlLEVBQUU7WUFDYiwyQkFBMkI7WUFDM0Isa0NBQWtDO1lBQ2xDLHlCQUF5QjtZQUN6Qix3QkFBd0I7WUFDeEIseUJBQXlCO1lBQ3pCLDhCQUE4QjtZQUM5QiwrQkFBK0I7WUFDL0IsK0JBQStCO1lBQy9CLDJCQUEyQjtZQUMzQiw4QkFBOEI7WUFDOUIsb0VBQW9FO1lBQ3BFLHNFQUFzRTtZQUN0RSwrQ0FBK0M7WUFDL0MsK0NBQStDO1lBQy9DLHFEQUFxRDtZQUNyRCxxREFBcUQ7WUFDckQsK0ZBQStGO1NBQ2xHO1FBQ0QsR0FBRyxRQUFRO1FBQ1gsdUNBQXVDO1FBQ3ZDLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxJQUFJLFFBQVE7S0FFMUMsQ0FBQyxDQUFDO0lBRUgsTUFBTSxDQUFDLGVBQWUsQ0FBQyw0QkFBaUIsQ0FBQyxDQUFDO0lBRTFDLE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUMsQ0FBQTtBQXREWSxRQUFBLFlBQVksZ0JBc0R4QjtBQUVZLFFBQUEsYUFBYSxHQUFZLElBQUEsb0JBQVksRUFBQyxLQUFLLENBQUMsQ0FBQztBQUUxRCwyREFFb0M7QUFEaEMsMkdBQUEsV0FBVyxPQUFBO0FBR2YsdUNBTW9CO0FBTGhCLDZHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHVIQUFBLDJCQUEyQixPQUFBO0FBQzNCLG1IQUFBLHVCQUF1QixPQUFBO0FBQ3ZCLGtIQUFBLHNCQUFzQixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTG9nZ2VyLCBJTG9nT2JqLCBJU2V0dGluZ3NQYXJhbSB9IGZyb20gXCJ0c2xvZ1wiO1xuaW1wb3J0IHsgbG9ndHJhaWxUcmFuc3BvcnQgfSBmcm9tIFwiLi9sb2d0cmFpbFwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIElMb2dnZXIgZXh0ZW5kcyBMb2dnZXI8SUxvZ09iaj4ge1xufVxuXG5jb25zdCBsb2dMZXZlbHM6IGFueSA9IHtcbiAgICBcInNpbGx5XCI6IDAsXG4gICAgXCJ0cmFjZVwiOiAxLFxuICAgIFwiZGVidWdcIjogMixcbiAgICBcImluZm9cIjogMyxcbiAgICBcIndhcm5cIjogNCxcbiAgICBcImVycm9yXCI6IDUsXG4gICAgXCJmYXRhbFwiOiA2LFxufTtcblxuY29uc3QgbG9nTGV2ZWwgPSBsb2dMZXZlbHNbIChwcm9jZXNzLmVudi5MT0dfTEVWRUwgfHwgJ2luZm8nKS50b0xvd2VyQ2FzZSgpIF07XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVMb2dnZXIgPSAoX29wdGlvbnM6IHN0cmluZyB8IEZ1bmN0aW9uIHwgSVNldHRpbmdzUGFyYW08SUxvZ09iaj4sIF9sb2dMZXZlbD86IDAgfCAxIHwgMiB8IDMgfCA0IHwgNSB8IDYpID0+IHtcblxuICAgIF9sb2dMZXZlbCA9IF9sb2dMZXZlbCA/PyBsb2dMZXZlbDtcblxuICAgIGlmICh0eXBlb2YgX29wdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBfb3B0aW9ucyA9IF9vcHRpb25zLm5hbWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBfb3B0aW9ucyA9PSAnc3RyaW5nJykge1xuICAgICAgICBfb3B0aW9ucyA9IHsgbmFtZTogX29wdGlvbnMsIG1pbkxldmVsOiBsb2dMZXZlbCB9O1xuICAgIH1cblxuICAgIC8vIHNob3cgbGluZSBudW1iZXIgb25seSBmb3IgZGVidWcgYW5kIHRyYWNlXG4gICAgaWYgKCFfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uICYmIGxvZ0xldmVsID4gMikge1xuICAgICAgICBfb3B0aW9ucy5oaWRlTG9nUG9zaXRpb25Gb3JQcm9kdWN0aW9uID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGltZSBmb3JtYXRcbiAgICBpZiAoIV9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lKSB7XG4gICAgICAgIF9vcHRpb25zLnByZXR0eUxvZ1RpbWVab25lID0gJ2xvY2FsJztcbiAgICB9XG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgICAgc3R5bGVQcmV0dHlMb2dzOiBmYWxzZSxcbiAgICAgICAgbWFza1ZhbHVlc09mS2V5czogWyAncGFzc3dvcmQnLCAnY29uZmlybVBhc3N3b3JkJywgJ3NlY3JldCcsICd0b2tlbicsICdhcGlLZXknLCAnYWNjZXNzVG9rZW4nLCAncmVmcmVzaFRva2VuJywgJ2NsaWVudFNlY3JldCcsICdjbGllbnRJZCcsICdjbGllbnRUb2tlbicsICdjbGllbnRDb2RlJywgJ2NsaWVudEtleScgXSxcbiAgICAgICAgbWFza1ZhbHVlc09mS2V5c0Nhc2VJbnNlbnNpdGl2ZTogdHJ1ZSxcbiAgICAgICAgbWFza1ZhbHVlc1JlZ0V4OiBbXG4gICAgICAgICAgICAvcGFzc3dvcmRcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvY29uZmlybVBhc3N3b3JkXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL3NlY3JldFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC90b2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9hcGlLZXlcXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvYWNjZXNzVG9rZW5cXHMqOlxccyooW15cXHNdKykvZ2ksXG4gICAgICAgICAgICAvcmVmcmVzaFRva2VuXFxzKjpcXHMqKFteXFxzXSspL2dpLFxuICAgICAgICAgICAgL2NsaWVudFNlY3JldFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRJZFxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC9jbGllbnRUb2tlblxccyo6XFxzKihbXlxcc10rKS9naSxcbiAgICAgICAgICAgIC8oW2EtekEtWjAtOV9dKmtleVthLXpBLVowLTlfXSopXFxzKjpcXHMqKD86WydcIl0pPyhbXidcIl0rKSg/OlsnXCJdKT8vZ2ksXG4gICAgICAgICAgICAvKFthLXpBLVowLTlfXSp0b2tlblthLXpBLVowLTlfXSopXFxzKjpcXHMqKD86WydcIl0pPyhbXidcIl0rKSg/OlsnXCJdKT8vZ2ksXG4gICAgICAgICAgICAvUFJJVkFURSBLRVktLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC9DRVJUSUZJQ0FURS0tLS0tXFxzKihbXFxzXFxTXSo/KSg/Oi0tLS0tRU5EfCQpL2dpLFxuICAgICAgICAgICAgL0JFR0lOIFBSSVZBVEUgS0VZLS0tLS1cXHMqKFtcXHNcXFNdKj8pKD86LS0tLS1FTkR8JCkvZ2ksXG4gICAgICAgICAgICAvQkVHSU4gQ0VSVElGSUNBVEUtLS0tLVxccyooW1xcc1xcU10qPykoPzotLS0tLUVORHwkKS9naSxcbiAgICAgICAgICAgIC8oPzprZXl8cHJpdmF0ZUtleXxwdWJsaWNLZXl8Y2VydGlmaWNhdGUpXFxzKjpcXHMqKFtcXHNcXFNdKj8pKD86XFxuXFxzKlxcbnxcXG5cXHMqW2EtekEtWl18XFxuXFxzKiR8JCkvZ2ksXG4gICAgICAgIF0sXG4gICAgICAgIC4uLl9vcHRpb25zLFxuICAgICAgICAvLyBlbnN1cmUgbWluIGxvZyBsZXZlbCBpcyBhbHdheXMgdGhlcmVcbiAgICAgICAgbWluTGV2ZWw6IF9vcHRpb25zLm1pbkxldmVsID8/IGxvZ0xldmVsLFxuXG4gICAgfSk7XG5cbiAgICBsb2dnZXIuYXR0YWNoVHJhbnNwb3J0KGxvZ3RyYWlsVHJhbnNwb3J0KTtcblxuICAgIHJldHVybiBsb2dnZXI7XG59XG5cbmV4cG9ydCBjb25zdCBEZWZhdWx0TG9nZ2VyOiBJTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdbKl0nKTtcblxuZXhwb3J0IHtcbiAgICBMb2dEdXJhdGlvblxufSBmcm9tICcuLi9kZWNvcmF0b3JzL2xvZy1kdXJhdGlvbic7XG5cbmV4cG9ydCB7XG4gICAgbG9ndHJhaWxUcmFuc3BvcnQsXG4gICAgcmVzb2x2ZUxvZ3RyYWlsVmVjdG9ySW5nZXN0LFxuICAgIHNldExvZ3RyYWlsVmVjdG9ySW5nZXN0LFxuICAgIHNoaXBMb2d0cmFpbFZlY3Rvckpzb24sXG4gICAgdHlwZSBMb2d0cmFpbFZlY3RvckluZ2VzdENvbmZpZyxcbn0gZnJvbSAnLi9sb2d0cmFpbCc7XG4iXX0=