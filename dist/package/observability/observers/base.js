"use strict";
/**
 * Base utilities for observers
 *
 * Provides shared functionality to reduce code duplication across observers.
 * All observers should use these utilities instead of duplicating logic.
 *
 * TESTABILITY: Uses IEventCapture interface with setCapturer() for dependency injection.
 * In tests, call setCapturer(mockCapturer) before running observer tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeCapturer = initializeCapturer;
exports.setCapturer = setCapturer;
exports.resetCapturer = resetCapturer;
exports.generateId = generateId;
exports.resolveCorrelationId = resolveCorrelationId;
exports.mergeObserverTags = mergeObserverTags;
exports.buildCommonFields = buildCommonFields;
exports.extractObserverOptions = extractObserverOptions;
exports.normalizeError = normalizeError;
exports.mapError = mapError;
exports.captureEvent = captureEvent;
exports.captureEventAsync = captureEventAsync;
const context_1 = require("../context");
const logging_1 = require("../../logging");
const id_generator_1 = require("../utils/id-generator");
const baseLogger = (0, logging_1.createLogger)('Observer');
/**
 * Event Capturer Registry
 *
 * Simple registry - no lazy loading, no circular dependencies.
 * ObservabilityManager MUST call initialize() during its initialization.
 */
class CapturerRegistry {
    capturer = null;
    /**
       * Initialize the capturer (called by ObservabilityManager during initialization)
     */
    initialize(capturer) {
        if (!this.capturer) {
            this.capturer = capturer;
        }
    }
    /**
       * Get the event capturer. Throws if not initialized.
     */
    get() {
        if (!this.capturer) {
            throw new Error('Observability not initialized. ObservabilityManager must initialize before observers can be used. ' +
                'This usually means you are using observers before the framework has initialized. ' +
                'If you see this error, import ObservabilityManager somewhere in your code to trigger initialization.');
        }
        return this.capturer;
    }
    /**
       * Set a custom capturer (for testing)
     *
     * @example
     * ```typescript
     * // In tests:
     * const mockCapturer = {
     *   capture: jest.fn().mockReturnValue('test-log-id'),
     *   captureAsync: jest.fn().mockResolvedValue('test-log-id'),
     * };
     * setCapturer(mockCapturer);
       * ```
       */
    set(capturer) {
        this.capturer = capturer;
    }
    /**
     * Reset to uninitialized state (for testing cleanup)
     */
    reset() {
        this.capturer = null;
    }
}
// Singleton instance
const capturerRegistry = new CapturerRegistry();
/**
 * Initialize the capturer - called by ObservabilityManager
 * @internal
 */
function initializeCapturer(capturer) {
    capturerRegistry.initialize(capturer);
}
/**
 * Get the event capturer (lazy-loads manager if needed)
 * @internal
 */
function getCapturer() {
    return capturerRegistry.get();
}
/**
 * Set a custom event capturer (for testing)
 */
function setCapturer(capturer) {
    capturerRegistry.set(capturer);
}
/**
 * Reset capturer to default (for testing cleanup)
 */
function resetCapturer() {
    capturerRegistry.reset();
}
/**
 * Generate a unique ID
 */
function generateId() {
    // Use W3C Span ID format (16 hex chars) by default for compatibility
    return (0, id_generator_1.generateSpanId)();
}
/**
 * Resolve correlation ID from explicit value or context.
 *
 * If no correlationId is available:
 * - In development (NODE_ENV !== 'production'): throws error for fast failure
 * - In production: auto-generates with warning for resilience
 */
function resolveCorrelationId(observerName, explicitId) {
    let correlationId = explicitId ?? (0, context_1.getCorrelationIdIfExists)();
    if (!correlationId) {
        const message = `${observerName}: No observability context established. ` +
            'Establish context with runWithContext() before using observers. ';
        // In development, fail fast to catch context issues early
        if (process.env.NODE_ENV !== 'production') {
            baseLogger.error(message + 'This will auto-generate in production but should be fixed.');
            // Don't throw - just log error. Observability should never crash the app.
        }
        // Auto-generate correlationId to maintain observability
        // Use W3C Trace ID format (32 hex chars)
        correlationId = (0, id_generator_1.generateTraceId)();
        baseLogger.warn(message + `Auto-generated correlationId: ${correlationId}`);
    }
    return correlationId;
}
/**
 * Merge tags from context and options
 */
