/**
 * Summary tracking operations - tracking suppressions on parent spans.
 */
import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
/**
 * Add noise reduction summary data to parent span.
 *
 * Tracks statistics about suppressed children (dropped/folded/aggregated)
 * on the parent span. This provides visibility into what was suppressed.
 *
 * Summary data includes:
 * - Counts by decision type (dropped, folded, aggregated)
 * - Breakdown by event type
 * - Breakdown by rule ID (debug metadata only)
 * - Breakdown by operation (debug metadata only)
 *
 * @param node - Node that was suppressed (child)
 * @param config - Noise reduction configuration
 */
export declare function addToParentSummary(node: TreeNode, config: NoiseReductionConfig): void;
