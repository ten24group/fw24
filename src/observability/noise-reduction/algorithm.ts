/**
 * Noise Reduction Algorithm (v2: single DFS, no tree mutation)
 *
 * Three-phase approach:
 * 1. BUILD: Flat events → tree (parentObservabilityLogId linkage)
 * 2. EVALUATE: Post-order DFS assigns emit/absorb/silent to each node
 * 3. COLLECT: Pre-order DFS builds output with resolved parent IDs and absorbed data
 * 4. STRIP: Promoted (noise) roots are removed; genuine children become new roots
 *
 * Key invariants:
 * - The tree is NEVER mutated (no reparenting, no child moving)
 * - Decisions are recorded as separate properties on nodes
 * - Parent IDs in output resolve to the nearest EMITTED ancestor
 * - Absorbed data flows to the nearest EMITTED ancestor
 * - Hard signals force emit (unless explicitly overridden by high-priority rule)
 * - Noise roots (silent/absorbed with no emitted ancestor) are ALWAYS stripped:
 *   - If ALL events are noise → entire invocation is suppressed (0 output)
 *   - If SOME events are genuine → noise roots stripped, genuine children kept as new roots
 */

import type {
  ObservabilityEvent,
  NoiseReductionConfig,
  NoiseRule,
  NoiseRuleMatch,
} from '../types';
import type {
  TreeNode,
  NodeDecision,
  EmittedEvent,
  NoiseReductionResult,
  NoiseReductionStats,
  AbsorptionBounds,
} from './types';
import { evaluateNoiseRules, HARD_SIGNAL_PRIORITY, type RuleMatchFn } from './priority';
import { isHardSignal } from './hard-signals';
import { matchesRule } from './rules/matcher';
import { getBuiltinRules } from './rules/builtins';
import {
  createMutableAbsorbed,
  freezeAbsorbed,
  absorbEvent,
  recordSilent,
  type MutableAbsorbedData,
} from './absorb';
import { createMutableStats, freezeStats, incrementCounter, getAbsorptionBounds } from './utils';

// ═══════════════════════════════════════════════════════════════════════════
// MUTABLE TREE NODE (internal, for building)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal mutable node used during tree construction.
 * After build, this is cast to the readonly TreeNode interface.
 */
interface MutableTreeNode {
  readonly event: ObservabilityEvent;
  parent: MutableTreeNode | undefined;
  readonly children: MutableTreeNode[];
  evaluation?: NodeDecision;
  /** True if THIS event is a hard signal (error/failure/slow), regardless of decision. */
  isHardSignal?: boolean;
  hasHardSignalDescendant?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: BUILD TREE
// ═══════════════════════════════════════════════════════════════════════════

interface BuildResult {
  readonly roots: readonly MutableTreeNode[];
  readonly nodeById: ReadonlyMap<string, MutableTreeNode>;
  readonly spanStartEvents: readonly ObservabilityEvent[];
}

/**
 * Build a tree from flat events based on parentObservabilityLogId.
 *
 * Events whose parent is not in this batch become root nodes.
 * span.start events are separated for special handling.
 */
function buildTree(events: readonly ObservabilityEvent[]): BuildResult {
  const nodeById = new Map<string, MutableTreeNode>();
  const spanStartEvents: ObservabilityEvent[] = [];

  // First pass: create all nodes, separating span.start events
  for (const event of events) {
    if (event.type === 'span.start') {
      spanStartEvents.push(event);
      continue;
    }
    const node: MutableTreeNode = {
      event,
      parent: undefined,
      children: [],
    };
    nodeById.set(event.observabilityLogId, node);
  }

  // Second pass: link parents
  const roots: MutableTreeNode[] = [];

  for (const node of nodeById.values()) {
    const parentId = node.event.parentObservabilityLogId;
    if (parentId) {
      const parent = nodeById.get(parentId);
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
        continue;
      }
    }
    // No parent or parent not in batch → root
    roots.push(node);
  }

