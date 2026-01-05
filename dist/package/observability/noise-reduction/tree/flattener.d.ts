/**
 * Phase 4: Flatten tree to output array.
 *
 * Converts the transformed tree back to a flat array of events,
 * including only kept nodes and adding summary checkpoints.
 *
 * IMPORTANT: Tree structure is the source of truth after transformation.
 * The parentObservabilityLogId field is always synchronized from the tree's
 * parent pointer. If reparenting occurred during transformation, the output
 * will reflect the modified hierarchy.
 */
import type { NoiseReductionConfig, ObservabilityEvent } from '../../types';
import type { TreeNode } from '../types';
/**
 * Flatten tree to output array.
 *
 * Performs depth-first traversal, emitting only kept nodes.
 * For nodes with noise reduction summaries, adds a summary checkpoint.
 *
 * Time complexity: O(n) where n = nodes
 * Space complexity: O(k) where k = kept nodes
 *
 * @param node - Current node to flatten
 * @param output - Output array to append to
 * @param config - Optional config for checkpoint bounds checking
 */
export declare function flattenTree(node: TreeNode, output: ObservabilityEvent[], config?: NoiseReductionConfig): void;
