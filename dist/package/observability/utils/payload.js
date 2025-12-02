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
// Maximum payload size to prevent DynamoDB item size limits
const MAX_PAYLOAD_BYTES = 350 * 1024; // 350KB (leaving room for other fields)
/**
 * Safely stringify an object, handling circular references
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
        const str = JSON.stringify(value);
        if (str.length > maxLength) {
            return str.substring(0, maxLength) + '...[truncated]';
        }
        return value;
    }
    catch {
        return '[unserializable]';
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bG9hZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL3BheWxvYWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7O0FBUUgsc0NBc0JDO0FBaUJELDBDQTJCQztBQUtELGtDQU9DO0FBZ0JELDRDQVVDO0FBS0Qsc0RBRUM7QUFVRCxzQ0FVQztBQXpJRCw0REFBNEQ7QUFDNUQsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsd0NBQXdDO0FBRTlFOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEtBQWMsRUFBRSxVQUFVLElBQUksT0FBTyxFQUFVO0lBQzNFLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNoRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN2QixPQUFPLFlBQVksQ0FBQztJQUN0QixDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUVuQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN6QixPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQTRCLEVBQUUsQ0FBQztJQUMzQyxLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsR0FBRyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ2pELE1BQU0sQ0FBRSxHQUFHLENBQUUsR0FBRyxhQUFhLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFRCxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3RCLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFXRDs7Ozs7R0FLRztBQUNILFNBQWdCLGVBQWUsQ0FDN0IsT0FBVSxFQUNWLFdBQW1CLGlCQUFpQjtJQUVwQyxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDM0MsSUFBSSxVQUFrQixDQUFDO0lBRXZCLElBQUksQ0FBQztRQUNILFVBQVUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFBQyxNQUFNLENBQUM7UUFDUCxPQUFPO1lBQ0wsVUFBVSxFQUFFLElBQUk7WUFDaEIsYUFBYSxFQUFFLENBQUMsQ0FBQztZQUNqQixRQUFRLEVBQUUsa0JBQWtCO1NBQzdCLENBQUM7SUFDSixDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDdkQsSUFBSSxRQUFRLElBQUksUUFBUSxFQUFFLENBQUM7UUFDekIsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztJQUVELE9BQU87UUFDTCxVQUFVLEVBQUUsSUFBSTtRQUNoQixhQUFhLEVBQUUsUUFBUTtRQUN2QixRQUFRLEVBQUUsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsZ0JBQWdCO0tBQzNELENBQUM7QUFDSixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixXQUFXLENBQUMsS0FBYztJQUN4QyxPQUFPLENBQ0wsT0FBTyxLQUFLLEtBQUssUUFBUTtRQUN6QixLQUFLLEtBQUssSUFBSTtRQUNkLFlBQVksSUFBSSxLQUFLO1FBQ3BCLEtBQTRCLENBQUMsVUFBVSxLQUFLLElBQUksQ0FDbEQsQ0FBQztBQUNKLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQUMsSUFBYTtJQUM1QyxJQUFJLENBQUM7UUFDSCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2xDLDRDQUE0QztRQUM1QywwREFBMEQ7UUFDMUQsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLHFEQUFxRDtRQUNyRCxPQUFPLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztJQUNqQyxDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IscUJBQXFCLENBQUMsT0FBZ0IsRUFBRSxXQUFtQixpQkFBaUI7SUFDMUYsT0FBTyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxRQUFRLENBQUM7QUFDL0MsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFnQixhQUFhLENBQUMsS0FBYyxFQUFFLFlBQW9CLElBQUk7SUFDcEUsSUFBSSxDQUFDO1FBQ0gsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNsQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsU0FBUyxFQUFFLENBQUM7WUFDM0IsT0FBTyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQztRQUN4RCxDQUFDO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxrQkFBa0IsQ0FBQztJQUM1QixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUGF5bG9hZCB1dGlsaXRpZXMgZm9yIG9ic2VydmFiaWxpdHlcbiAqIFxuICogSGFuZGxlcyBwYXlsb2FkIHRydW5jYXRpb24gYW5kIHNpemUgZXN0aW1hdGlvbiBmb3IgRHluYW1vREIgc3RvcmFnZVxuICovXG5cbi8vIE1heGltdW0gcGF5bG9hZCBzaXplIHRvIHByZXZlbnQgRHluYW1vREIgaXRlbSBzaXplIGxpbWl0c1xuY29uc3QgTUFYX1BBWUxPQURfQllURVMgPSAzNTAgKiAxMDI0OyAvLyAzNTBLQiAobGVhdmluZyByb29tIGZvciBvdGhlciBmaWVsZHMpXG5cbi8qKlxuICogU2FmZWx5IHN0cmluZ2lmeSBhbiBvYmplY3QsIGhhbmRsaW5nIGNpcmN1bGFyIHJlZmVyZW5jZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhZmVTdHJpbmdpZnkodmFsdWU6IHVua25vd24sIHZpc2l0ZWQgPSBuZXcgV2Vha1NldDxvYmplY3Q+KCkpOiB1bmtub3duIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICBpZiAodmlzaXRlZC5oYXModmFsdWUpKSB7XG4gICAgcmV0dXJuICdbQ2lyY3VsYXJdJztcbiAgfVxuXG4gIHZpc2l0ZWQuYWRkKHZhbHVlKTtcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUubWFwKChpdGVtKSA9PiBzYWZlU3RyaW5naWZ5KGl0ZW0sIHZpc2l0ZWQpKTtcbiAgfVxuXG4gIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGtleSwgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgcmVzdWx0WyBrZXkgXSA9IHNhZmVTdHJpbmdpZnkodmFsLCB2aXNpdGVkKTtcbiAgfVxuXG4gIHZpc2l0ZWQuZGVsZXRlKHZhbHVlKTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBUcnVuY2F0aW9uIG1ldGFkYXRhIC0gcmVwbGFjZXMgcGF5bG9hZCB3aGVuIGl0IGV4Y2VlZHMgc2l6ZSBsaW1pdHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcnVuY2F0aW9uTWV0YWRhdGEge1xuICBfdHJ1bmNhdGVkOiB0cnVlO1xuICBfb3JpZ2luYWxTaXplOiBudW1iZXI7XG4gIF9wcmV2aWV3OiBzdHJpbmc7XG59XG5cbi8qKlxuICogVHJ1bmNhdGUgcGF5bG9hZCBpZiBpdCBleGNlZWRzIG1heCBzaXplXG4gKiBcbiAqIEByZXR1cm5zIE9yaWdpbmFsIHBheWxvYWQgaWYgd2l0aGluIGxpbWl0cywgb3IgVHJ1bmNhdGlvbk1ldGFkYXRhIGlmIHRvbyBsYXJnZS5cbiAqICAgICAgICAgIENoZWNrIGZvciBgX3RydW5jYXRlZGAgcHJvcGVydHkgdG8gZGV0ZWN0IHRydW5jYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZVBheWxvYWQ8VD4oXG4gIHBheWxvYWQ6IFQsXG4gIG1heEJ5dGVzOiBudW1iZXIgPSBNQVhfUEFZTE9BRF9CWVRFU1xuKTogVCB8IFRydW5jYXRpb25NZXRhZGF0YSB7XG4gIGNvbnN0IHNhZmVQYXlsb2FkID0gc2FmZVN0cmluZ2lmeShwYXlsb2FkKTtcbiAgbGV0IHNlcmlhbGl6ZWQ6IHN0cmluZztcblxuICB0cnkge1xuICAgIHNlcmlhbGl6ZWQgPSBKU09OLnN0cmluZ2lmeShzYWZlUGF5bG9hZCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7XG4gICAgICBfdHJ1bmNhdGVkOiB0cnVlLFxuICAgICAgX29yaWdpbmFsU2l6ZTogLTEsXG4gICAgICBfcHJldmlldzogJ1t1bnNlcmlhbGl6YWJsZV0nLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBieXRlU2l6ZSA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHNlcmlhbGl6ZWQsICd1dGY4Jyk7XG4gIGlmIChieXRlU2l6ZSA8PSBtYXhCeXRlcykge1xuICAgIHJldHVybiBwYXlsb2FkO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBfdHJ1bmNhdGVkOiB0cnVlLFxuICAgIF9vcmlnaW5hbFNpemU6IGJ5dGVTaXplLFxuICAgIF9wcmV2aWV3OiBzZXJpYWxpemVkLnN1YnN0cmluZygwLCAxMDAwKSArICcuLi5bVFJVTkNBVEVEXScsXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSB2YWx1ZSBpcyB0cnVuY2F0aW9uIG1ldGFkYXRhXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1RydW5jYXRlZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFRydW5jYXRpb25NZXRhZGF0YSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgJ190cnVuY2F0ZWQnIGluIHZhbHVlICYmXG4gICAgKHZhbHVlIGFzIFRydW5jYXRpb25NZXRhZGF0YSkuX3RydW5jYXRlZCA9PT0gdHJ1ZVxuICApO1xufVxuXG4vKipcbiAqIEVzdGltYXRlIHRoZSBzaXplIG9mIGFuIGl0ZW0gd2hlbiBzdG9yZWQgaW4gRHluYW1vREJcbiAqIFxuICogRHluYW1vREIgY2FsY3VsYXRlcyBpdGVtIHNpemUgYXM6XG4gKiAtIFN0cmluZzogVVRGLTggZW5jb2RlZCBsZW5ndGhcbiAqIC0gTnVtYmVyOiB1cCB0byAzOCBzaWduaWZpY2FudCBkaWdpdHMgKyAyIGJ5dGVzXG4gKiAtIEJpbmFyeTogcmF3IGJ5dGUgbGVuZ3RoXG4gKiAtIE1hcC9MaXN0OiBzdW0gb2YgZWxlbWVudCBzaXplcyArIG92ZXJoZWFkXG4gKiAtIFNldDogc3VtIG9mIGVsZW1lbnQgc2l6ZXNcbiAqIC0gTnVsbDogMSBieXRlXG4gKiAtIEJvb2xlYW46IDEgYnl0ZVxuICogXG4gKiBUaGlzIGlzIGFuIGFwcHJveGltYXRpb24gdXNpbmcgSlNPTi5zdHJpbmdpZnkgbGVuZ3RoIGFzIGEgcHJveHlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVzdGltYXRlSXRlbVNpemUoaXRlbTogdW5rbm93bik6IG51bWJlciB7XG4gIHRyeSB7XG4gICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KGl0ZW0pO1xuICAgIC8vIEpTT04gbGVuZ3RoIGlzIGEgcmVhc29uYWJsZSBhcHByb3hpbWF0aW9uXG4gICAgLy8gQWRkIDIwJSBvdmVyaGVhZCBmb3IgRHluYW1vREIncyBpbnRlcm5hbCByZXByZXNlbnRhdGlvblxuICAgIHJldHVybiBNYXRoLmNlaWwoanNvbi5sZW5ndGggKiAxLjIpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBJZiBzZXJpYWxpemF0aW9uIGZhaWxzLCByZXR1cm4gbWF4IHNpemUgdG8gYmUgc2FmZVxuICAgIHJldHVybiBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUjtcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgcGF5bG9hZCBpcyB3aXRoaW4gRHluYW1vREIgbGltaXRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1BheWxvYWRXaXRoaW5MaW1pdHMocGF5bG9hZDogdW5rbm93biwgbWF4Qnl0ZXM6IG51bWJlciA9IE1BWF9QQVlMT0FEX0JZVEVTKTogYm9vbGVhbiB7XG4gIHJldHVybiBlc3RpbWF0ZUl0ZW1TaXplKHBheWxvYWQpIDw9IG1heEJ5dGVzO1xufVxuXG4vKipcbiAqIFNhZmVseSBzZXJpYWxpemUgYSB2YWx1ZSBmb3IgbG9nZ2luZy9hdWRpdCAodHJ1bmNhdGUgaWYgbmVlZGVkKVxuICogVXNlIHRoaXMgZm9yIGNhcHR1cmluZyBtZXRob2QgYXJndW1lbnRzLCByZXR1cm4gdmFsdWVzLCBldGMuXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIFZhbHVlIHRvIHNlcmlhbGl6ZVxuICogQHBhcmFtIG1heExlbmd0aCAtIE1heCBzdHJpbmcgbGVuZ3RoIChkZWZhdWx0IDEwMDApXG4gKiBAcmV0dXJucyBTZXJpYWxpemFibGUgdmFsdWUgb3IgJ1t1bnNlcmlhbGl6YWJsZV0nIGlmIGZhaWxzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYWZlU2VyaWFsaXplKHZhbHVlOiB1bmtub3duLCBtYXhMZW5ndGg6IG51bWJlciA9IDEwMDApOiB1bmtub3duIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdHIgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgaWYgKHN0ci5sZW5ndGggPiBtYXhMZW5ndGgpIHtcbiAgICAgIHJldHVybiBzdHIuc3Vic3RyaW5nKDAsIG1heExlbmd0aCkgKyAnLi4uW3RydW5jYXRlZF0nO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnW3Vuc2VyaWFsaXphYmxlXSc7XG4gIH1cbn1cbiJdfQ==