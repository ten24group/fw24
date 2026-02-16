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
 * SpanObserver.start('operation');  // Creates span (lifecycle hooks notify OTEL directly)
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
   * This gives developers *local control* (per @Observed decorator or per log entry) to override
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
 * Noise reduction decision (v2: three-decision model).
 * 
 * - emit:   Persist as a standalone DynamoDB record (full event preserved)
 * - absorb: Do not persist as standalone; merge structured data into nearest emitted ancestor
 * - silent: Do not persist; only increment a counter on nearest emitted ancestor
 * 
 * This replaces the previous 5-decision model (keep/drop/fold/aggregate/downgrade).
 * The three decisions map cleanly to what happens with data:
 * - emit   = full record in DynamoDB (was: keep)
 * - absorb = structured info in parent's data.absorbed (was: fold + aggregate)
 * - silent = counter only (was: drop)
 */
export type NoiseDecision = 'emit' | 'absorb' | 'silent';

/**
 * Per-event noise control override.
 * 
 * Allows code to explicitly control how an event is handled by noise reduction,
 * bypassing all rules and hard signal logic.
 */
export interface NoiseControl {
  /** Override decision for this event (emit/absorb/silent) */
  decision: NoiseDecision;
  /** Optional reason for audits/debugging */
  reason?: string;
}

export type NoiseReductionPreset =
  | 'fw24.hotpaths'          // safe defaults for stream processors, audit logger, search sync, batch processors
  | 'fw24.batch_processors'; // aggressively reduce per-record noise

/**
 * Hard signal detection configuration.
 * Hard signals are events that must always be preserved and trigger context preservation.
 */
export interface HardSignalConfig {
  /** Which log levels are considered hard signals. Default: ['error', 'critical'] */
  levels?: ObservabilityLevelString[];

  /** Treat WARN level as hard signal (opt-in). Default: false */
  includeWarn?: boolean;

  /** Global slow operation threshold (ms). Default: 5000 */
  slowThresholdMs?: number;

  /** Per-type slow thresholds (overrides global). Key = event type, value = threshold in ms */
  slowThresholds?: Record<string, number>;
}

/**
 * Noise reduction configuration (v2: three-decision model).
 *
 * This layer is orthogonal to sampling:
 * - Sampling decides *whether* to store based on cost
 * - Noise reduction decides *how* to represent data (emit vs absorb vs silent)
 * 
 * Rule evaluation:
 * 1. Per-event override (CaptureControl.noise) takes absolute precedence
 * 2. Hard signals (errors/failures/slow) default to emit unless explicitly overridden
 * 3. All matching rules are collected (custom + builtin), exceptions evaluated
 * 4. Rule with highest effective priority wins
 * 5. No matching rule → emit (safe default)
 */
/**
 * Convenience preset level for noise reduction.
 * - `'off'`: disabled entirely (default)
 * - `'recommended'`: enabled with sane FW24 defaults
 * - `'aggressive'`: enabled with tighter thresholds and lower absorption bounds
 */
export type NoiseReductionPresetLevel = 'off' | 'recommended' | 'aggressive';

export interface NoiseReductionConfig {
  enabled: boolean;

  /**
   * Convenience preset level. When set, auto-configures `enabled`, thresholds,
   * and absorption bounds. Explicit field overrides still take precedence.
   */
  preset?: NoiseReductionPresetLevel;

  /** 
   * When true, attach noise reduction decision metadata (ruleId, reason, decision) 
   * to emitted events as data._noiseDebug. Useful for understanding why events were kept/dropped.
   */
  debug?: boolean;

  /** Hard signal detection configuration */
  hardSignals?: HardSignalConfig;

  /** Built-in preset(s) with sane defaults for hot paths */
  presets: NoiseReductionPreset[];

  /** 
   * Custom rules with priority-based evaluation.
   * When multiple rules match, highest priority wins.
   */
  rules: NoiseRule[];

  // ─────────────────────────────────────────────────────────────────────────
  // Absorption bounds (prevent unbounded growth of absorbed data on parents)
  // ─────────────────────────────────────────────────────────────────────────

