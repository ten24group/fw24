"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.levelToString = levelToString;
exports.stringToLevel = stringToLevel;
exports.levelToPowertoolsLogLevel = levelToPowertoolsLogLevel;
const types_1 = require("../types");
/**
 * Convert ObservabilityLevel enum to string representation
 */
function levelToString(level) {
    switch (level) {
        case types_1.ObservabilityLevel.TRACE:
            return 'trace';
        case types_1.ObservabilityLevel.DEBUG:
            return 'debug';
        case types_1.ObservabilityLevel.INFO:
            return 'info';
        case types_1.ObservabilityLevel.WARN:
            return 'warn';
        case types_1.ObservabilityLevel.ERROR:
            return 'error';
        case types_1.ObservabilityLevel.CRITICAL:
            return 'critical';
        default:
            return 'info';
    }
}
/**
 * Convert string level to ObservabilityLevel enum value
 */
function stringToLevel(level) {
    const normalized = level.toLowerCase();
    switch (normalized) {
        case 'trace':
            return types_1.ObservabilityLevel.TRACE;
        case 'debug':
            return types_1.ObservabilityLevel.DEBUG;
        case 'info':
            return types_1.ObservabilityLevel.INFO;
        case 'warn':
            return types_1.ObservabilityLevel.WARN;
        case 'error':
            return types_1.ObservabilityLevel.ERROR;
        case 'critical':
            return types_1.ObservabilityLevel.CRITICAL;
        default:
            return types_1.ObservabilityLevel[level] ?? types_1.ObservabilityLevel.INFO;
    }
}
/**
 * Map ObservabilityLevel to AWS Powertools Logger level
 */
