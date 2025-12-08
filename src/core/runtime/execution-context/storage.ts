/**
 * Execution Context Storage
 * 
 * AsyncLocalStorage-based context management for the framework.
 * This is the SINGLE source of truth for cross-cutting context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Actor } from '../../types/execution-context';
import { ExecutionContextData, CreateExecutionContextOptions } from './types';

// ============================================================================
// Storage (ONE AsyncLocalStorage for the entire framework)
// ============================================================================

const storage = new AsyncLocalStorage<ExecutionContextData>();

// ============================================================================
// Context Lifecycle
// ============================================================================

/**
 * Create execution context.
 * 
 * @param options - Context options (correlationId is required)
 * @returns ExecutionContextData
 * @throws Error if correlationId is empty
 */
export function createExecutionContext(
  options: CreateExecutionContextOptions
): ExecutionContextData {
  const correlationId = options.correlationId?.trim();
  if (!correlationId) {
    throw new Error('correlationId is required for execution context');
  }

  const tags: Record<string, string> = { ...options.tags };
  const attributes: Record<string, unknown> = { ...options.attributes };

  return {
    correlationId,
    parentLogId: options.parentLogId?.trim(),
    sampled: options.sampled ?? true,
    actor: options.actor,
    tags,
    attributes,
    source: options.source?.trim(),
    startTime: Date.now(),
  };
}

/**
 * Run async function with execution context.
 * 
 * Context is available via getCurrentExecutionContext() within the function
 * and all async operations it spawns.
 */
export async function runWithExecutionContext<T>(
  ctx: ExecutionContextData,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Run sync function with execution context.
 */
export function runWithExecutionContextSync<T>(
  ctx: ExecutionContextData,
  fn: () => T
): T {
  return storage.run(ctx, fn);
}

// ============================================================================
// Context Access
// ============================================================================

/**
 * Get current execution context.
 * Returns undefined if no context is established.
 */
export function getCurrentExecutionContext(): ExecutionContextData | undefined {
  return storage.getStore();
}

// ============================================================================
// Context Enrichment
// ============================================================================

/**
 * Set actor on current context.
 */
export function setActor(actor: Actor): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.actor = actor;
  }
}

/**
 * Merge partial actor data into existing actor.
 */
export function enrichActor(partial: Partial<Actor>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  
  if (ctx.actor) {
    Object.assign(ctx.actor, partial);
  } else {
    ctx.actor = partial as Actor;
  }
}

/**
 * Add tags to current context (merged with existing).
 */
export function addTags(tags: Record<string, string>): void {
  const ctx = storage.getStore();
  if (ctx) {
    Object.assign(ctx.tags, tags);
  }
}

/**
 * Set a single attribute on current context.
 */
export function setAttribute(key: string, value: unknown): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.attributes[key] = value;
  }
}

/**
 * Set multiple attributes on current context.
 */
export function setAttributes(attrs: Record<string, unknown>): void {
  const ctx = storage.getStore();
  if (ctx) {
    Object.assign(ctx.attributes, attrs);
  }
}

/**
 * Set source identifier on current context.
 */
export function setSource(source: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.source = source.trim();
  }
}

/**
 * Set parent log ID on current context.
 * Used for tracking span hierarchy.
 */
export function setParentLogId(logId: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.parentLogId = logId;
  }
}