  /** Maximum error entries in data.absorbed.errors per emitted event (default: 20) */
  maxAbsorbedErrorsPerSpan: number;

  /** Maximum causedBy links in data.absorbed.causedByLinks per emitted event (default: 50) */
  maxAbsorbedCausedByLinksPerSpan: number;

  /** Maximum entity IDs in data.absorbed.entityIds per emitted event (default: 100) */
  maxAbsorbedEntityIdsPerSpan: number;

  /** Maximum distinct operation keys in data.absorbed.byOperation per emitted event (default: 50) */
  maxAbsorbedOperationKeysPerSpan: number;

  /** Maximum checkpoint entries converted to data.checkpoints per emitted event (default: 100) */
  maxAbsorbedCheckpointsPerSpan: number;
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
   * Example: minDurationMs: 100 matches spans with 100ms or longer duration.
   * Events without durationMs field will NOT match.
   */
  minDurationMs?: number;
  /**
   * Match maximum durationMs threshold (matches events where durationMs < this value).
   * Example: maxDurationMs: 50 matches spans under 50ms.
   * Combine with minDurationMs for range matching: { minDurationMs: 10, maxDurationMs: 100 } matches 10ms-99ms.
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

/**
 * Noise reduction rule with priority-based evaluation.
 * 
 * When multiple rules match an event, the rule with the highest effective priority wins.
 * Effective priority = explicit priority OR decision's base priority.
 * 
 * Decision base priorities (from highest to lowest):
 * - emit:   100 (always emit, hard to override)
 * - absorb:  50 (merge into parent)
 * - silent:  10 (drop entirely, easy to override)
 */
export interface NoiseRule {
  /** Unique identifier for this rule */
  readonly id: string;

  /** Conditions that must match for this rule to apply */
  readonly match: NoiseRuleMatch;

  /** The noise reduction action: emit, absorb, or silent */
  readonly decision: NoiseDecision;

  /** 
   * Explicit priority for this rule (overrides decision's base priority).
   * Higher priority wins when multiple rules match.
   * Range: 1-1000 (recommended: use multiples of 10)
   */
  readonly priority?: number;

  /**
   * Exception conditions - rule does NOT apply if any exception matches.
   * Evaluated AFTER the main match succeeds.
   * Use for "silent X except when Y" patterns.
   */
  readonly except?: readonly NoiseRuleMatch[];

  /** Human-readable reason for this rule (for debugging) */
  readonly reason?: string;
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

  /** 
   * Deterministic error fingerprint for grouping same errors across invocations.
   * 
   * Auto-computed from error.type + normalized message + stack when an error is present.
   * Uses SHA-256 (first 16 hex chars) with UUIDs, timestamps, and numeric IDs normalized out.
   */
  fingerprint?: string;

  // === NOISE REDUCTION (set by noise reduction algorithm, not by callers) ===
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

// ═══════════════════════════════════════════════════════════════════════════
// SPAN LIFECYCLE HOOKS (for OTEL and other real-time span backends)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Information provided when a span starts.
 * This is a minimal snapshot - full event data is only available at span end.
 */
export interface SpanStartInfo {
  /** Unique observability log ID for this span */
  readonly id: string;
  /** Operation name (e.g., 'HTTP GET /api/users', 'OrderService.create') */
  readonly operation: string;
  /** Parent span's observability log ID (undefined for root spans) */
  readonly parentId: string | undefined;
  /** Correlation ID for distributed tracing */
  readonly correlationId: string;
  /** Cross-hop causedBy link (upstream correlation ID) */
  readonly causedBy: string | undefined;
  /** Source identifier (e.g., 'controller:OrderController.create') */
  readonly source: string | undefined;
  /** Sub-type hint for span kind (e.g., 'http', 'db', 'queue') */
  readonly subType: string | undefined;
  /** Tags at span start (may be enriched by the time span ends) */
  readonly tags: Readonly<Record<string, string>> | undefined;
  /** Start timestamp in epoch milliseconds */
  readonly startTimeMs: number;
}

/**
 * Information provided when a span ends.
 * Contains the full context accumulated during the span's lifetime.
 */
export interface SpanEndInfo {
  /** Unique observability log ID for this span */
  readonly id: string;
  /** Operation name */
  readonly operation: string;
  /** Whether the span completed successfully */
  readonly success: boolean;
  /** Duration in milliseconds */
  readonly durationMs: number;
  /** Start timestamp in epoch milliseconds */
  readonly startTimeMs: number;
  /** Parent span's observability log ID (undefined for root spans) */
  readonly parentId: string | undefined;
  /** Correlation ID for distributed tracing */
  readonly correlationId: string;
  /** Cross-hop causedBy link (upstream correlation ID) */
  readonly causedBy: string | undefined;
  /** Source identifier (e.g., 'controller:OrderController.create') */
  readonly source: string | undefined;
  /** Sub-type hint for span kind (e.g., 'http', 'db', 'queue') */
  readonly subType: string | undefined;
  /** Error details if the span failed */
  readonly error: ObservabilityError | undefined;
  /** Tags accumulated during span lifetime */
  readonly tags: Readonly<Record<string, string>> | undefined;
  /** Metrics accumulated during span lifetime */
  readonly metrics: Readonly<Record<string, number>> | undefined;
  /** Data payload accumulated during span lifetime */
  readonly data: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Lifecycle hook for backends that need real-time span start/end notifications.
 * 
 * This interface decouples backends (like OTEL) from the buffered capture pipeline.
 * Instead of receiving span.start events through capture(), backends implementing
 * this interface receive direct, typed notifications from SpanObserver.
 * 
 * Implementations MUST be fast and non-blocking - these are called synchronously
 * from the application's hot path.
 */
export interface SpanLifecycleHook {
  /** Called synchronously when a span starts */
  onSpanStart(info: SpanStartInfo): void;
  /** Called synchronously when a span ends (success or failure) */
  onSpanEnd(info: SpanEndInfo): void;
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
/**
 * Tag filtering configuration (framework-level).
 * 
 * Controls which tags are included on ObservabilityEvents before they reach backends.
 * This affects ALL backends (CloudWatch, DynamoDB, Console, etc.).
 * 
 * Why filter tags?
 * - CloudWatch: Each unique tag combination creates a metric stream = cost
 * - DynamoDB: Reduces storage size
 * - All backends: Cleaner, more focused telemetry
 * 
 * If omitted, defaults to: stage, tenantId, operationCategory (balanced)
 */
export interface TagFilteringConfig {
  /**
   * Framework tags to include on events.
   * Tags not in this list are excluded (except custom tags).
   * 
   * Available framework tags:
   * - stage: Environment (dev/staging/prod)
   * - tenantId: Multi-tenant ID
   * - operationCategory: read/write/delete
   * - authMethod: cognito/apikey/iam
   * - actorType: user/service
   * - handlerType: controller/queue/task
   * - entityName: HIGH CARDINALITY
   * - operation: VERY HIGH CARDINALITY
   * 
   * @example
   * ```typescript
   * // Minimal
   * include: ['stage', 'tenantId']
   * 
   * // Balanced (default)
   * include: ['stage', 'tenantId', 'operationCategory']
   * 
   * // Comprehensive
   * include: ['stage', 'tenantId', 'operationCategory', 'authMethod', 'actorType', 'handlerType']
   * ```
   */
  include?: string[];

  /**
   * Custom tags to always add (e.g., from env vars).
   * These are added AFTER framework tag filtering.
   * 
   * @example
   * ```typescript
   * custom: {
   *   region: () => process.env.AWS_REGION!,
   *   version: () => process.env.APP_VERSION || 'unknown',
   * }
   * ```
   */
  custom?: Record<string, (event: ObservabilityEvent) => string>;

  /**
   * Maximum total tags per event.
   * Default: 10
   */
  maxTags?: number;
}

/**
 * Operation-specific metric filtering rule.
 * Allows different metric rules per operation (e.g., payments vs health checks).
 */
export interface OperationMetricRule {
  /**
   * Operation pattern to match.
   * Supports exact match, wildcards (*), and regex.
   * 
   * @example
   * ```typescript
   * operation: '/api/payment/*'        // All payment endpoints
   * operation: '/api/health'           // Exact match
   * operation: '/^HTTP (GET|HEAD)/'    // Regex
   * ```
   */
  operation: string | RegExp;

