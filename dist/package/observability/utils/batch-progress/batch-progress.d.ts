import { ProcessContext, ProcessOptions, BatchResult, ChunkOptions, BatchSummary } from '.';
/** Auto-detect item ID from common fields */
export declare function autoGetItemId(item: unknown, index: number): string;
export declare class BatchProgress {
    /**
     * Process items individually.
     */
    static process<T, R = void>(name: string, items: T[], processor: (item: T, ctx: ProcessContext) => Promise<R> | R, options?: ProcessOptions<T>): Promise<BatchResult<R>>;
    /**
     * Process items in chunks (for batch APIs).
     */
    static chunk<T, R = T>(name: string, items: T[], processor: (chunk: T[], ctx: ProcessContext) => Promise<R[]> | R[], options?: ChunkOptions<T>): Promise<BatchResult<R>>;
    /**
     * Process all items at once.
     */
    static all<T, R = T>(name: string, items: T[], processor: (items: T[], ctx: ProcessContext) => Promise<R[]> | R[], options?: Omit<ProcessOptions<T>, 'concurrency'>): Promise<BatchResult<R>>;
    /**
     * Simple forEach with tracking.
     */
    static forEach<T>(name: string, items: T[], processor: (item: T, ctx: ProcessContext) => Promise<void> | void, options?: ProcessOptions<T>): Promise<BatchSummary>;
    /**
     * Map with tracking.
     */
    static map<T, R>(name: string, items: T[], mapper: (item: T, ctx: ProcessContext) => Promise<R> | R, options?: ProcessOptions<T>): Promise<R[]>;
    /**
     * Concurrent map (like Promise.all but with tracking).
     */
    static mapConcurrent<T, R>(name: string, items: T[], mapper: (item: T, ctx: ProcessContext) => Promise<R>, concurrency?: number, options?: Omit<ProcessOptions<T>, 'concurrency'>): Promise<R[]>;
}
