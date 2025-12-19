/**
 * Base utilities for observers
 *
 * Provides shared functionality to reduce code duplication across observers.
 * All observers should use these utilities instead of duplicating logic.
 *
 * TESTABILITY: Uses IEventCapture interface with setCapturer() for dependency injection.
 * In tests, call setCapturer(mockCapturer) before running observer tests.
 */
import { Actor, ExecutionContext } from '../../core/types/execution-context';
import { CaptureInput, CaptureOptions, IEventCapture, ObservabilityError } from '../types';
/**
 * Set a custom event capturer (for testing)
 */
export declare function setCapturer(capturer: IEventCapture): void;
/**
 * Reset capturer to default (for testing cleanup)
 */
export declare function resetCapturer(): void;
/**
 * Standard payload fields for observability events
 *
 * STRICT SEMANTICS - WHAT GOES WHERE:
 *
 * - `metrics`: NUMERIC values for aggregation/dashboards (counts, durations, sizes)
 *   Example: { 'api.duration': 1250, 'db.rows_processed': 500 }
 *
 * - `attributes`: SIMPLE, SEARCHABLE values for filtering/querying (IDs, names, statuses, flags)
 *   Example: { 'user.id': 'user-123', 'http.method': 'POST', 'error.type': 'ValidationError' }
 *
 * - `data`: COMPLEX objects/arrays for detailed inspection (request bodies, error details, nested structures)
 *   Example: { requestBody: {...}, errors: [...], config: {...} }
 *
 * See OBSERVABILITY_FIELD_SEMANTICS.md for complete rules and examples.
 */
export interface ObservabilityPayload {
    /**
     * Structured data for auditing/detailed inspection
     * Use for: Request/response bodies, complex objects, arrays, nested structures
     * DON'T use for: Simple values (use attributes), numeric metrics (use metrics)
     */
    data?: Record<string, unknown>;
    /**
     * Embedded metrics for CloudWatch EMF (NUMBERS ONLY)
     * Use for: Counts, durations, sizes, rates, percentages
     * DON'T use for: Strings, booleans, IDs (use attributes)
     */
    metrics?: Record<string, number>;
    /**
     * Span/trace attributes for filtering and searching
     * Use for: IDs, names, statuses, flags, simple searchable values
     * DON'T use for: Complex objects (use data), numeric metrics (use metrics)
     */
    attributes?: Record<string, unknown>;
}
/**
 * Standard options shared by all observers
 */
export interface BaseObserverOptions {
    /** Explicit correlation ID (defaults to context) */
    correlationId?: string;
    /** Correlation ID that caused this event (cross-invocation tracing) */
    causedBy?: string;
    /** All related trace IDs (for complex workflows) */
    relatedTraces?: string[];
    /** Actor performing the action */
    actor?: Actor;
    /** Source identifier */
    source?: string;
    /**
     * Tags for high-level grouping and classification (STRINGS ONLY)
     * Use for: Environment, service name, feature flags, team ownership
     * DON'T use for: Request-specific data (use attributes), metrics, detailed values
     */
    tags?: Record<string, string>;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Common fields derived from context and options
 */
export interface CommonFields {
    correlationId: string;
    causedBy?: string;
    relatedTraces?: string[];
    actor?: Actor;
    source?: string;
    tags?: Record<string, string>;
    metadata?: Record<string, unknown>;
}
/**
 * Generate a unique ID
 */
export declare function generateId(): string;
/**
 * Resolve correlation ID from explicit value or context.
 *
 * If no correlationId is available:
 * - In development (NODE_ENV !== 'production'): throws error for fast failure
 * - In production: auto-generates with warning for resilience
 */
export declare function resolveCorrelationId(observerName: string, explicitId?: string): string;
/**
 * Merge tags from context and options
 */
export declare function mergeObserverTags(contextTags?: Record<string, string>, optionTags?: Record<string, string>): Record<string, string> | undefined;
/**
 * Build common fields from context and options.
 * Always returns fields - auto-generates correlationId if needed.
 */
export declare function buildCommonFields(observerName: string, options?: BaseObserverOptions): CommonFields;
/**
 * Extract BaseObserverOptions from ExecutionContext or pass through if already options.
 *
 * When an ExecutionContext (the handler context with event/request/response) is passed,
 * extracts all observability fields from executionContext (the AsyncLocalStorage context),
 * with fallbacks for backward compatibility.
 */
export declare function extractObserverOptions(ctx?: ExecutionContext | BaseObserverOptions): BaseObserverOptions;
/**
 * Normalize an unknown caught value to an Error.
 * In JavaScript, catch blocks can receive any value, not just Error objects.
 *
 * @example
 * ```typescript
 * try {
 *   // ...
 * } catch (error) {
 *   const normalizedError = normalizeError(error);
 *   span.end({ success: false, error: normalizedError });
 * }
 * ```
 */
export declare function normalizeError(error: unknown): Error;
/**
 * Map Error to ObservabilityError format
 */
export declare function mapError(error: Error): ObservabilityError;
/**
 * Capture an event using common fields.
 * Handles all the boilerplate - observers should use this instead of calling capture directly.
 *
 * Uses getCapturer() for testability - in tests, call setCapturer(mockCapturer) first.
 */
export declare function captureEvent(fields: CommonFields, event: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    observabilityLogId?: string;
    timestampMs?: number;
}, options?: CaptureOptions): string | undefined;
/**
 * Capture an event asynchronously using common fields.
 * Use when you need to await backend completion (e.g., for critical audits).
 */
export declare function captureEventAsync(fields: CommonFields, event: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    observabilityLogId?: string;
    timestampMs?: number;
}, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined>;
