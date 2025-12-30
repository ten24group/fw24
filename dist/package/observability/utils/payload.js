"use strict";
/**
 * Payload utilities for observability
 *
 * Handles payload truncation and size estimation for DynamoDB storage
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeStringify = safeStringify;
exports.truncatePayload = truncatePayload;
exports.isTruncated = isTruncated;
exports.estimateItemSize = estimateItemSize;
exports.isPayloadWithinLimits = isPayloadWithinLimits;
exports.safeSerialize = safeSerialize;
exports.truncateItem = truncateItem;
// Maximum payload size to prevent DynamoDB item size limits
const MAX_PAYLOAD_BYTES = 350 * 1024; // 350KB (leaving room for other fields)
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * Safely convert an input into a JSON-serializable-ish shape, handling circular references.
 *
 * NOTE: This intentionally preserves `undefined` (JSON drops it in objects; arrays stringify it as null).
 */
function safeStringify(value, visited = new WeakSet()) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (visited.has(value)) {
        return '[Circular]';
    }
    visited.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => safeStringify(item, visited));
    }
    const result = {};
    for (const [key, val] of Object.entries(value)) {
        result[key] = safeStringify(val, visited);
    }
    visited.delete(value);
    return result;
}
/**
 * Truncate payload if it exceeds max size
 *
 * @returns Original payload if within limits, or TruncationMetadata if too large.
 *          Check for `_truncated` property to detect truncation.
 */
function truncatePayload(payload, maxBytes = MAX_PAYLOAD_BYTES) {
    const safePayload = safeStringify(payload);
    let serialized;
    try {
        serialized = JSON.stringify(safePayload);
    }
    catch {
        return {
            _truncated: true,
            _originalSize: -1,
            _preview: '[unserializable]',
        };
    }
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    if (byteSize <= maxBytes) {
        return payload;
    }
    return {
        _truncated: true,
        _originalSize: byteSize,
        _preview: serialized.substring(0, 1000) + '...[TRUNCATED]',
    };
}
/**
 * Check if a value is truncation metadata
 */
function isTruncated(value) {
    return (typeof value === 'object' &&
        value !== null &&
        '_truncated' in value &&
        value._truncated === true);
}
/**
 * Estimate the size of an item when stored in DynamoDB
 *
 * DynamoDB calculates item size as:
 * - String: UTF-8 encoded length
 * - Number: up to 38 significant digits + 2 bytes
 * - Binary: raw byte length
 * - Map/List: sum of element sizes + overhead
 * - Set: sum of element sizes
 * - Null: 1 byte
 * - Boolean: 1 byte
 *
 * This is an approximation using JSON.stringify length as a proxy
 */
function estimateItemSize(item) {
    try {
        const json = JSON.stringify(item);
        // JSON length is a reasonable approximation
        // Add 20% overhead for DynamoDB's internal representation
        return Math.ceil(json.length * 1.2);
    }
    catch {
        // If serialization fails, return max size to be safe
        return Number.MAX_SAFE_INTEGER;
    }
}
/**
 * Check if a payload is within DynamoDB limits
 */
function isPayloadWithinLimits(payload, maxBytes = MAX_PAYLOAD_BYTES) {
    return estimateItemSize(payload) <= maxBytes;
}
/**
 * Safely serialize a value for logging/audit (truncate if needed)
 * Use this for capturing method arguments, return values, etc.
 *
 * @param value - Value to serialize
 * @param maxLength - Max string length (default 1000)
 * @returns Serializable value or '[unserializable]' if fails
 */
function safeSerialize(value, maxLength = 1000) {
    try {
        const sanitized = safeStringify(value);
        const str = JSON.stringify(sanitized);
        if (str === undefined) {
            return '[unserializable]';
        }
        if (str.length > maxLength) {
            return str.substring(0, maxLength) + '...[truncated]';
        }
        return sanitized;
    }
    catch {
        return '[unserializable]';
    }
}
/**
 * Truncate specific fields in an item.
 * Used as alternative to compression when guaranteed size limits are required.
 */
