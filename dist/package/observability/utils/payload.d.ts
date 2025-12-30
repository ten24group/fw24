/**
 * Payload utilities for observability
 *
 * Handles payload truncation and size estimation for DynamoDB storage
 */
/**
 * Safely stringify an object, handling circular references
 */
export type SerializableValue = string | number | boolean | null | undefined | SerializableValue[] | {
    [key: string]: SerializableValue;
};
/**
 * Safely convert an input into a JSON-serializable-ish shape, handling circular references.
 *
 * NOTE: This intentionally preserves `undefined` (JSON drops it in objects; arrays stringify it as null).
 */
export declare function safeStringify(value: unknown, visited?: WeakSet<object>): SerializableValue;
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
 * Safely serialize a value for logging/audit (truncate if needed)
 * Use this for capturing method arguments, return values, etc.
 *
 * @param value - Value to serialize
 * @param maxLength - Max string length (default 1000)
 * @returns Serializable value or '[unserializable]' if fails
 */
export declare function safeSerialize(value: unknown, maxLength?: number): unknown;
/**
 * Truncate specific fields in an item.
 * Used as alternative to compression when guaranteed size limits are required.
 */
export declare function truncateItem<T extends Record<string, unknown>>(item: T, fields: ReadonlyArray<string>, maxBytes: number): T;
