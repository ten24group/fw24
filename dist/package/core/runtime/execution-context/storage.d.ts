/**
 * Execution Context Storage
 *
 * AsyncLocalStorage-based context management for the framework.
 * This is the SINGLE source of truth for cross-cutting context.
 */
import { Actor } from '../../types/execution-context';
import { ExecutionContextData, CreateExecutionContextOptions } from './types';
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
 * Set actor on current context.
 */
export declare function setActor(actor: Actor): void;
/**
 * Merge partial actor data into existing actor.
 */
export declare function enrichActor(partial: Partial<Actor>): void;
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
 * Set source identifier on current context.
 */
export declare function setSource(source: string): void;
/**
 * Set parent observability log ID on current context.
 * Used for tracking span hierarchy.
 */
export declare function setParentObservabilityLogId(observabilityLogId: string): void;
