/**
 * Compression utilities for observability data
 * 
 * Compresses large payloads before storing in DynamoDB to reduce storage costs.
 * Uses gzip compression with base64 encoding for safe storage.
 */

import { gzipSync, gunzipSync } from 'zlib';
import { createLogger } from '../../logging';

const logger = createLogger('observability:compression');

export interface CompressionConfig {
  /** Enable compression */
  enabled: boolean;
  /** Minimum size in bytes before compression is applied */
  threshold: number;
  /** Fields to compress if they exceed threshold */
  fields: ReadonlyArray<'data' | 'attributes' | 'metadata' | 'context'>;
}

interface CompressedPayload {
  /** Marker to indicate this is compressed data */
  _compressed: true;
  /** Compression algorithm used */
  _algorithm: 'gzip';
  /** Base64-encoded compressed data */
  _data: string;
  /** Original size in bytes (for metrics) */
  _originalSize: number;
  /** Compressed size in bytes (for metrics) */
  _compressedSize: number;
}

/**
 * Check if a value is a compressed payload
 */
export function isCompressed(value: unknown): value is CompressedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_compressed' in value &&
    value._compressed === true &&
    '_algorithm' in value &&
    '_data' in value
  );
}

/**
 * Compress a value if it exceeds the threshold
 * 
 * @param value - Value to compress
 * @param threshold - Minimum size in bytes before compression
 * @returns Compressed payload or original value if below threshold
 */
export function compressIfNeeded(
  value: unknown,
  threshold: number
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  try {
    // Serialize to JSON to measure size
    const json = JSON.stringify(value);
    const sizeBytes = Buffer.byteLength(json, 'utf8');

    // Skip compression if below threshold
    if (sizeBytes < threshold) {
      return value;
    }

    // Compress using gzip
    const compressed = gzipSync(Buffer.from(json, 'utf8'));
    const compressedSize = compressed.length;

    // Only use compressed version if it's actually smaller
    if (compressedSize >= sizeBytes) {
      logger.debug('Compression did not reduce size, keeping original', {
        originalSize: sizeBytes,
        compressedSize,
      });
      return value;
    }

    const result: CompressedPayload = {
      _compressed: true,
      _algorithm: 'gzip',
      _data: compressed.toString('base64'),
      _originalSize: sizeBytes,
      _compressedSize: compressedSize,
    };

    logger.debug('Compressed payload', {
      originalSize: sizeBytes,
      compressedSize,
      ratio: (compressedSize / sizeBytes * 100).toFixed(1) + '%',
    });

    return result;
  } catch (error) {
    logger.warn('Failed to compress payload, using original:', error);
    return value;
  }
}

/**
 * Decompress a compressed payload
 * 
 * @param value - Compressed payload
 * @returns Decompressed value
 */
export function decompress(value: unknown): unknown {
  if (!isCompressed(value)) {
    return value;
  }

  try {
    if (value._algorithm !== 'gzip') {
      throw new Error(`Unsupported compression algorithm: ${value._algorithm}`);
    }

    const compressed = Buffer.from(value._data, 'base64');
    const decompressed = gunzipSync(compressed);
    const json = decompressed.toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    logger.error('Failed to decompress payload:', error);
    throw new Error(`Decompression failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Apply compression to specified fields in an item
 * 
 * @param item - Item to compress
 * @param config - Compression configuration
 * @returns Item with compressed fields
 */
export function compressItem<T extends Record<string, unknown>>(
  item: T,
  config: CompressionConfig
): T {
  if (!config.enabled) {
    return item;
  }

  const result = { ...item } as Record<string, unknown>;

  for (const field of config.fields) {
    if (field in result && result[ field ] !== null && result[ field ] !== undefined) {
      result[ field ] = compressIfNeeded(result[ field ], config.threshold);
    }
  }

  return result as T;
}

/**
 * Decompress all compressed fields in an item
 * 
 * @param item - Item with potentially compressed fields
 * @returns Item with decompressed fields
 */
export function decompressItem<T extends Record<string, unknown>>(item: T): T {
  const result = { ...item } as Record<string, unknown>;

  for (const key in result) {
    if (isCompressed(result[ key ])) {
      result[ key ] = decompress(result[ key ]);
    }
  }

  return result as T;
}
