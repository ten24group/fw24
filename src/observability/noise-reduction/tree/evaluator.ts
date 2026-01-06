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
import { evaluateNoiseRules } from '../priority';
import { matchesRule } from '../rules/matcher';
import { isHardSignal } from '../hard-signals';

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
export function evaluateDecisions(
  node: TreeNode,
  config: NoiseReductionConfig,
  allRules: ReadonlyArray<NoiseRule>
): void {
  // Evaluate rules for this node
  const result = evaluateNoiseRules(node.event, allRules, matchesRule);

  // Hard signal protection: errors/failures cannot be dropped, folded, or downgraded
  // EXCEPT when explicitly overridden via capture.noise (which has Infinity priority)
  const isExplicitOverride = result.ruleId === 'override';
  const shouldProtect = isHardSignal(node.event, config) && !isExplicitOverride;

  if (shouldProtect) {
    if (result.decision === 'drop' || result.decision === 'fold' || result.decision === 'downgrade') {
      // Override: hard signals must be kept as standalone records
      node.decision = 'keep';
      node.ruleId = 'builtin.hard_signal_protection';
      node.reason = 'Hard signal (error/failure/slow) must be visible as standalone record';
    } else {
      // Allow KEEP or AGGREGATE (errors still visible in parent stats if aggregated)
      node.decision = result.decision;
      node.ruleId = result.ruleId;
      node.reason = result.reason;
    }
  } else {
    // Not a hard signal OR explicit override - use rule evaluation result
    node.decision = result.decision;
    node.ruleId = result.ruleId;
    node.reason = result.reason;
  }

  // Recurse to children (depth-first traversal)
  for (const child of node.children) {
    evaluateDecisions(child, config, allRules);
  }
}
