/**
 * Phase 2.5: Propagate hard signal flags up the tree.
 *
 * This phase walks the tree post-order and marks which nodes have
 * hard signals in their subtree. This information is used in Phase 3
 * to automatically preserve context around errors.
 */
import type { TreeNode } from '../types';
import type { NoiseReductionConfig } from '../../types';
/**
 * Propagate hard signal flags up the tree.
 *
 * Post-order traversal: check children first, then this node.
 * If any descendant is a hard signal, mark this node's subtree as having one.
 *
 * This enables automatic context preservation: nodes with hard signals in
 * their subtree will not be dropped even if rules say to drop them.
 *
 * Time complexity: O(n) where n = number of nodes
 * Space complexity: O(1) additional (modifies nodes in-place)
 *
 * @param node - Current node to process
 * @param config - Noise reduction configuration
 * @returns true if this node or any descendant is a hard signal
 */
export declare function propagateHardSignals(node: TreeNode, config: NoiseReductionConfig): boolean;
