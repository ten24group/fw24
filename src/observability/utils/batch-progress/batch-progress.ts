import { ProcessContext, ProcessOptions, BatchResult, ChunkOptions, BatchSummary } from '.';
import { Tracker } from './tracker';

// ═══════════════════════════════════════════════════════════════════════════
// Smart Defaults
// ═══════════════════════════════════════════════════════════════════════════

/** Auto-detect item ID from common fields */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Auto-detect item ID from common fields */
export function autoGetItemId(item: unknown, index: number): string {
  if (item == null) return String(index);
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);

  // Try common ID fields
  if (!isRecord(item)) return String(index);
  const idFields = [ 'id', 'eventId', 'messageId', 'entityId', 'recordId', 'itemId', 'key', 'uuid' ];
  for (const field of idFields) {
    const v = item[ field ];
    if (v != null) return String(v);
  }

  return String(index);
}

// ═══════════════════════════════════════════════════════════════════════════
// BatchProgress
// ═══════════════════════════════════════════════════════════════════════════

export class BatchProgress {

  /**
   * Process items individually.
   */
  static async process<T, R = void>(
    name: string,
    items: T[],
    processor: (item: T, ctx: ProcessContext) => Promise<R> | R,
    options?: ProcessOptions<T>
  ): Promise<BatchResult<R>> {
    const tracker = new Tracker({
      name,
      total: items.length,
      observe: options?.observe,
      tags: options?.tags,
      sampleFirst: options?.sampleFirst,
      sampleRate: options?.sampleRate,
      progressEvery: options?.progressEvery,
    });

    const results: R[] = [];
    const concurrency = options?.concurrency ?? 1;
    const continueOnError = options?.continueOnError ?? true;
    const maxFailures = options?.maxFailures;
    const getItemId = options?.getItemId ?? autoGetItemId;

    const processOne = async (item: T, itemIndex: number): Promise<R | undefined> => {
      const itemId = getItemId(item, itemIndex);
      const startTime = Date.now();
      const ctx = tracker.createContext(itemIndex);

      try {
        const result = await processor(item, ctx);
        tracker.recordSuccess(Date.now() - startTime, itemId);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        tracker.recordFailure(Date.now() - startTime, err, itemId);
        if (!continueOnError) throw error;
        return undefined;
      }
    };

    if (concurrency === 1) {
      for (let i = 0; i < items.length; i++) {
        if (maxFailures !== undefined && tracker.getFailedCount() >= maxFailures) break;
        const result = await processOne(items[ i ], i);
        if (result !== undefined) results.push(result);
      }
    } else {
      for (let i = 0; i < items.length; i += concurrency) {
        if (maxFailures !== undefined && tracker.getFailedCount() >= maxFailures) break;
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map((item, j) => processOne(item, i + j)));
        for (const r of batchResults) {
          if (r !== undefined) results.push(r);
        }
      }
    }

    return { results, summary: tracker.complete() };
  }

  /**
   * Process items in chunks (for batch APIs).
   */
  static async chunk<T, R = T>(
    name: string,
    items: T[],
    processor: (chunk: T[], ctx: ProcessContext) => Promise<R[]> | R[],
    options?: ChunkOptions<T>
  ): Promise<BatchResult<R>> {
    const chunkSize = options?.size ?? 25;
    const tracker = new Tracker({
      name,
      total: items.length,
      observe: options?.observe,
      tags: options?.tags,
      sampleFirst: options?.sampleFirst,
      sampleRate: options?.sampleRate,
      progressEvery: options?.progressEvery,
    });

    const results: R[] = [];
    const continueOnError = options?.continueOnError ?? true;
    const maxFailures = options?.maxFailures;
    const getItemId = options?.getItemId ?? autoGetItemId;

    for (let i = 0; i < items.length; i += chunkSize) {
      if (maxFailures !== undefined && tracker.getFailedCount() >= maxFailures) break;

      const chunk = items.slice(i, i + chunkSize);
      const startTime = Date.now();
      // itemIndex = first item's position in this chunk
      const ctx = tracker.createContext(i);

      try {
        const chunkResults = await processor(chunk, ctx);
        const duration = (Date.now() - startTime) / chunk.length;

        for (let j = 0; j < chunk.length; j++) {
          tracker.recordSuccess(duration, getItemId(chunk[ j ], i + j));
          if (chunkResults[ j ] !== undefined) results.push(chunkResults[ j ]);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const duration = (Date.now() - startTime) / chunk.length;

        for (let j = 0; j < chunk.length; j++) {
          tracker.recordFailure(duration, err, getItemId(chunk[ j ], i + j));
        }

        if (!continueOnError) throw error;
      }
    }

    return { results, summary: tracker.complete() };
  }

  /**
   * Process all items at once.
   */
  static async all<T, R = T>(
    name: string,
    items: T[],
    processor: (items: T[], ctx: ProcessContext) => Promise<R[]> | R[],
    options?: Omit<ProcessOptions<T>, 'concurrency'>
  ): Promise<BatchResult<R>> {
    const tracker = new Tracker({
      name,
      total: items.length,
      observe: options?.observe,
      tags: options?.tags,
      sampleFirst: options?.sampleFirst,
      sampleRate: options?.sampleRate,
    });

    const getItemId = options?.getItemId ?? autoGetItemId;
    const startTime = Date.now();
    const ctx = tracker.createContext(0);

    try {
      const results = await processor(items, ctx);
      const duration = (Date.now() - startTime) / items.length;

      for (let i = 0; i < items.length; i++) {
        tracker.recordSuccess(duration, getItemId(items[ i ], i));
      }

      return { results, summary: tracker.complete() };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const duration = (Date.now() - startTime) / items.length;

      for (let i = 0; i < items.length; i++) {
        tracker.recordFailure(duration, err, getItemId(items[ i ], i));
      }

      return { results: [], summary: tracker.complete() };
    }
  }

  /**
   * Simple forEach with tracking.
   */
  static async forEach<T>(
    name: string,
    items: T[],
    processor: (item: T, ctx: ProcessContext) => Promise<void> | void,
    options?: ProcessOptions<T>
  ): Promise<BatchSummary> {
    const { summary } = await this.process(name, items, processor, options);
    return summary;
  }

  /**
   * Map with tracking.
   */
  static async map<T, R>(
    name: string,
    items: T[],
    mapper: (item: T, ctx: ProcessContext) => Promise<R> | R,
    options?: ProcessOptions<T>
  ): Promise<R[]> {
    const { results } = await this.process(name, items, mapper, {
      ...options,
      continueOnError: false,
    });
    return results;
  }

  /**
   * Concurrent map (like Promise.all but with tracking).
   */
  static async mapConcurrent<T, R>(
    name: string,
    items: T[],
    mapper: (item: T, ctx: ProcessContext) => Promise<R>,
    concurrency = 5,
    options?: Omit<ProcessOptions<T>, 'concurrency'>
  ): Promise<R[]> {
    const { results } = await this.process(name, items, mapper, {
      ...options,
      concurrency,
      continueOnError: false,
    });
    return results;
  }
}
