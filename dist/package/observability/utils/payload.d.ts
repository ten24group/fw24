/**
 * Payload utilities for observability
 *
 * Handles payload serialization with depth control and truncation for storage optimization
 */
/**
 * Serialization options for depth-aware truncation
 */
export interface SerializeOptions {
    /**
     * Maximum string length for the entire serialized output.
     * Default: 10000 (10KB of text)
     * Set to Infinity to disable truncation entirely.
     */
    maxLength?: number;
    /**
     * Maximum depth to traverse in nested objects.
     * Default: 10
     * Beyond this depth, objects are replaced with '[Object...]', arrays with '[Array...]'
     */
    maxDepth?: number;
    /**
     * Prevent truncation entirely - always serialize full data.
     * Use sparingly for critical data that must be captured in full.
     * Default: false
     */
    preventTruncation?: boolean;
}
/**
 * Safely stringify an object with depth control and circular reference handling.
 * Uses framework's existing serialization utilities.
 *
 * @param value - Value to serialize
 * @param options - Serialization options
 * @param currentDepth - Internal: current traversal depth
 * @returns Serialized value or truncation marker
 */
export declare function safeStringify(value: unknown, options?: SerializeOptions, currentDepth?: number): unknown;
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
export declare function safeSerialize(value: unknown, options?: SerializeOptions | number): unknown;
/**
 * Truncation metadata - replaces payload when it exceeds size limits
 */
export interface TruncationMetadata {
    _truncated: true;
    _originalSize: number;
    _preview: string;
}
/**
 * Truncate payload if it exceeds max size
 *
 * @returns Original payload if within limits, or TruncationMetadata if too large.
 *          Check for `_truncated` property to detect truncation.
 */
export declare function truncatePayload<T>(payload: T, maxBytes?: number): T | TruncationMetadata;
/**
 * Check if a value is truncation metadata
 */
export declare function isTruncated(value: unknown): value is TruncationMetadata;
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
export declare function estimateItemSize(item: unknown): number;
/**
 * Check if a payload is within DynamoDB limits
 */
export declare function isPayloadWithinLimits(payload: unknown, maxBytes?: number): boolean;
/**
 * Truncate specific fields in an item.
 * Used as alternative to compression when guaranteed size limits are required.
 */
export declare function truncateItem<T extends Record<string, unknown>>(item: T, fields: ReadonlyArray<string>, maxBytes: number): T;