  return { roots, nodeById, spanStartEvents };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: EVALUATE DECISIONS (post-order DFS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate noise reduction decisions for an entire subtree (post-order DFS).
 *
 * Post-order ensures children are evaluated before parents, which is needed
 * for hard signal propagation (if a child is a hard signal, the parent
 * knows about it when it's evaluated).
 */
function evaluateSubtree(
  node: MutableTreeNode,
  config: NoiseReductionConfig,
  allRules: readonly NoiseRule[],
  matchFn: RuleMatchFn,
): void {
  // Recurse into children first (post-order)
  for (const child of node.children) {
    evaluateSubtree(child, config, allRules, matchFn);
  }

  // Evaluate this node's decision via rules
  const ruleResult = evaluateNoiseRules(node.event, allRules, matchFn);
  const eventIsHardSignal = isHardSignal(node.event, config);

  // Store the hard signal flag on the node (used for propagation)
  node.isHardSignal = eventIsHardSignal;

  // Hard signal protection: force emit unless the rule explicitly overrides
  if (eventIsHardSignal && ruleResult.decision !== 'emit' && ruleResult.priority <= HARD_SIGNAL_PRIORITY) {
    node.evaluation = {
      decision: 'emit',
      ruleId: 'hard-signal',
      reason: 'Hard signal: error/failure/slow operation forces emit',
      priority: HARD_SIGNAL_PRIORITY,
    };
  } else {
    node.evaluation = {
      decision: ruleResult.decision,
      ruleId: ruleResult.ruleId,
      reason: ruleResult.reason,
      priority: ruleResult.priority,
    };
  }

  // Propagate hard signal flag from children
  // Check both: child IS a hard signal, or child HAS hard signal descendants
  const childHasHardSignal = node.children.some(
    c => c.isHardSignal || c.hasHardSignalDescendant,
  );
  node.hasHardSignalDescendant = childHasHardSignal;

  // Context preservation: if this span has hard signal descendants and would
  // be absorbed/silenced, force it to emit to preserve the hierarchy
  if (childHasHardSignal && node.evaluation.decision !== 'emit' && node.event.type === 'span') {
    node.evaluation = {
      decision: 'emit',
      ruleId: 'hard-signal-ancestor',
      reason: 'Ancestor of hard signal: forced emit to preserve hierarchy',
      priority: HARD_SIGNAL_PRIORITY,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: COLLECT OUTPUT (pre-order DFS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Entry in the emitted events list during collection.
 */
interface CollectedEmittedEntry {
  readonly event: ObservabilityEvent;
  readonly resolvedParentId: string | undefined;
  readonly evaluation?: NodeDecision;
  /**
   * True if this event was promoted from absorb/silent to emit because it had no emitted ancestor.
   * Promoted events are noise roots — they are always stripped from the final output.
   * If all events are promoted, the entire invocation is noise and fully suppressed.
   */
  readonly promoted?: boolean;
}

/**
 * Accumulated output during the collect phase.
 */
interface CollectState {
  /** Ordered list of emitted events with resolved parent IDs and evaluation metadata */
  readonly emittedEvents: CollectedEmittedEntry[];
  /** Absorbed data builders keyed by the observabilityLogId of the emitted ancestor */
  readonly absorbedByNodeId: Map<string, MutableAbsorbedData>;
  /** Mutable stats counters */
  readonly stats: ReturnType<typeof createMutableStats>;
  /** Absorption bounds from config */
  readonly bounds: AbsorptionBounds;
}

/**
 * Collect output from a subtree via pre-order DFS.
 *
 * - EMIT nodes become output events; their children get this node as their nearest emitted ancestor
 * - ABSORB nodes merge data into the nearest emitted ancestor; children inherit the same ancestor
 * - SILENT nodes increment a counter on the nearest emitted ancestor; children inherit the same ancestor
 *
 * If a node would be absorbed/silenced but has no emitted ancestor (root with no parent in batch),
 * it is promoted to emit and marked as `promoted: true`. After collection, if ALL emitted events
 * are promoted, the entire invocation tree is noise and can be suppressed.
 */
function collectNode(
  node: MutableTreeNode,
  nearestEmittedAncestorId: string | undefined,
  state: CollectState,
): void {
  // Safety: evaluation must be set by Phase 2
  const decision = node.evaluation?.decision ?? 'emit';

  if (decision === 'emit') {
    // This node is genuinely emitted as a standalone record
    state.emittedEvents.push({
      event: node.event,
      resolvedParentId: nearestEmittedAncestorId,
      evaluation: node.evaluation,
      promoted: false,
    });
    state.stats.emitted++;

    // Children see this node as their nearest emitted ancestor
    for (const child of node.children) {
      collectNode(child, node.event.observabilityLogId, state);
    }
  } else if (decision === 'absorb') {
    if (nearestEmittedAncestorId) {
      // Merge data into the nearest emitted ancestor
      const absorbed = getOrCreateAbsorbed(state.absorbedByNodeId, nearestEmittedAncestorId);
      absorbEvent(absorbed, node.event, state.bounds);
      state.stats.absorbed++;
      incrementCounter(state.stats.absorbedByOperation, node.event.operation ?? node.event.type);
    } else {
      // No ancestor to absorb into → promote to emit (marked for possible suppression)
      state.emittedEvents.push({
        event: node.event,
        resolvedParentId: undefined,
        evaluation: node.evaluation,
        promoted: true,
      });
      state.stats.emitted++;
    }

    // Children inherit the same nearest emitted ancestor (or this node if promoted)
    const childAncestorId = nearestEmittedAncestorId ?? node.event.observabilityLogId;
    for (const child of node.children) {
      collectNode(child, childAncestorId, state);
    }
  } else {
    // 'silent': counter only
    if (nearestEmittedAncestorId) {
      const absorbed = getOrCreateAbsorbed(state.absorbedByNodeId, nearestEmittedAncestorId);
      recordSilent(absorbed);
      state.stats.silenced++;
      incrementCounter(state.stats.silencedByOperation, node.event.operation ?? node.event.type);
    } else {
      // No ancestor to track counter on → promote to emit (marked for possible suppression)
      state.emittedEvents.push({
        event: node.event,
        resolvedParentId: undefined,
        evaluation: node.evaluation,
        promoted: true,
      });
      state.stats.emitted++;
    }

    const childAncestorId = nearestEmittedAncestorId ?? node.event.observabilityLogId;
    for (const child of node.children) {
      collectNode(child, childAncestorId, state);
    }
  }
}

function getOrCreateAbsorbed(
  map: Map<string, MutableAbsorbedData>,
  nodeId: string,
): MutableAbsorbedData {
  let absorbed = map.get(nodeId);
  if (!absorbed) {
    absorbed = createMutableAbsorbed();
    map.set(nodeId, absorbed);
  }
  return absorbed;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply noise reduction to a batch of observability events.
 *
 * This is the core algorithm. It processes events through three phases:
 * 1. Build tree from flat events (parentObservabilityLogId linkage)
 * 2. Evaluate decisions via post-order DFS (rules + hard signals)
 * 3. Collect output via pre-order DFS (resolved parents + absorbed data)
 *
 * span.start events are handled separately: they follow the decision of their
 * corresponding consolidated span (same observabilityLogId).
 *
 * @param inputEvents - Raw events from the invocation buffer
 * @param config - Noise reduction configuration
 * @returns Reduced events with resolved parent IDs and absorbed data
 */
export function applyNoiseReduction(
  inputEvents: readonly ObservabilityEvent[],
  config: NoiseReductionConfig,
): NoiseReductionResult {
  // Disabled → pass everything through
  if (!config.enabled) {
    const events: EmittedEvent[] = inputEvents.map(event => ({
      event,
      resolvedParentId: event.parentObservabilityLogId ?? undefined,
      absorbed: undefined,
    }));
    return {
      events,
      stats: {
        emitted: inputEvents.length,
        absorbed: 0,
        silenced: 0,
        totalInput: inputEvents.length,
        suppressedRoots: 0,
        absorbedByOperation: {},
        silencedByOperation: {},
      },
    };
  }

  const bounds = getAbsorptionBounds(config);

  // Collect all rules (builtin + custom)
  const builtinRules = getBuiltinRules(config.presets);
  const allRules: readonly NoiseRule[] = [...builtinRules, ...config.rules];

  // Phase 1: Build tree (separates span.start events)
  const { roots, nodeById, spanStartEvents } = buildTree(inputEvents);

  // Phase 2: Evaluate decisions (post-order DFS)
  for (const root of roots) {
    evaluateSubtree(root, config, allRules, matchesRule);
  }

  // Track decisions for span.start handling
  const spanDecisions = new Map<string, NodeDecision>();
  for (const node of nodeById.values()) {
    if (node.event.type === 'span' && node.evaluation) {
      spanDecisions.set(node.event.observabilityLogId, node.evaluation);
    }
  }

  // Phase 3: Collect output (pre-order DFS)
  const state: CollectState = {
    emittedEvents: [],
    absorbedByNodeId: new Map(),
    stats: createMutableStats(),
    bounds,
  };

  for (const root of roots) {
    collectNode(root, undefined, state);
  }

  // Handle span.start events: follow the decision of their parent span
  for (const spanStart of spanStartEvents) {
    const parentDecision = spanDecisions.get(spanStart.observabilityLogId);
    if (!parentDecision || parentDecision.decision === 'emit') {
      // Span was emitted → emit its span.start too
      state.emittedEvents.push({
        event: spanStart,
        resolvedParentId: spanStart.parentObservabilityLogId ?? undefined,
      });
      state.stats.emitted++;
    } else {
      // Span was absorbed/silenced → drop span.start
      state.stats.silenced++;
      incrementCounter(state.stats.silencedByOperation, spanStart.operation ?? 'span.start');
    }
  }

  state.stats.totalInput = inputEvents.length;

  // ═══════════════════════════════════════════════════════════════════════
  // NOISE ROOT STRIPPING
  //
  // Promoted events are noise roots (silent/absorbed) that had no emitted
  // ancestor. They are ALWAYS stripped from the output:
  //
  // 1. If ALL emitted events are promoted → entire invocation is noise
  //    (e.g., idle scheduled task, stream processor that just forwarded).
  //    Nothing is persisted — this is "root suppression".
  //
  // 2. If SOME are promoted and SOME are genuine → the noise roots are
  //    dropped but genuine children are kept. Genuine children that
  //    referenced a promoted root get resolvedParentId cleared to
  //    undefined (they become new roots in the output).
  //    Example: DynamoDBStreamAuditLogger batch span is dropped, but the
  //    genuine audit.entity children are persisted as root records.
  //
  // Safety guarantees:
  // - Hard signals (errors/failures/slow ops) force `decision: 'emit'` in
  //   Phase 2, so they are NEVER promoted and are always persisted.
  // - Genuine audit records, user-facing events, etc. that don't match any
  //   silent/absorb rule default to 'emit' and are always persisted.
  // ═══════════════════════════════════════════════════════════════════════

  // Collect IDs of promoted (noise) events so we can fix parent references
  const promotedIds = new Set<string>();
  for (const entry of state.emittedEvents) {
    if (entry.promoted === true) {
      promotedIds.add(entry.event.observabilityLogId);
    }
  }

  // Separate genuine and promoted events
  const genuineEvents: typeof state.emittedEvents = [];
  for (const entry of state.emittedEvents) {
    if (entry.promoted === true) {
      // Noise root — strip from output and adjust stats
      state.stats.emitted--;
      const originalDecision = entry.evaluation?.decision ?? 'silent';
      if (originalDecision === 'absorb') {
        state.stats.absorbed++;
        incrementCounter(state.stats.absorbedByOperation, entry.event.operation ?? entry.event.type);
      } else {
        state.stats.silenced++;
        incrementCounter(state.stats.silencedByOperation, entry.event.operation ?? entry.event.type);
      }
    } else {
      genuineEvents.push(entry);
    }
  }

  // Count suppressed roots (all promoted, entire invocation is noise)
  if (genuineEvents.length === 0 && promotedIds.size > 0) {
    state.stats.suppressedRoots += roots.length;
  }

  // Build final output with frozen absorbed data (and optional debug info)
  const includeDebug = config.debug === true;
  const finalEvents: EmittedEvent[] = genuineEvents.map(({ event, resolvedParentId, evaluation }) => {
    const mutableAbsorbed = state.absorbedByNodeId.get(event.observabilityLogId);

    // If this event's parent was a promoted (noise) root, clear both the
    // resolved parent ID and the event's original parentObservabilityLogId.
    // This prevents the manager from falling back to a stale reference that
    // points to a span that was stripped from the output.
    let cleanParentId = resolvedParentId;
    if (resolvedParentId && promotedIds.has(resolvedParentId)) {
      cleanParentId = undefined;
      (event as any).parentObservabilityLogId = undefined;
    }

    return {
      event,
      resolvedParentId: cleanParentId,
      absorbed: mutableAbsorbed ? freezeAbsorbed(mutableAbsorbed) : undefined,
      debugInfo: includeDebug && evaluation ? {
        decision: evaluation.decision,
        ruleId: evaluation.ruleId,
        reason: evaluation.reason,
      } : undefined,
    };
  });

  return {
    events: finalEvents,
    stats: freezeStats(state.stats),
  };
}

/**
 * Evaluate noise decision for a single event (for testing/inspection).
 *
 * This evaluates rules for a single event without building a tree.
 * Does NOT apply hard signal logic or context preservation.
 *
 * @param event - Event to evaluate
 * @param config - Noise reduction configuration
 * @returns Decision with context
 */
export function pickNoiseDecision(
  event: ObservabilityEvent,
  config: NoiseReductionConfig,
): { readonly decision: string; readonly ruleId: string; readonly reason: string } {
  const builtinRules = getBuiltinRules(config.presets);
  const allRules: readonly NoiseRule[] = [...builtinRules, ...config.rules];
  const result = evaluateNoiseRules(event, allRules, matchesRule);

  return {
    decision: result.decision,
    ruleId: result.ruleId,
    reason: result.reason,
  };
}

/**
 * Get the tree built from events (for testing/inspection).
 * Returns the tree nodes with their evaluations but without collecting output.
 */
export function buildAndEvaluate(
  inputEvents: readonly ObservabilityEvent[],
  config: NoiseReductionConfig,
): { readonly roots: readonly TreeNode[]; readonly nodeById: ReadonlyMap<string, TreeNode> } {
  const builtinRules = getBuiltinRules(config.presets);
  const allRules: readonly NoiseRule[] = [...builtinRules, ...config.rules];

  const { roots, nodeById } = buildTree(inputEvents);

  for (const root of roots) {
    evaluateSubtree(root, config, allRules, matchesRule);
  }

  // Cast is safe: MutableTreeNode satisfies TreeNode (TreeNode is readonly)
  return {
    roots: roots as unknown as readonly TreeNode[],
    nodeById: nodeById as unknown as ReadonlyMap<string, TreeNode>,
  };
}