function mergeObserverTags(contextTags, optionTags) {
    if (!contextTags && !optionTags)
        return undefined;
    return { ...contextTags, ...optionTags };
}
/**
 * Build common fields from context and options.
 * Always returns fields - auto-generates correlationId if needed.
 */
function buildCommonFields(observerName, options) {
    const context = (0, context_1.getCurrentContext)();
    const correlationId = resolveCorrelationId(observerName, options?.correlationId);
    return {
        correlationId,
        causedBy: options?.causedBy,
        relatedTraces: options?.relatedTraces,
        actor: options?.actor ?? context?.actor,
        source: options?.source ?? context?.source,
        tags: mergeObserverTags(context?.tags, options?.tags),
        metadata: options?.metadata,
    };
}
/**
 * Extract BaseObserverOptions from ExecutionContext or pass through if already options.
 *
 * When an ExecutionContext (the handler context with event/request/response) is passed,
 * extracts correlationId from executionContext first (the AsyncLocalStorage context),
 * then falls back to actor.correlationId.
 */
function extractObserverOptions(ctx) {
    if (!ctx)
        return {};
    // Check if this is a handler ExecutionContext (has event and lambdaContext)
    if ('event' in ctx && 'lambdaContext' in ctx) {
        const handlerCtx = ctx;
        return {
            // Prefer executionContext.correlationId (the real trace ID from AsyncLocalStorage)
            // Fall back to actor.correlationId for backward compatibility
            correlationId: handlerCtx.executionContext?.correlationId ?? handlerCtx.actor?.correlationId,
            actor: handlerCtx.actor,
        };
    }
    return ctx;
}
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
function normalizeError(error) {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }
    if (error !== null && typeof error === 'object') {
        // Handle error-like objects with message property
        const errorObj = error;
        if (typeof errorObj.message === 'string') {
            const err = new Error(errorObj.message);
            if (typeof errorObj.name === 'string') {
                err.name = errorObj.name;
            }
            if (typeof errorObj.stack === 'string') {
                err.stack = errorObj.stack;
            }
            return err;
        }
    }
    // Fallback: stringify whatever we got
    return new Error(String(error));
}
/**
 * Map Error to ObservabilityError format
 */
function mapError(error) {
    // Check for code property (common in Node.js errors)
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
        type: error.name,
        message: error.message,
        stack: error.stack,
        code,
    };
}
/**
 * Capture an event using common fields.
 * Handles all the boilerplate - observers should use this instead of calling capture directly.
 *
 * Uses getCapturer() for testability - in tests, call setCapturer(mockCapturer) first.
 */
function captureEvent(fields, event, options) {
    return getCapturer().capture({
        ...event,
        correlationId: fields.correlationId,
        observabilityLogId: event.observabilityLogId ?? generateId(),
        timestampMs: event.timestampMs ?? Date.now(),
        actor: event.actor ?? fields.actor,
        source: event.source ?? fields.source,
        tags: mergeObserverTags(fields.tags, event.tags),
        metadata: event.metadata ?? fields.metadata,
    }, options);
}
/**
 * Capture an event asynchronously using common fields.
 * Use when you need to await backend completion (e.g., for critical audits).
 */