function levelToPowertoolsLogLevel(level) {
    if (level === undefined)
        return 'INFO';
    if (level <= types_1.ObservabilityLevel.DEBUG) {
        return 'DEBUG';
    }
    else if (level === types_1.ObservabilityLevel.INFO) {
        return 'INFO';
    }
    else if (level === types_1.ObservabilityLevel.WARN) {
        return 'WARN';
    }
    else if (level >= types_1.ObservabilityLevel.ERROR) {
        return 'ERROR';
    }
    return 'INFO';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGV2ZWwtdXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS91dGlscy9sZXZlbC11dGlscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUtBLHNDQWlCQztBQUtELHNDQW9CQztBQUtELDhEQWNDO0FBbEVELG9DQUE4QztBQUU5Qzs7R0FFRztBQUNILFNBQWdCLGFBQWEsQ0FBQyxLQUF5QjtJQUNyRCxRQUFRLEtBQUssRUFBRSxDQUFDO1FBQ2QsS0FBSywwQkFBa0IsQ0FBQyxLQUFLO1lBQzNCLE9BQU8sT0FBTyxDQUFDO1FBQ2pCLEtBQUssMEJBQWtCLENBQUMsS0FBSztZQUMzQixPQUFPLE9BQU8sQ0FBQztRQUNqQixLQUFLLDBCQUFrQixDQUFDLElBQUk7WUFDMUIsT0FBTyxNQUFNLENBQUM7UUFDaEIsS0FBSywwQkFBa0IsQ0FBQyxJQUFJO1lBQzFCLE9BQU8sTUFBTSxDQUFDO1FBQ2hCLEtBQUssMEJBQWtCLENBQUMsS0FBSztZQUMzQixPQUFPLE9BQU8sQ0FBQztRQUNqQixLQUFLLDBCQUFrQixDQUFDLFFBQVE7WUFDOUIsT0FBTyxVQUFVLENBQUM7UUFDcEI7WUFDRSxPQUFPLE1BQU0sQ0FBQztJQUNsQixDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUMzQixLQUEwRTtJQUUxRSxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDdkMsUUFBUSxVQUFVLEVBQUUsQ0FBQztRQUNuQixLQUFLLE9BQU87WUFDVixPQUFPLDBCQUFrQixDQUFDLEtBQUssQ0FBQztRQUNsQyxLQUFLLE9BQU87WUFDVixPQUFPLDBCQUFrQixDQUFDLEtBQUssQ0FBQztRQUNsQyxLQUFLLE1BQU07WUFDVCxPQUFPLDBCQUFrQixDQUFDLElBQUksQ0FBQztRQUNqQyxLQUFLLE1BQU07WUFDVCxPQUFPLDBCQUFrQixDQUFDLElBQUksQ0FBQztRQUNqQyxLQUFLLE9BQU87WUFDVixPQUFPLDBCQUFrQixDQUFDLEtBQUssQ0FBQztRQUNsQyxLQUFLLFVBQVU7WUFDYixPQUFPLDBCQUFrQixDQUFDLFFBQVEsQ0FBQztRQUNyQztZQUNFLE9BQVEsMEJBQTBCLENBQUMsS0FBSyxDQUFDLElBQUksMEJBQWtCLENBQUMsSUFBSSxDQUFDO0lBQ3pFLENBQUM7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQix5QkFBeUIsQ0FBQyxLQUEwQjtJQUNsRSxJQUFJLEtBQUssS0FBSyxTQUFTO1FBQUUsT0FBTyxNQUFNLENBQUM7SUFFdkMsSUFBSSxLQUFLLElBQUksMEJBQWtCLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDdEMsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztTQUFNLElBQUksS0FBSyxLQUFLLDBCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDO1FBQzdDLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7U0FBTSxJQUFJLEtBQUssS0FBSywwQkFBa0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM3QyxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO1NBQU0sSUFBSSxLQUFLLElBQUksMEJBQWtCLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDN0MsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi90eXBlcyc7XG5cbi8qKlxuICogQ29udmVydCBPYnNlcnZhYmlsaXR5TGV2ZWwgZW51bSB0byBzdHJpbmcgcmVwcmVzZW50YXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxldmVsVG9TdHJpbmcobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbCk6ICd0cmFjZScgfCAnZGVidWcnIHwgJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJyB8ICdjcml0aWNhbCcge1xuICBzd2l0Y2ggKGxldmVsKSB7XG4gICAgY2FzZSBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0U6XG4gICAgICByZXR1cm4gJ3RyYWNlJztcbiAgICBjYXNlIE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRzpcbiAgICAgIHJldHVybiAnZGVidWcnO1xuICAgIGNhc2UgT2JzZXJ2YWJpbGl0eUxldmVsLklORk86XG4gICAgICByZXR1cm4gJ2luZm8nO1xuICAgIGNhc2UgT2JzZXJ2YWJpbGl0eUxldmVsLldBUk46XG4gICAgICByZXR1cm4gJ3dhcm4nO1xuICAgIGNhc2UgT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SOlxuICAgICAgcmV0dXJuICdlcnJvcic7XG4gICAgY2FzZSBPYnNlcnZhYmlsaXR5TGV2ZWwuQ1JJVElDQUw6XG4gICAgICByZXR1cm4gJ2NyaXRpY2FsJztcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuICdpbmZvJztcbiAgfVxufVxuXG4vKipcbiAqIENvbnZlcnQgc3RyaW5nIGxldmVsIHRvIE9ic2VydmFiaWxpdHlMZXZlbCBlbnVtIHZhbHVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpbmdUb0xldmVsKFxuICBsZXZlbDogc3RyaW5nIHwgJ3RyYWNlJyB8ICdkZWJ1ZycgfCAnaW5mbycgfCAnd2FybicgfCAnZXJyb3InIHwgJ2NyaXRpY2FsJyxcbik6IE9ic2VydmFiaWxpdHlMZXZlbCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBsZXZlbC50b0xvd2VyQ2FzZSgpO1xuICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICBjYXNlICd0cmFjZSc6XG4gICAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFO1xuICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgIHJldHVybiBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUc7XG4gICAgY2FzZSAnaW5mbyc6XG4gICAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG4gICAgY2FzZSAnd2Fybic6XG4gICAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eUxldmVsLldBUk47XG4gICAgY2FzZSAnZXJyb3InOlxuICAgICAgcmV0dXJuIE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUjtcbiAgICBjYXNlICdjcml0aWNhbCc6XG4gICAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gKE9ic2VydmFiaWxpdHlMZXZlbCBhcyBhbnkpW2xldmVsXSA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTztcbiAgfVxufVxuXG4vKipcbiAqIE1hcCBPYnNlcnZhYmlsaXR5TGV2ZWwgdG8gQVdTIFBvd2VydG9vbHMgTG9nZ2VyIGxldmVsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsKGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsKTogJ0RFQlVHJyB8ICdJTkZPJyB8ICdXQVJOJyB8ICdFUlJPUicge1xuICBpZiAobGV2ZWwgPT09IHVuZGVmaW5lZCkgcmV0dXJuICdJTkZPJztcbiAgXG4gIGlmIChsZXZlbCA8PSBPYnNlcnZhYmlsaXR5TGV2ZWwuREVCVUcpIHtcbiAgICByZXR1cm4gJ0RFQlVHJztcbiAgfSBlbHNlIGlmIChsZXZlbCA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLklORk8pIHtcbiAgICByZXR1cm4gJ0lORk8nO1xuICB9IGVsc2UgaWYgKGxldmVsID09PSBPYnNlcnZhYmlsaXR5TGV2ZWwuV0FSTikge1xuICAgIHJldHVybiAnV0FSTic7XG4gIH0gZWxzZSBpZiAobGV2ZWwgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SKSB7XG4gICAgcmV0dXJuICdFUlJPUic7XG4gIH1cbiAgXG4gIHJldHVybiAnSU5GTyc7XG59XG5cbiJdfQ==