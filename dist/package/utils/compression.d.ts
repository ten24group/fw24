/**
 * Compression utilities for observability data
 *
 * Compresses large payloads before storing in DynamoDB to reduce storage costs.
 * Uses gzip compression with base64 encoding for safe storage.
 */
/**
 * Compression configuration interface.
 * Can be used by ANY entity/service in fw24.
 */
export interface CompressionConfig {
    enabled: boolean;
    threshold: number;
    fields: ReadonlyArray<string>;
}
/**
 * Standard compressed payload format.
 *
 * **Contract:**
 * - `_compressed: true` - Always true, marker for detection
 * - `_algorithm: 'gzip'` - Currently only gzip supported
 * - `_data: string` - Base64-encoded gzip data
 * - `_originalSize: number` - Original size in bytes (for UI display)
 * - `_compressedSize: number` - Compressed size in bytes (for metrics)
 *
 * **Frontend Detection:**
 * UI24 checks for `_compressed === true` and `_algorithm === 'gzip'`
 * then decompresses `_data` (base64 → binary → gunzip → JSON.parse)
 */
export interface CompressedPayload {
    _compressed: true;
    _algorithm: 'gzip';
    _data: string;
    _originalSize: number;
    _compressedSize: number;
}
/**
 * Check if a value is a compressed payload
 */
export declare function isCompressed(value: unknown): value is CompressedPayload;
/**
 * Compress a value if it exceeds the threshold.
 * Returns CompressedPayload in standard format.
 *
 * @param value - Value to compress
 * @param threshold - Minimum size in bytes before compression
 * @returns CompressedPayload if compressed, original value if below threshold
 */
export declare function compressIfNeeded(value: unknown, threshold: number): unknown | CompressedPayload;
/**
 * Decompress a compressed payload
 *
 * @param value - Compressed payload
 * @returns Decompressed value
 */
export declare function decompress(value: unknown): unknown;
/**
 * Apply compression to specified fields in an item
 *
 * @param item - Item to compress
 * @param config - Compression configuration
 * @returns Item with compressed fields
 */
export declare function compressItem<T extends Record<string, unknown>>(item: T, config: CompressionConfig): T;
/**
 * Decompress all compressed fields in an item
 *
 * @param item - Item with potentially compressed fields
 * @returns Item with decompressed fields
 */
export declare function decompressItem<T extends Record<string, unknown>>(item: T): T;