async function captureEventAsync(fields, event, options) {
    return getCapturer().captureAsync({
        ...event,
        correlationId: fields.correlationId,
        observabilityLogId: event.observabilityLogId ?? generateId(),
        timestampMs: event.timestampMs ?? Date.now(),
        actor: event.actor ?? fields.actor,
        source: event.source ?? fields.source,
        tags: mergeObserverTags(fields.tags, event.tags),
        metadata: event.metadata ?? fields.metadata,
    }, options);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUEyRUgsZ0RBRUM7QUFhRCxrQ0FFQztBQUtELHNDQUVDO0FBc0NELGdDQUdDO0FBU0Qsb0RBd0JDO0FBS0QsOENBTUM7QUFNRCw4Q0FnQkM7QUFTRCx3REFpQkM7QUFnQkQsd0NBdUJDO0FBS0QsNEJBU0M7QUFRRCxvQ0FxQkM7QUFNRCw4Q0FxQkM7QUFqVkQsd0NBQXlFO0FBRXpFLDJDQUE2QztBQUM3Qyx3REFBd0U7QUFFeEUsTUFBTSxVQUFVLEdBQUcsSUFBQSxzQkFBWSxFQUFDLFVBQVUsQ0FBQyxDQUFDO0FBRTVDOzs7OztHQUtHO0FBQ0gsTUFBTSxnQkFBZ0I7SUFDWixRQUFRLEdBQXlCLElBQUksQ0FBQztJQUU5Qzs7T0FFRztJQUNILFVBQVUsQ0FBQyxRQUF1QjtRQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ25CLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQzNCLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxHQUFHO1FBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNuQixNQUFNLElBQUksS0FBSyxDQUNiLG9HQUFvRztnQkFDcEcsbUZBQW1GO2dCQUNuRixzR0FBc0csQ0FDdkcsQ0FBQztRQUNKLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUM7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7U0FZSztJQUNMLEdBQUcsQ0FBQyxRQUF1QjtRQUN6QixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLO1FBQ0gsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUM7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O0FBRUQ7OztHQUdHO0FBQ0ksS0FBSyxVQUFVLGlCQUFpQixDQUNyQyxNQUFvQixFQUNwQixLQUdDLEVBQ0QsT0FBc0M7SUFFdEMsT0FBTyxXQUFXLEVBQUUsQ0FBQyxZQUFZLENBQy9CO1FBQ0UsR0FBRyxLQUFLO1FBQ1IsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhO1FBQ25DLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsSUFBSSxVQUFVLEVBQUU7UUFDNUQsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUM1QyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUMsS0FBSztRQUNsQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTTtRQUNyQyxJQUFJLEVBQUUsaUJBQWlCLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDO1FBQ2hELFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRO0tBQzVDLEVBQ0QsT0FBTyxDQUNSLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBCYXNlIHV0aWxpdGllcyBmb3Igb2JzZXJ2ZXJzXG4gKiBcbiAqIFByb3ZpZGVzIHNoYXJlZCBmdW5jdGlvbmFsaXR5IHRvIHJlZHVjZSBjb2RlIGR1cGxpY2F0aW9uIGFjcm9zcyBvYnNlcnZlcnMuXG4gKiBBbGwgb2JzZXJ2ZXJzIHNob3VsZCB1c2UgdGhlc2UgdXRpbGl0aWVzIGluc3RlYWQgb2YgZHVwbGljYXRpbmcgbG9naWMuXG4gKiBcbiAqIFRFU1RBQklMSVRZOiBVc2VzIElFdmVudENhcHR1cmUgaW50ZXJmYWNlIHdpdGggc2V0Q2FwdHVyZXIoKSBmb3IgZGVwZW5kZW5jeSBpbmplY3Rpb24uXG4gKiBJbiB0ZXN0cywgY2FsbCBzZXRDYXB0dXJlcihtb2NrQ2FwdHVyZXIpIGJlZm9yZSBydW5uaW5nIG9ic2VydmVyIHRlc3RzLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IENhcHR1cmVJbnB1dCwgQ2FwdHVyZU9wdGlvbnMsIElFdmVudENhcHR1cmUsIE9ic2VydmFiaWxpdHlFcnJvciB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgZ2VuZXJhdGVUcmFjZUlkLCBnZW5lcmF0ZVNwYW5JZCB9IGZyb20gJy4uL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5cbmNvbnN0IGJhc2VMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmVyJyk7XG5cbi8qKlxuICogRXZlbnQgQ2FwdHVyZXIgUmVnaXN0cnlcbiAqIFxuICogU2ltcGxlIHJlZ2lzdHJ5IC0gbm8gbGF6eSBsb2FkaW5nLCBubyBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciBNVVNUIGNhbGwgaW5pdGlhbGl6ZSgpIGR1cmluZyBpdHMgaW5pdGlhbGl6YXRpb24uXG4gKi9cbmNsYXNzIENhcHR1cmVyUmVnaXN0cnkge1xuICBwcml2YXRlIGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqXG4gICAgICogSW5pdGlhbGl6ZSB0aGUgY2FwdHVyZXIgKGNhbGxlZCBieSBPYnNlcnZhYmlsaXR5TWFuYWdlciBkdXJpbmcgaW5pdGlhbGl6YXRpb24pXG4gICAqL1xuICBpbml0aWFsaXplKGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVyKSB7XG4gICAgICB0aGlzLmNhcHR1cmVyID0gY2FwdHVyZXI7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAgICogR2V0IHRoZSBldmVudCBjYXB0dXJlci4gVGhyb3dzIGlmIG5vdCBpbml0aWFsaXplZC5cbiAgICovXG4gIGdldCgpOiBJRXZlbnRDYXB0dXJlIHtcbiAgICBpZiAoIXRoaXMuY2FwdHVyZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLiBPYnNlcnZhYmlsaXR5TWFuYWdlciBtdXN0IGluaXRpYWxpemUgYmVmb3JlIG9ic2VydmVycyBjYW4gYmUgdXNlZC4gJyArXG4gICAgICAgICdUaGlzIHVzdWFsbHkgbWVhbnMgeW91IGFyZSB1c2luZyBvYnNlcnZlcnMgYmVmb3JlIHRoZSBmcmFtZXdvcmsgaGFzIGluaXRpYWxpemVkLiAnICtcbiAgICAgICAgJ0lmIHlvdSBzZWUgdGhpcyBlcnJvciwgaW1wb3J0IE9ic2VydmFiaWxpdHlNYW5hZ2VyIHNvbWV3aGVyZSBpbiB5b3VyIGNvZGUgdG8gdHJpZ2dlciBpbml0aWFsaXphdGlvbi4nXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYXB0dXJlcjtcbiAgfVxuXG4gIC8qKlxuICAgICAqIFNldCBhIGN1c3RvbSBjYXB0dXJlciAoZm9yIHRlc3RpbmcpXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIC8vIEluIHRlc3RzOlxuICAgKiBjb25zdCBtb2NrQ2FwdHVyZXIgPSB7XG4gICAqICAgY2FwdHVyZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSgndGVzdC1sb2ctaWQnKSxcbiAgICogICBjYXB0dXJlQXN5bmM6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSgndGVzdC1sb2ctaWQnKSxcbiAgICogfTtcbiAgICogc2V0Q2FwdHVyZXIobW9ja0NhcHR1cmVyKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgc2V0KGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgdGhpcy5jYXB0dXJlciA9IGNhcHR1cmVyO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IHRvIHVuaW5pdGlhbGl6ZWQgc3RhdGUgKGZvciB0ZXN0aW5nIGNsZWFudXApXG4gICAqL1xuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLmNhcHR1cmVyID0gbnVsbDtcbiAgfVxufVxuXG4vLyBTaW5nbGV0b24gaW5zdGFuY2VcbmNvbnN0IGNhcHR1cmVyUmVnaXN0cnkgPSBuZXcgQ2FwdHVyZXJSZWdpc3RyeSgpO1xuXG4vKipcbiAqIEluaXRpYWxpemUgdGhlIGNhcHR1cmVyIC0gY2FsbGVkIGJ5IE9ic2VydmFiaWxpdHlNYW5hZ2VyXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluaXRpYWxpemVDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LmluaXRpYWxpemUoY2FwdHVyZXIpO1xufVxuXG4vKipcbiAqIEdldCB0aGUgZXZlbnQgY2FwdHVyZXIgKGxhenktbG9hZHMgbWFuYWdlciBpZiBuZWVkZWQpXG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gZ2V0Q2FwdHVyZXIoKTogSUV2ZW50Q2FwdHVyZSB7XG4gIHJldHVybiBjYXB0dXJlclJlZ2lzdHJ5LmdldCgpO1xufVxuXG4vKipcbiAqIFNldCBhIGN1c3RvbSBldmVudCBjYXB0dXJlciAoZm9yIHRlc3RpbmcpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LnNldChjYXB0dXJlcik7XG59XG5cbi8qKlxuICogUmVzZXQgY2FwdHVyZXIgdG8gZGVmYXVsdCAoZm9yIHRlc3RpbmcgY2xlYW51cClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0Q2FwdHVyZXIoKTogdm9pZCB7XG4gIGNhcHR1cmVyUmVnaXN0cnkucmVzZXQoKTtcbn1cblxuLyoqXG4gKiBTdGFuZGFyZCBvcHRpb25zIHNoYXJlZCBieSBhbGwgb2JzZXJ2ZXJzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIC8qKiBFeHBsaWNpdCBjb3JyZWxhdGlvbiBJRCAoZGVmYXVsdHMgdG8gY29udGV4dCkgKi9cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgLyoqIENvcnJlbGF0aW9uIElEIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnQgKGNyb3NzLWludm9jYXRpb24gdHJhY2luZykgKi9cbiAgY2F1c2VkQnk/OiBzdHJpbmc7XG4gIC8qKiBBbGwgcmVsYXRlZCB0cmFjZSBJRHMgKGZvciBjb21wbGV4IHdvcmtmbG93cykgKi9cbiAgcmVsYXRlZFRyYWNlcz86IHN0cmluZ1tdO1xuICAvKiogQWN0b3IgcGVyZm9ybWluZyB0aGUgYWN0aW9uICovXG4gIGFjdG9yPzogQWN0b3I7XG4gIC8qKiBTb3VyY2UgaWRlbnRpZmllciAqL1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIC8qKiBUYWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBBZGRpdGlvbmFsIG1ldGFkYXRhICovXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogQ29tbW9uIGZpZWxkcyBkZXJpdmVkIGZyb20gY29udGV4dCBhbmQgb3B0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1vbkZpZWxkcyB7XG4gIGNvcnJlbGF0aW9uSWQ6IHN0cmluZztcbiAgY2F1c2VkQnk/OiBzdHJpbmc7XG4gIHJlbGF0ZWRUcmFjZXM/OiBzdHJpbmdbXTtcbiAgYWN0b3I/OiBBY3RvcjtcbiAgc291cmNlPzogc3RyaW5nO1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHVuaXF1ZSBJRFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVJZCgpOiBzdHJpbmcge1xuICAvLyBVc2UgVzNDIFNwYW4gSUQgZm9ybWF0ICgxNiBoZXggY2hhcnMpIGJ5IGRlZmF1bHQgZm9yIGNvbXBhdGliaWxpdHlcbiAgcmV0dXJuIGdlbmVyYXRlU3BhbklkKCk7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBjb3JyZWxhdGlvbiBJRCBmcm9tIGV4cGxpY2l0IHZhbHVlIG9yIGNvbnRleHQuXG4gKiBcbiAqIElmIG5vIGNvcnJlbGF0aW9uSWQgaXMgYXZhaWxhYmxlOlxuICogLSBJbiBkZXZlbG9wbWVudCAoTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJyk6IHRocm93cyBlcnJvciBmb3IgZmFzdCBmYWlsdXJlXG4gKiAtIEluIHByb2R1Y3Rpb246IGF1dG8tZ2VuZXJhdGVzIHdpdGggd2FybmluZyBmb3IgcmVzaWxpZW5jZVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUNvcnJlbGF0aW9uSWQoXG4gIG9ic2VydmVyTmFtZTogc3RyaW5nLFxuICBleHBsaWNpdElkPzogc3RyaW5nXG4pOiBzdHJpbmcge1xuICBsZXQgY29ycmVsYXRpb25JZCA9IGV4cGxpY2l0SWQgPz8gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk7XG5cbiAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9XG4gICAgICBgJHtvYnNlcnZlck5hbWV9OiBObyBvYnNlcnZhYmlsaXR5IGNvbnRleHQgZXN0YWJsaXNoZWQuIGAgK1xuICAgICAgJ0VzdGFibGlzaCBjb250ZXh0IHdpdGggcnVuV2l0aENvbnRleHQoKSBiZWZvcmUgdXNpbmcgb2JzZXJ2ZXJzLiAnO1xuXG4gICAgLy8gSW4gZGV2ZWxvcG1lbnQsIGZhaWwgZmFzdCB0byBjYXRjaCBjb250ZXh0IGlzc3VlcyBlYXJseVxuICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSB7XG4gICAgICBiYXNlTG9nZ2VyLmVycm9yKG1lc3NhZ2UgKyAnVGhpcyB3aWxsIGF1dG8tZ2VuZXJhdGUgaW4gcHJvZHVjdGlvbiBidXQgc2hvdWxkIGJlIGZpeGVkLicpO1xuICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBqdXN0IGxvZyBlcnJvci4gT2JzZXJ2YWJpbGl0eSBzaG91bGQgbmV2ZXIgY3Jhc2ggdGhlIGFwcC5cbiAgICB9XG5cbiAgICAvLyBBdXRvLWdlbmVyYXRlIGNvcnJlbGF0aW9uSWQgdG8gbWFpbnRhaW4gb2JzZXJ2YWJpbGl0eVxuICAgIC8vIFVzZSBXM0MgVHJhY2UgSUQgZm9ybWF0ICgzMiBoZXggY2hhcnMpXG4gICAgY29ycmVsYXRpb25JZCA9IGdlbmVyYXRlVHJhY2VJZCgpO1xuICAgIGJhc2VMb2dnZXIud2FybihtZXNzYWdlICsgYEF1dG8tZ2VuZXJhdGVkIGNvcnJlbGF0aW9uSWQ6ICR7Y29ycmVsYXRpb25JZH1gKTtcbiAgfVxuXG4gIHJldHVybiBjb3JyZWxhdGlvbklkO1xufVxuXG4vKipcbiAqIE1lcmdlIHRhZ3MgZnJvbSBjb250ZXh0IGFuZCBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZU9ic2VydmVyVGFncyhcbiAgY29udGV4dFRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICBvcHRpb25UYWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCB7XG4gIGlmICghY29udGV4dFRhZ3MgJiYgIW9wdGlvblRhZ3MpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB7IC4uLmNvbnRleHRUYWdzLCAuLi5vcHRpb25UYWdzIH07XG59XG5cbi8qKlxuICogQnVpbGQgY29tbW9uIGZpZWxkcyBmcm9tIGNvbnRleHQgYW5kIG9wdGlvbnMuXG4gKiBBbHdheXMgcmV0dXJucyBmaWVsZHMgLSBhdXRvLWdlbmVyYXRlcyBjb3JyZWxhdGlvbklkIGlmIG5lZWRlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ29tbW9uRmllbGRzKFxuICBvYnNlcnZlck5hbWU6IHN0cmluZyxcbiAgb3B0aW9ucz86IEJhc2VPYnNlcnZlck9wdGlvbnNcbik6IENvbW1vbkZpZWxkcyB7XG4gIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gcmVzb2x2ZUNvcnJlbGF0aW9uSWQob2JzZXJ2ZXJOYW1lLCBvcHRpb25zPy5jb3JyZWxhdGlvbklkKTtcblxuICByZXR1cm4ge1xuICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgY2F1c2VkQnk6IG9wdGlvbnM/LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IG9wdGlvbnM/LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yID8/IGNvbnRleHQ/LmFjdG9yLFxuICAgIHNvdXJjZTogb3B0aW9ucz8uc291cmNlID8/IGNvbnRleHQ/LnNvdXJjZSxcbiAgICB0YWdzOiBtZXJnZU9ic2VydmVyVGFncyhjb250ZXh0Py50YWdzLCBvcHRpb25zPy50YWdzKSxcbiAgICBtZXRhZGF0YTogb3B0aW9ucz8ubWV0YWRhdGEsXG4gIH07XG59XG5cbi8qKlxuICogRXh0cmFjdCBCYXNlT2JzZXJ2ZXJPcHRpb25zIGZyb20gRXhlY3V0aW9uQ29udGV4dCBvciBwYXNzIHRocm91Z2ggaWYgYWxyZWFkeSBvcHRpb25zLlxuICogXG4gKiBXaGVuIGFuIEV4ZWN1dGlvbkNvbnRleHQgKHRoZSBoYW5kbGVyIGNvbnRleHQgd2l0aCBldmVudC9yZXF1ZXN0L3Jlc3BvbnNlKSBpcyBwYXNzZWQsXG4gKiBleHRyYWN0cyBjb3JyZWxhdGlvbklkIGZyb20gZXhlY3V0aW9uQ29udGV4dCBmaXJzdCAodGhlIEFzeW5jTG9jYWxTdG9yYWdlIGNvbnRleHQpLFxuICogdGhlbiBmYWxscyBiYWNrIHRvIGFjdG9yLmNvcnJlbGF0aW9uSWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zKFxuICBjdHg/OiBFeGVjdXRpb25Db250ZXh0IHwgQmFzZU9ic2VydmVyT3B0aW9uc1xuKTogQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIGlmICghY3R4KSByZXR1cm4ge307XG5cbiAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIGhhbmRsZXIgRXhlY3V0aW9uQ29udGV4dCAoaGFzIGV2ZW50IGFuZCBsYW1iZGFDb250ZXh0KVxuICBpZiAoJ2V2ZW50JyBpbiBjdHggJiYgJ2xhbWJkYUNvbnRleHQnIGluIGN0eCkge1xuICAgIGNvbnN0IGhhbmRsZXJDdHggPSBjdHggYXMgRXhlY3V0aW9uQ29udGV4dDtcbiAgICByZXR1cm4ge1xuICAgICAgLy8gUHJlZmVyIGV4ZWN1dGlvbkNvbnRleHQuY29ycmVsYXRpb25JZCAodGhlIHJlYWwgdHJhY2UgSUQgZnJvbSBBc3luY0xvY2FsU3RvcmFnZSlcbiAgICAgIC8vIEZhbGwgYmFjayB0byBhY3Rvci5jb3JyZWxhdGlvbklkIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBjb3JyZWxhdGlvbklkOiBoYW5kbGVyQ3R4LmV4ZWN1dGlvbkNvbnRleHQ/LmNvcnJlbGF0aW9uSWQgPz8gaGFuZGxlckN0eC5hY3Rvcj8uY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiBoYW5kbGVyQ3R4LmFjdG9yLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gY3R4IGFzIEJhc2VPYnNlcnZlck9wdGlvbnM7XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGFuIHVua25vd24gY2F1Z2h0IHZhbHVlIHRvIGFuIEVycm9yLlxuICogSW4gSmF2YVNjcmlwdCwgY2F0Y2ggYmxvY2tzIGNhbiByZWNlaXZlIGFueSB2YWx1ZSwgbm90IGp1c3QgRXJyb3Igb2JqZWN0cy5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHRyeSB7XG4gKiAgIC8vIC4uLlxuICogfSBjYXRjaCAoZXJyb3IpIHtcbiAqICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbm9ybWFsaXplRXJyb3IoZXJyb3IpO1xuICogICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplZEVycm9yIH0pO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVFcnJvcihlcnJvcjogdW5rbm93bik6IEVycm9yIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3I7XG4gIH1cbiAgaWYgKHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbmV3IEVycm9yKGVycm9yKTtcbiAgfVxuICBpZiAoZXJyb3IgIT09IG51bGwgJiYgdHlwZW9mIGVycm9yID09PSAnb2JqZWN0Jykge1xuICAgIC8vIEhhbmRsZSBlcnJvci1saWtlIG9iamVjdHMgd2l0aCBtZXNzYWdlIHByb3BlcnR5XG4gICAgY29uc3QgZXJyb3JPYmogPSBlcnJvciBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGVycm9yT2JqLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoZXJyb3JPYmoubWVzc2FnZSk7XG4gICAgICBpZiAodHlwZW9mIGVycm9yT2JqLm5hbWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGVyci5uYW1lID0gZXJyb3JPYmoubmFtZTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgZXJyb3JPYmouc3RhY2sgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGVyci5zdGFjayA9IGVycm9yT2JqLnN0YWNrO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGVycjtcbiAgICB9XG4gIH1cbiAgLy8gRmFsbGJhY2s6IHN0cmluZ2lmeSB3aGF0ZXZlciB3ZSBnb3RcbiAgcmV0dXJuIG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKTtcbn1cblxuLyoqXG4gKiBNYXAgRXJyb3IgdG8gT2JzZXJ2YWJpbGl0eUVycm9yIGZvcm1hdFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFwRXJyb3IoZXJyb3I6IEVycm9yKTogT2JzZXJ2YWJpbGl0eUVycm9yIHtcbiAgLy8gQ2hlY2sgZm9yIGNvZGUgcHJvcGVydHkgKGNvbW1vbiBpbiBOb2RlLmpzIGVycm9ycylcbiAgY29uc3QgY29kZSA9ICdjb2RlJyBpbiBlcnJvciAmJiB0eXBlb2YgZXJyb3IuY29kZSA9PT0gJ3N0cmluZycgPyBlcnJvci5jb2RlIDogdW5kZWZpbmVkO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IGVycm9yLm5hbWUsXG4gICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgY29kZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXB0dXJlIGFuIGV2ZW50IHVzaW5nIGNvbW1vbiBmaWVsZHMuXG4gKiBIYW5kbGVzIGFsbCB0aGUgYm9pbGVycGxhdGUgLSBvYnNlcnZlcnMgc2hvdWxkIHVzZSB0aGlzIGluc3RlYWQgb2YgY2FsbGluZyBjYXB0dXJlIGRpcmVjdGx5LlxuICogXG4gKiBVc2VzIGdldENhcHR1cmVyKCkgZm9yIHRlc3RhYmlsaXR5IC0gaW4gdGVzdHMsIGNhbGwgc2V0Q2FwdHVyZXIobW9ja0NhcHR1cmVyKSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhcHR1cmVFdmVudChcbiAgZmllbGRzOiBDb21tb25GaWVsZHMsXG4gIGV2ZW50OiBPbWl0PENhcHR1cmVJbnB1dCwgJ2NvcnJlbGF0aW9uSWQnIHwgJ29ic2VydmFiaWxpdHlMb2dJZCcgfCAndGltZXN0YW1wTXMnPiAmIHtcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmc7XG4gICAgdGltZXN0YW1wTXM/OiBudW1iZXI7XG4gIH0sXG4gIG9wdGlvbnM/OiBDYXB0dXJlT3B0aW9uc1xuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGdldENhcHR1cmVyKCkuY2FwdHVyZShcbiAgICB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGZpZWxkcy5jb3JyZWxhdGlvbklkLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQgPz8gZ2VuZXJhdGVJZCgpLFxuICAgICAgdGltZXN0YW1wTXM6IGV2ZW50LnRpbWVzdGFtcE1zID8/IERhdGUubm93KCksXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPz8gZmllbGRzLmFjdG9yLFxuICAgICAgc291cmNlOiBldmVudC5zb3VyY2UgPz8gZmllbGRzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBldmVudC50YWdzKSxcbiAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSA/PyBmaWVsZHMubWV0YWRhdGEsXG4gICAgfSxcbiAgICBvcHRpb25zXG4gICk7XG59XG5cbi8qKlxuICogQ2FwdHVyZSBhbiBldmVudCBhc3luY2hyb25vdXNseSB1c2luZyBjb21tb24gZmllbGRzLlxuICogVXNlIHdoZW4geW91IG5lZWQgdG8gYXdhaXQgYmFja2VuZCBjb21wbGV0aW9uIChlLmcuLCBmb3IgY3JpdGljYWwgYXVkaXRzKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhcHR1cmVFdmVudEFzeW5jKFxuICBmaWVsZHM6IENvbW1vbkZpZWxkcyxcbiAgZXZlbnQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYge1xuICAgIG9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgICB0aW1lc3RhbXBNcz86IG51bWJlcjtcbiAgfSxcbiAgb3B0aW9ucz86IE9taXQ8Q2FwdHVyZU9wdGlvbnMsICdzeW5jJz5cbik6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gIHJldHVybiBnZXRDYXB0dXJlcigpLmNhcHR1cmVBc3luYyhcbiAgICB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGZpZWxkcy5jb3JyZWxhdGlvbklkLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQgPz8gZ2VuZXJhdGVJZCgpLFxuICAgICAgdGltZXN0YW1wTXM6IGV2ZW50LnRpbWVzdGFtcE1zID8/IERhdGUubm93KCksXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPz8gZmllbGRzLmFjdG9yLFxuICAgICAgc291cmNlOiBldmVudC5zb3VyY2UgPz8gZmllbGRzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBldmVudC50YWdzKSxcbiAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSA/PyBmaWVsZHMubWV0YWRhdGEsXG4gICAgfSxcbiAgICBvcHRpb25zXG4gICk7XG59XG4iXX0=