/**
 * Execution Context Types
 * 
 * Core types for the framework's execution context system.
 */

import { Actor } from '../../types/execution-context';

/**
 * Execution context data - stored in AsyncLocalStorage.
 * 
 * This is the cross-cutting context available anywhere in the call stack.
 * Contains correlation, actor, and custom metadata.
 */
export interface ExecutionContextData {
  /** Correlation ID for distributed tracing (required) */
  readonly correlationId: string;

  /** Parent observability log ID for trace hierarchy */
  parentObservabilityLogId?: string;

  /** Whether this trace is sampled */
  readonly sampled: boolean;

  /** Actor performing the operation */
  actor?: Actor;

  /** Tags for filtering/categorization */
  readonly tags: Record<string, string>;

  /** Custom attributes for application data */
  readonly attributes: Record<string, unknown>;

  /** Source identifier (e.g., 'OrderController.create') */
  source?: string;

  /** Context creation timestamp */
  readonly startTime: number;

  /** 
   * Buffer for smart tail-based sampling.
   * Stores all events during execution. On flush:
   * - If error occurred: all events are captured (buffer already flushed on error)
   * - If no error: sampling rules applied to buffer before capture
   */
  observabilityBuffer?: any[]; // Will be ObservabilityEvent[] but can't import here

  /**
   * Flag indicating if an error (ERROR/CRITICAL) has occurred in this invocation.
   * Once set, all subsequent events bypass buffering and are captured immediately.
   */
  errorOccurred?: boolean;

  /**
   * Observability metrics for this invocation.
   * Tracks buffer usage, dropped events, etc.
   */
  observabilitySummary?: {
    /** Number of events evicted from buffer due to size limits */
    evicted?: number;
    /** Number of events buffered */
    buffered?: number;
    /** Number of events captured immediately */
    captured?: number;
  };
}

/**
 * Options for creating execution context
 */
export interface CreateExecutionContextOptions {
  /** Correlation ID (required) */
  correlationId: string;
  /** Parent observability log ID for trace hierarchy */
  parentObservabilityLogId?: string;
  /** Whether trace is sampled (default: true) */
  sampled?: boolean;
  /** Actor performing the operation */
  actor?: Actor;
  /** Initial tags */
  tags?: Record<string, string>;
  /** Initial attributes */
  attributes?: Record<string, unknown>;
  /** Source identifier */
  source?: string;
  /** Module-level sampling override */
  moduleSampling?: { rate?: number; smart?: boolean };
}

/**
 * Parsed trace context from incoming requests/messages
 */
export interface ParsedTraceContext {
  /** Correlation/trace ID */
  correlationId: string;
  /** Parent observability log ID */
  parentObservabilityLogId?: string;
  /** Whether trace is sampled */
  sampled?: boolean;
}

