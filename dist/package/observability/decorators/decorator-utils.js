"use strict";
/**
 * Shared utilities for observability decorators
 *
 * Eliminates duplication across @Observed, @Traced, @Audited
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSource = void 0;
exports.executeWithHandlers = executeWithHandlers;
var source_utils_1 = require("../utils/source-utils");
Object.defineProperty(exports, "resolveSource", { enumerable: true, get: function () { return source_utils_1.resolveSource; } });
/**
 * Execute a method with callbacks for success/error handling.
 * Automatically detects sync vs async and calls appropriate callbacks.
 *
 * This eliminates the 4-path duplication (async-success, async-error, sync-success, sync-error)
 * that was present in all decorators.
 */
function executeWithHandlers(originalMethod, context, args, onFinish) {
    try {
        const result = originalMethod.apply(context, args);
        // Check if result is a Promise/thenable
        if (result && typeof result.then === 'function') {
            // Handle async method
            return result
                .then((value) => {
                onFinish(true, value);
                return value;
            })
                .catch((error) => {
                onFinish(false, undefined, error);
                throw error;
            });
        }
        // Handle sync method
        onFinish(true, result);
        return result;
    }
    catch (error) {
        onFinish(false, undefined, error);
        throw error;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVjb3JhdG9yLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9kZWNvcmF0b3ItdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQVdILGtEQThCQztBQXZDRCxzREFBa0U7QUFBN0MsNkdBQUEsYUFBYSxPQUFBO0FBRWxDOzs7Ozs7R0FNRztBQUNILFNBQWdCLG1CQUFtQixDQUNqQyxjQUF5QyxFQUN6QyxPQUFnQixFQUNoQixJQUFlLEVBQ2YsUUFBdUU7SUFFdkUsSUFBSSxDQUFDO1FBQ0gsTUFBTSxNQUFNLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFbkQsd0NBQXdDO1FBQ3hDLElBQUksTUFBTSxJQUFJLE9BQVEsTUFBYyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6RCxzQkFBc0I7WUFDdEIsT0FBUSxNQUFjO2lCQUNuQixJQUFJLENBQUMsQ0FBQyxLQUFjLEVBQUUsRUFBRTtnQkFDdkIsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDdEIsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDLENBQUM7aUJBQ0QsS0FBSyxDQUFDLENBQUMsS0FBYyxFQUFFLEVBQUU7Z0JBQ3hCLFFBQVEsQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNsQyxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELHFCQUFxQjtRQUNyQixRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3ZCLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsUUFBUSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEMsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU2hhcmVkIHV0aWxpdGllcyBmb3Igb2JzZXJ2YWJpbGl0eSBkZWNvcmF0b3JzXG4gKiBcbiAqIEVsaW1pbmF0ZXMgZHVwbGljYXRpb24gYWNyb3NzIEBPYnNlcnZlZCwgQFRyYWNlZCwgQEF1ZGl0ZWRcbiAqL1xuXG5leHBvcnQgeyBTb3VyY2VUeXBlLCByZXNvbHZlU291cmNlIH0gZnJvbSAnLi4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuLyoqXG4gKiBFeGVjdXRlIGEgbWV0aG9kIHdpdGggY2FsbGJhY2tzIGZvciBzdWNjZXNzL2Vycm9yIGhhbmRsaW5nLlxuICogQXV0b21hdGljYWxseSBkZXRlY3RzIHN5bmMgdnMgYXN5bmMgYW5kIGNhbGxzIGFwcHJvcHJpYXRlIGNhbGxiYWNrcy5cbiAqIFxuICogVGhpcyBlbGltaW5hdGVzIHRoZSA0LXBhdGggZHVwbGljYXRpb24gKGFzeW5jLXN1Y2Nlc3MsIGFzeW5jLWVycm9yLCBzeW5jLXN1Y2Nlc3MsIHN5bmMtZXJyb3IpXG4gKiB0aGF0IHdhcyBwcmVzZW50IGluIGFsbCBkZWNvcmF0b3JzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhlY3V0ZVdpdGhIYW5kbGVyczxUPihcbiAgb3JpZ2luYWxNZXRob2Q6ICguLi5hcmdzOiB1bmtub3duW10pID0+IFQsXG4gIGNvbnRleHQ6IHVua25vd24sXG4gIGFyZ3M6IHVua25vd25bXSxcbiAgb25GaW5pc2g6IChzdWNjZXNzOiBib29sZWFuLCByZXN1bHQ/OiB1bmtub3duLCBlcnJvcj86IHVua25vd24pID0+IHZvaWRcbik6IFQge1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuXG4gICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZVxuICAgIGlmIChyZXN1bHQgJiYgdHlwZW9mIChyZXN1bHQgYXMgYW55KS50aGVuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBIYW5kbGUgYXN5bmMgbWV0aG9kXG4gICAgICByZXR1cm4gKHJlc3VsdCBhcyBhbnkpXG4gICAgICAgIC50aGVuKCh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgICAgICAgIG9uRmluaXNoKHRydWUsIHZhbHVlKTtcbiAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgICBvbkZpbmlzaChmYWxzZSwgdW5kZWZpbmVkLCBlcnJvcik7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBzeW5jIG1ldGhvZFxuICAgIG9uRmluaXNoKHRydWUsIHJlc3VsdCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBvbkZpbmlzaChmYWxzZSwgdW5kZWZpbmVkLCBlcnJvcik7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuIl19