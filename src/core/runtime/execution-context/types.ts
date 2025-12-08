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
  
  /** Parent log ID for trace hierarchy */
  parentLogId?: string;
  
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
}

/**
 * Options for creating execution context
 */
export interface CreateExecutionContextOptions {
  /** Correlation ID (required) */
  correlationId: string;
  /** Parent log ID for trace hierarchy */
  parentLogId?: string;
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
}

/**
 * Parsed trace context from incoming requests/messages
 */
export interface ParsedTraceContext {
  /** Correlation/trace ID */
  correlationId: string;
  /** Parent log ID */
  parentLogId?: string;
  /** Whether trace is sampled */
  sampled?: boolean;
}

