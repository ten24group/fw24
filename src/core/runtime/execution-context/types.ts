/**
 * Execution Context Types
 *
 * Core types for the framework's execution context system.
 *
 * DESIGN:
 * - Core trace identity (correlationId, causedBy, actor) at root level
 * - All observability-specific state in single `observability` namespace
 * - SpanObserver instances form linked tree via parent references
 */

import type { ObservabilityEvent } from '../../../observability/types';
import type { Actor } from '../../types/execution-context';

// Forward declaration to avoid circular imports
// The actual SpanObserver type is in observability/observers/span.ts
export interface ISpanNode {
  readonly id: string;
  readonly operation: string;
  readonly parent?: ISpanNode;
  readonly captured: boolean;

  /**
   * Optional span APIs used across the framework for consolidation.
   * These are implemented by the framework span observer (SpanObserver).
   *
   * Note: Return types are intentionally `unknown`/`void`-compatible so implementations can be fluent.
   */
  tag?: (key: string, value: string | number | boolean) => unknown;
  tags?: (tags: Record<string, string | number | boolean>) => unknown;
  metric?: (key: string, value: number) => unknown;
  metrics?: (metrics: Record<string, number>) => unknown;
  setData?: (data: Record<string, unknown>) => unknown;
  checkpoint?: (name: string, options?: { metrics?: Record<string, number>; data?: Record<string, unknown>; tags?: Record<string, string>; error?: Error | string }) => unknown;
}

/**
 * Execution context data - stored in AsyncLocalStorage.
 *
 * This is the cross-cutting context available anywhere in the call stack.
 */
export interface ExecutionContextData {
  // ═══════════════════════════════════════════════════════════════════════════
  // TRACE IDENTITY (used by business logic + observability)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Correlation ID for distributed tracing (required) */
  readonly correlationId: string;

  /**
   * Correlation ID of the upstream request that caused this execution.
   * Used to link downstream processing (e.g., DynamoDB stream, SQS processing)
   * back to the original API request that triggered it.
   */
  causedBy?: string;

  /** Actor performing the operation */
  actor?: Actor;

  /** Context creation timestamp */
  readonly startTime: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVABILITY STATE (single namespace)
  // ═══════════════════════════════════════════════════════════════════════════

  /** All observability-specific state */
  readonly observability: ObservabilityState;
}

/**
 * All observability-specific state in one namespace.
 *
 * Includes:
 * - Current span (for automatic parent linking)
 * - Sampling control
 * - Event enrichment (source, tags, attributes)
 * - Smart sampling buffer
 */
export interface ObservabilityState {
  // ─────────────────────────────────────────────────────────────────────────
  // Span Hierarchy
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Stable identity for this invocation's observability state.
   *
   * Important: ExecutionContextData objects are cloned when entering span scopes
   * (see withCurrentSpan()), so we cannot key any per-invocation registries by the
   * context object reference. This key is preserved across clones.
   */
  contextKey: object;

  /**
   * Current span in this context scope.
   * Set via withCurrentSpan(), automatically restored on scope exit.
   * Used for automatic parent linking in child spans.
   */
  currentSpan?: ISpanNode;

  // ─────────────────────────────────────────────────────────────────────────
  // Sampling
  // ─────────────────────────────────────────────────────────────────────────

  /** Whether this trace is sampled */
  sampled: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Event Enrichment
  // ─────────────────────────────────────────────────────────────────────────

  /** Source identifier (e.g., 'OrderController.create') */
  source?: string;

  /** Tags for filtering/categorization */
  tags: Record<string, string>;

  /**
   * Custom attributes for span/operation enrichment.
   * These are inherited by spans created in this context.
   */
  attributes: Record<string, unknown>;

  /**
   * Context-level metadata that applies to all events in this scope.
   * Set via withContext({ metadata: {...} }) and flows to event.metadata.
   * Used for tenant ID, user context, etc.
   */
  metadata: Record<string, unknown>;

  // ─────────────────────────────────────────────────────────────────────────
  // Smart Sampling Buffer
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Buffer for smart tail-based sampling.
   * Stores all events during execution. On flush:
   * - If error occurred: all events are captured (buffer already flushed on error)
   * - If no error: sampling rules applied to buffer before capture
   */
  buffer: ObservabilityEvent[];

  /**
   * Flag indicating if an error (ERROR/CRITICAL) has occurred in this invocation.
   * Once set, all subsequent events bypass buffering and are captured immediately.
   */
  errorOccurred: boolean;

  /**
   * Observability metrics for this invocation.
   * Tracks buffer usage, dropped events, etc.
   */
  summary: ObservabilitySummary;

  /**
   * Detailed breakdown of captured events by type, operation, and level.
   * Used to generate detailed observability summary checkpoints.
   */
  capturedBreakdown?: {
    byType: Record<string, number>;
    byOperation: Record<string, number>;
    byLevel: Record<string, number>;
  };
}

/**
 * Observability metrics for an invocation.
 */
export interface ObservabilitySummary {
  /** Number of events evicted from buffer due to size limits */
  evicted: number;
  /** Number of events buffered */
  buffered: number;
  /** Number of events captured immediately */
  captured: number;
  /** Number of events sampled out */
  sampledOut: number;
}

/**
 * Options for creating execution context.
 */
export interface CreateExecutionContextOptions {
  /** Correlation ID (required) */
  correlationId: string;
  /** Upstream request correlation ID that caused this execution */
  causedBy?: string;
  /** Whether trace is sampled (default: true) */
  sampled?: boolean;
  /** Actor performing the operation */
  actor?: Actor;
  /** Source identifier */
  source?: string;
  /** Initial tags */
  tags?: Record<string, string>;
  /** Initial attributes (for spans) */
  attributes?: Record<string, unknown>;
  /** Initial metadata (for all events) */
  metadata?: Record<string, unknown>;
}

/**
 * Parsed trace context from incoming requests/messages.
 */
export interface ParsedTraceContext {
  /** Correlation/trace ID */
  correlationId: string;
  /** Upstream request correlation ID that caused this execution */
  causedBy?: string;
  /** Whether trace is sampled */
  sampled?: boolean;
}
