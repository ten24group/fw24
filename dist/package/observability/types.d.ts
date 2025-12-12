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
    /** Unique ID for this observability log entry */
    observabilityLogId: string;
    /** Parent observability log ID for hierarchical relationships */
    parentObservabilityLogId?: string | null;
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
    observabilityLogId?: string;
    timestampMs?: number;
    parentObservabilityLogId?: string | null;
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
    /** Sampling rates by level name (0-1). Missing levels default to 1.0 (100%) */
    rates?: Partial<Record<ObservabilityLevelString, number>>;
    /** Sampling rates by operation pattern */
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
export declare const DefaultSamplingConfig: SamplingConfig;
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
