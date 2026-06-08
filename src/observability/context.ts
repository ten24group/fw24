/**
 * Observability Context
 * 
 * Re-exports from the core execution context module for observability use.
 * 
 * @module observability/context
 */

// Re-export everything from core execution context
export {
  // Types
  type ExecutionContextData,
  type CreateExecutionContextOptions,
  type ParsedTraceContext,
  type ObservabilityState,
  type ObservabilitySummary,
  type ISpanNode,

  // Storage & Lifecycle
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
  getCurrentExecutionContext,
  getObservabilityState,
  getCurrentSpan,

  // Parent Resolution
  getCapturedParentId,
  getCurrentParentObservabilityLogId,

  // Enrichment
  setActor,
  enrichActor,
  addTags,
  setAttribute,
  setAttributes,
  setSource,

  // Propagation - Extraction
  extractFromHeaders,
  extractFromSqs,
  extractFromSqsRecord,
  extractFromSns,
  extractFromEventBridge,
  extractFromStepFunctions,
  extractFromKinesis,

  // Propagation - Creation
  createHttpHeaders,
  createSqsAttributes,
  createSnsAttributes,
  createEventBridgeContext,
  createStepFunctionsContext,
  toW3CTraceId,
  toW3CParentId,
} from '../core/runtime/execution-context';

// Re-export Actor type from core
export type { Actor } from '../core/types/execution-context';

// ============================================================================
// Internal Helper (used by observability internals only)
// ============================================================================

import { getCurrentExecutionContext, type ExecutionContextData } from '../core/runtime/execution-context';

/** 
 * Get correlation ID if context exists - for internal use by observers
 * @internal
 */
export function getCorrelationIdIfExists(): string | undefined {
  return getCurrentExecutionContext()?.correlationId;
}

/**
 * Get current context - simpler name for internal use
 * @internal
 */
export function getCurrentContext(): ExecutionContextData | undefined {
  return getCurrentExecutionContext();
}

// ============================================================================
// Context Override - Scoped context changes
// ============================================================================

import { runWithExecutionContext, runWithExecutionContextSync, createExecutionContext } from '../core/runtime/execution-context';
import type { ContextOverrides } from './types';
import { merge } from '../utils/merge';

/**
 * Run function with context overrides.
 * Supports both sync and async functions automatically.
 * 
 * All override fields are optional - only override what you need.
 * Tags are merged with existing by default.
 * 
 * @example
 * ```typescript
 * // Override actor for system operations
 * withContext({ actor: systemActor }, () => {
 *   AuditObserver.entityDelete('User', userId, data);
 * });
 * 
 * // Add batch tags
 * await withContext({ tags: { batchId: 'batch-123' } }, async () => {
 *   for (const item of items) {
 *     await processItem(item);
 *   }
 * });
 * 
 * // Override source for a scope
 * withContext({ source: 'WorkflowEngine' }, () => {
 *   // All logs/spans in here will have source='WorkflowEngine'
 * });
 * ```
 */
export function withContext<T>(
  overrides: ContextOverrides,
  fn: () => T
): T {
  const currentCtx = getCurrentExecutionContext();

  if (!currentCtx) {
    // No context exists - create one if correlationId is provided, otherwise just run
    if (overrides.correlationId) {
      const newCtx = createExecutionContext({
        correlationId: overrides.correlationId,
        causedBy: overrides.causedBy,
        actor: overrides.actor,
        source: overrides.source,
        tags: overrides.tags ?? overrides.replaceTags,
        metadata: overrides.metadata, // metadata goes to state.metadata
      });
      // IMPORTANT: run fn INSIDE the newly created execution context.
      // runWithExecutionContextSync works for both sync and async functions
      // (it calls fn synchronously, but fn can return a Promise)
      return runWithExecutionContextSync(newCtx, fn);
    }
    // No correlationId and no context - just run
    return fn();
  }

  // Build overridden context
  const newObservability = { ...currentCtx.observability };

  if (overrides.source !== undefined) {
    newObservability.source = overrides.source;
  }

  if (overrides.replaceTags !== undefined) {
    // Replace tags entirely
    newObservability.tags = { ...overrides.replaceTags };
  } else if (overrides.tags !== undefined) {
    // Merge tags (shallow is fine for flat key-value)
    newObservability.tags = { ...currentCtx.observability.tags, ...overrides.tags };
  }

  // Deep merge metadata into context metadata (flows to event.metadata)
  if (overrides.metadata !== undefined) {
    newObservability.metadata = merge([
      currentCtx.observability.metadata,
      overrides.metadata
    ]) ?? {};
  }

  const newCtx: ExecutionContextData = {
    ...currentCtx,
    correlationId: overrides.correlationId ?? currentCtx.correlationId,
    causedBy: overrides.causedBy ?? currentCtx.causedBy,
    actor: overrides.actor ?? currentCtx.actor,
    observability: newObservability,
  };

  // IMPORTANT: run fn INSIDE the overridden execution context.
  // runWithExecutionContextSync works for both sync and async functions
  return runWithExecutionContextSync(newCtx, fn);
}
