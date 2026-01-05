/**
 * Phase 3: Transform tree based on noise reduction decisions.
 *
 * Applies noise reduction decisions to the tree, performing:
 * - Dropping nodes
 * - Folding nodes into parents
 * - Aggregating nodes into parents
 * - Reparenting orphaned children
 * - Tracking statistics
 */
import type { NoiseReductionConfig } from '../../types';
import type { TreeNode, NoiseReductionStats } from '../types';
/**
 * Transform tree by applying noise reduction decisions.
 *
 * Uses post-order traversal (children first) to ensure child states
 * are known before parent decisions are applied. This enables natural
 * reparenting and prevents force-keep bugs.
 *
 * For each node:
 * 1. Transform all children first (post-order)
 * 2. Apply this node's decision (keep/drop/fold/aggregate/downgrade)
 * 3. Handle side effects (reparenting, summaries, statistics)
 *
 * Time complexity: O(n) where n = nodes
 * Space complexity: O(1) additional (modifies tree in-place)
 *
 * @param node - Current node to transform
 * @param config - Noise reduction configuration
 * @param stats - Statistics accumulator
 * @returns Array of orphaned nodes (children that became roots)
 */
export declare function transformTree(node: TreeNode, config: NoiseReductionConfig, stats: NoiseReductionStats): TreeNode[];
