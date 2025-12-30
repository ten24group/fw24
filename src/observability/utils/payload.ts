/**
 * Payload utilities for observability
 * 
 * Handles payload truncation and size estimation for DynamoDB storage
 */

// Maximum payload size to prevent DynamoDB item size limits
const MAX_PAYLOAD_BYTES = 350 * 1024; // 350KB (leaving room for other fields)

/**
 * Safely stringify an object, handling circular references
 */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableValue[]
  | { [ key: string ]: SerializableValue };

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Safely convert an input into a JSON-serializable-ish shape, handling circular references.
 *
 * NOTE: This intentionally preserves `undefined` (JSON drops it in objects; arrays stringify it as null).
 */
export function safeStringify(value: unknown, visited = new WeakSet<object>()): SerializableValue {
  if (value === null || typeof value !== 'object') {
    return value as SerializableValue;
  }

  if (visited.has(value as object)) {
    return '[Circular]';
  }

  visited.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => safeStringify(item, visited));
  }

  const result: Record<string, unknown> = {};
  for (const [ key, val ] of Object.entries(value)) {
    result[ key ] = safeStringify(val, visited);
  }

  visited.delete(value as object);
  return result as SerializableValue;
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
 * Safely serialize a value for logging/audit (truncate if needed)
 * Use this for capturing method arguments, return values, etc.
 * 
 * @param value - Value to serialize
 * @param maxLength - Max string length (default 1000)
 * @returns Serializable value or '[unserializable]' if fails
 */
export function safeSerialize(value: unknown, maxLength: number = 1000): unknown {
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
  } catch {
    return '[unserializable]';
  }
}
