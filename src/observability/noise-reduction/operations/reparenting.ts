/**
 * Reparenting operations - handling orphaned children when parents are dropped.
 */

import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
import { appendCheckpointBounded, getBounds } from '../utils';

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
export function reparentKeptChildren(
  droppedNode: TreeNode,
  config: NoiseReductionConfig
): TreeNode[] {
  const keptChildren = droppedNode.children.filter(c => c.kept);
  const bounds = getBounds(config);
  const orphanedNodes: TreeNode[] = [];

  for (const child of keptChildren) {
    // Find nearest ancestor
    // We simply move children to the immediate parent (bubbling up).
    // The ancestor will then decide whether to keep itself (now that it has children)
    // or drop and continue bubbling the children up.
    const ancestor = droppedNode.parent;

    if (ancestor) {
      // Reparent to ancestor (update tree structure only)
      // The flattener will set parentObservabilityLogId based on the tree structure
      child.parent = ancestor;

      // Add child to ancestor's children if not already there
      // (It might already be there from initial tree building)
      if (!ancestor.children.includes(child)) {
        ancestor.children.push(child);
      }

      // Add debug checkpoint
      if (bounds.includeDebugMetadata) {
        appendCheckpointBounded(child.event, config, {
          name: 'noiseReduction.reparented',
          ts: Date.now(),
          data: {
            originalParent: droppedNode.event.observabilityLogId,
            newParent: ancestor.event.observabilityLogId,
            reason: 'Original parent was dropped by noise reduction',
          },
        });
      }
    } else {
      // No kept ancestor found - this becomes a root (orphan)
      // The flattener will set parentObservabilityLogId to undefined based on wasReparented flag
      child.parent = undefined;
      child.wasReparented = true;

      // Track as orphaned node (will be added to roots)
      orphanedNodes.push(child);

      // Add debug checkpoint
      if (bounds.includeDebugMetadata) {
        appendCheckpointBounded(child.event, config, {
          name: 'noiseReduction.orphaned',
          ts: Date.now(),
          data: {
            originalParent: droppedNode.event.observabilityLogId,
            reason: 'Original parent and all ancestors were dropped by noise reduction',
          },
        });
      }
    }
  }

  return orphanedNodes;
}
