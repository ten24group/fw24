/**
 * Reparenting operations - handling orphaned children when parents are dropped.
 */
import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
/**
 * Reparent kept children when their parent is dropped.
 *
 * When a parent node is dropped/folded/aggregated, any kept children
 * must be reparented to the nearest kept ancestor. This maintains
 * hierarchy integrity in the final output.
 *
 * Algorithm:
 * 1. Find all kept children of the dropped node
 * 2. For each kept child:
 *    a. Walk up ancestors until finding a kept one
 *    b. If found: reparent to that ancestor
 *    c. If not found: make child a root (orphan)
 * 3. Add debug checkpoints to track reparenting
 *
 * Time complexity: O(k * d) where k = kept children, d = tree depth
 * Space complexity: O(1) (modifies tree in-place)
 *
 * @param droppedNode - Node that was dropped (parent)
 * @param config - Noise reduction configuration
 * @returns Array of orphaned nodes (children that became roots)
 */
export declare function reparentKeptChildren(droppedNode: TreeNode, config: NoiseReductionConfig): TreeNode[];
