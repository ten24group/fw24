"use strict";
/**
 * Payload utilities for observability
 *
 * Handles payload serialization with depth control and truncation for storage optimization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeStringify = safeStringify;
exports.safeSerialize = safeSerialize;
exports.truncatePayload = truncatePayload;
exports.isTruncated = isTruncated;
exports.estimateItemSize = estimateItemSize;
exports.isPayloadWithinLimits = isPayloadWithinLimits;
exports.truncateItem = truncateItem;
const datatypes_1 = require("../../utils/datatypes");
const serialize_1 = require("../../utils/serialize");
// Maximum payload size to prevent DynamoDB item size limits
const MAX_PAYLOAD_BYTES = 350 * 1024; // 350KB (leaving room for other fields)
/**
 * Safely stringify an object with depth control and circular reference handling.
 * Uses framework's existing serialization utilities.
 *
 * @param value - Value to serialize
 * @param options - Serialization options
 * @param currentDepth - Internal: current traversal depth
 * @returns Serialized value or truncation marker
 */
function safeStringify(value, options = {}, currentDepth = 0) {
    // When preventTruncation is true, disable depth limit too
    const maxDepth = options.preventTruncation ? Infinity : (options.maxDepth ?? 10);
    // Check depth limit
    if (currentDepth >= maxDepth) {
        if ((0, datatypes_1.isObject)(value))
            return '[Object:max-depth]';
        if ((0, datatypes_1.isArray)(value))
            return '[Array:max-depth]';
        return value;
    }
    // Primitives pass through
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    // Special types
    if ((0, datatypes_1.isDate)(value))
        return value.toISOString();
    if ((0, datatypes_1.isError)(value))
        return { type: value.name, message: value.message, stack: value.stack };
    if ((0, datatypes_1.isRegExp)(value))
        return value.toString();
    if ((0, datatypes_1.isMap)(value))
        return Array.from(value.entries());
    if ((0, datatypes_1.isSet)(value))
        return Array.from(value.values());
    // Arrays
    if ((0, datatypes_1.isArray)(value)) {
        return value.map((item) => safeStringify(item, options, currentDepth + 1));
    }
    // Objects
    if ((0, datatypes_1.isObject)(value)) {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = safeStringify(val, options, currentDepth + 1);
        }
        return result;
    }
    return value;
}
/**
 * Safely serialize a value for logging/audit with configurable truncation.
 * Use this for capturing method arguments, return values, etc.
 *
 * Features:
 * - Handles circular references using framework utilities
 * - Depth-aware traversal (configurable max depth)
 * - Optional length-based truncation
 * - Special handling for Date, Error, Map, Set, RegExp
 *
 * @param value - Value to serialize
 * @param options - Serialization options (or number for backward compat maxLength)
 * @returns Serialized value, truncation marker, or '[unserializable]'
 *
 * @example
 * ```typescript
 * // Default: max 10KB, depth 10
 * safeSerialize(data)
 *
 * // No truncation at all
 * safeSerialize(data, { preventTruncation: true })
 *
 * // Custom limits
 * safeSerialize(data, { maxLength: 5000, maxDepth: 5 })
 *
 * // Backward compat: pass number as maxLength
 * safeSerialize(data, 1000)
 * ```
 */
