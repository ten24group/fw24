/**
 * Observability Types
 * 
 * DESIGN PRINCIPLES:
 * - Required fields are REQUIRED - no fallbacks
 * - Optional fields are intentionally optional for logged data flexibility
 * - Reuse existing FW24 types (Actor) - no redundancy
 * - Strict typing - callers must provide proper values
 * - CaptureControl is the SINGLE source for all capture behavior
 * - RecordOverrides defines what can be overridden when calling observers
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
  | 'span'
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
 * - Equals 'span' or 'span.start': categorized as 'span'
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

// ═══════════════════════════════════════════════════════════════════════════
// CAPTURE CONTROL - Single source for ALL capture behavior
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Group-based sampling configuration for batch scenarios.
 * 
 * Use this when processing batches of items and you want to:
 * - Capture first N items in detail
 * - Sample remaining items
 * - Always capture failures
 * 
 * The manager handles sampling decisions based on this config.
 */
export interface GroupSamplingConfig {
  /** Unique group identifier (e.g., 'queue-batch-123') */
  key: string;
  /** Current item index in group (0-based). Caller must track this. */
  index: number;
  /** Total items in group (optional, for better logging) */
  total?: number;
  /** Capture first N items in full. Default: 3 */
  captureFirst?: number;
  /** Sample rate for remaining items (0-1). Default: 0.1 */
  sampleRate?: number;
}

/**
 * Capture control - per-event overrides for capture behavior.
 * 
 * Use this to OVERRIDE global config for specific events.
 * Most code should NOT need this - global config handles defaults.
 * 
 * @example
 * ```typescript
 * // Override: Always capture this specific log (bypass sampling)
 * LogObserver.info('Payment completed', data, {
 *   capture: { bypass: true }
 * });
 * 
 * // Override: Capture this span even if it's fast
 * SpanObserver.wrap('criticalButFast', fn, {
 *   capture: { minDurationMs: 0 }
 * });
 * 
 * // Override: Don't skip this span even if empty
 * SpanObserver.wrap('importantSpan', fn, {
 *   capture: { skipEmpty: false }
 * });
 * 
 * // Batch processing with group sampling
 * for (let i = 0; i < items.length; i++) {
 *   LogObserver.info('Processing', { item: items[i] }, {
 *     capture: { group: { key: 'batch-123', index: i, total: items.length } }
 *   });
 * }
 * ```
 */
export interface CaptureControl {
  /** Bypass sampling - always capture this record */
  bypass?: boolean;

  /** Priority for buffer eviction (higher = keep longer). Default: 0 */
  priority?: number;

  /** 
   * Override minDurationMs threshold for this span.
   * Set to 0 to capture regardless of duration.
   * Only applies to consolidated span records (type='span').
   */
  minDurationMs?: number;

  /** 
   * Override skipEmpty for this span.
   * Set to false to capture even if span has no events/errors.
   * Only applies to consolidated span records (type='span').
   */
  skipEmpty?: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // Noise Reduction Overrides
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Optional per-event override for the noise-reduction pipeline.
   *
   * This gives developers *local control* (per decorator or per log entry) to override
   * standard presets/rules when needed.
   */
  noise?: NoiseControl;

  /** Override TTL for this record (in days). Default: from config */
  ttlDays?: number;

  /** Group-based sampling for batch scenarios */
  group?: GroupSamplingConfig;

  /**
   * Limit which backends receive this event.
   * If specified, only these backends will capture.
   * Used internally for OTEL span tracking in consolidated mode.
   * @internal
   */
  backends?: ('cloudwatch' | 'dynamodb' | 'otel')[];
}

/**
 * Noise reduction decision.
 * - keep: persist as a standalone record (subject to normal sampling/backends)
 * - drop: do not persist as a standalone record (may still be accounted for in summaries)
 * - fold: merge into parent span as a checkpoint/event (best for noisy inner-loop logs)
 * - aggregate: count occurrences and keep statistics/examples on parent span
 * - downgrade: reduce level (e.g., error -> warn) if it's a known non-critical noise
 */
export type NoiseDecision = 'keep' | 'drop' | 'fold' | 'aggregate' | 'downgrade';

/**
 * Per-event noise control override.
 */
export interface NoiseControl {
  /** Override decision for this event */
  decision: NoiseDecision;
  /** Optional reason for audits/debugging (included in noise summaries) */
  reason?: string;
}

export type NoiseReductionPreset =
  | 'fw24.hotpaths'          // safe defaults for stream processors, audit logger, search sync, batch processors
  | 'fw24.batch_processors'; // aggressively reduce per-record noise

/**
 * Noise reduction configuration.
 *
 * This layer is orthogonal to sampling:
 * - sampling decides *whether* to store based on cost
 * - noise reduction decides *how* to represent data (standalone vs merged vs dropped)
 */
export interface NoiseReductionConfig {
  enabled: boolean;

  /** Built-in preset(s) with sane defaults for hot paths */
  presets: NoiseReductionPreset[];

  /** Custom rules evaluated in-order (first match wins) */
  rules: NoiseRule[];

  /** Emit a summary marker when events are dropped/folded (default: true) */
  emitSummaries: boolean;

  /**
   * Bounds for how much folded/aggregated detail can be attached to a single span.
   * This prevents giant DynamoDB items and UI overload.
   */
  maxCheckpointsPerSpan: number;
  maxAggregateKeysPerSpan: number;

  /** How many example events to keep per aggregate key (default: 5) */
  maxAggregateExamplesPerKey: number;
  /** How many error examples to keep per aggregate key (default: 3) */
  maxAggregateErrorExamplesPerKey: number;

  /** 
   * Include debug metadata in checkpoints and summaries (default: false).
   * When enabled, includes ruleId, reason, approxBytesSaved, byRuleId breakdowns, etc.
   * Checkpoints are ALWAYS created (they're core to the timeline), but their data payload
   * is minimal in production mode.
   */
  includeDebugMetadata: boolean;

  /** Include examples in aggregates (default: false) */
  includeExamples: boolean;
}

/**
 * Span checkpoint entry stored on consolidated span records at `data.checkpoints`.
 *
 * FW24 contract:
 * - Checkpoints are the ONLY supported nested timeline mechanism.
 * - No compatibility is provided for legacy `data.events`.
 */
export interface SpanCheckpoint {
  name: string;
  ts: number;
  tags?: Record<string, string>;
  metrics?: Record<string, number>;
  data?: Record<string, unknown>;
  error?: ObservabilityError;
}

export interface NoiseRuleMatch {
  /** Match event type(s) */
  type?: ObservabilityEventType | ObservabilityEventType[];
  /** Match level(s) */
  level?: ObservabilityLevelString | ObservabilityLevelString[];
  /** Match operation/message (exact string or regex-string like `/Publish\\s+SNS\\b/i`) */
  operation?: string;
  /** Match source (exact or regex string) */
  source?: string;
  /** Match entityName */
  entityName?: string;
  /** Match tag equality (all specified tags must match exactly) */
  tags?: Record<string, string>;
  /** 
   * Match minimum durationMs threshold (matches events where durationMs >= this value).
   * Example: durationMs: 100 matches spans with 100ms or longer duration.
   * Events without durationMs field will NOT match.
   */
  minDurationMs?: number;
  /**
   * Match maximum durationMs threshold (matches events where durationMs < this value).
   * Example: maxDurationMs: 50 matches spans under 50ms.
   * Combine with durationMs for range matching: { durationMs: 10, maxDurationMs: 100 } matches 10ms-99ms.
   * Events without durationMs field will NOT match.
   */
  maxDurationMs?: number;
  /**
   * Match success status (true = successful operations, false = failed operations).
   * Example: success: true matches all successful spans/operations.
   * Events without success field will NOT match.
   */
  success?: boolean;
}

export interface NoiseRule {
  id: string;
  match: NoiseRuleMatch;
  decision: NoiseDecision;
  reason?: string;
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

  // === CAPTURE CONTROL (optional) ===
  /** 
   * Capture control options. All capture behavior in one place.
   * 
   * @see CaptureControl for available options
   */
  capture?: CaptureControl;
}

/**
 * Input for capturing events - allows some fields to be auto-generated.
 * 
 * This is the internal type used by ObservabilityCore.record().
 * Observers build this from their specific options.
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

  /** Capture control - all capture behavior in one place */
  capture?: CaptureControl;
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
  /** Compression configuration for large payloads */
  compression?: {
    /** Enable compression (default: false) */
    enabled: boolean;
    /** Minimum size in bytes before compression is applied (default: 10KB) */
    threshold: number;
    /** Fields to compress if they exceed threshold (default: all) */
    fields: Array<'data' | 'attributes' | 'metadata' | 'context'>;
  };
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
 * Span-specific configuration defaults.
 * These apply to ALL spans unless overridden via CaptureControl.
 */
export interface SpanConfig {
  /**
   * Minimum duration (ms) to capture a span.
   * Spans faster than this are skipped UNLESS they have errors.
   * Set to 0 to capture all spans regardless of duration.
   * Default: 50
   */
  minDurationMs: number;

  /**
   * Skip spans that have no events and no errors.
   * "Empty" spans add noise without value.
   * Default: true
   */
  skipEmpty: boolean;
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

  /**
   * Optional capture timeout in milliseconds.
   * If set, capture operations exceeding this timeout will be logged as warnings.
   * Default: undefined (no timeout - suitable for Lambda's fast execution)
   * 
   * Only set this if you need extra safety for long-running operations.
   */
  captureTimeout?: number;

  /** CloudWatch configuration */
  cloudwatch: CloudWatchConfig;

  /** DynamoDB configuration */
  dynamodb: DynamoDBConfig;

  /** Data protection configuration */
  dataProtection: ObservabilityDataProtectionConfig;

  /** Source map support for better error stack traces */
  sourceMap: {
    /** Enable source-map-support module (requires source-map-support package installed) */
    enabled: boolean;
  };

  /**
   * Span-specific defaults.
   * Control which spans are captured and how.
   */
  spans: SpanConfig;

  /**
   * Noise reduction configuration (merge/drop/aggregate).
   */
  noiseReduction: NoiseReductionConfig;

  /**
   * Operation normalization / renaming.
   * Purpose: reduce cardinality and make traces consistent across backends.
   *
   * Applied to `event.operation` before export (and for OTEL span names).
   */
  operationNormalization: {
    enabled: boolean;
    /** Rules evaluated in-order (first match wins). match supports regex-string like `/^SQS Batch .+/` */
    rules: Array<{
      id: string;
      match: string;
      replace: string;
      reason?: string;
      /** Limit to specific event types (optional) */
      types?: ObservabilityEventType[] | ObservabilityEventType;
    }>;
    /** When true, store original operation + applied rules in event.data.operationNormalization (default: true) */
    storeOriginal?: boolean;
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// RECORD OVERRIDES - What observers can override
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fields that can be overridden when calling observers.
 * 
 * All fields are optional - observers use context values by default.
 * Only specify fields you want to override.
 * 
 * Pattern: Observer-specific options + RecordOverrides = full options
 * 
 * @example
 * ```typescript
 * interface SpanOptions extends RecordOverrides {
 *   level?: ObservabilityLevelString;
 *   attributes?: Record<string, unknown>;
 * }
 * ```
 */
export type RecordOverrides = Partial<Pick<CaptureInput,
  | 'capture'
  | 'correlationId'
  | 'causedBy'
  | 'relatedTraces'
  | 'actor'
  | 'source'
  | 'tags'
  | 'metadata'
  | 'parentObservabilityLogId'
>>;

/**
 * Context overrides for withContext().
 * 
 * All fields optional - only override what you need.
 * Tags are merged with existing by default.
 * 
 * @example
 * ```typescript
 * // Override actor for system operations
 * withContext({ actor: systemActor }, () => {
 *   AuditObserver.entityDelete('User', userId, data);
 * });
 * 
 * // Add batch tags
 * await withContext({ tags: { batchId: 'batch-123' } }, async () => {
 *   for (const item of items) {
 *     await processItem(item);
 *   }
 * });
 * 
 * // Override source for a scope
 * withContext({ source: 'WorkflowEngine' }, () => {
 *   // All logs/spans in here will have source='WorkflowEngine'
 * });
 * ```
 */
export interface ContextOverrides {
  /** Override correlation ID */
  correlationId?: string;
  /** Override causation chain */
  causedBy?: string;
  /** Override actor */
  actor?: Actor;
  /** Override source */
  source?: string;
  /** Merge additional tags (adds to existing, doesn't replace) */
  tags?: Record<string, string>;
  /** Replace tags entirely instead of merging */
  replaceTags?: Record<string, string>;
  /** Add metadata to all events in this scope */
  metadata?: Record<string, unknown>;
}

/**
 * Interface for event capture - enables testability via dependency injection
 * 
 * Observers use this interface instead of importing ObservabilityManager directly,
 * allowing easy mocking in tests.
 * 
 * Note: CaptureControl is embedded in CaptureInput.capture - no separate options param.
 */
export interface IEventCapture {
  /**
   * Capture an observability event (fire-and-forget)
   * @param input - Event input with capture control embedded in input.capture
   * @returns observabilityLogId if captured, undefined if filtered/sampled out
   */
  capture(input: CaptureInput): string | undefined;

  /**
   * Capture an observability event asynchronously
   * Use when you need to await backend completion
   * @param input - Event input with capture control embedded in input.capture
   * @returns Promise<observabilityLogId> if captured, undefined if filtered/sampled out
   */
  captureAsync(input: CaptureInput): Promise<string | undefined>;
}
