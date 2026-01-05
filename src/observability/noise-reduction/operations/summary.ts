/**
 * Summary tracking operations - tracking suppressions on parent spans.
 */

import type { NoiseReductionConfig } from '../../types';
import type { TreeNode, NoiseReductionData } from '../types';
import { ensureSpanData, incrementCounter, getBounds } from '../utils';

/**
 * Add noise reduction summary data to parent span.
 * 
 * Tracks statistics about suppressed children (dropped/folded/aggregated)
 * on the parent span. This provides visibility into what was suppressed.
 * 
 * Summary data includes:
 * - Counts by decision type (dropped, folded, aggregated)
 * - Breakdown by event type
 * - Breakdown by rule ID (debug metadata only)
 * - Breakdown by operation (debug metadata only)
 * 
 * @param node - Node that was suppressed (child)
 * @param config - Noise reduction configuration
 */
export function addToParentSummary(
  node: TreeNode,
  config: NoiseReductionConfig
): void {
  if (!node.parent) return;

  const parent = node.parent;
  const event = node.event;
  const bounds = getBounds(config);

  // Get or create noise reduction data on parent
  const data = ensureSpanData(parent.event);
  const nrData = (data.noiseReduction ?? {}) as NoiseReductionData;

  // Increment appropriate decision counter
  switch (node.decision) {
    case 'drop':
      nrData.dropped = (nrData.dropped ?? 0) + 1;
      break;
    case 'fold':
      nrData.folded = (nrData.folded ?? 0) + 1;
      break;
    case 'aggregate':
      nrData.aggregated = (nrData.aggregated ?? 0) + 1;
      break;
  }

  // Track by event type
  if (!nrData.byType) nrData.byType = {};
  incrementCounter(nrData.byType, event.type);

  // Track by rule ID (debug metadata only)
  if (bounds.includeDebugMetadata) {
    if (!nrData.byRuleId) nrData.byRuleId = {};
    if (node.ruleId) {
      incrementCounter(nrData.byRuleId, node.ruleId);
    }

    if (!nrData.byOperation) nrData.byOperation = {};
    incrementCounter(nrData.byOperation, event.operation);
  }

  // Save updated data
  data.noiseReduction = nrData;
}
