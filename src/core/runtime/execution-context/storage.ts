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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from '../../types/execution-context';
import type {
  ExecutionContextData,
  CreateExecutionContextOptions,
  ObservabilityState,
  ObservabilitySummary,
  ISpanNode,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Storage (ONE AsyncLocalStorage for the entire framework)
// ═══════════════════════════════════════════════════════════════════════════

const storage = new AsyncLocalStorage<ExecutionContextData>();

// ═══════════════════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create default observability summary.
 */
function createObservabilitySummary(): ObservabilitySummary {
  return {
    evicted: 0,
    buffered: 0,
    captured: 0,
    sampledOut: 0,
  };
}

/**
 * Create observability state.
 */
function createObservabilityState(
  sampled: boolean,
  source?: string,
  tags?: Record<string, string>,
  attributes?: Record<string, unknown>,
  metadata?: Record<string, unknown>
): ObservabilityState {
  return {
    contextKey: {},
    currentSpan: undefined,
    sampled,
    source,
    tags: { ...tags },
    attributes: { ...attributes },
    metadata: { ...metadata },
    buffer: [],
    errorOccurred: false,
    summary: createObservabilitySummary(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Context Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

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

  return {
    correlationId,
    causedBy: options.causedBy?.trim(),
    actor: options.actor,
    startTime: Date.now(),
    observability: createObservabilityState(
      options.sampled ?? true,
      options.source?.trim(),
      options.tags,
      options.attributes,
      options.metadata
    ),
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

// ═══════════════════════════════════════════════════════════════════════════
// Context Access
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current execution context.
 * Returns undefined if no context is established.
 */
export function getCurrentExecutionContext(): ExecutionContextData | undefined {
  return storage.getStore();
}

/**
 * Get current observability state.
 * Returns undefined if no context is established.
 */
export function getObservabilityState(): ObservabilityState | undefined {
  return storage.getStore()?.observability;
}

/**
 * Get current span from observability state.
 * Returns undefined if no span is active.
 */
export function getCurrentSpan(): ISpanNode | undefined {
  return storage.getStore()?.observability.currentSpan;
}

// ═══════════════════════════════════════════════════════════════════════════
// Span Context Scoping
// ═══════════════════════════════════════════════════════════════════════════

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
export function withCurrentSpan<T>(span: ISpanNode, fn: () => T): T {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No execution context - call runWithExecutionContext first');
  }

  // Create new context with updated currentSpan
  // Other state is shallow copied (buffer array is same reference - intentional)
  const newCtx: ExecutionContextData = {
    ...ctx,
    observability: {
      ...ctx.observability,
      currentSpan: span,
    },
  };

  // Run in new scope - AsyncLocalStorage handles restoration
  return storage.run(newCtx, fn);
}

/**
 * Async version of withCurrentSpan.
 */
export async function withCurrentSpanAsync<T>(
  span: ISpanNode,
  fn: () => Promise<T>
): Promise<T> {
  return withCurrentSpan(span, fn);
}

// ═══════════════════════════════════════════════════════════════════════════
// Context Enrichment - Actor
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Context Enrichment - Observability
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set source identifier on current context.
 */
export function setSource(source: string): void {
  const state = getObservabilityState();
  if (state) {
    state.source = source.trim();
  }
}

/**
 * Add tags to current context (merged with existing).
 */
export function addTags(tags: Record<string, string>): void {
  const state = getObservabilityState();
  if (state) {
    Object.assign(state.tags, tags);
  }
}

/**
 * Set a single attribute on current context.
 */
export function setAttribute(key: string, value: unknown): void {
  const state = getObservabilityState();
  if (state) {
    state.attributes[ key ] = value;
  }
}

/**
 * Set multiple attributes on current context.
 */
export function setAttributes(attrs: Record<string, unknown>): void {
  const state = getObservabilityState();
  if (state) {
    Object.assign(state.attributes, attrs);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Parent ID Resolution
// ═══════════════════════════════════════════════════════════════════════════

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
export function getCapturedParentId(span: ISpanNode | undefined): string | undefined {
  let current = span?.parent;
  while (current) {
    if (current.captured) {
      return current.id;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Get parent observability log ID for new events.
 * Uses the current span and walks to find captured ancestor.
 */
export function getCurrentParentObservabilityLogId(): string | undefined {
  const currentSpan = getCurrentSpan();
  if (!currentSpan) return undefined;

  // If current span was captured, use its ID
  // Otherwise walk up to find captured ancestor
  if (currentSpan.captured) {
    return currentSpan.id;
  }
  return getCapturedParentId(currentSpan);
}

/**
 * Explicitly register that a span ID has been emitted/propagated as a parentObservabilityLogId.
 *
 * This is the central integrity mechanism for hierarchy:
 * when a parent ID is referenced, the parent span must not be dropped later by filtering.
 *
 * This function is intentionally explicit (NOT hidden inside parent-id getters).
 */
// Parent/child integrity is now enforced at flush-time (graph-based),
// not via manual reference tracking.