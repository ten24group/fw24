/**
 * Observability Types
 * 
 * DESIGN PRINCIPLES:
 * - Required fields are REQUIRED - no fallbacks
 * - Optional fields are intentionally optional for logged data flexibility
 * - Reuse existing FW24 types (Actor) - no redundancy
 * - Strict typing - callers must provide proper values
 */

import { Actor } from '../core/types/execution-context';

/**
 * Observability levels - numeric for comparison
 */
export enum ObservabilityLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  CRITICAL = 5,
  OFF = 99,
}

/**
 * String representation of observability levels
 */
export type ObservabilityLevelString = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * Base event types supported by the framework
 */
export type BaseEventType =
  // Span/Trace types
  | 'span.start'
  | 'span.event'
  | 'span.end'
  // General logging
  | 'log'
  // Metrics
  | 'metric'
  // Audit types
  | 'audit'
  | 'audit.entity'
  | 'audit.access'
  | 'audit.compliance'
  // Workflow types
  | 'workflow.start'
  | 'workflow.step'
  | 'workflow.end'
  // Decision types
  | 'decision'
  | 'decision.rule'
  | 'decision.algorithm'
  | 'decision.feature_flag'
  | 'decision.ab_test'
  // Access log types
  | 'access.request'
  | 'access.response';

/**
 * All supported event types (base + custom)
 * 
 * Custom event types are fully supported without registration!
 * Use Observer.capture() or Manager.capture() with any type:
 * 
 * @example
 * ```typescript
 * import { Observer } from '@ten24group/fw24';
 * 
 * // Business event
 * Observer.capture({
 *   type: 'business.order_placed',
 *   level: 'info',
 *   entityName: 'order',
 *   entityId: order.id,
 *   data: { orderId, amount, customer },
 *   metrics: { amount: 99.99 },
 * });
 * 
 * // Payment transaction
 * Observer.capture({
 *   type: 'payment.transaction',
 *   level: 'info',
 *   data: { transactionId, status },
 *   success: status === 'completed',
 * });
 * 
 * // Or use existing observers if the type matches:
 * SpanObserver.start('operation');  // Creates 'span.start'
 * LogObserver.info('message');      // Creates 'log'
 * AuditObserver.entityCreate(...);  // Creates 'audit.entity'
 * ```
 * 
 * Type categorization (for backend routing and sampling):
 * - Starts with 'span.': categorized as 'span'
 * - Equals 'metric': categorized as 'metric'
 * - Starts with 'audit': categorized as 'audit'
 * - Everything else: categorized as 'log'
 */
export type ObservabilityEventType = BaseEventType | (string & {});

/**
 * Error details for observability events
 */
export interface ObservabilityError {
  type: string;
  message: string;
  stack?: string;
  code?: string;
}

/**
 * Universal observation event
 * 
 * REQUIRED fields must be provided by caller - no auto-generation fallbacks.
 * OPTIONAL fields are intentionally loose for flexibility in logged data.
 * 
 * Uses existing Actor type from ExecutionContext - DO NOT create redundant actor types.
 */
export interface ObservabilityEvent {
  // === REQUIRED - must be provided, no fallbacks ===
  /** Event type - determines routing and handling */
  type: ObservabilityEventType;
  /** Severity level */
  level: ObservabilityLevelString;
  /** Correlation ID for distributed tracing - MUST be propagated from context */
  correlationId: string;
  /** Timestamp in milliseconds */
  timestampMs: number;
  /** Unique ID for this observability log entry */
  observabilityLogId: string;

  // === TRACING (optional - depends on context) ===
  /** Parent observability log ID for hierarchical relationships (within same invocation) */
  parentObservabilityLogId?: string | null;
  /** 
   * Correlation ID that caused this event (cross-invocation tracing)
   * Example: DynamoDB stream audit caused by original API request
   */
  causedBy?: string;
  /** 
   * All related trace IDs (for complex workflows spanning multiple invocations)
   * Allows querying "show me everything related to this business transaction"
   */
  relatedTraces?: string[];

  // === ENTITY CONTEXT (optional - depends on what's being observed) ===
  /** Entity type being observed (user, order, span, workflow) */
  entityName?: string;
  /** Specific entity instance ID */
  entityId?: string;

  // === OPERATION (optional - depends on event type) ===
  /** What action is being performed */
  operation?: string;
  /** More specific classification of the event */
  subType?: string;
  /** Current status (pending, completed, failed, etc.) */
  status?: string;
  /** Operation outcome */
  success?: boolean;

  // === TIMING (optional) ===
  /** Duration in milliseconds */
  durationMs?: number;

  // === ACTOR (optional - uses existing FW24 Actor type) ===
  /** Who/what is performing the action */
  actor?: Actor;