  /**
   * Whitelist: ONLY these metrics are published for matching operations.
   * Supports exact names and glob patterns.
   * 
   * @example
   * ```typescript
   * whitelist: ['duration', 'error_count', 'payment.amount']
   * whitelist: []  // No metrics (e.g., for health checks)
   * ```
   */
  whitelist?: string[];

  /**
   * Blacklist: All metrics EXCEPT these are published for matching operations.
   * Supports exact names and glob patterns.
   */
  blacklist?: string[];

  /**
   * Pattern matching for this operation.
   * More flexible than whitelist/blacklist.
   */
  patterns?: {
    /** Patterns to include (OR logic) */
    include?: RegExp[];
    /** Patterns to exclude (AND NOT logic) */
    exclude?: RegExp[];
  };
}

/**
 * Metric filtering configuration.
 * 
 * Control which metrics are published to CloudWatch.
 * Use this to reduce costs by only publishing important metrics.
 * 
 * Supports both global rules and operation-specific rules.
 */
export interface MetricFilteringConfig {
  /** Enable metric filtering (default: false = publish all) */
  enabled?: boolean;

  /** Filtering mode */
  mode?: 'whitelist' | 'blacklist';

  /**
   * Whitelist mode: ONLY these metrics are published.
   * Supports exact names and glob patterns.
   * 
   * Used as fallback when no operation-specific rule matches.
   * 
   * @example
   * ```typescript
   * whitelist: [
   *   'duration',           // Exact match
   *   'error_count',        // Exact match
   *   'db.*',              // All db metrics
   *   'cache.hit_rate',    // Exact match
   *   '*.duration',        // All duration metrics
   * ]
   * ```
   */
  whitelist?: string[];

  /**
   * Blacklist mode: All metrics EXCEPT these are published.
   * Supports exact names and glob patterns.
   * 
   * Used as fallback when no operation-specific rule matches.
   * 
   * @example
   * ```typescript
   * blacklist: [
   *   'temp.*',            // No temp metrics
   *   'debug.*',           // No debug metrics
   *   'resultCount',       // No result count
   * ]
   * ```
   */
  blacklist?: string[];

  /**
   * Pattern matching for advanced filtering.
   * More flexible than whitelist/blacklist.
   * 
   * Used as fallback when no operation-specific rule matches.
   */
  patterns?: {
    /** Patterns to include (OR logic) */
    include?: RegExp[];
    /** Patterns to exclude (AND NOT logic) */
    exclude?: RegExp[];
  };

  /**
   * Operation-specific metric rules.
   * 
   * Rules are evaluated in order. First match wins.
   * If no rule matches, falls back to global whitelist/blacklist/patterns.
   * 
   * **Use Cases:**
   * - Health checks: Publish no metrics (reduce noise)
   * - Payment endpoints: Publish only critical metrics
   * - Admin endpoints: Publish all metrics (high visibility)
   * 
   * @example
   * ```typescript
   * operationRules: [
   *   {
   *     operation: '/api/health',
   *     whitelist: [],  // No metrics for health checks
   *   },
   *   {
   *     operation: '/api/payment/*',
   *     whitelist: ['duration', 'error_count', 'payment.amount', 'payment.status'],
   *   },
   *   {
   *     operation: '/api/admin/*',
   *     blacklist: [],  // All metrics for admin (high visibility)
   *   },
   * ],
   * // Fallback for all other operations:
   * whitelist: ['duration', 'error_count', 'request_count'],
   * ```
   */
  operationRules?: OperationMetricRule[];
}

/**
 * Metric sampling configuration.
 * 
 * Sample routine operations to reduce CloudWatch costs while preserving
 * visibility into errors and performance issues.
 * 
 * **Strategy:**
 * - Always publish: errors, slow operations (critical signals)
 * - Sample: fast, successful operations (routine traffic)
 * - Aggregate: batch operations (queue processing)
 */
export interface MetricSamplingConfig {
  /** Enable metric sampling (default: false) */
  enabled?: boolean;

