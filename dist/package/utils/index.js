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
__exportStar(require("./metadata"), exports);
__exportStar(require("./keys"), exports);
__exportStar(require("./env"), exports);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF3QkEsd0NBb0RDO0FBNUVELHNDQUEyQztBQUUzQywwQ0FBd0I7QUFDeEIsOENBQTRCO0FBQzVCLDRDQUEwQjtBQUMxQiwwQ0FBd0I7QUFDeEIsMENBQXdCO0FBQ3hCLDhDQUE0QjtBQUM1QiwwQ0FBd0I7QUFFeEIsNkNBQTJCO0FBQzNCLHlDQUF1QjtBQUN2Qix3Q0FBc0I7QUFFdEIsTUFBYSxnQkFBaUIsU0FBUSx1QkFBYztJQUNoRCxZQUFZLE9BQWUsRUFBRSxPQUE2QjtRQUN0RCxLQUFLLENBQUMsT0FBTyxFQUFFO1lBQ1gsR0FBRyxPQUFPO1lBQ1YsU0FBUyxFQUFFLGtCQUFrQjtZQUM3QixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7U0FDdEMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztDQUNKO0FBUkQsNENBUUM7QUFFRCxTQUFnQixjQUFjLENBQVUsR0FBd0IsRUFBRSxJQUFZLEVBQUUsWUFBZ0I7SUFDNUYsSUFBSSxDQUFDLEdBQUcsSUFBSSxPQUFPLEdBQUcsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksZ0JBQWdCLENBQUMsK0JBQStCLEVBQUU7WUFDeEQsR0FBRztZQUNILElBQUksRUFBRSxPQUFPLEdBQUc7WUFDaEIsTUFBTSxFQUFFLEdBQUcsS0FBSyxJQUFJO1NBQ3ZCLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3BDLE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyxpQ0FBaUMsRUFBRTtZQUMxRCxJQUFJO1lBQ0osSUFBSSxFQUFFLE9BQU8sSUFBSTtTQUNwQixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsSUFBSSxDQUFDO1FBQ0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM3QixJQUFJLE9BQU8sR0FBRyxHQUFHLENBQUM7UUFFbEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ1AsTUFBTSxJQUFJLGdCQUFnQixDQUFDLGlDQUFpQyxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUM1RSxDQUFDO1lBRUQsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJLEVBQUUsQ0FBQztnQkFDNUMsT0FBTyxZQUFpQixDQUFDO1lBQzdCLENBQUM7WUFFRCxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxJQUFJLGdCQUFnQixDQUFDLDRCQUE0QixHQUFHLEVBQUUsRUFBRTtvQkFDMUQsSUFBSTtvQkFDSixHQUFHO29CQUNILGFBQWEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztpQkFDdEMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELE9BQU8sR0FBRyxPQUFPLENBQUUsR0FBRyxDQUFFLENBQUM7UUFDN0IsQ0FBQztRQUVELE9BQU8sQ0FBQyxPQUFPLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBTSxDQUFDO0lBQ2pFLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxLQUFLLFlBQVksZ0JBQWdCLEVBQUUsQ0FBQztZQUNwQyxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO1FBQ0QsTUFBTSxJQUFJLGdCQUFnQixDQUFDLGdDQUFnQyxJQUFJLEVBQUUsRUFBRTtZQUMvRCxJQUFJO1lBQ0osTUFBTSxFQUFFLEdBQUc7WUFDWCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtZQUMvRCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsU0FBUztTQUMxRCxDQUFDLENBQUM7SUFDUCxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZyYW1ld29ya0Vycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcblxuZXhwb3J0ICogZnJvbSAnLi9jYXNlcyc7XG5leHBvcnQgKiBmcm9tICcuL2RhdGF0eXBlcyc7XG5leHBvcnQgKiBmcm9tICcuL2V4Y2x1ZGUnO1xuZXhwb3J0ICogZnJvbSAnLi9tZXJnZSc7XG5leHBvcnQgKiBmcm9tICcuL3BhcnNlJztcbmV4cG9ydCAqIGZyb20gJy4vc2VyaWFsaXplJztcbmV4cG9ydCAqIGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgKiBmcm9tICcuL21ldGFkYXRhJztcbmV4cG9ydCAqIGZyb20gJy4va2V5cyc7XG5leHBvcnQgKiBmcm9tICcuL2Vudic7XG5cbmV4cG9ydCBjbGFzcyBWYWx1ZUJ5UGF0aEVycm9yIGV4dGVuZHMgRnJhbWV3b3JrRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgZGV0YWlscz86IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICAgICAgc3VwZXIobWVzc2FnZSwge1xuICAgICAgICAgICAgLi4uZGV0YWlscyxcbiAgICAgICAgICAgIGVycm9yVHlwZTogJ1ZhbHVlQnlQYXRoRXJyb3InLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmFsdWVCeVBhdGg8VCA9IGFueT4ob2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBwYXRoOiBzdHJpbmcsIGRlZmF1bHRWYWx1ZT86IFQpOiBUIHtcbiAgICBpZiAoIW9iaiB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcignT2JqZWN0IG11c3QgYmUgYSB2YWxpZCBvYmplY3QnLCB7XG4gICAgICAgICAgICBvYmosXG4gICAgICAgICAgICB0eXBlOiB0eXBlb2Ygb2JqLFxuICAgICAgICAgICAgaXNOdWxsOiBvYmogPT09IG51bGxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCFwYXRoIHx8IHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcignUGF0aCBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZycsIHtcbiAgICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgICB0eXBlOiB0eXBlb2YgcGF0aFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBrZXlzID0gcGF0aC5zcGxpdCgnLicpO1xuICAgICAgICBsZXQgY3VycmVudCA9IG9iajtcblxuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgICAgICBpZiAoIWtleSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKCdJbnZhbGlkIHBhdGggc2VnbWVudDogZW1wdHkga2V5JywgeyBwYXRoIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3VycmVudCA9PT0gdW5kZWZpbmVkIHx8IGN1cnJlbnQgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVmYXVsdFZhbHVlIGFzIFQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghKGtleSBpbiBjdXJyZW50KSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKGBLZXkgbm90IGZvdW5kIGluIG9iamVjdDogJHtrZXl9YCwge1xuICAgICAgICAgICAgICAgICAgICBwYXRoLFxuICAgICAgICAgICAgICAgICAgICBrZXksXG4gICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZUtleXM6IE9iamVjdC5rZXlzKGN1cnJlbnQpXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBrZXkgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAoY3VycmVudCA9PT0gdW5kZWZpbmVkID8gZGVmYXVsdFZhbHVlIDogY3VycmVudCkgYXMgVDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWx1ZUJ5UGF0aEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcihgRmFpbGVkIHRvIGdldCB2YWx1ZSBhdCBwYXRoOiAke3BhdGh9YCwge1xuICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIG9iamVjdDogb2JqLFxuICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICAgICAgc3RhY2s6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5zdGFjayA6IHVuZGVmaW5lZFxuICAgICAgICB9KTtcbiAgICB9XG59Il19