import { ObserveMode, ProcessContext, BatchSummary } from '.';
import type { CaptureControl } from '../../types';
/** Calculate progress interval */
export declare function calcProgressInterval(total: number, customInterval?: number): number;
export declare class Tracker {
    private readonly name;
    private readonly batchId;
    private readonly startTime;
    private readonly observe;
    private readonly tags?;
    private readonly sampleFirst;
    private readonly sampleRate;
    private readonly progressEvery;
    private total;
    private succeeded;
    private failed;
    private skipped;
    private processed;
    private durations;
    private minDuration;
    private maxDuration;
    private slowestItemId?;
    private failedItems;
    private errorsByType;
    private metrics;
    private currentItemMetrics;
    constructor(config: {
        name: string;
        total: number;
        observe?: ObserveMode;
        tags?: Record<string, string>;
        sampleFirst?: number;
        sampleRate?: number;
        progressEvery?: number;
    });
    addMetric(name: string, value: number): void;
    private flushMetrics;
    recordSuccess(durationMs: number, itemId?: string): void;
    recordFailure(durationMs: number, error: Error, itemId: string): void;
    recordSkipped(): void;
    getFailedCount(): number;
    /**
     * Get capture control for per-item logging.
     * Always returns group sampling config - decoupled from observe mode.
     * This allows users to control per-item log sampling independently.
     */
    getCaptureControl(): CaptureControl;
    /** Get batch ID */
    getBatchId(): string;
    createContext(itemIndex: number): ProcessContext;
    private maybeLogProgress;
    complete(): BatchSummary;
}
