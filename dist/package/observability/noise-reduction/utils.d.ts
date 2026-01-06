/**
 * Shared utility functions for noise reduction.
 */
import type { ObservabilityEvent, NoiseReductionConfig, SpanCheckpoint } from '../types';
import type { NoiseReductionBounds, NoiseReductionStats } from './types';
/**
 * Type guard for checking if a value is a record.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/**
 * Type guard for checking if a value is a valid checkpoint.
 */
export declare function isCheckpoint(value: unknown): value is SpanCheckpoint;
/**
 * Convert a value to an array if it isn't already.
 */
export declare function asArray<T>(v: T | T[] | undefined): T[] | undefined;
/**
 * Increment a counter in a record.
 */
export declare function incrementCounter(map: Record<string, number>, key: string | undefined, by?: number): void;
/**
 * Estimate the size of heavy fields in an event.
 * Used for tracking bytes saved by noise reduction.
 */
export declare function estimateEventHeavyBytes(event: ObservabilityEvent): number;
/**
 * Get configuration bounds from noise reduction config.
 */
export declare function getBounds(cfg: NoiseReductionConfig): NoiseReductionBounds;
/**
 * Ensure event.data exists and is a record.
 */
export declare function ensureSpanData(span: ObservabilityEvent): Record<string, unknown>;
/**
 * Append a checkpoint to a span, respecting configured limits.
 * Tracks truncation when limit is reached.
 *
 * @returns true if checkpoint was added, false if truncated
 */
export declare function appendCheckpointBounded(span: ObservabilityEvent, cfg: NoiseReductionConfig, checkpoint: SpanCheckpoint): boolean;
/**
 * Create initial noise reduction stats.
 */
export declare function createStats(): NoiseReductionStats;
/**
 * Strip heavy fields from an event (downgrade operation).
 */
export declare function stripHeavyFields(event: ObservabilityEvent): void;
