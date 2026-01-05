/**
 * Aggregation operations - summarizing multiple events into buckets.
 */

import type { NoiseReductionConfig } from '../../types';
import type { TreeNode, AggregateBucket, NoiseReductionData, AggregateExample, AggregateErrorExample } from '../types';
import { appendCheckpointBounded, ensureSpanData, getBounds } from '../utils';

/**
 * Aggregate an event into its parent span's aggregate buckets.
 * 
 * PURPOSE: Summarize many similar events (e.g., batch processing 1000 items)
 * into statistics + limited examples. Shows patterns without storing every event.
 * 
 * PERFORMANCE CRITICAL: Runs during flush on potentially 1000+ events.
 * - Fast bucket lookups
 * - Minimal field copies
 * - Examples only if configured
 * 
 * OUTPUT:
 * - Statistics: count, errorCount, durationSum, durationMax
 * - Success examples: Minimal (ID + timing only)
 * - Error examples: Full context (critical for debugging)
 * 
 * @param node - Node to aggregate (child)
 * @param config - Noise reduction configuration
 */
export function aggregateIntoParent(node: TreeNode, config: NoiseReductionConfig): void {
  if (!node.parent) return;

  const parent = node.parent;
  const event = node.event;
  const bounds = getBounds(config);

  // Get or create noise reduction data on parent
  const data = ensureSpanData(parent.event);
  const nrData = (data.noiseReduction ?? {}) as NoiseReductionData;
  if (!nrData.aggregates) {
    nrData.aggregates = {};
  }

  // Create aggregate key from event type and operation/source
  const key = `${event.type}:${event.operation ?? event.source ?? event.type}`;
  let bucket = nrData.aggregates[ key ];
  let isNewBucket = false;

  if (!bucket) {
    // Track bucket count internally (avoid Object.keys() on every call)
    if (!nrData._bucketCount) nrData._bucketCount = 0;

    // Check if we've hit the limit for aggregate keys
    if (nrData._bucketCount >= bounds.maxAggregateKeysPerSpan) {
      nrData.aggregateTruncated = true;
      return; // Don't create new bucket if limit reached
    }

    // Create new bucket
    bucket = {
      count: 0,
      errorCount: 0,
      durationSumMs: 0,
      durationMaxMs: 0,
      examples: [],
      errorExamples: [],
      rules: {},
    };
    nrData.aggregates[ key ] = bucket;
    nrData._bucketCount++;
    isNewBucket = true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE STATISTICS (FAST)
  // ─────────────────────────────────────────────────────────────────────────

  bucket.count++;

  if (event.durationMs !== undefined) {
    bucket.durationSumMs += event.durationMs;
    bucket.durationMaxMs = Math.max(bucket.durationMaxMs, event.durationMs);
  }

  // Track which rule matched
  if (node.ruleId) {
    bucket.rules[ node.ruleId ] = (bucket.rules[ node.ruleId ] ?? 0) + 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CAPTURE EXAMPLES (if configured)
  // ─────────────────────────────────────────────────────────────────────────

  if (!bounds.includeExamples) {
    // Examples disabled - skip expensive example creation
    if (!event.success || event.error) {
      bucket.errorCount++;
    }
  } else if (!event.success || event.error) {
    // ERROR EXAMPLE: Capture full context (critical for debugging)
    bucket.errorCount++;

    if (bucket.errorExamples.length < bounds.maxAggregateErrorExamplesPerKey) {
      const errorExample: AggregateErrorExample = {
        observabilityLogId: event.observabilityLogId,
        type: event.type,
        level: event.level,
        operation: event.operation,
        entityId: event.entityId, // Critical for identifying which entity failed
        entityName: event.entityName,
        durationMs: event.durationMs,
        success: event.success,
        error: event.error
          ? { type: event.error.type ?? 'Error', message: event.error.message ?? '' }
          : undefined,
        // Error context (important for debugging)
        status: event.status,
        subType: event.subType,
        data: event.data, // Full error payload
        tags: event.tags,
        metrics: event.metrics,
        actor: event.actor,
        causedBy: event.causedBy,
        ruleId: node.ruleId,
      };
      bucket.errorExamples.push(errorExample);
    }
  } else {
    // SUCCESS EXAMPLE: Minimal data (just ID + timing for reference)
    if (bucket.examples.length < bounds.maxAggregateExamplesPerKey) {
      const example: AggregateExample = {
        observabilityLogId: event.observabilityLogId,
        type: event.type,
        level: event.level,
        operation: event.operation,
        entityId: event.entityId, // Just the ID for lookup/reference
        entityName: event.entityName,
        durationMs: event.durationMs,
        success: event.success,
        // Minimal context (no heavy payloads for successful operations)
        status: event.status,
        subType: event.subType,
        ruleId: node.ruleId,
        // DEBUG MODE: Include tags/metrics for pattern analysis
        tags: bounds.includeDebugMetadata ? event.tags : undefined,
        metrics: bounds.includeDebugMetadata ? event.metrics : undefined,
      };
      bucket.examples.push(example);
    }
  }

  // Save updated noise reduction data
  data.noiseReduction = nrData;

  // Add checkpoint to parent timeline ONLY for new buckets (not every event)
  // This prevents thousands of duplicate checkpoints
  if (isNewBucket) {
    appendCheckpointBounded(parent.event, config, {
      name: `aggregate:${key}`,
      ts: event.timestampMs,
      data: bounds.includeDebugMetadata
        ? { ruleId: node.ruleId, reason: node.reason }
        : undefined,
    });
  }
}
