"use strict";
/**
 * Error Fingerprinting Utility
 *
 * Computes a deterministic fingerprint from error properties so that
 * "same error, different invocations" can be grouped together.
 *
 * The fingerprint is a hex string derived from:
 *  - error.type (class name)
 *  - normalized error.message (variable parts stripped)
 *  - normalized stack trace (first few frames, line numbers stripped)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeErrorMessage = normalizeErrorMessage;
exports.normalizeStackTrace = normalizeStackTrace;
exports.computeErrorFingerprint = computeErrorFingerprint;
const crypto_1 = require("crypto");
/** Patterns to strip variable parts from error messages */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_ID_PATTERN = /\b[0-9a-f]{16,}\b/gi;
const NUMERIC_ID_PATTERN = /\b\d{4,}\b/g;
const TIMESTAMP_ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+:-]*/g;
const TIMESTAMP_EPOCH_PATTERN = /\b1[6-9]\d{11}\b/g;
/** Number of stack frames to include in fingerprint */
const MAX_STACK_FRAMES = 3;
/** Pattern to strip line/column numbers from stack frames */
const LINE_COL_PATTERN = /:\d+:\d+\)?$/;
/**
 * Normalize an error message by stripping variable parts (UUIDs, numbers, timestamps).
 * This ensures the same logical error produces the same fingerprint even with different runtime values.
 */
function normalizeErrorMessage(message) {
    return message
        .replace(UUID_PATTERN, '<uuid>')
        .replace(TIMESTAMP_ISO_PATTERN, '<timestamp>')
        .replace(TIMESTAMP_EPOCH_PATTERN, '<epoch>')
        .replace(HEX_ID_PATTERN, '<hex>')
        .replace(NUMERIC_ID_PATTERN, '<n>');
}
/**
 * Extract and normalize the first N stack frames.
 * Strips line/column numbers so minor code shifts don't change the fingerprint.
 */
function normalizeStackTrace(stack) {
    const lines = stack.split('\n');
    const frames = [];
    for (const line of lines) {
        const trimmed = line.trim();
        // Only include "at ..." lines (actual stack frames)
        if (trimmed.startsWith('at ')) {
            // Strip line:col numbers
            const normalized = trimmed.replace(LINE_COL_PATTERN, '');
            frames.push(normalized);
            if (frames.length >= MAX_STACK_FRAMES)
                break;
        }
    }
    return frames.join('\n');
}
/**
 * Compute a deterministic fingerprint for an error.
 *
 * Returns a 16-character hex string (first 8 bytes of SHA-256).
 * The fingerprint is stable across invocations for the same logical error,
 * but may change if the error type, message pattern, or stack trace location changes.
 */
