/**
 * Execution Context Storage
 *
 * AsyncLocalStorage-based context management for the framework.
 * This is the SINGLE source of truth for cross-cutting context.
 *
 * DESIGN:
 * - One AsyncLocalStorage for entire framework
 * - Context scoping via nested storage.run() calls
 * - Automatic restoration when scope exits
 */
import type { Actor } from '../../types/execution-context';
import type { ExecutionContextData, CreateExecutionContextOptions, ObservabilityState, ISpanNode } from './types';
/**
 * Create execution context.
 *
 * @param options - Context options (correlationId is required)
 * @returns ExecutionContextData
 * @throws Error if correlationId is empty
 */
export declare function createExecutionContext(options: CreateExecutionContextOptions): ExecutionContextData;
/**
 * Run async function with execution context.
 *
 * Context is available via getCurrentExecutionContext() within the function
 * and all async operations it spawns.
 */
export declare function runWithExecutionContext<T>(ctx: ExecutionContextData, fn: () => Promise<T>): Promise<T>;
/**
 * Run sync function with execution context.
 */
export declare function runWithExecutionContextSync<T>(ctx: ExecutionContextData, fn: () => T): T;
/**
 * Get current execution context.
 * Returns undefined if no context is established.
 */
export declare function getCurrentExecutionContext(): ExecutionContextData | undefined;
/**
 * Get current observability state.
 * Returns undefined if no context is established.
 */
export declare function getObservabilityState(): ObservabilityState | undefined;
/**
 * Get current span from observability state.
 * Returns undefined if no span is active.
 */
export declare function getCurrentSpan(): ISpanNode | undefined;
/**
 * Run function with span as current.
 * Creates a new context scope - parent context is automatically restored on exit.
 *
 * This is the key mechanism for automatic parent tracking:
 * - withSpan() calls this to set the new span as current
 * - Nested withSpan() calls see this span as their parent
 * - When scope exits, previous context (with previous span) is restored
 *
 * @param span - The span to set as current
 * @param fn - Function to execute in the new scope
 * @returns Result of fn
 */
export declare function withCurrentSpan<T>(span: ISpanNode, fn: () => T): T;
/**
 * Async version of withCurrentSpan.
 */
export declare function withCurrentSpanAsync<T>(span: ISpanNode, fn: () => Promise<T>): Promise<T>;
/**
 * Set actor on current context.
 */
export declare function setActor(actor: Actor): void;
/**
 * Merge partial actor data into existing actor.
 */
export declare function enrichActor(partial: Partial<Actor>): void;
/**
 * Set source identifier on current context.
 */
export declare function setSource(source: string): void;
/**
 * Add tags to current context (merged with existing).
 */
export declare function addTags(tags: Record<string, string>): void;
/**
 * Set a single attribute on current context.
 */
export declare function setAttribute(key: string, value: unknown): void;
/**
 * Set multiple attributes on current context.
 */
export declare function setAttributes(attrs: Record<string, unknown>): void;
/**
 * Walk up the span tree to find the first captured ancestor.
 * Returns the ID of the first parent span that was actually captured (not sampled out).
 *
 * This is used for parentObservabilityLogId in ALL events:
 * - If parent was captured → returns parent.id
 * - If parent was sampled out → walks to grandparent, etc.
 * - Returns undefined if no captured ancestor
 *
 * @param span - Starting span (checks span.parent, not span itself)
 * @returns ID of first captured ancestor, or undefined
 */
export declare function getCapturedParentId(span: ISpanNode | undefined): string | undefined;
/**
 * Get parent observability log ID for new events.
 * Uses the current span and walks to find captured ancestor.
 */
export declare function getCurrentParentObservabilityLogId(): string | undefined;
/**
 * Explicitly register that a span ID has been emitted/propagated as a parentObservabilityLogId.
 *
 * This is the central integrity mechanism for hierarchy:
 * when a parent ID is referenced, the parent span must not be dropped later by filtering.
 *
 * This function is intentionally explicit (NOT hidden inside parent-id getters).
 */
