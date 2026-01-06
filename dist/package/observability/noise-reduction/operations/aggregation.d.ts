/**
 * Aggregation operations - summarizing multiple events into buckets.
 */
import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
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
export declare function aggregateIntoParent(node: TreeNode, config: NoiseReductionConfig): void;
