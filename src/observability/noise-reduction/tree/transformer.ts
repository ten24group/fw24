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

import type { NoiseReductionConfig, ObservabilityEvent } from '../../types';
import { ObservabilityLevel } from '../../types';
import type { TreeNode, NoiseReductionStats, NoiseReductionData } from '../types';
import { estimateEventHeavyBytes, incrementCounter, stripHeavyFields, getBounds, ensureSpanData, appendCheckpointBounded, isRecord } from '../utils';
import { stringToLevel } from '../../utils/level-utils';
import { foldIntoParent } from '../operations/folding';
import { aggregateIntoParent } from '../operations/aggregation';
import { reparentKeptChildren } from '../operations/reparenting';
import { addToParentSummary } from '../operations/summary';

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
export function transformTree(
  node: TreeNode,
  config: NoiseReductionConfig,
  stats: NoiseReductionStats
): TreeNode[] {
  const bounds = getBounds(config);
  let orphanedNodes: TreeNode[] = [];

  // Post-order traversal: transform children first
  // This ensures we know child states before applying parent decisions
  for (const child of node.children) {
    const childOrphans = transformTree(child, config, stats);
    orphanedNodes = orphanedNodes.concat(childOrphans);
  }

  // Now apply decision to THIS node
  const decision = node.decision ?? 'keep';

  switch (decision) {
    case 'keep':
      node.kept = true;
      stats.kept++;
      break;

    case 'drop':
      const minContextLevel = config.minLevel ?? ObservabilityLevel.INFO;
      const nodeLevel = stringToLevel(node.event.level);
      const hasParent = node.parent !== undefined;
      const isExplicitOverride = node.ruleId === 'override';

      // Context preservation: upgrade DROP to FOLD if this node provides context for a hard signal
      // EXCEPT for explicit overrides (capture.noise) which must be honored
      if (!isExplicitOverride && node.hasHardSignalInSubtree && nodeLevel >= minContextLevel) {
        // Has hard signal in subtree AND node meets minLevel threshold
        // AUTOMATIC UPGRADE: DROP → FOLD (or KEEP if root)
        if (hasParent) {
          node.kept = false;
          foldIntoParent(node, config);
          stats.folded++;
          incrementCounter(stats.foldedByType, node.event.type);
          incrementCounter(stats.foldedByOperation, node.event.operation);

          if (bounds.includeDebugMetadata) {
            stats.approxBytesSaved += estimateEventHeavyBytes(node.event);
          }

          const newOrphans = reparentKeptChildren(node, config);
          orphanedNodes = orphanedNodes.concat(newOrphans);
          addToParentSummary(node, config);
        } else {
          // ROOT: can't fold, keep as context
          node.kept = true;
          stats.kept++;

          if (bounds.includeDebugMetadata) {
            appendCheckpointBounded(node.event, config, {
              name: 'noiseReduction.contextRoot',
              ts: Date.now(),
              data: {
                reason: 'Root context for hard signal (has error in subtree)',
              },
            });
          }
        }
      } else {
        // No hard signal OR below minLevel - drop as intended
        node.kept = false;
        stats.dropped++;
        incrementCounter(stats.droppedByType, node.event.type);
        incrementCounter(stats.droppedByOperation, node.event.operation);

        if (bounds.includeDebugMetadata) {
          stats.approxBytesSaved += estimateEventHeavyBytes(node.event);
        }

        const newOrphans = reparentKeptChildren(node, config);
        orphanedNodes = orphanedNodes.concat(newOrphans);
        addToParentSummary(node, config);
      }
      break;

    case 'fold':
      if (node.parent) {
        // Always fold into parent (even if parent will be dropped later)
        // The parent's subsequent processing will see 'hasAbsorbedData=true' and keep itself
        foldIntoParent(node, config);
        node.kept = false;
        stats.folded++;
        incrementCounter(stats.foldedByType, node.event.type);
        incrementCounter(stats.foldedByOperation, node.event.operation);

        if (bounds.includeDebugMetadata) {
          stats.approxBytesSaved += estimateEventHeavyBytes(node.event);
        }

        // CRITICAL: Reparent any kept children before dropping
        // When a node is folded, its children become orphaned unless reparented
        const newOrphans = reparentKeptChildren(node, config);
        orphanedNodes = orphanedNodes.concat(newOrphans);

        addToParentSummary(node, config);
      } else {
        // No parent - cannot fold, must keep
        node.kept = true;
        stats.kept++;
      }
      break;

    case 'aggregate':
      if (node.parent) {
        // Always aggregate into parent
        aggregateIntoParent(node, config);
        node.kept = false;
        stats.aggregated++;

        if (bounds.includeDebugMetadata) {
          stats.approxBytesSaved += estimateEventHeavyBytes(node.event);
        }

        // CRITICAL: Reparent any kept children before dropping
        // When a node is aggregated, its children become orphaned unless reparented
        const newOrphans = reparentKeptChildren(node, config);
        orphanedNodes = orphanedNodes.concat(newOrphans);

        addToParentSummary(node, config);
      } else {
        // No parent - cannot aggregate, must keep
        node.kept = true;
        stats.kept++;
      }
      break;

    case 'downgrade':
      node.kept = true;
      stats.downgraded++;
      stripHeavyFields(node.event);

      if (bounds.includeDebugMetadata) {
        stats.approxBytesSaved += estimateEventHeavyBytes(node.event);
      }
      break;
  }

  return orphanedNodes;
}
