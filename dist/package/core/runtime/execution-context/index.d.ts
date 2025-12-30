/**
 * Execution Context
 *
 * Framework-owned execution context for cross-cutting concerns.
 * Provides actor, correlation, and custom data throughout the call stack.
 *
 * ## Usage
 *
 * ### In Controllers (context is established automatically)
 * ```typescript
 * async myHandler(request, response, ctx) {
 *   const execCtx = getCurrentExecutionContext();
 *   const { correlationId, actor } = execCtx;
 *
 *   // Enrich context
 *   setAttribute('orderId', orderId);
 *   addTags({ feature: 'checkout' });
 * }
 * ```
 *
 * ### In Services
 * ```typescript
 * class OrderService {
 *   async create(data: OrderData) {
 *     const ctx = getCurrentExecutionContext();
 *     const actor = ctx?.actor;
 *     const tenantId = actor?.tenantId;
 *
 *     // Context is automatically propagated to:
 *     // - Child async operations
 *     // - Outgoing HTTP/SQS/SNS calls (if using framework clients)
 *   }
 * }
 * ```
 *
 * @module core/runtime/execution-context
 */
export type { ExecutionContextData, CreateExecutionContextOptions, ParsedTraceContext, ObservabilityState, ObservabilitySummary, ISpanNode, } from './types';
export { createExecutionContext, runWithExecutionContext, runWithExecutionContextSync, getCurrentExecutionContext, getObservabilityState, getCurrentSpan, } from './storage';
export { getCapturedParentId, getCurrentParentObservabilityLogId, } from './storage';
export { setActor, enrichActor, addTags, setAttribute, setAttributes, setSource, } from './storage';
export { extractFromHeaders, extractFromSqs, extractFromSqsRecord, extractFromSns, extractFromEventBridge, extractFromStepFunctions, extractFromKinesis, } from './propagation';
export { createHttpHeaders, createSqsAttributes, createSnsAttributes, createEventBridgeContext, createStepFunctionsContext, toW3CTraceId, toW3CParentId, } from './propagation';
