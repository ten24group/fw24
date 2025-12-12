/**
 * Observability Context
 * 
 * Direct re-exports from the core execution context module.
 * 
 * @module observability/context
 */

// Re-export everything from core execution context
export {
  // Types
  type ExecutionContextData,
  type CreateExecutionContextOptions,
  type ParsedTraceContext,

  // Storage & Lifecycle
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
  getCurrentExecutionContext,

  // Enrichment
  setActor,
  enrichActor,
  addTags,
  setAttribute,
  setAttributes,
  setSource,
  setParentObservabilityLogId,

  // Propagation - Extraction
  extractFromHeaders,
  extractFromSqs,
  extractFromSns,
  extractFromEventBridge,
  extractFromStepFunctions,
  extractFromKinesis,
  extractFromDynamoDBStream,

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
// Internal convenience aliases (used by observability internals)
// ============================================================================

import {
  getCurrentExecutionContext,
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
  type ExecutionContextData,
  type CreateExecutionContextOptions,
} from '../core/runtime/execution-context';

/** @internal Alias for getCurrentExecutionContext */
export function getCurrentContext(): ExecutionContextData | undefined {
  return getCurrentExecutionContext();
}

/** @internal Get correlation ID if context exists */
export function getCorrelationIdIfExists(): string | undefined {
  return getCurrentExecutionContext()?.correlationId;
}

// ============================================================================
// Testing utilities - types and functions for testing
// ============================================================================

/** Type alias for testing */
export type ObservationContext = ExecutionContextData;

/** Create observation context - alias for createExecutionContext */
export function createObservationContext(
  correlationId: string,
  options?: Omit<CreateExecutionContextOptions, 'correlationId'>
): ObservationContext {
  return createExecutionContext({ correlationId, ...options });
}

/** Run with context - alias for runWithExecutionContext */
export function runWithContext<T>(
  context: ObservationContext,
  fn: () => Promise<T>
): Promise<T> {
  return runWithExecutionContext(context, fn);
}

/** Run with context sync - alias for runWithExecutionContextSync */
export function runWithContextSync<T>(
  context: ObservationContext,
  fn: () => T
): T {
  return runWithExecutionContextSync(context, fn);
}
