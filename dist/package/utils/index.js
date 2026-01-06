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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF5QkEsd0NBb0RDO0FBN0VELHNDQUEyQztBQUUzQywwQ0FBd0I7QUFDeEIsOENBQTRCO0FBQzVCLDRDQUEwQjtBQUMxQiwwQ0FBd0I7QUFDeEIsMENBQXdCO0FBQ3hCLDhDQUE0QjtBQUM1QiwwQ0FBd0I7QUFDeEIsMENBQXdCO0FBRXhCLDZDQUEyQjtBQUMzQix5Q0FBdUI7QUFDdkIsd0NBQXNCO0FBRXRCLE1BQWEsZ0JBQWlCLFNBQVEsdUJBQWM7SUFDaEQsWUFBWSxPQUFlLEVBQUUsT0FBNkI7UUFDdEQsS0FBSyxDQUFDLE9BQU8sRUFBRTtZQUNYLEdBQUcsT0FBTztZQUNWLFNBQVMsRUFBRSxrQkFBa0I7WUFDN0IsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1NBQ3RDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQVJELDRDQVFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFVLEdBQXdCLEVBQUUsSUFBWSxFQUFFLFlBQWdCO0lBQzVGLElBQUksQ0FBQyxHQUFHLElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDbEMsTUFBTSxJQUFJLGdCQUFnQixDQUFDLCtCQUErQixFQUFFO1lBQ3hELEdBQUc7WUFDSCxJQUFJLEVBQUUsT0FBTyxHQUFHO1lBQ2hCLE1BQU0sRUFBRSxHQUFHLEtBQUssSUFBSTtTQUN2QixDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsSUFBSSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNwQyxNQUFNLElBQUksZ0JBQWdCLENBQUMsaUNBQWlDLEVBQUU7WUFDMUQsSUFBSTtZQUNKLElBQUksRUFBRSxPQUFPLElBQUk7U0FDcEIsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELElBQUksQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDN0IsSUFBSSxPQUFPLEdBQUcsR0FBRyxDQUFDO1FBRWxCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDckIsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUNQLE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyxpQ0FBaUMsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFDNUUsQ0FBQztZQUVELElBQUksT0FBTyxLQUFLLFNBQVMsSUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQzVDLE9BQU8sWUFBaUIsQ0FBQztZQUM3QixDQUFDO1lBRUQsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ3BCLE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyw0QkFBNEIsR0FBRyxFQUFFLEVBQUU7b0JBQzFELElBQUk7b0JBQ0osR0FBRztvQkFDSCxhQUFhLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUM7aUJBQ3RDLENBQUMsQ0FBQztZQUNQLENBQUM7WUFFRCxPQUFPLEdBQUcsT0FBTyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1FBQzdCLENBQUM7UUFFRCxPQUFPLENBQUMsT0FBTyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQU0sQ0FBQztJQUNqRSxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNiLElBQUksS0FBSyxZQUFZLGdCQUFnQixFQUFFLENBQUM7WUFDcEMsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztRQUNELE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyxnQ0FBZ0MsSUFBSSxFQUFFLEVBQUU7WUFDL0QsSUFBSTtZQUNKLE1BQU0sRUFBRSxHQUFHO1lBQ1gsS0FBSyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7WUFDL0QsS0FBSyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVM7U0FDMUQsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBGcmFtZXdvcmtFcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5cbmV4cG9ydCAqIGZyb20gJy4vY2FzZXMnO1xuZXhwb3J0ICogZnJvbSAnLi9kYXRhdHlwZXMnO1xuZXhwb3J0ICogZnJvbSAnLi9leGNsdWRlJztcbmV4cG9ydCAqIGZyb20gJy4vbWVyZ2UnO1xuZXhwb3J0ICogZnJvbSAnLi9wYXJzZSc7XG5leHBvcnQgKiBmcm9tICcuL3NlcmlhbGl6ZSc7XG5leHBvcnQgKiBmcm9tICcuL3R5cGVzJztcbmV4cG9ydCAqIGZyb20gJy4vdGltZXInO1xuXG5leHBvcnQgKiBmcm9tICcuL21ldGFkYXRhJztcbmV4cG9ydCAqIGZyb20gJy4va2V5cyc7XG5leHBvcnQgKiBmcm9tICcuL2Vudic7XG5cbmV4cG9ydCBjbGFzcyBWYWx1ZUJ5UGF0aEVycm9yIGV4dGVuZHMgRnJhbWV3b3JrRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgZGV0YWlscz86IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICAgICAgc3VwZXIobWVzc2FnZSwge1xuICAgICAgICAgICAgLi4uZGV0YWlscyxcbiAgICAgICAgICAgIGVycm9yVHlwZTogJ1ZhbHVlQnlQYXRoRXJyb3InLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmFsdWVCeVBhdGg8VCA9IGFueT4ob2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBwYXRoOiBzdHJpbmcsIGRlZmF1bHRWYWx1ZT86IFQpOiBUIHtcbiAgICBpZiAoIW9iaiB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcignT2JqZWN0IG11c3QgYmUgYSB2YWxpZCBvYmplY3QnLCB7XG4gICAgICAgICAgICBvYmosXG4gICAgICAgICAgICB0eXBlOiB0eXBlb2Ygb2JqLFxuICAgICAgICAgICAgaXNOdWxsOiBvYmogPT09IG51bGxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCFwYXRoIHx8IHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcignUGF0aCBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZycsIHtcbiAgICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgICB0eXBlOiB0eXBlb2YgcGF0aFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBrZXlzID0gcGF0aC5zcGxpdCgnLicpO1xuICAgICAgICBsZXQgY3VycmVudCA9IG9iajtcblxuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgICAgICBpZiAoIWtleSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKCdJbnZhbGlkIHBhdGggc2VnbWVudDogZW1wdHkga2V5JywgeyBwYXRoIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3VycmVudCA9PT0gdW5kZWZpbmVkIHx8IGN1cnJlbnQgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZGVmYXVsdFZhbHVlIGFzIFQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghKGtleSBpbiBjdXJyZW50KSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBWYWx1ZUJ5UGF0aEVycm9yKGBLZXkgbm90IGZvdW5kIGluIG9iamVjdDogJHtrZXl9YCwge1xuICAgICAgICAgICAgICAgICAgICBwYXRoLFxuICAgICAgICAgICAgICAgICAgICBrZXksXG4gICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZUtleXM6IE9iamVjdC5rZXlzKGN1cnJlbnQpXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGN1cnJlbnQgPSBjdXJyZW50WyBrZXkgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiAoY3VycmVudCA9PT0gdW5kZWZpbmVkID8gZGVmYXVsdFZhbHVlIDogY3VycmVudCkgYXMgVDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWx1ZUJ5UGF0aEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgVmFsdWVCeVBhdGhFcnJvcihgRmFpbGVkIHRvIGdldCB2YWx1ZSBhdCBwYXRoOiAke3BhdGh9YCwge1xuICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIG9iamVjdDogb2JqLFxuICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICAgICAgc3RhY2s6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5zdGFjayA6IHVuZGVmaW5lZFxuICAgICAgICB9KTtcbiAgICB9XG59Il19