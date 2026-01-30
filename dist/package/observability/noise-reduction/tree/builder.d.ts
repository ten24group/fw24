/**
 * Phase 1: Build event tree from flat array.
 *
 * Constructs a tree structure from flat observability events based on
 * parentObservabilityLogId relationships. This enables efficient
 * parent-child operations in subsequent phases.
 */
import type { ObservabilityEvent } from '../../types';
import type { EventTree } from '../types';
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
export declare function buildEventTree(events: ReadonlyArray<ObservabilityEvent>): EventTree;