function truncateItem(item, fields, maxBytes) {
    const result = { ...item };
    for (const field of fields) {
        if (field in result && result[field] !== undefined) {
            result[field] = truncatePayload(result[field], maxBytes);
        }
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bG9hZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL3BheWxvYWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7O0FBMEJILHNDQXNCQztBQWlCRCwwQ0EyQkM7QUFLRCxrQ0FPQztBQWdCRCw0Q0FVQztBQUtELHNEQUVDO0FBVUQsc0NBY0M7QUFNRCxvQ0FjQztBQW5MRCw0REFBNEQ7QUFDNUQsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsd0NBQXdDO0FBYzlFLFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLElBQUksQ0FBQztBQUNyRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQWdCLGFBQWEsQ0FBQyxLQUFjLEVBQUUsVUFBVSxJQUFJLE9BQU8sRUFBVTtJQUMzRSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDaEQsT0FBTyxLQUEwQixDQUFDO0lBQ3BDLENBQUM7SUFFRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBZSxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLFlBQVksQ0FBQztJQUN0QixDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFlLENBQUMsQ0FBQztJQUU3QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN6QixPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQTRCLEVBQUUsQ0FBQztJQUMzQyxLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsR0FBRyxDQUFF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TyxrQkFBa0IsQ0FBQztJQUM1QixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLFlBQVksQ0FDMUIsSUFBTyxFQUNQLE1BQTZCLEVBQzdCLFFBQWdCO0lBRWhCLE1BQU0sTUFBTSxHQUFHLEVBQUUsR0FBRyxJQUFJLEVBQTZCLENBQUM7SUFFdEQsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUMzQixJQUFJLEtBQUssSUFBSSxNQUFNLElBQUksTUFBTSxDQUFFLEtBQUssQ0FBRSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3JELE1BQU0sQ0FBRSxLQUFLLENBQUUsR0FBRyxlQUFlLENBQUMsTUFBTSxDQUFFLEtBQUssQ0FBRSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQy9ELENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxNQUFXLENBQUM7QUFDckIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUGF5bG9hZCB1dGlsaXRpZXMgZm9yIG9ic2VydmFiaWxpdHlcbiAqIFxuICogSGFuZGxlcyBwYXlsb2FkIHRydW5jYXRpb24gYW5kIHNpemUgZXN0aW1hdGlvbiBmb3IgRHluYW1vREIgc3RvcmFnZVxuICovXG5cbi8vIE1heGltdW0gcGF5bG9hZCBzaXplIHRvIHByZXZlbnQgRHluYW1vREIgaXRlbSBzaXplIGxpbWl0c1xuY29uc3QgTUFYX1BBWUxPQURfQllURVMgPSAzNTAgKiAxMDI0OyAvLyAzNTBLQiAobGVhdmluZyByb29tIGZvciBvdGhlciBmaWVsZHMpXG5cbi8qKlxuICogU2FmZWx5IHN0cmluZ2lmeSBhbiBvYmplY3QsIGhhbmRsaW5nIGNpcmN1bGFyIHJlZmVyZW5jZXNcbiAqL1xuZXhwb3J0IHR5cGUgU2VyaWFsaXphYmxlVmFsdWUgPVxuICB8IHN0cmluZ1xuICB8IG51bWJlclxuICB8IGJvb2xlYW5cbiAgfCBudWxsXG4gIHwgdW5kZWZpbmVkXG4gIHwgU2VyaWFsaXphYmxlVmFsdWVbXVxuICB8IHsgWyBrZXk6IHN0cmluZyBdOiBTZXJpYWxpemFibGVWYWx1ZSB9O1xuXG5mdW5jdGlvbiBpc09iamVjdCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIG9iamVjdCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsO1xufVxuXG4vKipcbiAqIFNhZmVseSBjb252ZXJ0IGFuIGlucHV0IGludG8gYSBKU09OLXNlcmlhbGl6YWJsZS1pc2ggc2hhcGUsIGhhbmRsaW5nIGNpcmN1bGFyIHJlZmVyZW5jZXMuXG4gKlxuICogTk9URTogVGhpcyBpbnRlbnRpb25hbGx5IHByZXNlcnZlcyBgdW5kZWZpbmVkYCAoSlNPTiBkcm9wcyBpdCBpbiBvYmplY3RzOyBhcnJheXMgc3RyaW5naWZ5IGl0IGFzIG51bGwpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FmZVN0cmluZ2lmeSh2YWx1ZTogdW5rbm93biwgdmlzaXRlZCA9IG5ldyBXZWFrU2V0PG9iamVjdD4oKSk6IFNlcmlhbGl6YWJsZVZhbHVlIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gdmFsdWUgYXMgU2VyaWFsaXphYmxlVmFsdWU7XG4gIH1cblxuICBpZiAodmlzaXRlZC5oYXModmFsdWUgYXMgb2JqZWN0KSkge1xuICAgIHJldHVybiAnW0NpcmN1bGFyXSc7XG4gIH1cblxuICB2aXNpdGVkLmFkZCh2YWx1ZSBhcyBvYmplY3QpO1xuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5tYXAoKGl0ZW0pID0+IHNhZmVTdHJpbmdpZnkoaXRlbSwgdmlzaXRlZCkpO1xuICB9XG5cbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFsga2V5LCB2YWwgXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIHtcbiAgICByZXN1bHRbIGtleSBdID0gc2FmZVN0cmluZ2lmeSh2YWwsIHZpc2l0ZWQpO1xuICB9XG5cbiAgdmlzaXRlZC5kZWxldGUodmFsdWUgYXMgb2JqZWN0KTtcbiAgcmV0dXJuIHJlc3VsdCBhcyBTZXJpYWxpemFibGVWYWx1ZTtcbn1cblxuLyoqXG4gKiBUcnVuY2F0aW9uIG1ldGFkYXRhIC0gcmVwbGFjZXMgcGF5bG9hZCB3aGVuIGl0IGV4Y2VlZHMgc2l6ZSBsaW1pdHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcnVuY2F0aW9uTWV0YWRhdGEge1xuICBfdHJ1bmNhdGVkOiB0cnVlO1xuICBfb3JpZ2luYWxTaXplOiBudW1iZXI7XG4gIF9wcmV2aWV3OiBzdHJpbmc7XG59XG5cbi8qKlxuICogVHJ1bmNhdGUgcGF5bG9hZCBpZiBpdCBleGNlZWRzIG1heCBzaXplXG4gKiBcbiAqIEByZXR1cm5zIE9yaWdpbmFsIHBheWxvYWQgaWYgd2l0aGluIGxpbWl0cywgb3IgVHJ1bmNhdGlvbk1ldGFkYXRhIGlmIHRvbyBsYXJnZS5cbiAqICAgICAgICAgIENoZWNrIGZvciBgX3RydW5jYXRlZGAgcHJvcGVydHkgdG8gZGV0ZWN0IHRydW5jYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZVBheWxvYWQ8VD4oXG4gIHBheWxvYWQ6IFQsXG4gIG1heEJ5dGVzOiBudW1iZXIgPSBNQVhfUEFZTE9BRF9CWVRFU1xuKTogVCB8IFRydW5jYXRpb25NZXRhZGF0YSB7XG4gIGNvbnN0IHNhZmVQYXlsb2FkID0gc2FmZVN0cmluZ2lmeShwYXlsb2FkKTtcbiAgbGV0IHNlcmlhbGl6ZWQ6IHN0cmluZztcblxuICB0cnkge1xuICAgIHNlcmlhbGl6ZWQgPSBKU09OLnN0cmluZ2lmeShzYWZlUGF5bG9hZCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7XG4gICAgICBfdHJ1bmNhdGVkOiB0cnVlLFxuICAgICAgX29yaWdpbmFsU2l6ZTogLTEsXG4gICAgICBfcHJldmlldzogJ1t1bnNlcmlhbGl6YWJsZV0nLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBieXRlU2l6ZSA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHNlcmlhbGl6ZWQsICd1dGY4Jyk7XG4gIGlmIChieXRlU2l6ZSA8PSBtYXhCeXRlcykge1xuICAgIHJldHVybiBwYXlsb2FkO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBfdHJ1bmNhdGVkOiB0cnVlLFxuICAgIF9vcmlnaW5hbFNpemU6IGJ5dGVTaXplLFxuICAgIF9wcmV2aWV3OiBzZXJpYWxpemVkLnN1YnN0cmluZygwLCAxMDAwKSArICcuLi5bVFJVTkNBVEVEXScsXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSB2YWx1ZSBpcyB0cnVuY2F0aW9uIG1ldGFkYXRhXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1RydW5jYXRlZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFRydW5jYXRpb25NZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgJ190cnVuY2F0ZWQnIGluIHZhbHVlICYmXG4gICAgKHZhbHVlIGFzIFRydW5jYXRpb25NZXRhZGF0YSkuX3RydW5jYXRlZCA9PT0gdHJ1ZVxuICApO1xufVxuXG4vKipcbiAqIEVzdGltYXRlIHRoZSBzaXplIG9mIGFuIGl0ZW0gd2hlbiBzdG9yZWQgaW4gRHluYW1vREJcbiAqIFxuICogRHluYW1vREIgY2FsY3VsYXRlcyBpdGVtIHNpemUgYXM6XG4gKiAtIFN0cmluZzogVVRGLTggZW5jb2RlZCBsZW5ndGhcbiAqIC0gTnVtYmVyOiB1cCB0byAzOCBzaWduaWZpY2FudCBkaWdpdHMgKyAyIGJ5dGVzXG4gKiAtIEJpbmFyeTogcmF3IGJ5dGUgbGVuZ3RoXG4gKiAtIE1hcC9MaXN0OiBzdW0gb2YgZWxlbWVudCBzaXplcyArIG92ZXJoZWFkXG4gKiAtIFNldDogc3VtIG9mIGVsZW1lbnQgc2l6ZXNcbiAqIC0gTnVsbDogMSBieXRlXG4gKiAtIEJvb2xlYW46IDEgYnl0ZVxuICogXG4gKiBUaGlzIGlzIGFuIGFwcHJveGltYXRpb24gdXNpbmcgSlNPTi5zdHJpbmdpZnkgbGVuZ3RoIGFzIGEgcHJveHlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVzdGltYXRlSXRlbVNpemUoaXRlbTogdW5rbm93bik6IG51bWJlciB7XG4gIHRyeSB7XG4gICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KGl0ZW0pO1xuICAgIC8vIEpTT04gbGVuZ3RoIGlzIGEgcmVhc29uYWJsZSBhcHByb3hpbWF0aW9uXG4gICAgLy8gQWRkIDIwJSBvdmVyaGVhZCBmb3IgRHluYW1vREIncyBpbnRlcm5hbCByZXByZXNlbnRhdGlvblxuICAgIHJldHVybiBNYXRoLmNlaWwoanNvbi5sZW5ndGggKiAxLjIpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBJZiBzZXJpYWxpemF0aW9uIGZhaWxzLCByZXR1cm4gbWF4IHNpemUgdG8gYmUgc2FmZVxuICAgIHJldHVybiBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUjtcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgcGF5bG9hZCBpcyB3aXRoaW4gRHluYW1vREIgbGltaXRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1BheWxvYWRXaXRoaW5MaW1pdHMocGF5bG9hZDogdW5rbm93biwgbWF4Qnl0ZXM6IG51bWJlciA9IE1BWF9QQVlMT0FEX0JZVEVTKTogYm9vbGVhbiB7XG4gIHJldHVybiBlc3RpbWF0ZUl0ZW1TaXplKHBheWxvYWQpIDw9IG1heEJ5dGVzO1xufVxuXG4vKipcbiAqIFNhZmVseSBzZXJpYWxpemUgYSB2YWx1ZSBmb3IgbG9nZ2luZy9hdWRpdCAodHJ1bmNhdGUgaWYgbmVlZGVkKVxuICogVXNlIHRoaXMgZm9yIGNhcHR1cmluZyBtZXRob2QgYXJndW1lbnRzLCByZXR1cm4gdmFsdWVzLCBldGMuXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIFZhbHVlIHRvIHNlcmlhbGl6ZVxuICogQHBhcmFtIG1heExlbmd0aCAtIE1heCBzdHJpbmcgbGVuZ3RoIChkZWZhdWx0IDEwMDApXG4gKiBAcmV0dXJucyBTZXJpYWxpemFibGUgdmFsdWUgb3IgJ1t1bnNlcmlhbGl6YWJsZV0nIGlmIGZhaWxzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYWZlU2VyaWFsaXplKHZhbHVlOiB1bmtub3duLCBtYXhMZW5ndGg6IG51bWJlciA9IDEwMDApOiB1bmtub3duIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzYW5pdGl6ZWQgPSBzYWZlU3RyaW5naWZ5KHZhbHVlKTtcbiAgICBjb25zdCBzdHIgPSBKU09OLnN0cmluZ2lmeShzYW5pdGl6ZWQpO1xuICAgIGlmIChzdHIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuICdbdW5zZXJpYWxpemFibGVdJztcbiAgICB9XG4gICAgaWYgKHN0ci5sZW5ndGggPiBtYXhMZW5ndGgpIHtcbiAgICAgIHJldHVybiBzdHIuc3Vic3RyaW5nKDAsIG1heExlbmd0aCkgKyAnLi4uW3RydW5jYXRlZF0nO1xuICAgIH1cbiAgICByZXR1cm4gc2FuaXRpemVkO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ1t1bnNlcmlhbGl6YWJsZV0nO1xuICB9XG59XG5cbi8qKlxuICogVHJ1bmNhdGUgc3BlY2lmaWMgZmllbGRzIGluIGFuIGl0ZW0uXG4gKiBVc2VkIGFzIGFsdGVybmF0aXZlIHRvIGNvbXByZXNzaW9uIHdoZW4gZ3VhcmFudGVlZCBzaXplIGxpbWl0cyBhcmUgcmVxdWlyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZUl0ZW08VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIHVua25vd24+PihcbiAgaXRlbTogVCxcbiAgZmllbGRzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG1heEJ5dGVzOiBudW1iZXJcbik6IFQge1xuICBjb25zdCByZXN1bHQgPSB7IC4uLml0ZW0gfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGZpZWxkcykge1xuICAgIGlmIChmaWVsZCBpbiByZXN1bHQgJiYgcmVzdWx0WyBmaWVsZCBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc3VsdFsgZmllbGQgXSA9IHRydW5jYXRlUGF5bG9hZChyZXN1bHRbIGZpZWxkIF0sIG1heEJ5dGVzKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzdWx0IGFzIFQ7XG59XG4iXX0=