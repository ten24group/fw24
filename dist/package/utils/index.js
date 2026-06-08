"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValueByPathError = void 0;
exports.getValueByPath = getValueByPath;
const errors_1 = require("../errors");
__exportStar(require("./cases"), exports);
__exportStar(require("./datatypes"), exports);
__exportStar(require("./exclude"), exports);
__exportStar(require("./merge"), exports);
__exportStar(require("./parse"), exports);
__exportStar(require("./serialize"), exports);
__exportStar(require("./types"), exports);
__exportStar(require("./timer"), exports);
__exportStar(require("./metadata"), exports);
__exportStar(require("./keys"), exports);
__exportStar(require("./env"), exports);
__exportStar(require("./compression"), exports);
__exportStar(require("./iam-policy-chunking"), exports);
class ValueByPathError extends errors_1.FrameworkError {
    constructor(message, details) {
        super(message, {
            ...details,
            errorType: 'ValueByPathError',
            timestamp: new Date().toISOString()
        });
    }
}
exports.ValueByPathError = ValueByPathError;
function getValueByPath(obj, path, defaultValue) {
    if (!obj || typeof obj !== 'object') {
        throw new ValueByPathError('Object must be a valid object', {
            obj,
            type: typeof obj,
            isNull: obj === null
        });
    }
    if (!path || typeof path !== 'string') {
        throw new ValueByPathError('Path must be a non-empty string', {
            path,
            type: typeof path
        });
    }
    try {
        const keys = path.split('.');
        let current = obj;
        for (const key of keys) {
            if (!key) {
                throw new ValueByPathError('Invalid path segment: empty key', { path });
            }
            if (current === undefined || current === null) {
                return defaultValue;
            }
            if (!(key in current)) {
                throw new ValueByPathError(`Key not found in object: ${key}`, {
                    path,
                    key,
                    availableKeys: Object.keys(current)
                });
            }
            current = current[key];
        }
        return (current === undefined ? defaultValue : current);
    }
    catch (error) {
        if (error instanceof ValueByPathError) {
            throw error;
        }
        throw new ValueByPathError(`Failed to get value at path: ${path}`, {
            path,
            object: obj,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7QUEyQkEsd0NBb0RDO0FBL0VELHNDQUEyQztBQUUzQywwQ0FBd0I7QUFDeEIsOENBQTRCO0FBQzVCLDRDQUEwQjtBQUMxQiwwQ0FBd0I7QUFDeEIsMENBQXdCO0FBQ3hCLDhDQUE0QjtBQUM1QiwwQ0FBd0I7QUFDeEIsMENBQXdCO0FBRXhCLDZDQUEyQjtBQUMzQix5Q0FBdUI7QUFDdkIsd0NBQXNCO0FBQ3RCLGdEQUE4QjtBQUM5Qix3REFBc0M7QUFFdEMsTUFBYSxnQkFBaUIsU0FBUSx1QkFBYztJQUNoRCxZQUFZLE9BQWUsRUFBRSxPQUE2QjtRQUN0RCxLQUFLLENBQUMsT0FBTyxFQUFFO1lBQ1gsR0FBRyxPQUFPO1lBQ1YsU0FBUyxFQUFFLGtCQUFrQjtZQUM3QixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7U0FDdEMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBUkQsNENBUUM7QUFFRCxTQUFnQixjQUFjLENBQVUsR0FBd0IsRUFBRSxJQUFZLEVBQUUsWUFBZ0I7SUFDNUYsSUFBSSxDQUFDLEdBQUcsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksZ0JBQWdCLENBQUMsK0JBQStCLEVBQUU7WUFDeEQsR0FBRztZQUNILElBQUksRUFBRSxPQUFPLEdBQUc7WUFDaEIsTUFBTSxFQUFFLEdBQUcsS0FBSyxJQUFJO1NBQ3ZCLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3BDLE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyxpQ0FBaUMsRUFBRTtZQUMxRCxJQUFJO1lBQ0osSUFBSSxFQUFFLE9BQU8sSUFBSTtTQUNwQixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsSUFBSSxDQUFDO1FBQ0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM3QixJQUFJLE9BQU8sR0FBRyxHQUFHLENBQUM7UUFFbEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ1AsTUFBTSxJQUFJLGdCQUFnQixDQUFDLGlDQUFpQyxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUM1RSxDQUFDO1lBRUQsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEVBQUUsQ0FBQztnQkFDNUMsT0FBTyxZQUFpQixDQUFDO1lBQzdCLENBQUM7WUFFRCxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxJQUFJLGdCQUFnQixDQUFDLDRCQUE0QixHQUFHLEVBQUUsRUFBRTtvQkFDMUQsSUFBSTtvQkFDSixHQUFHO29CQUNILGFBQWEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztpQkFDdEMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELE9BQU8sR0FBRyxPQUFPLENBQUUsR0FBRyxDQUFFLENBQUM7UUFDN0IsQ0FBQztRQUVELE9BQU8sQ0FBQyxPQUFPLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBTSxDQUFDO0lBQ2pFLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxLQUFLLFlBQVksZ0JBQWdCLEVBQUUsQ0FBQztZQUNwQyxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO1FBQ0QsTUFBTSxJQUFJLGdCQUFnQixDQUFDLGdDQUFnQyxJQUFJLEVBQUUsRUFBRTtZQUMvRCxJQUFJO1lBQ0osTUFBTSxFQUFFLEdBQUc7WUFDWCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtZQUMvRCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsU0FBUztTQUMxRCxDQUFDLENBQUM7SUFDUCxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZyYW1ld29ya0Vycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcblxuZXhwb3J0ICogZnJvbSAnLi9jYXNlcyc7XG5leHBvcnQgKiBmcm9tICcuL2RhdGF0eXBlcyc7XG5leHBvcnQgKiBmcm9tICcuL2V4Y2x1ZGUnO1xuZXhwb3J0ICogZnJvbSAnLi9tZXJnZSc7XG5leHBvcnQgKiBmcm9tICcuL3BhcnNlJztcbmV4cG9ydCAqIGZyb20gJy4vc2VyaWFsaXplJztcbmV4cG9ydCAqIGZyb20gJy4vdHlwZXMnO1xuZXhwb3J0ICogZnJvbSAnLi90aW1lcic7XG5cbmV4cG9ydCAqIGZyb20gJy4vbWV0YWRhdGEnO1xuZXhwb3J0ICogZnJvbSAnLi9rZXlzJztcbmV4cG9ydCAqIGZyb20gJy4vZW52JztcbmV4cG9ydCAqIGZyb20gJy4vY29tcHJlc3Npb24nO1xuZXhwb3J0ICogZnJvbSAnLi9pYW0tcG9saWN5LWNodW5raW5nJztcblxuZXhwb3J0IGNsYXNzIFZhbHVlQnlQYXRoRXJyb3IgZXh0ZW5kcyBGcmFtZXdvcmtFcnJvciB7XG4gICAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgICAgICBzdXBlcihtZXNzYWdlLCB7XG4gICAgICAgICAgICAuLi5kZXRhaWxzLFxuICAgICAgICAgICAgZXJyb3JUeXBlOiAnVmFsdWVCeVBhdGhFcnJvcicsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRWYWx1ZUJ5UGF0aDxUID0gYW55PihvYmo6IFJlY29yZDxzdHJpbmcsIGFueT4sIHBhdGg6IHN0cmluZywgZGVmYXVsdFZhbHVlPzogVCk6IFQge1xuICAgIGlmICghb2JqIHx8IHR5cGVvZiBvYmogIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKCdPYmplY3QgbXVzdCBiZSBhIHZhbGlkIG9iamVjdCcsIHtcbiAgICAgICAgICAgIG9iaixcbiAgICAgICAgICAgIHR5cGU6IHR5cGVvZiBvYmosXG4gICAgICAgICAgICBpc051bGw6IG9iaiA9PT0gbnVsbFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoIXBhdGggfHwgdHlwZW9mIHBhdGggIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKCdQYXRoIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nJywge1xuICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIHR5cGU6IHR5cGVvZiBwYXRoXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGtleXMgPSBwYXRoLnNwbGl0KCcuJyk7XG4gICAgICAgIGxldCBjdXJyZW50ID0gb2JqO1xuXG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgICAgICAgIGlmICgha2V5KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFZhbHVlQnlQYXRoRXJyb3IoJ0ludmFsaWQgcGF0aCBzZWdtZW50OiBlbXB0eSBrZXknLCB7IHBhdGggfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjdXJyZW50ID09PSB1bmRlZmluZWQgfHwgY3VycmVudCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBkZWZhdWx0VmFsdWUgYXMgVDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCEoa2V5IGluIGN1cnJlbnQpKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFZhbHVlQnlQYXRoRXJyb3IoYEtleSBub3QgZm91bmQgaW4gb2JqZWN0OiAke2tleX1gLCB7XG4gICAgICAgICAgICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGtleSxcbiAgICAgICAgICAgICAgICAgICAgYXZhaWxhYmxlS2V5czogT2JqZWN0LmtleXMoY3VycmVudClcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY3VycmVudCA9IGN1cnJlbnRbIGtleSBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIChjdXJyZW50ID09PSB1bmRlZmluZWQgPyBkZWZhdWx0VmFsdWUgOiBjdXJyZW50KSBhcyBUO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbHVlQnlQYXRoRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKGBGYWlsZWQgdG8gZ2V0IHZhbHVlIGF0IHBhdGg6ICR7cGF0aH1gLCB7XG4gICAgICAgICAgICBwYXRoLFxuICAgICAgICAgICAgb2JqZWN0OiBvYmosXG4gICAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXG4gICAgICAgICAgICBzdGFjazogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLnN0YWNrIDogdW5kZWZpbmVkXG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=