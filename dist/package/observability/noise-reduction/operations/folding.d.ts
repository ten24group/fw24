/**
 * Folding operations - collapsing events into parent as checkpoints.
 */
import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
/**
 * Fold an event into its parent span as a checkpoint.
 *
 * PURPOSE: Collapse noisy child events into parent timeline, preserving
 * metrics and critical context. Used for repetitive operations (cache hits,
 * validation steps, etc.) that need timeline markers but not standalone records.
 *
 * PERFORMANCE CRITICAL: Runs during flush on potentially 1000+ events.
 * - NO JSON.stringify()
 * - NO Object.keys().length checks
 * - NO deep object comparisons
 * - Simple string comparisons only
 *
 * DESIGN:
 * - Metrics: Merged into parent (additive aggregation)
 * - Timeline: Single checkpoint with timestamp
 * - Critical data: Errors, failures, entity IDs
 * - Common data: Inherited from parent (NOT duplicated)
 *
 * @param node - Node to fold (child)
 * @param config - Noise reduction configuration
 */
export declare function foldIntoParent(node: TreeNode, config: NoiseReductionConfig): void;
