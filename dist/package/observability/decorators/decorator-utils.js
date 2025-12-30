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
        // Check if result is a Promise (framework standard).
        // We intentionally do NOT treat arbitrary "thenables" as promises to avoid unsafe casting.
        if (result instanceof Promise) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVjb3JhdG9yLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9kZWNvcmF0b3ItdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQWFILGtEQThCQztBQXZDRCxzREFBc0Q7QUFBN0MsNkdBQUEsYUFBYSxPQUFBO0FBRXRCOzs7Ozs7R0FNRztBQUNILFNBQWdCLG1CQUFtQixDQUNqQyxjQUFpQixFQUNqQixPQUE2QixFQUM3QixJQUFtQixFQUNuQixRQUF1RTtJQUV2RSxJQUFJLENBQUM7UUFDSCxNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVuRCxxREFBcUQ7UUFDckQsMkZBQTJGO1FBQzNGLElBQUksTUFBTSxZQUFZLE9BQU8sRUFBRSxDQUFDO1lBQzlCLE9BQU8sTUFBTTtpQkFDVixJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDZCxRQUFRLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUN0QixPQUFPLEtBQUssQ0FBQztZQUNmLENBQUMsQ0FBQztpQkFDRCxLQUFLLENBQUMsQ0FBQyxLQUFjLEVBQUUsRUFBRTtnQkFDeEIsUUFBUSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQ2xDLE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQyxDQUFrQixDQUFDO1FBQ3hCLENBQUM7UUFFRCxxQkFBcUI7UUFDckIsUUFBUSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN2QixPQUFPLE1BQXVCLENBQUM7SUFDakMsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixRQUFRLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNsQyxNQUFNLEtBQUssQ0FBQztJQUNkLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTaGFyZWQgdXRpbGl0aWVzIGZvciBvYnNlcnZhYmlsaXR5IGRlY29yYXRvcnNcbiAqIFxuICogRWxpbWluYXRlcyBkdXBsaWNhdGlvbiBhY3Jvc3MgQE9ic2VydmVkLCBAVHJhY2VkLCBAQXVkaXRlZFxuICovXG5cbi8vIFJlLWV4cG9ydCBmcm9tIHR5cGVzIGZvciB0eXBlIGNvbnNpc3RlbmN5XG5leHBvcnQgdHlwZSB7IFNvdXJjZVR5cGUgfSBmcm9tICcuLi90eXBlcyc7XG5leHBvcnQgeyByZXNvbHZlU291cmNlIH0gZnJvbSAnLi4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuLyoqXG4gKiBFeGVjdXRlIGEgbWV0aG9kIHdpdGggY2FsbGJhY2tzIGZvciBzdWNjZXNzL2Vycm9yIGhhbmRsaW5nLlxuICogQXV0b21hdGljYWxseSBkZXRlY3RzIHN5bmMgdnMgYXN5bmMgYW5kIGNhbGxzIGFwcHJvcHJpYXRlIGNhbGxiYWNrcy5cbiAqIFxuICogVGhpcyBlbGltaW5hdGVzIHRoZSA0LXBhdGggZHVwbGljYXRpb24gKGFzeW5jLXN1Y2Nlc3MsIGFzeW5jLWVycm9yLCBzeW5jLXN1Y2Nlc3MsIHN5bmMtZXJyb3IpXG4gKiB0aGF0IHdhcyBwcmVzZW50IGluIGFsbCBkZWNvcmF0b3JzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhlY3V0ZVdpdGhIYW5kbGVyczxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+KFxuICBvcmlnaW5hbE1ldGhvZDogVCxcbiAgY29udGV4dDogVGhpc1BhcmFtZXRlclR5cGU8VD4sXG4gIGFyZ3M6IFBhcmFtZXRlcnM8VD4sXG4gIG9uRmluaXNoOiAoc3VjY2VzczogYm9vbGVhbiwgcmVzdWx0PzogdW5rbm93biwgZXJyb3I/OiB1bmtub3duKSA9PiB2b2lkXG4pOiBSZXR1cm5UeXBlPFQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseShjb250ZXh0LCBhcmdzKTtcblxuICAgIC8vIENoZWNrIGlmIHJlc3VsdCBpcyBhIFByb21pc2UgKGZyYW1ld29yayBzdGFuZGFyZCkuXG4gICAgLy8gV2UgaW50ZW50aW9uYWxseSBkbyBOT1QgdHJlYXQgYXJiaXRyYXJ5IFwidGhlbmFibGVzXCIgYXMgcHJvbWlzZXMgdG8gYXZvaWQgdW5zYWZlIGNhc3RpbmcuXG4gICAgaWYgKHJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgb25GaW5pc2godHJ1ZSwgdmFsdWUpO1xuICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICAgIG9uRmluaXNoKGZhbHNlLCB1bmRlZmluZWQsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSkgYXMgUmV0dXJuVHlwZTxUPjtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgc3luYyBtZXRob2RcbiAgICBvbkZpbmlzaCh0cnVlLCByZXN1bHQpO1xuICAgIHJldHVybiByZXN1bHQgYXMgUmV0dXJuVHlwZTxUPjtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBvbkZpbmlzaChmYWxzZSwgdW5kZWZpbmVkLCBlcnJvcik7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuIl19