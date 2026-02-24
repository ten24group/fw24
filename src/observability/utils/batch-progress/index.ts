/**
 * BatchProgress - Elegant batch processing with automatic observability
 *
 * Smart defaults:
 * - Auto-detects item ID from common fields (id, eventId, messageId, etc.)
 * - Progress logging every ~10% for large batches
 * - Default chunk size of 25 for batch APIs
 * - Sampling: first 3 items + 5% of rest
 *
 * Usage:
 * ```typescript
 * // Simplest - smart defaults handle everything
 * await BatchProgress.forEach('ProcessOrders', orders, async (order) => {
 *   await processOrder(order);
 * });
 *
 * // With results
 * const results = await BatchProgress.map('FetchUsers', userIds, async (id) => {
 *   return await fetchUser(id);
 * });
 *
 * // Chunked for batch APIs
 * await BatchProgress.chunk('BulkInsert', records, async (chunk) => {
 *   return await db.batchInsert(chunk);
 * });
 *
 * // Full control
 * const { results, summary } = await BatchProgress.process('Custom', items,
 *   async (item, index, ctx) => {
 *     ctx.addMetric('bytes', item.size);
 *     return await process(item);
 *   },
 *   { concurrency: 5, observe: 'errors' }
 * );
 * ```
 */

import type { CaptureControl } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Observability mode */
export type ObserveMode = 'all' | 'progress' | 'errors' | 'summary' | 'none';

/** Processing options */
export interface ProcessOptions<T = unknown> {
  /** Concurrency. Default: 1 */
  concurrency?: number;
  /** Continue on error. Default: true */
  continueOnError?: boolean;
  /** Stop after N failures */
  maxFailures?: number;
  /** Get item ID. Default: auto-detect from id/eventId/messageId */
  getItemId?: (item: T, index: number) => string;
  /** Observability mode. Default: 'progress' */
  observe?: ObserveMode;
  /** Progress every N items. Default: auto */
  progressEvery?: number;
  /** Tags for logs */
  tags?: Record<string, string>;
  /** First N items to capture in detail. Default: 3 */
  sampleFirst?: number;
  /** Sample rate for rest. Default: 0.05 */
  sampleRate?: number;
}

/** Chunk options */
export interface ChunkOptions<T = unknown> extends Omit<ProcessOptions<T>, 'concurrency'> {
  /** Chunk size. Default: 25 */
  size?: number;
}

/** Failed item for SQS partial batch failures */
export interface FailedItem {
  itemId: string;
  error: string;
  errorType: string;
}

/** Aggregated metrics */
export interface MetricStats {
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

/** Batch summary */
export interface BatchSummary {
  /** Batch identifier (name + timestamp) */
  batchId: string;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
  itemsPerSecond: number;
  timing: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    /** 95th percentile (requires 20+ items) */
    p95Ms?: number;
    /** 99th percentile (requires 100+ items) */
    p99Ms?: number;
    slowestItemId?: string;
  };
  /** Custom metrics aggregated across items */
  metrics: Record<string, MetricStats>;
  /** For SQS batchItemFailures */
  failedItems: FailedItem[];
  errorsByType: Record<string, number>;
}

/** Result from batch processing */
export interface BatchResult<R> {
  results: R[];
  summary: BatchSummary;
}

/** Context passed to processor */
export interface ProcessContext {
  /**
   * Get capture control for per-item logs.
   * Returns group sampling config based on sampleFirst/sampleRate options.
   * Works regardless of observe mode.
   *
   * @example
   * ```typescript
   * await BatchProgress.process('Test', items, async (item, ctx) => {
   *   LogObserver.info('Processing', { item }, { capture: ctx.getCaptureControl() });
   * });
   * ```
   */
  getCaptureControl: () => CaptureControl;
  /** Add custom metric (aggregated in summary) */
  addMetric: (name: string, value: number) => void;
  /**
   * Item index in the original array (0-based).
   * For process/forEach/map: the item's position.
   * For chunk: the first item's position in the chunk.
   * For all: always 0.
   */
  itemIndex: number;
  /** Total items in batch */
  total: number;
  /** Batch identifier */
  batchId: string;
}

export { BatchProgress } from './batch-progress';
