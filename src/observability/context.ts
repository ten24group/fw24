/**
 * Context Management for Observability
 * 
 * Provides context propagation for distributed tracing and observability correlation.
 * 
 * ## Design: Single Context Mechanism
 * 
 * This module uses **AsyncLocalStorage only** for context propagation:
 * - Standard Node.js mechanism for async context
 * - Automatic propagation across async boundaries (promises, callbacks)
 * - No module-level state, no Lambda-specific hacks
 * 
 * ## Usage Patterns
 * 
 * ### Lambda Handlers (Direct)
 * ```typescript
 * export const handler = async (event, lambdaContext) => {
 *   const context = createObservationContext(lambdaContext.awsRequestId, { ... });
 *   return runWithContext(context, async () => {
 *     // getCurrentContext() works here
 *     SpanObserver.start('operation');
 *   });
 * };
 * ```
 * 
 * ### API Gateway Controllers (via Middleware)
 * The middleware stores context in `ExecutionContext.observability`.
 * Access it in your handler:
 * ```typescript
 * async myHandler(request, response, ctx) {
 *   // Option 1: Access context data directly
 *   const { correlationId } = ctx.observability;
 *   
 *   // Option 2: Run code with full context propagation
 *   return runWithContext(ctx.observability.context, async () => {
 *     // getCurrentContext() works here
 *     SpanObserver.start('nested-operation');
 *   });
 * }
 * ```
 * 
 * ## W3C Trace Context Compliance
 * 
 * The traceparent header format is: `00-{trace-id}-{parent-id}-{flags}`
 * - trace-id: 32 lowercase hex chars
 * - parent-id: 16 lowercase hex chars  
 * - flags: 2 lowercase hex chars (01 = sampled)
 * 
 * @module observability/context
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Actor } from '../core/types/execution-context';
import { ObservationContext } from './types';

// ============================================================================
// Constants
// ============================================================================

/** W3C trace-id length (32 hex chars = 16 bytes) */
const W3C_TRACE_ID_LENGTH = 32;

/** W3C parent-id/span-id length (16 hex chars = 8 bytes) */
const W3C_PARENT_ID_LENGTH = 16;

// ============================================================================
// Context Storage (AsyncLocalStorage ONLY)
// ============================================================================

/**
 * AsyncLocalStorage for context propagation.
 * This is the ONLY storage mechanism - no module-level fallbacks.
 */
const storage = new AsyncLocalStorage<ObservationContext>();

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating an observation context.
 */
export interface CreateObservationContextOptions {
  /** Parent log/span ID for trace hierarchy */
  parentLogId?: string;
  /** Actor performing the operation */
  actor?: Actor;
  /** Tags to attach to all events */
  tags?: Record<string, string>;
  /** Source identifier (e.g., 'UserController.create') */
  source?: string;
  /** Whether trace is sampled (default: true) */
  sampled?: boolean;
}

/**
 * Parsed trace context from incoming requests/messages.
 */
export interface ParsedTraceContext {
  /** Correlation/trace ID */
  correlationId: string;
  /** Parent span/log ID */
  parentLogId?: string;
  /** Whether trace is sampled */
  sampled?: boolean;
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * Create a new observation context.
 * 
 * @param correlationId - REQUIRED non-empty trace/correlation ID
 * @param options - Optional configuration
 * @throws Error if correlationId is empty
 */
export function createObservationContext(
  correlationId: string,
  options?: CreateObservationContextOptions
): ObservationContext {
  const trimmedId = correlationId?.trim();
  if (!trimmedId) {
    throw new Error(
      'correlationId is required and cannot be empty. ' +
      'Use request.requestId, context.awsRequestId, or crypto.randomUUID().'
    );
  }

  return {
    correlationId: trimmedId,
    parentLogId: options?.parentLogId?.trim() || undefined,
    actor: options?.actor,
    tags: options?.tags,
    source: options?.source?.trim() || undefined,
    tenantId: options?.actor?.tenantId,
    sessionId: options?.actor?.sessionId,
    sampled: options?.sampled ?? true,
  };
}

// ============================================================================
// Context Access
// ============================================================================

/**
 * Get the current observation context.
 * Returns undefined if no context is established.
 */
export function getCurrentContext(): ObservationContext | undefined {
  return storage.getStore();
}

/**
 * Check if context is established.
 */
export function hasContext(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Get correlation ID from current context.
 * @throws Error if no context is established
 */
export function getCorrelationId(): string {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'No observation context. Wrap your code with runWithContext().'
    );
  }
  return context.correlationId;
}

/**
 * Get correlation ID if context exists, undefined otherwise.
 */
export function getCorrelationIdIfExists(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Get actor from current context.
 */
export function getContextActor(): Actor | undefined {
  return storage.getStore()?.actor;
}

// ============================================================================
// Context Execution
// ============================================================================

/**
 * Run a function with the given observation context.
 * 
 * This is THE way to establish context. All code within the function
 * will have access to the context via getCurrentContext().
 * 
 * @example
 * ```typescript
 * await runWithContext(context, async () => {
 *   // getCurrentContext() returns the context here
 *   const span = SpanObserver.start('operation');
 *   await doWork();
 *   span.end({ success: true });
 * });
 * ```
 */
export async function runWithContext<T>(
  context: ObservationContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(context, fn);
}

/**
 * Run a sync function with the given observation context.
 */
export function runWithContextSync<T>(
  context: ObservationContext,
  fn: () => T
): T {
  return storage.run(context, fn);
}

// ============================================================================
// Context Modification
// ============================================================================

/**
 * Update actor in current context.
 * Useful when actor becomes available after context creation (e.g., post-auth).
 * 
 * @throws Error if no context is established
 */
export function setContextActor(actor: Actor): void {
  const context = storage.getStore();
  if (!context) {
    throw new Error('No observation context. Cannot set actor.');
  }
  context.actor = actor;
  context.tenantId = actor.tenantId;
  context.sessionId = actor.sessionId;
}

/**
 * Add tags to current context (merged with existing).
 * 
 * @throws Error if no context is established
 */
export function addContextTags(tags: Record<string, string>): void {
  const context = storage.getStore();
  if (!context) {
    throw new Error('No observation context. Cannot add tags.');
  }
  context.tags = { ...context.tags, ...tags };
}

/**
 * Set parent log ID in current context.
 * 
 * @throws Error if no context is established
 */
export function setContextParentLogId(parentLogId: string): void {
  const context = storage.getStore();
  if (!context) {
    throw new Error('No observation context. Cannot set parent log ID.');
  }
  context.parentLogId = parentLogId;
}

// ============================================================================
// W3C Trace Context Utilities
// ============================================================================

/**
 * Convert UUID/string to valid W3C trace-id (32 hex chars).
 */
export function toW3CTraceId(id: string): string {
  const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return hex.length >= W3C_TRACE_ID_LENGTH
    ? hex.substring(0, W3C_TRACE_ID_LENGTH)
    : hex.padEnd(W3C_TRACE_ID_LENGTH, '0');
}

/**
 * Convert UUID/string to valid W3C parent-id (16 hex chars).
 */
export function toW3CParentId(id: string): string {
  const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return hex.length >= W3C_PARENT_ID_LENGTH
    ? hex.substring(0, W3C_PARENT_ID_LENGTH)
    : hex.padEnd(W3C_PARENT_ID_LENGTH, '0');
}

// ============================================================================
// Trace Context Extraction (Incoming)
// ============================================================================

/**
 * Extract trace context from HTTP headers.
 * 
 * Priority: x-correlation-id > traceparent (W3C) > x-amzn-trace-id (X-Ray)
 */
export function extractTraceContextFromHeaders(
  headers: Record<string, string | undefined>
): ParsedTraceContext | undefined {
  if (!headers) return undefined;

  // Normalize to lowercase
  const normalized: Record<string, string | undefined> = {};
  for (const [ key, value ] of Object.entries(headers)) {
    normalized[ key.toLowerCase() ] = value;
  }

  // 1. Custom correlation ID
  const customId = normalized[ 'x-correlation-id' ]?.trim();
  if (customId) {
    return {
      correlationId: customId,
      parentLogId: normalized[ 'x-parent-log-id' ]?.trim(),
    };
  }

  // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
  const traceparent = normalized[ 'traceparent' ];
  if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
    const parts = traceparent.split('-');
    return {
      correlationId: parts[ 1 ],
      parentLogId: parts[ 2 ],
      sampled: parts[ 3 ] === '01',
    };
  }

  // 3. X-Ray: Root=1-{epoch}-{unique};Parent={id};Sampled={0|1}
  const xray = normalized[ 'x-amzn-trace-id' ];
  if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
    const rootMatch = xray.match(/Root=([^;]+)/);
    const parentMatch = xray.match(/Parent=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      return {
        correlationId: rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''),
        parentLogId: parentMatch?.[ 1 ],
        sampled: sampledMatch?.[ 1 ] === '1',
      };
    }
  }

  return undefined;
}

/**
 * Extract trace context from SQS message attributes.
 */
export function extractTraceContextFromSqs(
  messageAttributes?: Record<string, { stringValue?: string; StringValue?: string }>
): ParsedTraceContext | undefined {
  if (!messageAttributes) return undefined;

  // X-Ray header
  const xrayAttr = messageAttributes[ 'AWSTraceHeader' ];
  const xray = xrayAttr?.stringValue || xrayAttr?.StringValue;
  if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
    const rootMatch = xray.match(/Root=([^;]+)/);
    const parentMatch = xray.match(/Parent=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      return {
        correlationId: rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''),
        parentLogId: parentMatch?.[ 1 ],
        sampled: sampledMatch?.[ 1 ] === '1',
      };
    }
  }

  // Custom attributes
  const correlationAttr = messageAttributes[ 'correlationId' ];
  const correlationId = (correlationAttr?.stringValue || correlationAttr?.StringValue)?.trim();
  if (correlationId) {
    const parentAttr = messageAttributes[ 'parentLogId' ];
    const sampledAttr = messageAttributes[ 'sampled' ];
    return {
      correlationId,
      parentLogId: (parentAttr?.stringValue || parentAttr?.StringValue)?.trim(),
      sampled: (sampledAttr?.stringValue || sampledAttr?.StringValue) === 'true',
    };
  }

  return undefined;
}

/**
 * Extract trace context from SNS message attributes.
 */
export function extractTraceContextFromSns(
  messageAttributes?: Record<string, { Type?: string; Value?: string }>
): ParsedTraceContext | undefined {
  if (!messageAttributes) return undefined;

  const correlationAttr = messageAttributes[ 'correlationId' ];
  if (correlationAttr?.Value?.trim()) {
    const parentAttr = messageAttributes[ 'parentLogId' ];
    const sampledAttr = messageAttributes[ 'sampled' ];
    return {
      correlationId: correlationAttr.Value.trim(),
      parentLogId: parentAttr?.Value?.trim(),
      sampled: sampledAttr?.Value === 'true',
    };
  }

  return undefined;
}

/**
 * Extract trace context from EventBridge event.
 */