  /**
   * Base sample rate for routine operations (0-1).
   * Default: 0.1 (10% of routine requests)
   * 
   * @example
   * - 0.1 = 10% (90% cost reduction on routine traffic)
   * - 0.01 = 1% (99% cost reduction on routine traffic)
   * - 1.0 = 100% (no sampling)
   */
  rate?: number;

  /**
   * Always publish metrics when these conditions are met (bypass sampling).
   * - 'error': Always publish on errors
   * - 'slow': Always publish on slow operations  
   * - 'both': Always publish on errors OR slow operations
   * Default: 'both'
   */
  alwaysPublishOn?: 'error' | 'slow' | 'both';

  /**
   * Thresholds for "always publish" conditions.
   */
  thresholds?: {
    /**
     * Minimum duration (ms) to always publish.
     * Operations faster than this are subject to sampling.
     * Default: 1000 (1 second)
     */
    slowDurationMs?: number;
  };

  /**
   * Operations to never sample (always publish).
   * Supports glob patterns.
   * 
   * @example
   * ```typescript
   * neverSample: [
   *   'payment.*',         // All payment operations
   *   'order.create',      // Specific operation
   *   '*.checkout',        // All checkout operations
   * ]
   * ```
   */
  neverSample?: string[];

  /**
   * Operations to always sample (never publish unless error/slow).
   * Useful for very high-volume, low-value operations.
   * 
   * @example
   * ```typescript
   * alwaysSample: [
   *   'healthcheck',       // Health checks
   *   'metrics.export',    // Metrics exports
   *   'heartbeat',         // Heartbeats
   * ]
   * ```
   */
  alwaysSample?: string[];
}

/**
 * CloudWatch namespace strategy.
 * Controls how metric namespaces are determined for each event.
 * 
 * **Why separate namespaces?**
 * - Organize metrics by source (API, Queue, Task, Service)
 * - Easier CloudWatch dashboard filtering
 * - Separate alarms per source type
 * - Better cost allocation per workload
 * 
 * @example
 * ```typescript
 * // Single namespace (default):
 * namespaceStrategy: 'single'
 * // Result: All metrics in 'FW24'
 * 
 * // Per-handler type:
 * namespaceStrategy: 'per-type'
 * // Result: 'FW24/API', 'FW24/Queue', 'FW24/Task'
 * 
 * // Per-source:
 * namespaceStrategy: 'per-source'
 * // Result: 'FW24/UserController', 'FW24/OrderService', etc.
 * 
 * // Custom function:
 * namespaceStrategy: (event) => {
 *   if (event.operation?.includes('payment')) return 'FW24/Payment';
 *   if (event.tags?.critical) return 'FW24/Critical';
 *   return 'FW24';
 * }
 * ```
 */
export type NamespaceStrategy =
  | 'single'      // All metrics in base namespace (e.g., 'FW24')
  | 'per-type'    // Namespace per handler type (e.g., 'FW24/API', 'FW24/Queue')
  | 'per-source'  // Namespace per source (e.g., 'FW24/UserController')
  | ((event: ObservabilityEvent) => string);  // Custom function

export interface CloudWatchConfig {
  /**
   * Base namespace for CloudWatch metrics.
   * Default: 'FW24'
   * 
   * This is used as:
   * - The full namespace if `namespaceStrategy: 'single'`
   * - The prefix if `namespaceStrategy: 'per-type'` or `'per-source'`
   * - Fallback for custom functions
   */
  namespace: string;

  /**
   * Namespace strategy - controls how namespaces are determined.
   * 
   * Default: 'single' (all metrics in base namespace)
   * 
   * **Options:**
   * - `'single'`: All metrics in base namespace (e.g., 'FW24')
   * - `'per-type'`: Namespace per handler type (e.g., 'FW24/API', 'FW24/Queue', 'FW24/Task')
   * - `'per-source'`: Namespace per source (e.g., 'FW24/UserController', 'FW24/OrderService')
   * - Custom function: `(event) => string` for full control
   * 
   * @example
   * ```typescript
   * // Single namespace (default, simplest)
   * namespaceStrategy: 'single'
   * 
   * // Per-handler type (good for multi-workload apps)
   * namespaceStrategy: 'per-type'
   * 
   * // Custom (advanced use cases)
   * namespaceStrategy: (event) => {
   *   if (event.tags?.tenantId) return `FW24/Tenant/${event.tags.tenantId}`;
   *   return 'FW24';
   * }
   * ```
   */
  namespaceStrategy?: NamespaceStrategy;

  /**
   * Metric filtering configuration (Phase 2 optimization).
   * Controls which metrics are published to CloudWatch.
   * Default: disabled (publish all)
   */
  metricFiltering?: MetricFilteringConfig;

  /**
   * Metric sampling configuration (Phase 2 optimization).
   * Sample routine operations while always capturing errors/slow requests.
   * Default: disabled (no sampling)
   */
  metricSampling?: MetricSamplingConfig;
}

/**
 * Truncation configuration for observability payloads.
 * 
 * **Use when:** Emergency lossy fallback if entity compression isn't sufficient.
 * **Trade-off:** Loses data permanently (not recoverable).
 * 
 * Creates format: `{ _truncated: true, _preview: string, _originalSize: number }`
 * 
 * **Note:** Entity schema handles compression automatically via `compressed: true`.
 * Truncation is ONLY for rare cases where compressed data still exceeds limits.
 */
export interface TruncationConfig {
  /** Enable truncation (default: false) */
  enabled: boolean;
  /** Maximum bytes per field (default: 350KB) */
  maxBytes: number;
  /** Fields to truncate */
  fields: ReadonlyArray<'actor' | 'data' | 'attributes' | 'metadata' | 'context'>;
}

/**
 * DynamoDB backend configuration.
 * 
 * **Data Flow:**
 * 1. Events buffered in memory during invocation
 * 2. On flush: deduplication, optional truncation
 * 3. Entity service auto-compresses fields marked `compressed: true` in schema
 * 4. Batch write to DynamoDB with TTL
 * 5. UI queries & auto-decompresses
 * 
 * **Size Management:**
 * - **Primary:** Entity schema compression (automatic, lossless, UI-decompressible)
 * - **Fallback:** Optional truncation (lossy, rarely needed)
 */
export interface DynamoDBConfig {
  /** Logical table key - resolved to actual table name via env var {tableKey}_table */
  tableKey: string;
  ttlDays: number;

  /** Truncation (optional - emergency lossy fallback, rarely needed) */
  truncation?: TruncationConfig;

  /** Maximum item size in bytes (default: 400KB - DynamoDB limit) */
  maxItemSize?: number;

  /** Batch write size (default: 25 - DynamoDB BatchWriteItem limit) */
  maxBatchSize?: number;

  /** Maximum buffer size before forcing flush (default: 1000) */
  maxBufferSize?: number;
}

/**
 * Data protection configuration for observability events.
 * 
 * Uses @hackylabs/deep-redact library for redaction.
 * Redacts sensitive data (passwords, tokens, PII) from observability payloads.
 */
export interface DataProtectionConfig {
  /** Enable/disable data protection (default: true) */
  enabled?: boolean;
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

