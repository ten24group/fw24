/**
 * Observability Context
 *
 * Re-exports from the core execution context module for observability use.
 *
 * @module observability/context
 */
export { type ExecutionContextData, type CreateExecutionContextOptions, type ParsedTraceContext, type ObservabilityState, type ObservabilitySummary, type ISpanNode, createExecutionContext, runWithExecutionContext, runWithExecutionContextSync, getCurrentExecutionContext, getObservabilityState, getCurrentSpan, getCapturedParentId, getCurrentParentObservabilityLogId, setActor, enrichActor, addTags, setAttribute, setAttributes, setSource, extractFromHeaders, extractFromSqs, extractFromSqsRecord, extractFromSns, extractFromEventBridge, extractFromStepFunctions, extractFromKinesis, createHttpHeaders, createSqsAttributes, createSnsAttributes, createEventBridgeContext, createStepFunctionsContext, toW3CTraceId, toW3CParentId, } from '../core/runtime/execution-context';
export type { Actor } from '../core/types/execution-context';
import type { ContextOverrides } from './types';
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
export declare function withContext<T>(overrides: ContextOverrides, fn: () => T): T;