  // === SOURCE & TAGS (optional) ===
  /** Source identifier (lambda:name, controller:Class.method) */
  source?: string;
  /** Key-value tags for filtering */
  tags?: Record<string, string>;

  // === PAYLOADS (optional - intentionally loose for flexibility) ===
  /** Main data payload */
  data?: Record<string, unknown>;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** System metadata */
  metadata?: Record<string, unknown>;
  /** Numeric metrics */
  metrics?: Record<string, number>;
  /** Request/response context */
  context?: Record<string, unknown>;

  // === ERROR (optional) ===
  /** Error details if applicable */
  error?: ObservabilityError;

  // === SAMPLING CONTROL (optional) ===
  /** 
   * Mark as critical - bypasses sampling and prevents buffer eviction
   * Use for: payment processing, security audits, critical business flows
   */
  critical?: boolean;
}

/**
 * Input for capturing events - allows some fields to be auto-generated
 */
export interface CaptureInput {
  // Required - no fallbacks
  type: ObservabilityEventType;
  level: ObservabilityLevelString;
  correlationId: string;

  // Auto-generated if not provided
  observabilityLogId?: string;
  timestampMs?: number;

  // Optional fields (same as ObservabilityEvent)
  // null = explicitly no parent (don't fall back to context)
  parentObservabilityLogId?: string | null;
  causedBy?: string;
  relatedTraces?: string[];
  entityName?: string;
  entityId?: string;
  operation?: string;
  subType?: string;
  status?: string;
  success?: boolean;
  durationMs?: number;
  actor?: Actor;
  source?: string;
  tags?: Record<string, string>;
  data?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
  context?: Record<string, unknown>;
  error?: ObservabilityError;
  critical?: boolean;
}

/**
 * Backend interface - what backends must implement
 */
export interface ObservabilityBackend {
  /** Unique backend name */
  name: string;
  /** Minimum level to capture (optional filtering) */
  minLevel?: ObservabilityLevel;
  /** Capture an event */
  capture(event: ObservabilityEvent): Promise<void>;
  /** Flush pending events (called before Lambda returns) */
  flush?(): Promise<void>;
  /** Initialize for new invocation (called on each Lambda invocation) */
  initializeInvocation?(): void;
}

/**
 * CloudWatch backend-specific options
 */
export interface CloudWatchBackendOptions {
  serviceName?: string;
  namespace?: string;
}

/**
 * DynamoDB backend-specific options
 */
export interface DynamoDBBackendOptions {
  /** Logical table key - resolved to actual table name via env var {tableKey}_table */
  tableKey?: string;
  ttlDays?: number;
}

/**
 * OTEL backend-specific options
 */
export interface OTELBackendOptions {
  serviceName?: string;
  endpoint?: string;
}

/**
 * Per-type backend filtering
 * Allows control over which event types this backend receives
 */
export interface BackendTypeFilter {
  /** Whether this type is enabled for this backend (default: true) */
  enabled?: boolean;
  /** Minimum level for this type on this backend (overrides backend-level minLevel) */
  minLevel?: ObservabilityLevel;
  /** Sampling rate override for this type on this backend (0.0-1.0) */
  sampling?: number;
}

/**
 * Backend configuration - discriminated union for type-safe config
 */
export type ObservabilityBackendConfig =
  | { type: 'cloudwatch'; enabled: boolean; minLevel?: ObservabilityLevel; config?: CloudWatchBackendOptions; types?: { span?: BackendTypeFilter; metric?: BackendTypeFilter; audit?: BackendTypeFilter; log?: BackendTypeFilter } }
  | { type: 'dynamodb'; enabled: boolean; minLevel?: ObservabilityLevel; config?: DynamoDBBackendOptions; types?: { span?: BackendTypeFilter; metric?: BackendTypeFilter; audit?: BackendTypeFilter; log?: BackendTypeFilter } }
  | { type: 'otel'; enabled: boolean; minLevel?: ObservabilityLevel; config?: OTELBackendOptions; types?: { span?: BackendTypeFilter; metric?: BackendTypeFilter; audit?: BackendTypeFilter; log?: BackendTypeFilter } };

/**
 * Type-specific configuration
 */
export interface TypeSpecificConfig {
  backends?: ('cloudwatch' | 'dynamodb' | 'otel')[];
  minLevel?: ObservabilityLevel;
  sampling?: {
    enabled: boolean;
    rate: number;
  };
}

/**
 * Sampling configuration
 */