  /**
   * Tag spans slower than this (ms) with `_slow=true` for easy filtering.
   * Disabled by default (undefined = no slow tagging).
   */
  slowTagThresholdMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY QUERY PERFORMANCE TRACKING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query operation types for CRUD operations.
 * Maps to ElectroDB operations.
 */
export type QueryOperation = 'get' | 'batchGet' | 'list' | 'query' | 'create' | 'update' | 'upsert' | 'delete' | 'batchDelete' | 'scan';

/**
 * Per-entity query timing configuration override.
 * Allows customizing thresholds and sampling for specific entities.
 */
export interface EntityQueryTimingOverride {
  /** Entity name to override */
  entityName: string;
  /** Override slow threshold for this entity (ms). Falls back to default if not set. */
  slowThreshold?: number;
  /** Override sampling rate for this entity (0-1). Falls back to default if not set. */
  sampleRate?: number;
}

/**
 * Per-operation timing configuration.
 * Different operations have different expected latencies.
 */
export interface OperationTimingConfig {
  /** Operation type */
  operation: QueryOperation;
  /** Slow threshold for this operation (ms) */
  slowThreshold: number;
}

/**
 * Database query performance tracking configuration.
 * Tracks query timing, detects slow queries, and captures context.
 * 
 * Features:
 * - Configurable slow query thresholds (global, per-operation, per-entity)
 * - Smart sampling (fast vs slow queries)
 * - Automatic checkpoint to spans
 * - Conditional logging (slow queries, scans, errors)
 * - Entity inclusion/exclusion lists
 * - Query detail capture (filters, pagination) for debugging
 * 
 * @example
 * ```typescript
 * queryPerformance: {
 *   enabled: true,
 *   slowThreshold: 1000, // 1 second
 *   fastQuerySampleRate: 0.01, // 1% of fast queries
 *   slowQuerySampleRate: 1.0, // 100% of slow queries
 *   excludeEntities: ['AnalyticsEvent', 'AuditLog'], // High volume
 *   alwaysTrackEntities: ['Order', 'Payment'], // Critical
 *   operationThresholds: [
 *     { operation: 'get', slowThreshold: 500 }, // Single item should be fast
 *     { operation: 'scan', slowThreshold: 3000 }, // Full scan naturally slower
 *   ]
 * }
 * ```
 */
export interface QueryPerformanceConfig {
  /** Enable query performance tracking. Default: true */
  enabled: boolean;

  /**
   * Default slow query threshold (ms).
   * Queries slower than this are logged at WARN level.
   * Default: 1000ms
   */
  slowThreshold: number;

  /**
   * Sample rate for fast queries (0-1).
   * 0 = never log fast queries, 1 = always log.
   * Used to gather baseline metrics without flooding logs.
   * Default: 0.01 (1%)
   */
  fastQuerySampleRate: number;

  /**
   * Sample rate for slow queries (0-1).
   * Even slow queries can be sampled to reduce log volume.
   * Default: 1.0 (100% - always log slow queries)
   */
  slowQuerySampleRate: number;

  /**
   * Per-operation thresholds.
   * Overrides default slowThreshold for specific operations.
   * 
   * Example: Scans are naturally slower, set higher threshold.
   * Default: Operation-specific thresholds (get:500ms, scan:3000ms, etc.)
   */
  operationThresholds?: OperationTimingConfig[];

  /**
   * Per-entity overrides.
   * Customize threshold and sampling for specific entities.
   * 
   * Example: Analytics entities have high volume, reduce sampling.
   */
  entityOverrides?: EntityQueryTimingOverride[];

  /**
   * Entities to exclude from tracking entirely.
   * Use for extremely high-volume entities.
   */
  excludeEntities?: string[];

  /**
   * Always track these entities regardless of sampling.
   * Use for critical entities (Order, Payment, etc.)
   */
  alwaysTrackEntities?: string[];

  /**
   * Capture query details (filters, pagination) for slow queries.
   * Disable in production if PII concerns exist.
   * Default: true
   */
  captureSlowQueryDetails: boolean;

  /**
   * Track consumed capacity (RCU/WCU) from DynamoDB responses.
   * When enabled, `QueryObserver.getCapacityGoOptions()` returns extra `.go()` params
   * that request `ReturnConsumedCapacity: 'TOTAL'` and capture the result via an ElectroDB listener.
   * Callers must spread these options into their `.go()` call for capacity to be captured.
   * Default: false
   */
  trackCapacity: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// END QUERY PERFORMANCE TRACKING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

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
  dataProtection: DataProtectionConfig;

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
   * Database query performance tracking configuration.
   * Tracks query timing, detects slow queries, and captures context.
   */
  queryPerformance: QueryPerformanceConfig;

  /**
   * Noise reduction configuration (emit/absorb/silent).
   */
  noiseReduction: NoiseReductionConfig;