export function extractTraceContextFromEventBridge(
  event: { detail?: Record<string, unknown> }
): ParsedTraceContext | undefined {
  const detail = event?.detail;
  if (!detail) return undefined;

  // Direct fields
  const correlationId = detail[ 'correlationId' ] || detail[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim()) {
    const parentLogId = detail[ 'parentLogId' ] || detail[ 'parentId' ];
    const sampled = detail[ 'sampled' ];
    return {
      correlationId: correlationId.trim(),
      parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext object
  const traceContext = detail[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string') {
    return {
      correlationId: (traceContext.correlationId as string).trim(),
      parentLogId: typeof traceContext.parentLogId === 'string'
        ? (traceContext.parentLogId as string).trim()
        : undefined,
      sampled: typeof traceContext.sampled === 'boolean'
        ? traceContext.sampled
        : traceContext.sampled === 'true',
    };
  }

  return undefined;
}

/**
 * Extract trace context from Step Functions input.
 */
export function extractTraceContextFromStepFunctions(
  input: Record<string, unknown>
): ParsedTraceContext | undefined {
  if (!input) return undefined;

  // Direct fields
  const correlationId = input[ 'correlationId' ] || input[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim()) {
    const parentLogId = input[ 'parentLogId' ] || input[ 'parentId' ];
    const sampled = input[ 'sampled' ];
    return {
      correlationId: correlationId.trim(),
      parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext
  const traceContext = input[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string') {
    return {
      correlationId: (traceContext.correlationId as string).trim(),
      parentLogId: typeof traceContext.parentLogId === 'string'
        ? (traceContext.parentLogId as string).trim()
        : undefined,
      sampled: typeof traceContext.sampled === 'boolean'
        ? traceContext.sampled
        : traceContext.sampled === 'true',
    };
  }

  // AWS execution context
  const awsContext = input[ 'aws' ] as Record<string, unknown> | undefined;
  if (awsContext?.[ 'executionArn' ] && typeof awsContext[ 'executionArn' ] === 'string') {
    const arnParts = (awsContext[ 'executionArn' ] as string).split(':');
    return { correlationId: arnParts[ arnParts.length - 1 ] };
  }

  return undefined;
}

/**
 * Extract trace context from Kinesis record.
 */
export function extractTraceContextFromKinesis(
  record: { kinesis?: { data?: string; partitionKey?: string } }
): ParsedTraceContext | undefined {
  if (!record?.kinesis?.data) return undefined;

  try {
    const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
    const data = JSON.parse(decoded) as Record<string, unknown>;
    const correlationId = data[ 'correlationId' ] || data[ 'traceId' ];
    if (typeof correlationId === 'string' && correlationId.trim()) {
      const parentLogId = data[ 'parentLogId' ] || data[ 'parentId' ];
      const sampled = data[ 'sampled' ];
      return {
        correlationId: correlationId.trim(),
        parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
        sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
      };
    }
  } catch {
    // Not JSON
  }

  // Fall back to partition key
  if (record.kinesis.partitionKey) {
    return { correlationId: record.kinesis.partitionKey };
  }

  return undefined;
}

/**
 * Extract trace context from DynamoDB Streams record.
 */
export function extractTraceContextFromDynamoDBStream(
  record: {
    dynamodb?: {
      NewImage?: Record<string, { S?: string; BOOL?: boolean }>;
    };
    eventID?: string;
  }
): ParsedTraceContext | undefined {
  const newImage = record?.dynamodb?.NewImage;
  if (newImage) {
    const correlationId = newImage[ 'correlationId' ]?.S || newImage[ 'traceId' ]?.S;
    if (correlationId?.trim()) {
      const parentLogId = newImage[ 'parentLogId' ]?.S || newImage[ 'parentId' ]?.S;
      const sampled = newImage[ 'sampled' ]?.BOOL ?? newImage[ 'sampled' ]?.S === 'true';
      return {
        correlationId: correlationId.trim(),
        parentLogId: parentLogId?.trim(),
        sampled: typeof sampled === 'boolean' ? sampled : undefined,
      };
    }
  }

  // Fall back to event ID
  if (record?.eventID) {
    return { correlationId: record.eventID };
  }

  return undefined;
}

// ============================================================================
// Trace Context Propagation (Outgoing)
// ============================================================================

/**
 * Create HTTP headers for trace propagation.
 * Includes both custom headers and W3C traceparent.
 */
export function createPropagationHeaders(context: ObservationContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': context.correlationId,
  };

  if (context.parentLogId) {
    headers[ 'x-parent-log-id' ] = context.parentLogId;
  }

  // W3C traceparent
  const sampledFlag = (context.sampled ?? true) ? '01' : '00';
  const traceId = toW3CTraceId(context.correlationId);
  const parentId = context.parentLogId
    ? toW3CParentId(context.parentLogId)
    : toW3CParentId(context.correlationId);
  headers[ 'traceparent' ] = `00-${traceId}-${parentId}-${sampledFlag}`;

  return headers;
}

/**
 * Create SQS message attributes for trace propagation.
 */
export function createSqsMessageAttributes(
  context: ObservationContext
): Record<string, { DataType: string; StringValue: string }> {
  const attrs: Record<string, { DataType: string; StringValue: string }> = {
    correlationId: { DataType: 'String', StringValue: context.correlationId },
    sampled: { DataType: 'String', StringValue: String(context.sampled ?? true) },
  };
  if (context.parentLogId) {
    attrs[ 'parentLogId' ] = { DataType: 'String', StringValue: context.parentLogId };
  }
  return attrs;
}

/**
 * Create SNS message attributes for trace propagation.
 */
export function createSnsMessageAttributes(
  context: ObservationContext
): Record<string, { DataType: string; StringValue: string }> {
  return createSqsMessageAttributes(context);
}

/**
 * Create trace context for EventBridge event detail.
 */
export function createEventBridgeTraceContext(
  context: ObservationContext
): Record<string, string | boolean> {
  const traceContext: Record<string, string | boolean> = {
    correlationId: context.correlationId,
    sampled: context.sampled ?? true,
  };
  if (context.parentLogId) {
    traceContext[ 'parentLogId' ] = context.parentLogId;
  }
  return traceContext;
}

/**
 * Create trace context for Step Functions output.
 */
export function createStepFunctionsTraceContext(
  context: ObservationContext
): Record<string, string | boolean> {
  return createEventBridgeTraceContext(context);
}

// ============================================================================
// Legacy Aliases (for backward compatibility during migration)
// ============================================================================

/**
 * @deprecated Use `runWithContext` instead
 */
export const withObservationContext = runWithContext;

/**
 * @deprecated Use `runWithContextSync` instead
 */
export const withObservationContextSync = runWithContextSync;
