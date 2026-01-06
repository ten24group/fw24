/**
 * Shared utility functions for noise reduction.
 */

import type { ObservabilityEvent, NoiseReductionConfig, SpanCheckpoint } from '../types';
import type { NoiseReductionBounds, NoiseReductionStats } from './types';

/**
 * Type guard for checking if a value is a record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard for checking if a value is a valid checkpoint.
 */
export function isCheckpoint(value: unknown): value is SpanCheckpoint {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.ts !== 'number') return false;
  if (value.tags !== undefined && !isRecord(value.tags)) return false;
  if (value.metrics !== undefined && !isRecord(value.metrics)) return false;
  if (value.data !== undefined && !isRecord(value.data)) return false;
  if (value.error !== undefined && !isRecord(value.error)) return false;
  return true;
}

/**
 * Convert a value to an array if it isn't already.
 */
export function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [ v ];
}

/**
 * Increment a counter in a record.
 */
export function incrementCounter(
  map: Record<string, number>,
  key: string | undefined,
  by: number = 1
): void {
  const k = key ?? '_';
  map[ k ] = (map[ k ] ?? 0) + by;
}

/**
 * Estimate the size of heavy fields in an event.
 * Used for tracking bytes saved by noise reduction.
 */
export function estimateEventHeavyBytes(event: ObservabilityEvent): number {
  const data = event.data ?? {};
  const attrs = event.attributes ?? {};
  const meta = event.metadata ?? {};
  const ctx = event.context ?? {};

  return (
    JSON.stringify(data).length +
    JSON.stringify(attrs).length +
    JSON.stringify(meta).length +
    JSON.stringify(ctx).length
  );
}

/**
 * Get configuration bounds from noise reduction config.
 */
export function getBounds(cfg: NoiseReductionConfig): NoiseReductionBounds {
  return {
    maxCheckpointsPerSpan: cfg.maxCheckpointsPerSpan,
    maxAggregateKeysPerSpan: cfg.maxAggregateKeysPerSpan,
    maxAggregateExamplesPerKey: cfg.maxAggregateExamplesPerKey,
    maxAggregateErrorExamplesPerKey: cfg.maxAggregateErrorExamplesPerKey,
    includeDebugMetadata: cfg.includeDebugMetadata,
    includeExamples: cfg.includeExamples,
  };
}

/**
 * Ensure event.data exists and is a record.
 */
export function ensureSpanData(span: ObservabilityEvent): Record<string, unknown> {
  if (!span.data) span.data = {};
  if (!isRecord(span.data)) span.data = {};
  return span.data as Record<string, unknown>;
}

/**
 * Append a checkpoint to a span, respecting configured limits.
 * Tracks truncation when limit is reached.
 * 
 * @returns true if checkpoint was added, false if truncated
 */
export function appendCheckpointBounded(
  span: ObservabilityEvent,
  cfg: NoiseReductionConfig,
  checkpoint: SpanCheckpoint
): boolean {
  const data = ensureSpanData(span);
  if (!data.checkpoints) data.checkpoints = [];
  if (!Array.isArray(data.checkpoints)) data.checkpoints = [];

  const arr = data.checkpoints as unknown[];
  const { maxCheckpointsPerSpan } = getBounds(cfg);

  if (arr.length < maxCheckpointsPerSpan) {
    arr.push(checkpoint);
    return true;
  }

  // Track truncation
  if (!data.noiseReduction) data.noiseReduction = {};
  const nrData = data.noiseReduction as any;

  if (!nrData.checkpointsTruncated) {
    nrData.checkpointsTruncated = true;
    nrData.checkpointsTruncatedCount = 0;
  }

  nrData.checkpointsTruncatedCount++;

  return false;
}

/**
 * Create initial noise reduction stats.
 */
export function createStats(): NoiseReductionStats {
  return {
    dropped: 0,
    folded: 0,
    aggregated: 0,
    downgraded: 0,
    kept: 0,
    approxBytesSaved: 0,
    droppedByType: {},
    droppedByOperation: {},
    foldedByType: {},
    foldedByOperation: {},
  };
}

/**
 * Strip heavy fields from an event (downgrade operation).
 */
export function stripHeavyFields(event: ObservabilityEvent): void {
  // Delete heavy fields entirely (not just empty them)
  delete event.data;
  delete event.attributes;
  delete event.metadata;
  delete event.context;
}
