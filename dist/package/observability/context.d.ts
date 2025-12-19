/**
 * Observability Context
 *
 * Direct re-exports from the core execution context module.
 *
 * @module observability/context
 */
export { type ExecutionContextData, type CreateExecutionContextOptions, type ParsedTraceContext, createExecutionContext, runWithExecutionContext, runWithExecutionContextSync, getCurrentExecutionContext, setActor, enrichActor, addTags, setAttribute, setAttributes, setSource, setParentObservabilityLogId, extractFromHeaders, extractFromSqs, extractFromSns, extractFromEventBridge, extractFromStepFunctions, extractFromKinesis, createHttpHeaders, createSqsAttributes, createSnsAttributes, createEventBridgeContext, createStepFunctionsContext, toW3CTraceId, toW3CParentId, } from '../core/runtime/execution-context';
export type { Actor } from '../core/types/execution-context';
import { type ExecutionContextData, type CreateExecutionContextOptions } from '../core/runtime/execution-context';
/** Type alias for testing */
export type ObservationContext = ExecutionContextData;
/** Create observation context - alias for createExecutionContext */
export declare function createObservationContext(correlationId: string, options?: Omit<CreateExecutionContextOptions, 'correlationId'>): ObservationContext;
/** Run with context - alias for runWithExecutionContext */
export declare function runWithContext<T>(context: ObservationContext, fn: () => Promise<T>): Promise<T>;
/** Run with context sync - alias for runWithExecutionContextSync */
export declare function runWithContextSync<T>(context: ObservationContext, fn: () => T): T;
