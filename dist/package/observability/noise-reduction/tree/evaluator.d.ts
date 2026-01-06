/**
 * Phase 2: Evaluate noise reduction decisions for all nodes.
 *
 * Walks the tree depth-first and evaluates noise reduction rules
 * for each node, storing the decision on the node itself.
 *
 * Hard signals (errors/failures/slow operations) are protected here and can only
 * receive KEEP or AGGREGATE decisions. This ensures critical events are always visible.
 */
import type { NoiseReductionConfig, NoiseRule } from '../../types';
import type { TreeNode } from '../types';
/**
 * Evaluate noise reduction decisions for a tree.
 *
 * Performs depth-first traversal, evaluating rules for each node.
 * The decision is stored on the node for use in Phase 3 (transformation).
 *
 * Hard signals are protected: if a rule tries to drop/fold/downgrade a hard signal,
 * the decision is overridden to KEEP to ensure visibility.
 *
 * Time complexity: O(n * m) where n = nodes, m = rules
 * Space complexity: O(1) additional (modifies nodes in-place)
 *
 * @param node - Current node to evaluate (starts with root)
 * @param config - Noise reduction configuration
 * @param allRules - All rules to evaluate (builtin + custom)
 */
export declare function evaluateDecisions(node: TreeNode, config: NoiseReductionConfig, allRules: ReadonlyArray<NoiseRule>): void;
