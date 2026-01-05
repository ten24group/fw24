/**
 * Tree-based noise reduction for observability events.
 * 
 * This module provides intelligent noise reduction for observability data,
 * reducing log volume while preserving critical information.
 * 
 * ## Architecture
 * 
 * The system uses a 4-phase tree-based approach:
 * 
 * 1. **Build Tree**: Convert flat events to tree structure
 * 2. **Evaluate Decisions**: Apply noise rules to each node
 * 3. **Transform Tree**: Apply decisions (drop/fold/aggregate)
 * 4. **Flatten**: Convert back to flat array
 * 
 * ## Benefits
 * 
 * - **O(n) complexity**: Single pass per phase
 * - **Automatic reparenting**: No separate loops needed
 * - **Clear separation**: Each phase is independently testable
 * - **Type-safe**: Strong TypeScript types throughout
 * 
 * @module noise-reduction
 */

import type { ObservabilityEvent, NoiseReductionConfig, NoiseDecision } from '../types';
import type { NoiseReductionStats, TreeNode } from './types';
import { createStats, incrementCounter } from './utils';
import { getBuiltinRules } from './rules/builtins';
import { buildEventTree } from './tree/builder';
import { evaluateDecisions } from './tree/evaluator';
import { propagateHardSignals } from './tree/propagator';
import { transformTree } from './tree/transformer';
import { flattenTree } from './tree/flattener';
import { evaluateNoiseRules } from './priority';
import { matchesRule } from './rules/matcher';

/**
 * Result of noise reduction processing.
 */
export interface NoiseReductionResult {
  /** Events after noise reduction */
  events: ObservabilityEvent[];

  /** Statistics about what was suppressed */
  stats: NoiseReductionStats;
}

/**
 * Apply noise reduction to a batch of observability events.
 * 
 * This is the main entry point for noise reduction. It processes events
 * through all four phases and returns the reduced output with statistics.
 * 
 * ## Algorithm
 * 
 * 1. Handle span.start events separately (OTEL compatibility)
 * 2. Build tree from remaining events
 * 3. Evaluate noise rules for all nodes
 * 4. Transform tree (apply decisions)
 * 5. Flatten tree to output
 * 6. Handle span.start based on parent decisions
 * 
 * ## Performance
 * 
 * - Time: O(n) where n = number of events
 * - Space: O(n) for tree structure
 * 
 * @param inputEvents - Events to process
 * @param cfg - Noise reduction configuration
 * @returns Reduced events with statistics
 */
export function applyNoiseReduction(
  inputEvents: ReadonlyArray<ObservabilityEvent>,
  cfg: NoiseReductionConfig
): NoiseReductionResult {
  const stats = createStats();

  // If disabled, return all events unchanged
  if (!cfg.enabled) {
    return {
      events: [ ...inputEvents ], // Create mutable copy
      stats: { ...stats, kept: inputEvents.length },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PREPARATION: Separate span.start events (OTEL compatibility)
  // ═══════════════════════════════════════════════════════════════════════

  const spanStartEvents: ObservabilityEvent[] = [];
  const mainEvents: ObservabilityEvent[] = [];
  const spanDecisions = new Map<string, NoiseDecision>();

  for (const event of inputEvents) {
    if (event.type === 'span.start') {
      spanStartEvents.push(event);
    } else {
      mainEvents.push(event);
    }
  }

  // Collect all rules (builtin + custom)
  const builtinRules = getBuiltinRules(cfg.presets);
  const allRules = [ ...builtinRules, ...cfg.rules ];


  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: BUILD TREE
  // ═══════════════════════════════════════════════════════════════════════

  const { roots, nodeById } = buildEventTree(mainEvents);

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: EVALUATE DECISIONS
  // ═══════════════════════════════════════════════════════════════════════

  for (const root of roots) {
    evaluateDecisions(root, cfg, allRules);
  }

  // Store decisions for span.start handling
  for (const node of nodeById.values()) {
    if (node.event.type === 'span') {
      spanDecisions.set(node.event.observabilityLogId, node.decision ?? 'keep');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2.5: PROPAGATE HARD SIGNALS
  // ═══════════════════════════════════════════════════════════════════════

  for (const root of roots) {
    propagateHardSignals(root, cfg);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: TRANSFORM TREE
  // ═══════════════════════════════════════════════════════════════════════

  const allOrphanedNodes: TreeNode[] = [];
  for (const root of roots) {
    const orphans = transformTree(root, cfg, stats);
    allOrphanedNodes.push(...orphans);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: FLATTEN TO OUTPUT
  // ═══════════════════════════════════════════════════════════════════════

  const output: ObservabilityEvent[] = [];

  // Flatten original roots
  for (const root of roots) {
    flattenTree(root, output, cfg);
  }

  // Flatten orphaned nodes (children that became roots)
  for (const orphan of allOrphanedNodes) {
    flattenTree(orphan, output, cfg);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HANDLE SPAN.START EVENTS (OTEL COMPATIBILITY)
  // ═══════════════════════════════════════════════════════════════════════

  for (const spanStart of spanStartEvents) {
    // Try to find the corresponding consolidated span's decision by ID
    let decision = spanDecisions.get(spanStart.observabilityLogId);

    // If not found (ID mismatch), evaluate span.start independently
    if (decision === undefined) {
      const result = evaluateNoiseRules(spanStart, allRules, matchesRule);
      decision = result.decision;
    }

    if (decision === 'drop' || decision === 'aggregate') {
      // Span was dropped/aggregated - drop span.start too
      stats.dropped++;
      incrementCounter(stats.droppedByType, spanStart.type);
      incrementCounter(stats.droppedByOperation, spanStart.operation);
    } else {
      // Span was kept - keep span.start
      output.push(spanStart);
      stats.kept++;
    }
  }

  // Update final kept count
  stats.kept = output.length;

  return {
    events: output,
    stats,
  };
}

/**
 * Evaluate noise decision for a single event (for testing/inspection).
 * 
 * This is a convenience function that evaluates rules for a single event
 * without building a tree or applying transformations.
 * 
 * @param event - Event to evaluate
 * @param cfg - Noise reduction configuration
 * @returns Decision with context
 */
export function pickNoiseDecision(
  event: ObservabilityEvent,
  cfg: NoiseReductionConfig
): { decision: NoiseDecision; ruleId: string; reason: string } {
  const builtinRules = getBuiltinRules(cfg.presets);
  const allRules = [ ...builtinRules, ...cfg.rules ];
  const result = evaluateNoiseRules(event, allRules, matchesRule);

  return {
    decision: result.decision,
    ruleId: result.ruleId,
    reason: result.reason,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORTS FOR BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════

export { evaluateNoiseRules, DECISION_BASE_PRIORITY, type NoiseEvaluationResult } from './priority';
export { getBuiltinRules, clearBuiltinRulesCache } from './rules/builtins';
export type { NoiseReductionStats } from './types';
