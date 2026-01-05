/**
 * Folding operations - collapsing events into parent as checkpoints.
 */

import type { NoiseReductionConfig } from '../../types';
import type { TreeNode } from '../types';
import { appendCheckpointBounded, getBounds } from '../utils';

/**
 * Fold an event into its parent span as a checkpoint.
 * 
 * PURPOSE: Collapse noisy child events into parent timeline, preserving
 * metrics and critical context. Used for repetitive operations (cache hits,
 * validation steps, etc.) that need timeline markers but not standalone records.
 * 
 * PERFORMANCE CRITICAL: Runs during flush on potentially 1000+ events.
 * - NO JSON.stringify()
 * - NO Object.keys().length checks
 * - NO deep object comparisons
 * - Simple string comparisons only
 * 
 * DESIGN:
 * - Metrics: Merged into parent (additive aggregation)
 * - Timeline: Single checkpoint with timestamp
 * - Critical data: Errors, failures, entity IDs
 * - Common data: Inherited from parent (NOT duplicated)
 * 
 * @param node - Node to fold (child)
 * @param config - Noise reduction configuration
 */
export function foldIntoParent(node: TreeNode, config: NoiseReductionConfig): void {
  if (!node.parent) return;

  const parent = node.parent;
  const event = node.event;
  const bounds = getBounds(config);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. MERGE METRICS INTO PARENT (fast additive operation)
  // ─────────────────────────────────────────────────────────────────────────

  if (event.metrics) {
    if (!parent.event.metrics) {
      parent.event.metrics = {};
    }
    for (const [ k, v ] of Object.entries(event.metrics)) {
      parent.event.metrics[ k ] = (parent.event.metrics[ k ] ?? 0) + v;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. BUILD CHECKPOINT WITH MINIMAL DATA (FAST)
  // ─────────────────────────────────────────────────────────────────────────

  const name = event.operation || event.type;
  const data: Record<string, unknown> = {
    _id: event.observabilityLogId, // Always include for traceability
  };

  // CRITICAL: Errors always get full context
  if (event.error) {
    data.error = event.error;
    if (event.data) data.data = event.data; // Error payload critical for debugging
  }

  // CRITICAL: Failures always recorded
  if (event.success === false) {
    data.success = false;
  }

  // Entity context (ONLY if different - cheap string comparison)
  if (event.entityId && event.entityId !== parent.event.entityId) {
    data.entityId = event.entityId;
  }

  if (event.entityName && event.entityName !== parent.event.entityName) {
    data.entityName = event.entityName;
  }

  // Status markers (checkpoint-specific, usually different)
  if (event.status) data.status = event.status;
  if (event.subType) data.subType = event.subType;

  // Duration if significant (>10ms threshold)
  if (event.durationMs !== undefined && event.durationMs > 10) {
    data.durationMs = event.durationMs;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. DEBUG MODE: Include verbose context (opt-in)
  // ─────────────────────────────────────────────────────────────────────────

  if (bounds.includeDebugMetadata) {
    // Include data payload (if not already included for error)
    if (event.data && !event.error) data.data = event.data;

    // Include metadata for debugging
    if (event.source && event.source !== parent.event.source) data.source = event.source;
    if (event.level && event.level !== parent.event.level) data.level = event.level;
    if (event.attributes) data.attributes = event.attributes;
    if (event.context) data.context = event.context;
    if (event.metadata) data.metadata = event.metadata;

    // Rule info
    if (node.ruleId) data._rule = node.ruleId;
    if (node.reason) data._reason = node.reason;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. APPEND CHECKPOINT TO PARENT
  // ─────────────────────────────────────────────────────────────────────────

  appendCheckpointBounded(parent.event, config, {
    name: `metrics.folded:${name}`, // Keep original naming for backward compatibility
    ts: event.timestampMs,
    metrics: event.metrics,
    data,
  });
}
