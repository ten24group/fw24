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
import type { TreeNode, NoiseReductionData } from '../types';
import { isRecord, appendCheckpointBounded } from '../utils';

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
export function flattenTree(
  node: TreeNode,
  output: ObservabilityEvent[],
  config?: NoiseReductionConfig
): void {
  if (!node.kept) {
    // Node was suppressed - skip it and its children
    return;
  }

  // CRITICAL: Sync parentObservabilityLogId from tree structure
  // Tree structure is the source of truth after reparenting
  if (node.parent !== undefined) {
    // Has parent: find nearest KEPT ancestor to avoid dangling references
    let nearestKeptAncestor: TreeNode | undefined = node.parent;
    while (nearestKeptAncestor && !nearestKeptAncestor.kept) {
      nearestKeptAncestor = nearestKeptAncestor.parent;
    }
    node.event.parentObservabilityLogId = nearestKeptAncestor?.event.observabilityLogId;
  } else if (node.wasReparented) {
    // Node was reparented (parent was dropped) - clear parent reference
    node.event.parentObservabilityLogId = undefined;
  } else if (node.event.parentObservabilityLogId) {
    // No parent in tree and not reparented: parent was never in this batch
    // Clear per contract: parentObservabilityLogId should only reference same slice
    // Cross-invocation links should use causedBy instead
    node.event.parentObservabilityLogId = undefined;
  }

  // Add this node to output
  output.push(node.event);

  // Add summary checkpoint if this node had suppressions
  // IMPORTANT: Use appendCheckpointBounded to respect limits
  const data = node.event.data;
  if (isRecord(data)) {
    const nrData = data.noiseReduction as NoiseReductionData | undefined;

    if (nrData && (nrData.dropped || nrData.folded || nrData.aggregated)) {
      // Check if summary checkpoint already exists
      const checkpoints = data.checkpoints;
      const hasSummary = Array.isArray(checkpoints) &&
        checkpoints.some((c: any) => c?.name === 'noiseReduction.summary');

      if (!hasSummary && config) {
        // Create summary data for checkpoint (compact, distinct info only)
        const summaryData: any = {};

        // Always include counts (cheap, useful)
        if (nrData.dropped) summaryData.dropped = nrData.dropped;
        if (nrData.folded) summaryData.folded = nrData.folded;
        if (nrData.aggregated) summaryData.aggregated = nrData.aggregated;

        // Include type breakdown (distinct values, cheap)
        if (nrData.byType && Object.keys(nrData.byType).length > 0) {
          summaryData.byType = nrData.byType;
        }

        // Include FULL aggregates data (with examples, errors, rules)
        // Checkpoint should be self-contained with all aggregate details
        if (nrData.aggregates) {
          summaryData.aggregates = nrData.aggregates;
        }

        // Include truncation metadata if present
        if (nrData.checkpointsTruncated) summaryData.checkpointsTruncated = nrData.checkpointsTruncated;
        if (nrData.checkpointsTruncatedCount) summaryData.checkpointsTruncatedCount = nrData.checkpointsTruncatedCount;
        if (nrData.aggregateKeysTruncated) summaryData.aggregateKeysTruncated = nrData.aggregateKeysTruncated;
        if (nrData.aggregateExamplesTruncated) summaryData.aggregateExamplesTruncated = nrData.aggregateExamplesTruncated;

        // Add summary checkpoint with ALL data (checkpoint is self-contained)
        appendCheckpointBounded(node.event, config, {
          name: 'noiseReduction.summary',
          ts: Date.now(),
          data: summaryData,
        });
      } else if (!hasSummary) {
        // Fallback if no config provided (shouldn't happen in practice)
        if (!Array.isArray(data.checkpoints)) {
          data.checkpoints = [];
        }
        (data.checkpoints as any[]).push({
          name: 'noiseReduction.summary',
          ts: Date.now(),
          data: {
            dropped: nrData.dropped,
            folded: nrData.folded,
            aggregated: nrData.aggregated,
            byType: nrData.byType,
            aggregates: nrData.aggregates,
          },
        });
      }

      // Delete data.noiseReduction entirely - all info is in the checkpoint now
      delete data.noiseReduction;
    }
  }

  // Recurse to kept children only
  for (const child of node.children) {
    if (child.kept) {
      flattenTree(child, output, config);
    }
  }
}
