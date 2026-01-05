/**
 * Phase 1: Build event tree from flat array.
 * 
 * Constructs a tree structure from flat observability events based on
 * parentObservabilityLogId relationships. This enables efficient
 * parent-child operations in subsequent phases.
 */

import type { ObservabilityEvent } from '../../types';
import type { EventTree, TreeNode } from '../types';

/**
 * Build a tree structure from flat observability events.
 * 
 * Algorithm:
 * 1. Create a TreeNode for each event
 * 2. Index all nodes by observabilityLogId
 * 3. Link parent-child relationships via parentObservabilityLogId
 * 4. Collect root nodes (no parent or parent not in batch)
 * 
 * Time complexity: O(n) where n is the number of events
 * Space complexity: O(n) for the tree structure
 * 
 * @param events - Flat array of observability events
 * @returns Tree structure with roots and node index
 */
export function buildEventTree(events: ReadonlyArray<ObservabilityEvent>): EventTree {
  const nodeById = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Phase 1: Create all nodes
  // We create all nodes first to ensure they exist before linking
  for (const event of events) {
    const node: TreeNode = {
      event,
      children: [],
      kept: false, // Will be set in Phase 3 (transformation)
    };

    nodeById.set(event.observabilityLogId, node);
  }

  // Phase 2: Link parent-child relationships
  // Now that all nodes exist, we can safely link them
  for (const node of nodeById.values()) {
    const parentId = node.event.parentObservabilityLogId;

    if (parentId) {
      const parent = nodeById.get(parentId);

      if (parent) {
        // Parent exists in this batch - link them
        node.parent = parent;
        parent.children.push(node);
      } else {
        // Parent not in this batch - this is a root for our purposes
        // This can happen with cross-invocation spans or batched processing
        roots.push(node);
      }
    } else {
      // No parent ID - this is a true root
      roots.push(node);
    }
  }

  return {
    roots: Object.freeze(roots),
    nodeById,
  };
}