function computeErrorFingerprint(error) {
    const parts = [
        error.type,
        normalizeErrorMessage(error.message),
    ];
    if (error.stack) {
        parts.push(normalizeStackTrace(error.stack));
    }
    const input = parts.join('\n');
    return (0, crypto_1.createHash)('sha256').update(input).digest('hex').substring(0, 16);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItZmluZ2VycHJpbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS91dGlscy9lcnJvci1maW5nZXJwcmludC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7R0FVRzs7QUFzQkgsc0RBT0M7QUFNRCxrREFnQkM7QUFTRCwwREFZQztBQXRFRCxtQ0FBb0M7QUFHcEMsMkRBQTJEO0FBQzNELE1BQU0sWUFBWSxHQUFHLGdFQUFnRSxDQUFDO0FBQ3RGLE1BQU0sY0FBYyxHQUFHLHFCQUFxQixDQUFDO0FBQzdDLE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxDQUFDO0FBQ3pDLE1BQU0scUJBQXFCLEdBQUcsZ0RBQWdELENBQUM7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxtQkFBbUIsQ0FBQztBQUVwRCx1REFBdUQ7QUFDdkQsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLENBQUM7QUFFM0IsNkRBQTZEO0FBQzdELE1BQU0sZ0JBQWdCLEdBQUcsY0FBYyxDQUFDO0FBRXhDOzs7R0FHRztBQUNILFNBQWdCLHFCQUFxQixDQUFDLE9BQWU7SUFDbkQsT0FBTyxPQUFPO1NBQ1gsT0FBTyxDQUFDLFlBQVksRUFBRSxRQUFRLENBQUM7U0FDL0IsT0FBTyxDQUFDLHFCQUFxQixFQUFFLGFBQWEsQ0FBQztTQUM3QyxPQUFPLENBQUMsdUJBQXVCLEVBQUUsU0FBUyxDQUFDO1NBQzNDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsT0FBTyxDQUFDO1NBQ2hDLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUN4QyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQUMsS0FBYTtJQUMvQyxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2hDLE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztJQUU1QixLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3pCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM1QixvREFBb0Q7UUFDcEQsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDOUIseUJBQXlCO1lBQ3pCLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDekQsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUN4QixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksZ0JBQWdCO2dCQUFFLE1BQU07UUFDL0MsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDM0IsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLHVCQUF1QixDQUFDLEtBQXlCO0lBQy9ELE1BQU0sS0FBSyxHQUFhO1FBQ3RCLEtBQUssQ0FBQyxJQUFJO1FBQ1YscUJBQXFCLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQztLQUNyQyxDQUFDO0lBRUYsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDaEIsS0FBSyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRUQsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvQixPQUFPLElBQUEsbUJBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFDM0UsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRXJyb3IgRmluZ2VycHJpbnRpbmcgVXRpbGl0eVxuICogXG4gKiBDb21wdXRlcyBhIGRldGVybWluaXN0aWMgZmluZ2VycHJpbnQgZnJvbSBlcnJvciBwcm9wZXJ0aWVzIHNvIHRoYXRcbiAqIFwic2FtZSBlcnJvciwgZGlmZmVyZW50IGludm9jYXRpb25zXCIgY2FuIGJlIGdyb3VwZWQgdG9nZXRoZXIuXG4gKiBcbiAqIFRoZSBmaW5nZXJwcmludCBpcyBhIGhleCBzdHJpbmcgZGVyaXZlZCBmcm9tOlxuICogIC0gZXJyb3IudHlwZSAoY2xhc3MgbmFtZSlcbiAqICAtIG5vcm1hbGl6ZWQgZXJyb3IubWVzc2FnZSAodmFyaWFibGUgcGFydHMgc3RyaXBwZWQpXG4gKiAgLSBub3JtYWxpemVkIHN0YWNrIHRyYWNlIChmaXJzdCBmZXcgZnJhbWVzLCBsaW5lIG51bWJlcnMgc3RyaXBwZWQpXG4gKi9cblxuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFcnJvciB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqIFBhdHRlcm5zIHRvIHN0cmlwIHZhcmlhYmxlIHBhcnRzIGZyb20gZXJyb3IgbWVzc2FnZXMgKi9cbmNvbnN0IFVVSURfUEFUVEVSTiA9IC9bMC05YS1mXXs4fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXs0fS1bMC05YS1mXXsxMn0vZ2k7XG5jb25zdCBIRVhfSURfUEFUVEVSTiA9IC9cXGJbMC05YS1mXXsxNix9XFxiL2dpO1xuY29uc3QgTlVNRVJJQ19JRF9QQVRURVJOID0gL1xcYlxcZHs0LH1cXGIvZztcbmNvbnN0IFRJTUVTVEFNUF9JU09fUEFUVEVSTiA9IC9cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVsuXFxkWis6LV0qL2c7XG5jb25zdCBUSU1FU1RBTVBfRVBPQ0hfUEFUVEVSTiA9IC9cXGIxWzYtOV1cXGR7MTF9XFxiL2c7XG5cbi8qKiBOdW1iZXIgb2Ygc3RhY2sgZnJhbWVzIHRvIGluY2x1ZGUgaW4gZmluZ2VycHJpbnQgKi9cbmNvbnN0IE1BWF9TVEFDS19GUkFNRVMgPSAzO1xuXG4vKiogUGF0dGVybiB0byBzdHJpcCBsaW5lL2NvbHVtbiBudW1iZXJzIGZyb20gc3RhY2sgZnJhbWVzICovXG5jb25zdCBMSU5FX0NPTF9QQVRURVJOID0gLzpcXGQrOlxcZCtcXCk/JC87XG5cbi8qKlxuICogTm9ybWFsaXplIGFuIGVycm9yIG1lc3NhZ2UgYnkgc3RyaXBwaW5nIHZhcmlhYmxlIHBhcnRzIChVVUlEcywgbnVtYmVycywgdGltZXN0YW1wcykuXG4gKiBUaGlzIGVuc3VyZXMgdGhlIHNhbWUgbG9naWNhbCBlcnJvciBwcm9kdWNlcyB0aGUgc2FtZSBmaW5nZXJwcmludCBldmVuIHdpdGggZGlmZmVyZW50IHJ1bnRpbWUgdmFsdWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplRXJyb3JNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBtZXNzYWdlXG4gICAgLnJlcGxhY2UoVVVJRF9QQVRURVJOLCAnPHV1aWQ+JylcbiAgICAucmVwbGFjZShUSU1FU1RBTVBfSVNPX1BBVFRFUk4sICc8dGltZXN0YW1wPicpXG4gICAgLnJlcGxhY2UoVElNRVNUQU1QX0VQT0NIX1BBVFRFUk4sICc8ZXBvY2g+JylcbiAgICAucmVwbGFjZShIRVhfSURfUEFUVEVSTiwgJzxoZXg+JylcbiAgICAucmVwbGFjZShOVU1FUklDX0lEX1BBVFRFUk4sICc8bj4nKTtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGFuZCBub3JtYWxpemUgdGhlIGZpcnN0IE4gc3RhY2sgZnJhbWVzLlxuICogU3RyaXBzIGxpbmUvY29sdW1uIG51bWJlcnMgc28gbWlub3IgY29kZSBzaGlmdHMgZG9uJ3QgY2hhbmdlIHRoZSBmaW5nZXJwcmludC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVN0YWNrVHJhY2Uoc3RhY2s6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gc3RhY2suc3BsaXQoJ1xcbicpO1xuICBjb25zdCBmcmFtZXM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIC8vIE9ubHkgaW5jbHVkZSBcImF0IC4uLlwiIGxpbmVzIChhY3R1YWwgc3RhY2sgZnJhbWVzKVxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoJ2F0ICcpKSB7XG4gICAgICAvLyBTdHJpcCBsaW5lOmNvbCBudW1iZXJzXG4gICAgICBjb25zdCBub3JtYWxpemVkID0gdHJpbW1lZC5yZXBsYWNlKExJTkVfQ09MX1BBVFRFUk4sICcnKTtcbiAgICAgIGZyYW1lcy5wdXNoKG5vcm1hbGl6ZWQpO1xuICAgICAgaWYgKGZyYW1lcy5sZW5ndGggPj0gTUFYX1NUQUNLX0ZSQU1FUykgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZyYW1lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIGEgZGV0ZXJtaW5pc3RpYyBmaW5nZXJwcmludCBmb3IgYW4gZXJyb3IuXG4gKiBcbiAqIFJldHVybnMgYSAxNi1jaGFyYWN0ZXIgaGV4IHN0cmluZyAoZmlyc3QgOCBieXRlcyBvZiBTSEEtMjU2KS5cbiAqIFRoZSBmaW5nZXJwcmludCBpcyBzdGFibGUgYWNyb3NzIGludm9jYXRpb25zIGZvciB0aGUgc2FtZSBsb2dpY2FsIGVycm9yLFxuICogYnV0IG1heSBjaGFuZ2UgaWYgdGhlIGVycm9yIHR5cGUsIG1lc3NhZ2UgcGF0dGVybiwgb3Igc3RhY2sgdHJhY2UgbG9jYXRpb24gY2hhbmdlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVFcnJvckZpbmdlcnByaW50KGVycm9yOiBPYnNlcnZhYmlsaXR5RXJyb3IpOiBzdHJpbmcge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXG4gICAgZXJyb3IudHlwZSxcbiAgICBub3JtYWxpemVFcnJvck1lc3NhZ2UoZXJyb3IubWVzc2FnZSksXG4gIF07XG5cbiAgaWYgKGVycm9yLnN0YWNrKSB7XG4gICAgcGFydHMucHVzaChub3JtYWxpemVTdGFja1RyYWNlKGVycm9yLnN0YWNrKSk7XG4gIH1cblxuICBjb25zdCBpbnB1dCA9IHBhcnRzLmpvaW4oJ1xcbicpO1xuICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGlucHV0KS5kaWdlc3QoJ2hleCcpLnN1YnN0cmluZygwLCAxNik7XG59XG4iXX0=