  /**
   * Tag filtering configuration (Phase 2 optimization).
   * Controls which tags are included on events before reaching backends.
   * Affects ALL backends (CloudWatch, DynamoDB, Console, etc.).
   * Default: ['stage', 'tenantId', 'operationCategory']
   */
  tagFiltering?: TagFilteringConfig;

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
  | 'entityName'
  | 'entityId'
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

// ═══════════════════════════════════════════════════════════════════════════
// DECORATOR OPTIONS BASE - Shared fields for all decorators
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Source type for auto-detection.
 * Used by decorators to infer the source prefix when not explicitly provided.
 */
export type SourceType = 'controller' | 'service' | 'queue' | 'task' | 'handler';

/**
 * Serialization options for captured data (args/result).
 * Allows fine-grained control over how data is serialized and truncated.
 */
export interface CaptureSerializeOptions {
  /**
   * Maximum string length for serialized output.
   * Default: 10000 (10KB)
   * Set to Infinity to disable length-based truncation.
   */
  maxLength?: number;

  /**
   * Maximum depth to traverse in nested objects/arrays.
   * Default: 10
   * Beyond this depth, objects/arrays are replaced with markers.
   */
  maxDepth?: number;

  /**
   * Prevent ALL truncation - always serialize full data.
   * Use sparingly for critical data that must be captured in full.
   * Overrides maxLength and maxDepth.
   * Default: false
   */
  preventTruncation?: boolean;
}

/**
 * Enhanced capture control for decorators.
 * Extends base CaptureControl with decorator-specific options (args/result capture).
 */
export interface DecoratorCaptureControl extends CaptureControl {
  /**
   * Capture method arguments.
   * - boolean: Enable/disable with defaults (maxLength: 10000, maxDepth: 10)
   * - CaptureSerializeOptions: Fine-grained control over serialization
   * 
   * When enabled, arguments are serialized with depth-aware truncation.
   */
  args?: boolean | CaptureSerializeOptions;

  /**
   * Capture method return value.
   * - boolean: Enable/disable with defaults (maxLength: 10000, maxDepth: 10)
   * - CaptureSerializeOptions: Fine-grained control over serialization
   * 
   * When enabled, result is serialized with depth-aware truncation.
   */
  result?: boolean | CaptureSerializeOptions;
}

/**
 * Base options shared by the @Observed decorator.
 * 
 * Extends RecordOverrides and enhances `capture` with decorator-specific options (args/result).
 * 
 * All capture control is unified under the `capture` namespace.
 * 
 * @example
 * ```typescript
 * // Basic usage - capture args and result
 * @Observed({ trace: true, capture: { args: true, result: true } })
 * async fetchData() { }
 * 
 * // Separate control for args vs result
 * @Observed({
 *   trace: true,
 *   capture: {
 *     args: { maxLength: 1000, maxDepth: 5 },  // Limit args
 *     result: { preventTruncation: true }      // Full result
 *   }
 * })
 * async processOrder(order: Order): Promise<Receipt> { }
 * 
 * // Advanced - combine sampling, noise reduction, and capture
 * @Observed({
 *   capture: {
 *     bypass: true,  // Always capture (skip sampling)
 *     args: true,
 *     result: { maxLength: 50000, maxDepth: 15 },
 *     noise: { decision: 'emit', reason: 'critical-path' }
 *   },
 *   tags: { critical: 'true' }
 * })
 * async criticalOperation() { }
 * 
 * // Group-based sampling with capture
 * @Observed({
 *   trace: true,
 *   capture: {
 *     group: { key: 'batch-123', index: i, total: 100 },
 *     args: { maxLength: 2000 },
 *     result: false
 *   }
 * })
 * async processBatchItem() { }
 * ```
 */
export interface DecoratorBaseOptions extends Omit<RecordOverrides, 'capture'> {
  /** Conditionally enable/disable decorator (evaluated at runtime) */
  enabled?: boolean | (() => boolean);

  /** 
   * Enhanced capture control with decorator-specific options.
   * Extends base CaptureControl with args/result capture capabilities.
   */
  capture?: DecoratorCaptureControl;

  /** Source type for auto-detection (controller, service, queue, task, handler) */
  sourceType?: SourceType;
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