export interface SamplingConfig {
  enabled: boolean;
  /** 
   * Enable smart tail-based sampling (capture full trace on error).
   * When enabled, logs/spans that would be sampled out are buffered.
   * If an ERROR/CRITICAL event occurs, the buffer is flushed.
   * Default: false
   */
  smart?: boolean;
  /**
   * Maximum buffer size for smart sampling (number of events).
   * When buffer exceeds this size, lowest priority events are evicted.
   * Default: 1000
   */
  maxBufferSize?: number;
  /**
   * Minimum level to capture when flushing buffer on error.
   * Prevents overwhelming backends with thousands of TRACE/DEBUG events.
   * Default: ObservabilityLevel.INFO
   */
  minLevelOnError?: ObservabilityLevel;
  /** Sampling rates by level name (0-1). Missing levels default to 1.0 (100%) */
  rates?: Partial<Record<ObservabilityLevelString, number>>;
  /** Sampling rates by operation pattern */
  operations?: Record<string, number>;
  /** 
   * Rule-based sampling configuration.
   * Rules are evaluated in order. First match determines the sampling rate.
   */
  rules?: SamplingRule[];
}

export interface SamplingRule {
  /** Target field to match against */
  target: 'tenant' | 'route' | 'tag' | 'actor' | 'source';
  /** 
   * Value pattern to match.
   * Can be a string (exact match) or regex pattern.
   * For tags, use "key:value" format.
   */
  pattern: string | RegExp;
  /** Sampling rate (0.0 to 1.0) */
  rate: number;
}

/**
 * CloudWatch configuration
 */
export interface CloudWatchConfig {
  namespace: string;
}

/**
 * DynamoDB configuration
 */
export interface DynamoDBConfig {
  /** Logical table key - resolved to actual table name via env var {tableKey}_table */
  tableKey: string;
  ttlDays: number;
}

/**
 * Data protection configuration for observability events
 * Reuses @hackylabs/deep-redact library for redaction
 */
export interface ObservabilityDataProtectionConfig {
  /** Enable/disable data protection (default: true) */
  enabled: boolean;
  /** Keys to redact (strings or regex patterns) */
  blacklistedKeys?: (string | RegExp)[];
  /** 
   * Fuzzy key matching - checks if blacklisted key is contained in actual key
   * e.g., "pass" matches "password", "userPassword", etc.
   * (default: true)
   */
  fuzzyKeyMatch?: boolean;
  /** Case sensitive key matching (default: false) */
  caseSensitiveKeyMatch?: boolean;
  /** Replacement string (default: '[REDACTED]') */
  replacement?: string;
  /** 
   * Fields to protect in ObservabilityEvent
   * Default: ['data', 'attributes', 'metadata', 'context']
   */
  fields?: ('data' | 'attributes' | 'metadata' | 'context' | 'error')[];
}


/**
 * Main observability configuration
 * 
 * ALL fields are REQUIRED - no optional fields with fallbacks.
 * Defaults are registered in DI by the observability module.
 */
export interface ObservabilityConfig {
  /** Enable/disable observability system */
  enabled: boolean;
  /** Minimum level to capture */
  minLevel: ObservabilityLevel;
  /** Sampling configuration */
  sampling: SamplingConfig;
  /** Backend configurations */
  backends: ObservabilityBackendConfig[];
  /** Type-specific overrides for core observers */
  types?: {
    span?: TypeSpecificConfig;
    metric?: TypeSpecificConfig;
    audit?: TypeSpecificConfig;
    log?: TypeSpecificConfig;
  };

  /** Service name (used by CloudWatch, OTEL) */
  serviceName: string;

  /** CloudWatch configuration */
  cloudwatch: CloudWatchConfig;

  /** DynamoDB configuration */
  dynamodb: DynamoDBConfig;

  /** Data protection configuration */
  dataProtection: ObservabilityDataProtectionConfig;
}

/**
 * Default sampling configuration - all levels at 100%
 */
export const DefaultSamplingConfig: SamplingConfig = {
  enabled: false,
  rates: {
    critical: 1,
    error: 1,
    warn: 1,
    info: 1,
    debug: 1,
    trace: 1,
  },
};

/**
 * Capture options for observe/capture methods
 */
export interface CaptureOptions {
  /** Bypass sampling - always capture this event */
  critical?: boolean;
}

/**
 * Interface for event capture - enables testability via dependency injection
 * 
 * Observers use this interface instead of importing ObservabilityManager directly,
 * allowing easy mocking in tests.
 */
export interface IEventCapture {
  /**
   * Capture an observability event (fire-and-forget)
   * @returns observabilityLogId if captured, undefined if filtered/sampled out
   */
  capture(input: CaptureInput, options?: CaptureOptions): string | undefined;

  /**
   * Capture an observability event asynchronously
   * Use when you need to await backend completion
   * @returns Promise<observabilityLogId> if captured, undefined if filtered/sampled out
   */
  captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined>;
}
