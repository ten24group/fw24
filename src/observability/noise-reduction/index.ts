/**
 * Noise Reduction Module (v2: three-decision model)
 * 
 * Intelligent noise reduction for observability events, reducing DynamoDB
 * record count while preserving critical information through structured
 * absorption into parent spans.
 * 
 * ## Three-Decision Model
 * 
 * | Decision  | DynamoDB Record? | Info Preserved?                          |
 * |-----------|------------------|------------------------------------------|
 * | `emit`    | Yes              | Full event                               |
 * | `absorb`  | No               | Structured summary in parent `data.absorbed` |
 * | `silent`  | No               | Counter on parent only                   |
 * 
 * ## Algorithm
 * 
 * 1. **Build**: Flat events → tree (parentObservabilityLogId linkage)
 * 2. **Evaluate**: Post-order DFS assigns decisions (rules + hard signals)
 * 3. **Collect**: Pre-order DFS builds output (resolved parents + absorbed data)
 * 
 * The tree is NEVER mutated. Parent IDs in output are resolved to the nearest
 * EMITTED ancestor, ensuring correct hierarchy without reparenting.
 * 
 * @module noise-reduction
 */

// ═══════════════════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════════════════

export { applyNoiseReduction, pickNoiseDecision, buildAndEvaluate } from './algorithm';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type {
  NoiseDecision,
  AbsorbedData,
  AbsorbedError,
  OperationStats,
  DurationStats,
  TreeNode,
  NodeDecision,
  EmittedEvent,
  NoiseReductionResult,
  NoiseReductionStats,
  NoiseDebugInfo,
  AbsorptionBounds,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// RULE EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

export {
  evaluateNoiseRules,
  DECISION_BASE_PRIORITY,
  HARD_SIGNAL_PRIORITY,
  getEffectivePriority,
  type NoiseEvaluationResult,
  type RuleMatchFn,
} from './priority';

// ═══════════════════════════════════════════════════════════════════════════
// RULE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export { getBuiltinRules, clearBuiltinRulesCache } from './rules/builtins';
export { matchesRule } from './rules/matcher';

// ═══════════════════════════════════════════════════════════════════════════
// HARD SIGNALS
// ═══════════════════════════════════════════════════════════════════════════

export { isHardSignal } from './hard-signals';