function safeSerialize(value, options = {}) {
    // Backward compat: if number passed, treat as maxLength
    const opts = typeof options === 'number'
        ? { maxLength: options }
        : options;
    // Apply defaults
    const maxLength = opts.preventTruncation ? Infinity : (opts.maxLength ?? 10000);
    const maxDepth = opts.maxDepth ?? 10;
    try {
        // First pass: depth-aware serialization
        const sanitized = safeStringify(value, { maxDepth });
        // Second pass: convert to JSON with circular handling
        const circularReplacer = (0, serialize_1.getCircularReplacer)();
        const str = JSON.stringify(sanitized, (key, val) => {
            // Apply circular check first
            const circularSafe = circularReplacer(key, val);
            if (circularSafe === undefined && (0, datatypes_1.isObject)(val))
                return '[Circular]';
            // Then apply framework's type replacer for any special types we might have missed
            return (0, serialize_1.jsonStringifyReplacer)(key, circularSafe ?? val);
        });
        if (str === undefined) {
            return '[unserializable]';
        }
        // Length-based truncation (if not disabled)
        if (maxLength !== Infinity && str.length > maxLength) {
            // Parse back to preserve top-level structure visibility
            try {
                const parsed = JSON.parse(str);
                const preview = JSON.stringify(parsed, null, 0).substring(0, maxLength);
                return preview + '...[truncated]';
            }
            catch {
                // Fallback: just truncate the string
                return str.substring(0, maxLength) + '...[truncated]';
            }
        }
        // Return parsed object (not stringified) - cleaner for storage
        return JSON.parse(str);
    }
    catch (err) {
        return '[unserializable]';
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF5bG9hZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL3BheWxvYWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7O0FBMkNILHNDQTJDQztBQStCRCxzQ0FpREM7QUFpQkQsMENBMkJDO0FBS0Qsa0NBT0M7QUFnQkQsNENBVUM7QUFLRCxzREFFQztBQU1ELG9DQWNDO0FBalJELHFEQUFtRztBQUNuRyxxREFBbUY7QUFFbkYsNERBQTREO0FBQzVELE1BQU0saUJBQWlCLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLHdDQUF3QztBQTRCOUU7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFnQixhQUFhLENBQzNCLEtBQWMsRUFDZCxVQUE0QixFQUFFLEVBQzlCLFlBQVksR0FBRyxDQUFDO0lBRWhCLDBEQUEwRDtJQUMxRCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBRWpGLG9CQUFvQjtJQUNwQixJQUFJLFlBQVksSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUM3QixJQUFJLElBQUEsb0JBQVEsRUFBQyxLQUFLLENBQUM7WUFBRSxPQUFPLG9CQUFvQixDQUFDO1FBQ2pELElBQUksSUFBQSxtQkFBTyxFQUFDLEtBQUssQ0FBQztZQUFFLE9BQU8sbUJBQW1CLENBQUM7UUFDL0MsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssU0FBUztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3hELElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FB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QztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLHFCQUFxQixDQUFDLE9BQWdCLEVBQUUsV0FBbUIsaUJBQWlCO0lBQzFGLE9BQU8sZ0JBQWdCLENBQUMsT0FBTyxDQUFDLElBQUksUUFBUSxDQUFDO0FBQy9DLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixZQUFZLENBQzFCLElBQU8sRUFDUCxNQUE2QixFQUM3QixRQUFnQjtJQUVoQixNQUFNLE1BQU0sR0FBRyxFQUFFLEdBQUcsSUFBSSxFQUE2QixDQUFDO0lBRXRELEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7UUFDM0IsSUFBSSxLQUFLLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBRSxLQUFLLENBQUUsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNyRCxNQUFNLENBQUUsS0FBSyxDQUFFLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBRSxLQUFLLENBQUUsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUMvRCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sTUFBVyxDQUFDO0FBQ3JCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBheWxvYWQgdXRpbGl0aWVzIGZvciBvYnNlcnZhYmlsaXR5XG4gKiBcbiAqIEhhbmRsZXMgcGF5bG9hZCBzZXJpYWxpemF0aW9uIHdpdGggZGVwdGggY29udHJvbCBhbmQgdHJ1bmNhdGlvbiBmb3Igc3RvcmFnZSBvcHRpbWl6YXRpb25cbiAqL1xuXG5pbXBvcnQgeyBpc09iamVjdCwgaXNBcnJheSwgaXNEYXRlLCBpc0Vycm9yLCBpc01hcCwgaXNTZXQsIGlzUmVnRXhwIH0gZnJvbSAnLi4vLi4vdXRpbHMvZGF0YXR5cGVzJztcbmltcG9ydCB7IGdldENpcmN1bGFyUmVwbGFjZXIsIGpzb25TdHJpbmdpZnlSZXBsYWNlciB9IGZyb20gJy4uLy4uL3V0aWxzL3NlcmlhbGl6ZSc7XG5cbi8vIE1heGltdW0gcGF5bG9hZCBzaXplIHRvIHByZXZlbnQgRHluYW1vREIgaXRlbSBzaXplIGxpbWl0c1xuY29uc3QgTUFYX1BBWUxPQURfQllURVMgPSAzNTAgKiAxMDI0OyAvLyAzNTBLQiAobGVhdmluZyByb29tIGZvciBvdGhlciBmaWVsZHMpXG5cbi8qKlxuICogU2VyaWFsaXphdGlvbiBvcHRpb25zIGZvciBkZXB0aC1hd2FyZSB0cnVuY2F0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2VyaWFsaXplT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBNYXhpbXVtIHN0cmluZyBsZW5ndGggZm9yIHRoZSBlbnRpcmUgc2VyaWFsaXplZCBvdXRwdXQuXG4gICAqIERlZmF1bHQ6IDEwMDAwICgxMEtCIG9mIHRleHQpXG4gICAqIFNldCB0byBJbmZpbml0eSB0byBkaXNhYmxlIHRydW5jYXRpb24gZW50aXJlbHkuXG4gICAqL1xuICBtYXhMZW5ndGg/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIE1heGltdW0gZGVwdGggdG8gdHJhdmVyc2UgaW4gbmVzdGVkIG9iamVjdHMuXG4gICAqIERlZmF1bHQ6IDEwXG4gICAqIEJleW9uZCB0aGlzIGRlcHRoLCBvYmplY3RzIGFyZSByZXBsYWNlZCB3aXRoICdbT2JqZWN0Li4uXScsIGFycmF5cyB3aXRoICdbQXJyYXkuLi5dJ1xuICAgKi9cbiAgbWF4RGVwdGg/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFByZXZlbnQgdHJ1bmNhdGlvbiBlbnRpcmVseSAtIGFsd2F5cyBzZXJpYWxpemUgZnVsbCBkYXRhLlxuICAgKiBVc2Ugc3BhcmluZ2x5IGZvciBjcml0aWNhbCBkYXRhIHRoYXQgbXVzdCBiZSBjYXB0dXJlZCBpbiBmdWxsLlxuICAgKiBEZWZhdWx0OiBmYWxzZVxuICAgKi9cbiAgcHJldmVudFRydW5jYXRpb24/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFNhZmVseSBzdHJpbmdpZnkgYW4gb2JqZWN0IHdpdGggZGVwdGggY29udHJvbCBhbmQgY2lyY3VsYXIgcmVmZXJlbmNlIGhhbmRsaW5nLlxuICogVXNlcyBmcmFtZXdvcmsncyBleGlzdGluZyBzZXJpYWxpemF0aW9uIHV0aWxpdGllcy5cbiAqIFxuICogQHBhcmFtIHZhbHVlIC0gVmFsdWUgdG8gc2VyaWFsaXplXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFNlcmlhbGl6YXRpb24gb3B0aW9uc1xuICogQHBhcmFtIGN1cnJlbnREZXB0aCAtIEludGVybmFsOiBjdXJyZW50IHRyYXZlcnNhbCBkZXB0aFxuICogQHJldHVybnMgU2VyaWFsaXplZCB2YWx1ZSBvciB0cnVuY2F0aW9uIG1hcmtlclxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FmZVN0cmluZ2lmeShcbiAgdmFsdWU6IHVua25vd24sXG4gIG9wdGlvbnM6IFNlcmlhbGl6ZU9wdGlvbnMgPSB7fSxcbiAgY3VycmVudERlcHRoID0gMFxuKTogdW5rbm93biB7XG4gIC8vIFdoZW4gcHJldmVudFRydW5jYXRpb24gaXMgdHJ1ZSwgZGlzYWJsZSBkZXB0aCBsaW1pdCB0b29cbiAgY29uc3QgbWF4RGVwdGggPSBvcHRpb25zLnByZXZlbnRUcnVuY2F0aW9uID8gSW5maW5pdHkgOiAob3B0aW9ucy5tYXhEZXB0aCA/PyAxMCk7XG5cbiAgLy8gQ2hlY2sgZGVwdGggbGltaXRcbiAgaWYgKGN1cnJlbnREZXB0aCA+PSBtYXhEZXB0aCkge1xuICAgIGlmIChpc09iamVjdCh2YWx1ZSkpIHJldHVybiAnW09iamVjdDptYXgtZGVwdGhdJztcbiAgICBpZiAoaXNBcnJheSh2YWx1ZSkpIHJldHVybiAnW0FycmF5Om1heC1kZXB0aF0nO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIC8vIFByaW1pdGl2ZXMgcGFzcyB0aHJvdWdoXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnIHx8IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHwgdHlwZW9mIHZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvLyBTcGVjaWFsIHR5cGVzXG4gIGlmIChpc0RhdGUodmFsdWUpKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKTtcbiAgaWYgKGlzRXJyb3IodmFsdWUpKSByZXR1cm4geyB0eXBlOiB2YWx1ZS5uYW1lLCBtZXNzYWdlOiB2YWx1ZS5tZXNzYWdlLCBzdGFjazogdmFsdWUuc3RhY2sgfTtcbiAgaWYgKGlzUmVnRXhwKHZhbHVlKSkgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gIGlmIChpc01hcCh2YWx1ZSkpIHJldHVybiBBcnJheS5mcm9tKHZhbHVlLmVudHJpZXMoKSk7XG4gIGlmIChpc1NldCh2YWx1ZSkpIHJldHVybiBBcnJheS5mcm9tKHZhbHVlLnZhbHVlcygpKTtcblxuICAvLyBBcnJheXNcbiAgaWYgKGlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoaXRlbSkgPT4gc2FmZVN0cmluZ2lmeShpdGVtLCBvcHRpb25zLCBjdXJyZW50RGVwdGggKyAxKSk7XG4gIH1cblxuICAvLyBPYmplY3RzXG4gIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsIF0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgICByZXN1bHRbIGtleSBdID0gc2FmZVN0cmluZ2lmeSh2YWwsIG9wdGlvbnMsIGN1cnJlbnREZXB0aCArIDEpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG4vKipcbiAqIFNhZmVseSBzZXJpYWxpemUgYSB2YWx1ZSBmb3IgbG9nZ2luZy9hdWRpdCB3aXRoIGNvbmZpZ3VyYWJsZSB0cnVuY2F0aW9uLlxuICogVXNlIHRoaXMgZm9yIGNhcHR1cmluZyBtZXRob2QgYXJndW1lbnRzLCByZXR1cm4gdmFsdWVzLCBldGMuXG4gKiBcbiAqIEZlYXR1cmVzOlxuICogLSBIYW5kbGVzIGNpcmN1bGFyIHJlZmVyZW5jZXMgdXNpbmcgZnJhbWV3b3JrIHV0aWxpdGllc1xuICogLSBEZXB0aC1hd2FyZSB0cmF2ZXJzYWwgKGNvbmZpZ3VyYWJsZSBtYXggZGVwdGgpXG4gKiAtIE9wdGlvbmFsIGxlbmd0aC1iYXNlZCB0cnVuY2F0aW9uXG4gKiAtIFNwZWNpYWwgaGFuZGxpbmcgZm9yIERhdGUsIEVycm9yLCBNYXAsIFNldCwgUmVnRXhwXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIFZhbHVlIHRvIHNlcmlhbGl6ZVxuICogQHBhcmFtIG9wdGlvbnMgLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMgKG9yIG51bWJlciBmb3IgYmFja3dhcmQgY29tcGF0IG1heExlbmd0aClcbiAqIEByZXR1cm5zIFNlcmlhbGl6ZWQgdmFsdWUsIHRydW5jYXRpb24gbWFya2VyLCBvciAnW3Vuc2VyaWFsaXphYmxlXSdcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIERlZmF1bHQ6IG1heCAxMEtCLCBkZXB0aCAxMFxuICogc2FmZVNlcmlhbGl6ZShkYXRhKVxuICogXG4gKiAvLyBObyB0cnVuY2F0aW9uIGF0IGFsbFxuICogc2FmZVNlcmlhbGl6ZShkYXRhLCB7IHByZXZlbnRUcnVuY2F0aW9uOiB0cnVlIH0pXG4gKiBcbiAqIC8vIEN1c3RvbSBsaW1pdHNcbiAqIHNhZmVTZXJpYWxpemUoZGF0YSwgeyBtYXhMZW5ndGg6IDUwMDAsIG1heERlcHRoOiA1IH0pXG4gKiBcbiAqIC8vIEJhY2t3YXJkIGNvbXBhdDogcGFzcyBudW1iZXIgYXMgbWF4TGVuZ3RoXG4gKiBzYWZlU2VyaWFsaXplKGRhdGEsIDEwMDApXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhZmVTZXJpYWxpemUoXG4gIHZhbHVlOiB1bmtub3duLFxuICBvcHRpb25zOiBTZXJpYWxpemVPcHRpb25zIHwgbnVtYmVyID0ge31cbik6IHVua25vd24ge1xuICAvLyBCYWNrd2FyZCBjb21wYXQ6IGlmIG51bWJlciBwYXNzZWQsIHRyZWF0IGFzIG1heExlbmd0aFxuICBjb25zdCBvcHRzOiBTZXJpYWxpemVPcHRpb25zID0gdHlwZW9mIG9wdGlvbnMgPT09ICdudW1iZXInXG4gICAgPyB7IG1heExlbmd0aDogb3B0aW9ucyB9XG4gICAgOiBvcHRpb25zO1xuXG4gIC8vIEFwcGx5IGRlZmF1bHRzXG4gIGNvbnN0IG1heExlbmd0aCA9IG9wdHMucHJldmVudFRydW5jYXRpb24gPyBJbmZpbml0eSA6IChvcHRzLm1heExlbmd0aCA/PyAxMDAwMCk7XG4gIGNvbnN0IG1heERlcHRoID0gb3B0cy5tYXhEZXB0aCA/PyAxMDtcblxuICB0cnkge1xuICAgIC8vIEZpcnN0IHBhc3M6IGRlcHRoLWF3YXJlIHNlcmlhbGl6YXRpb25cbiAgICBjb25zdCBzYW5pdGl6ZWQgPSBzYWZlU3RyaW5naWZ5KHZhbHVlLCB7IG1heERlcHRoIH0pO1xuXG4gICAgLy8gU2Vjb25kIHBhc3M6IGNvbnZlcnQgdG8gSlNPTiB3aXRoIGNpcmN1bGFyIGhhbmRsaW5nXG4gICAgY29uc3QgY2lyY3VsYXJSZXBsYWNlciA9IGdldENpcmN1bGFyUmVwbGFjZXIoKTtcbiAgICBjb25zdCBzdHIgPSBKU09OLnN0cmluZ2lmeShzYW5pdGl6ZWQsIChrZXksIHZhbCkgPT4ge1xuICAgICAgLy8gQXBwbHkgY2lyY3VsYXIgY2hlY2sgZmlyc3RcbiAgICAgIGNvbnN0IGNpcmN1bGFyU2FmZSA9IGNpcmN1bGFyUmVwbGFjZXIoa2V5LCB2YWwpO1xuICAgICAgaWYgKGNpcmN1bGFyU2FmZSA9PT0gdW5kZWZpbmVkICYmIGlzT2JqZWN0KHZhbCkpIHJldHVybiAnW0NpcmN1bGFyXSc7XG4gICAgICAvLyBUaGVuIGFwcGx5IGZyYW1ld29yaydzIHR5cGUgcmVwbGFjZXIgZm9yIGFueSBzcGVjaWFsIHR5cGVzIHdlIG1pZ2h0IGhhdmUgbWlzc2VkXG4gICAgICByZXR1cm4ganNvblN0cmluZ2lmeVJlcGxhY2VyKGtleSwgY2lyY3VsYXJTYWZlID8/IHZhbCk7XG4gICAgfSk7XG5cbiAgICBpZiAoc3RyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiAnW3Vuc2VyaWFsaXphYmxlXSc7XG4gICAgfVxuXG4gICAgLy8gTGVuZ3RoLWJhc2VkIHRydW5jYXRpb24gKGlmIG5vdCBkaXNhYmxlZClcbiAgICBpZiAobWF4TGVuZ3RoICE9PSBJbmZpbml0eSAmJiBzdHIubGVuZ3RoID4gbWF4TGVuZ3RoKSB7XG4gICAgICAvLyBQYXJzZSBiYWNrIHRvIHByZXNlcnZlIHRvcC1sZXZlbCBzdHJ1Y3R1cmUgdmlzaWJpbGl0eVxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShzdHIpO1xuICAgICAgICBjb25zdCBwcmV2aWV3ID0gSlNPTi5zdHJpbmdpZnkocGFyc2VkLCBudWxsLCAwKS5zdWJzdHJpbmcoMCwgbWF4TGVuZ3RoKTtcbiAgICAgICAgcmV0dXJuIHByZXZpZXcgKyAnLi4uW3RydW5jYXRlZF0nO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEZhbGxiYWNrOiBqdXN0IHRydW5jYXRlIHRoZSBzdHJpbmdcbiAgICAgICAgcmV0dXJuIHN0ci5zdWJzdHJpbmcoMCwgbWF4TGVuZ3RoKSArICcuLi5bdHJ1bmNhdGVkXSc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIHBhcnNlZCBvYmplY3QgKG5vdCBzdHJpbmdpZmllZCkgLSBjbGVhbmVyIGZvciBzdG9yYWdlXG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RyKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuICdbdW5zZXJpYWxpemFibGVdJztcbiAgfVxufVxuXG4vKipcbiAqIFRydW5jYXRpb24gbWV0YWRhdGEgLSByZXBsYWNlcyBwYXlsb2FkIHdoZW4gaXQgZXhjZWVkcyBzaXplIGxpbWl0c1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFRydW5jYXRpb25NZXRhZGF0YSB7XG4gIF90cnVuY2F0ZWQ6IHRydWU7XG4gIF9vcmlnaW5hbFNpemU6IG51bWJlcjtcbiAgX3ByZXZpZXc6IHN0cmluZztcbn1cblxuLyoqXG4gKiBUcnVuY2F0ZSBwYXlsb2FkIGlmIGl0IGV4Y2VlZHMgbWF4IHNpemVcbiAqIFxuICogQHJldHVybnMgT3JpZ2luYWwgcGF5bG9hZCBpZiB3aXRoaW4gbGltaXRzLCBvciBUcnVuY2F0aW9uTWV0YWRhdGEgaWYgdG9vIGxhcmdlLlxuICogICAgICAgICAgQ2hlY2sgZm9yIGBfdHJ1bmNhdGVkYCBwcm9wZXJ0eSB0byBkZXRlY3QgdHJ1bmNhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRydW5jYXRlUGF5bG9hZDxUPihcbiAgcGF5bG9hZDogVCxcbiAgbWF4Qnl0ZXM6IG51bWJlciA9IE1BWF9QQVlMT0FEX0JZVEVTXG4pOiBUIHwgVHJ1bmNhdGlvbk1ldGFkYXRhIHtcbiAgY29uc3Qgc2FmZVBheWxvYWQgPSBzYWZlU3RyaW5naWZ5KHBheWxvYWQpO1xuICBsZXQgc2VyaWFsaXplZDogc3RyaW5nO1xuXG4gIHRyeSB7XG4gICAgc2VyaWFsaXplZCA9IEpTT04uc3RyaW5naWZ5KHNhZmVQYXlsb2FkKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIF90cnVuY2F0ZWQ6IHRydWUsXG4gICAgICBfb3JpZ2luYWxTaXplOiAtMSxcbiAgICAgIF9wcmV2aWV3OiAnW3Vuc2VyaWFsaXphYmxlXScsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGJ5dGVTaXplID0gQnVmZmVyLmJ5dGVMZW5ndGgoc2VyaWFsaXplZCwgJ3V0ZjgnKTtcbiAgaWYgKGJ5dGVTaXplIDw9IG1heEJ5dGVzKSB7XG4gICAgcmV0dXJuIHBheWxvYWQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIF90cnVuY2F0ZWQ6IHRydWUsXG4gICAgX29yaWdpbmFsU2l6ZTogYnl0ZVNpemUsXG4gICAgX3ByZXZpZXc6IHNlcmlhbGl6ZWQuc3Vic3RyaW5nKDAsIDEwMDApICsgJy4uLltUUlVOQ0FURURdJyxcbiAgfTtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIHZhbHVlIGlzIHRydW5jYXRpb24gbWV0YWRhdGFcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVHJ1bmNhdGVkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgVHJ1bmNhdGlvbk1ldGFkYXRhIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAnX3RydW5jYXRlZCcgaW4gdmFsdWUgJiZcbiAgICAodmFsdWUgYXMgVHJ1bmNhdGlvbk1ldGFkYXRhKS5fdHJ1bmNhdGVkID09PSB0cnVlXG4gICk7XG59XG5cbi8qKlxuICogRXN0aW1hdGUgdGhlIHNpemUgb2YgYW4gaXRlbSB3aGVuIHN0b3JlZCBpbiBEeW5hbW9EQlxuICogXG4gKiBEeW5hbW9EQiBjYWxjdWxhdGVzIGl0ZW0gc2l6ZSBhczpcbiAqIC0gU3RyaW5nOiBVVEYtOCBlbmNvZGVkIGxlbmd0aFxuICogLSBOdW1iZXI6IHVwIHRvIDM4IHNpZ25pZmljYW50IGRpZ2l0cyArIDIgYnl0ZXNcbiAqIC0gQmluYXJ5OiByYXcgYnl0ZSBsZW5ndGhcbiAqIC0gTWFwL0xpc3Q6IHN1bSBvZiBlbGVtZW50IHNpemVzICsgb3ZlcmhlYWRcbiAqIC0gU2V0OiBzdW0gb2YgZWxlbWVudCBzaXplc1xuICogLSBOdWxsOiAxIGJ5dGVcbiAqIC0gQm9vbGVhbjogMSBieXRlXG4gKiBcbiAqIFRoaXMgaXMgYW4gYXBwcm94aW1hdGlvbiB1c2luZyBKU09OLnN0cmluZ2lmeSBsZW5ndGggYXMgYSBwcm94eVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXN0aW1hdGVJdGVtU2l6ZShpdGVtOiB1bmtub3duKTogbnVtYmVyIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkoaXRlbSk7XG4gICAgLy8gSlNPTiBsZW5ndGggaXMgYSByZWFzb25hYmxlIGFwcHJveGltYXRpb25cbiAgICAvLyBBZGQgMjAlIG92ZXJoZWFkIGZvciBEeW5hbW9EQidzIGludGVybmFsIHJlcHJlc2VudGF0aW9uXG4gICAgcmV0dXJuIE1hdGguY2VpbChqc29uLmxlbmd0aCAqIDEuMik7XG4gIH0gY2F0Y2gge1xuICAgIC8vIElmIHNlcmlhbGl6YXRpb24gZmFpbHMsIHJldHVybiBtYXggc2l6ZSB0byBiZSBzYWZlXG4gICAgcmV0dXJuIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSO1xuICB9XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBwYXlsb2FkIGlzIHdpdGhpbiBEeW5hbW9EQiBsaW1pdHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUGF5bG9hZFdpdGhpbkxpbWl0cyhwYXlsb2FkOiB1bmtub3duLCBtYXhCeXRlczogbnVtYmVyID0gTUFYX1BBWUxPQURfQllURVMpOiBib29sZWFuIHtcbiAgcmV0dXJuIGVzdGltYXRlSXRlbVNpemUocGF5bG9hZCkgPD0gbWF4Qnl0ZXM7XG59XG5cbi8qKlxuICogVHJ1bmNhdGUgc3BlY2lmaWMgZmllbGRzIGluIGFuIGl0ZW0uXG4gKiBVc2VkIGFzIGFsdGVybmF0aXZlIHRvIGNvbXByZXNzaW9uIHdoZW4gZ3VhcmFudGVlZCBzaXplIGxpbWl0cyBhcmUgcmVxdWlyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cnVuY2F0ZUl0ZW08VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIHVua25vd24+PihcbiAgaXRlbTogVCxcbiAgZmllbGRzOiBSZWFkb25seUFycmF5PHN0cmluZz4sXG4gIG1heEJ5dGVzOiBudW1iZXJcbik6IFQge1xuICBjb25zdCByZXN1bHQgPSB7IC4uLml0ZW0gfSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICBmb3IgKGNvbnN0IGZpZWxkIG9mIGZpZWxkcykge1xuICAgIGlmIChmaWVsZCBpbiByZXN1bHQgJiYgcmVzdWx0WyBmaWVsZCBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc3VsdFsgZmllbGQgXSA9IHRydW5jYXRlUGF5bG9hZChyZXN1bHRbIGZpZWxkIF0sIG1heEJ5dGVzKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzdWx0IGFzIFQ7XG59XG4iXX0=