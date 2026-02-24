/**
 * Payload utilities for observability
 *
 * Handles payload serialization with depth control and truncation for storage optimization
 */

import { isObject, isArray, isDate, isError, isMap, isSet, isRegExp } from '../../utils/datatypes';
import { getCircularReplacer, jsonStringifyReplacer } from '../../utils/serialize';

// Maximum payload size to prevent DynamoDB item size limits
const MAX_PAYLOAD_BYTES = 350 * 1024; // 350KB (leaving room for other fields)

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
export function safeStringify(
  value: unknown,
  options: SerializeOptions = {},
  currentDepth = 0
): unknown {
  // When preventTruncation is true, disable depth limit too
  const maxDepth = options.preventTruncation ? Infinity : (options.maxDepth ?? 10);

  // Check depth limit
  if (currentDepth >= maxDepth) {
    if (isObject(value)) return '[Object:max-depth]';
    if (isArray(value)) return '[Array:max-depth]';
    return value;
  }

  // Primitives pass through
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Special types
  if (isDate(value)) return value.toISOString();
  if (isError(value)) return { type: value.name, message: value.message, stack: value.stack };
  if (isRegExp(value)) return value.toString();
  if (isMap(value)) return Array.from(value.entries());
  if (isSet(value)) return Array.from(value.values());

  // Arrays
  if (isArray(value)) {
    return value.map((item) => safeStringify(item, options, currentDepth + 1));
  }

  // Objects
  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [ key, val ] of Object.entries(value)) {
      result[ key ] = safeStringify(val, options, currentDepth + 1);
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
export function safeSerialize(
  value: unknown,
  options: SerializeOptions | number = {}
): unknown {
  // Backward compat: if number passed, treat as maxLength
  const opts: SerializeOptions = typeof options === 'number'
    ? { maxLength: options }
    : options;

  // Apply defaults
  const maxLength = opts.preventTruncation ? Infinity : (opts.maxLength ?? 10000);
  const maxDepth = opts.maxDepth ?? 10;

  try {
    // First pass: depth-aware serialization
    const sanitized = safeStringify(value, { maxDepth });

    // Second pass: convert to JSON with circular handling
    const circularReplacer = getCircularReplacer();
    const str = JSON.stringify(sanitized, (key, val) => {
      // Apply circular check first
      const circularSafe = circularReplacer(key, val);
      if (circularSafe === undefined && isObject(val)) return '[Circular]';
      // Then apply framework's type replacer for any special types we might have missed
      return jsonStringifyReplacer(key, circularSafe ?? val);
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
      } catch {
        // Fallback: just truncate the string
        return str.substring(0, maxLength) + '...[truncated]';
      }
    }

    // Return parsed object (not stringified) - cleaner for storage
    return JSON.parse(str);
  } catch (err) {
    return '[unserializable]';
  }
}

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
export function truncatePayload<T>(
  payload: T,
  maxBytes: number = MAX_PAYLOAD_BYTES
): T | TruncationMetadata {
  const safePayload = safeStringify(payload);
  let serialized: string;

  try {
    serialized = JSON.stringify(safePayload);
  } catch {
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
export function isTruncated(value: unknown): value is TruncationMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_truncated' in value &&
    (value as TruncationMetadata)._truncated === true
  );
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
export function estimateItemSize(item: unknown): number {
  try {
    const json = JSON.stringify(item);
    // JSON length is a reasonable approximation
    // Add 20% overhead for DynamoDB's internal representation
    return Math.ceil(json.length * 1.2);
  } catch {
    // If serialization fails, return max size to be safe
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Check if a payload is within DynamoDB limits
 */
export function isPayloadWithinLimits(payload: unknown, maxBytes: number = MAX_PAYLOAD_BYTES): boolean {
  return estimateItemSize(payload) <= maxBytes;
}

/**
 * Truncate specific fields in an item.
 * Used as alternative to compression when guaranteed size limits are required.
 */
export function truncateItem<T extends Record<string, unknown>>(
  item: T,
  fields: ReadonlyArray<string>,
  maxBytes: number
): T {
  const result = { ...item } as Record<string, unknown>;

  for (const field of fields) {
    if (field in result && result[ field ] !== undefined) {
      result[ field ] = truncatePayload(result[ field ], maxBytes);
    }
  }

  return result as T;
}
