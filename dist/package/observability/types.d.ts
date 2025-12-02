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
export declare enum ObservabilityLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    CRITICAL = 5,
    OFF = 99
}
/**
 * String representation of observability levels
 */
export type ObservabilityLevelString = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
/**
 * Base event types supported by the framework
 */
export type BaseEventType = 'span.start' | 'span.event' | 'span.end' | 'log' | 'metric' | 'audit' | 'audit.entity' | 'audit.access' | 'audit.compliance' | 'workflow.start' | 'workflow.step' | 'workflow.end' | 'decision' | 'decision.rule' | 'decision.algorithm' | 'decision.feature_flag' | 'decision.ab_test' | 'access.request' | 'access.response';
/**
 * All supported event types (base + custom)
 */
export type ObservabilityEventType = BaseEventType | `custom.${string}`;
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
    /** Event type - determines routing and handling */
    type: ObservabilityEventType;
    /** Severity level */
    level: ObservabilityLevelString;
    /** Correlation ID for distributed tracing - MUST be propagated from context */
    correlationId: string;
    /** Timestamp in milliseconds */
    timestampMs: number;
    /** Unique ID for this log entry */
    logId: string;
    /** Parent log ID for hierarchical relationships */
    parentLogId?: string;
    /** Entity type being observed (user, order, span, workflow) */
    entityName?: string;
    /** Specific entity instance ID */
    entityId?: string;
    /** What action is being performed */
    operation?: string;
    /** More specific classification of the event */
    subType?: string;
    /** Current status (pending, completed, failed, etc.) */
    status?: string;
    /** Operation outcome */
    success?: boolean;
    /** Duration in milliseconds */
    durationMs?: number;
    /** Who/what is performing the action */
    actor?: Actor;
    /** Source identifier (lambda:name, controller:Class.method) */
    source?: string;
    /** Key-value tags for filtering */
    tags?: Record<string, string>;
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
    /** Error details if applicable */
    error?: ObservabilityError;
}
/**
 * Input for capturing events - allows some fields to be auto-generated
 */
export interface CaptureInput {
    type: ObservabilityEventType;
    level: ObservabilityLevelString;
    correlationId: string;
    logId?: string;
    timestampMs?: number;
    parentLogId?: string;
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
    tableName?: string;
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
 * Backend configuration - discriminated union for type-safe config
 */
export type ObservabilityBackendConfig = {
    type: 'cloudwatch';
    enabled: boolean;
    minLevel?: ObservabilityLevel;
    config?: CloudWatchBackendOptions;
} | {
    type: 'dynamodb';
    enabled: boolean;
    minLevel?: ObservabilityLevel;
    config?: DynamoDBBackendOptions;
} | {
    type: 'otel';
    enabled: boolean;
    minLevel?: ObservabilityLevel;
    config?: OTELBackendOptions;
};
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
    rates: Record<ObservabilityLevel, number>;
    operations?: Record<string, number>;
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
    tableName: string;
    ttlDays: number;
}
/**
 * Main observability configuration
 *
 * ALL fields are REQUIRED - no optional fields with fallbacks.
 * ConfigManager.fromEnvironment() provides defaults from env vars.
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
    /** Type-specific overrides */
    types?: {
        span?: TypeSpecificConfig;
        metric?: TypeSpecificConfig;
        audit?: TypeSpecificConfig;
        log?: TypeSpecificConfig;
        decision?: TypeSpecificConfig;
        workflow?: TypeSpecificConfig;
        access?: TypeSpecificConfig;
    };
    /** Service name (used by CloudWatch, OTEL) */
    serviceName: string;
    /** CloudWatch configuration */
    cloudwatch: CloudWatchConfig;
    /** DynamoDB configuration */
    dynamodb: DynamoDBConfig;
}
/**
 * Default sampling configuration - all levels at 100%
 */
export declare const DefaultSamplingConfig: SamplingConfig;
/**
 * Observation context for automatic context propagation
 * Used with AsyncLocalStorage for automatic injection into all observations
 *
 * correlationId is REQUIRED - must be set when context is created
 */
export interface ObservationContext {
    /** Correlation ID for distributed tracing - REQUIRED */
    correlationId: string;
    /** Parent log ID for hierarchical relationships */
    parentLogId?: string;
    /** Actor from ExecutionContext */
    actor?: Actor;
    /** Additional tags to propagate */
    tags?: Record<string, string>;
    /** Source identifier */
    source?: string;
    /** Tenant ID (from Actor) */
    tenantId?: string;
    /** Session ID (from Actor) */
    sessionId?: string;
    /**
     * Whether this trace is sampled (for propagation headers).
     * Extracted from incoming trace headers, used when creating outgoing headers.
     * Defaults to true if not specified.
     */
    sampled?: boolean;
}
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
     * @returns logId if captured, undefined if filtered/sampled out
     */
    capture(input: CaptureInput, options?: CaptureOptions): string | undefined;
    /**
     * Capture an observability event asynchronously
     * Use when you need to await backend completion
     * @returns Promise<logId> if captured, undefined if filtered/sampled out
     */
    captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined>;
}
