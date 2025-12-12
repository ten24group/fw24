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
const crypto_1 = require("crypto");
const context_1 = require("../context");
const logging_1 = require("../../logging");
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
    return (0, crypto_1.randomUUID)();
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
        correlationId = `auto-${(0, crypto_1.randomUUID)()}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUEwRUgsZ0RBRUM7QUFhRCxrQ0FFQztBQUtELHNDQUVDO0FBZ0NELGdDQUVDO0FBU0Qsb0RBdUJDO0FBS0QsOENBTUM7QUFNRCw4Q0FjQztBQVNELHdEQWlCQztBQWdCRCx3Q0F1QkM7QUFLRCw0QkFTQztBQVFELG9DQXFCQztBQU1ELDhDQXFCQztBQXhVRCxtQ0FBb0M7QUFFcEMsd0NBQXlFO0FBRXpFLDJDQUE2QztBQUU3QyxNQUFNLFVBQVUsR0FBRyxJQUFBLHNCQUFZLEVBQUMsVUFBVSxDQUFDLENBQUM7QUFFNUM7Ozs7O0dBS0c7QUFDSCxNQUFNLGdCQUFnQjtJQUNaLFFBQVEsR0FBeUIsSUFBSSxDQUFDO0lBRTlDOztPQUVHO0lBQ0gsVUFBVSxDQUFDLFFBQXVCO1FBQ2hDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDM0IsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEdBQUc7UUFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ25CLE1BQU0sSUFBSSxLQUFLLENBQ2Isb0dBQW9HO2dCQUNwRyxtRkFBbUY7Z0JBQ25GLHNHQUFzRyxDQUN2RyxDQUFDO1FBQ0osQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN2QixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztTQVlLO0lBQ0wsR0FBRyxDQUFDLFFBQXVCO1FBQ3pCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUs7UUFDSCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQztJ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LFdBQVcsRUFBRSxDQUFDLFlBQVksQ0FDL0I7UUFDRSxHQUFHLEtBQUs7UUFDUixhQUFhLEVBQUUsTUFBTSxDQUFDLGFBQWE7UUFDbkMsa0JBQWtCLEVBQUUsS0FBSyxDQUFDLGtCQUFrQixJQUFJLFVBQVUsRUFBRTtRQUM1RCxXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFO1FBQzVDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxLQUFLO1FBQ2xDLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxNQUFNO1FBQ3JDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFDaEQsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVE7S0FDNUMsRUFDRCxPQUFPLENBQ1IsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEJhc2UgdXRpbGl0aWVzIGZvciBvYnNlcnZlcnNcbiAqIFxuICogUHJvdmlkZXMgc2hhcmVkIGZ1bmN0aW9uYWxpdHkgdG8gcmVkdWNlIGNvZGUgZHVwbGljYXRpb24gYWNyb3NzIG9ic2VydmVycy5cbiAqIEFsbCBvYnNlcnZlcnMgc2hvdWxkIHVzZSB0aGVzZSB1dGlsaXRpZXMgaW5zdGVhZCBvZiBkdXBsaWNhdGluZyBsb2dpYy5cbiAqIFxuICogVEVTVEFCSUxJVFk6IFVzZXMgSUV2ZW50Q2FwdHVyZSBpbnRlcmZhY2Ugd2l0aCBzZXRDYXB0dXJlcigpIGZvciBkZXBlbmRlbmN5IGluamVjdGlvbi5cbiAqIEluIHRlc3RzLCBjYWxsIHNldENhcHR1cmVyKG1vY2tDYXB0dXJlcikgYmVmb3JlIHJ1bm5pbmcgb2JzZXJ2ZXIgdGVzdHMuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBBY3RvciwgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgQ2FwdHVyZUlucHV0LCBDYXB0dXJlT3B0aW9ucywgSUV2ZW50Q2FwdHVyZSwgT2JzZXJ2YWJpbGl0eUVycm9yIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGJhc2VMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmVyJyk7XG5cbi8qKlxuICogRXZlbnQgQ2FwdHVyZXIgUmVnaXN0cnlcbiAqIFxuICogU2ltcGxlIHJlZ2lzdHJ5IC0gbm8gbGF6eSBsb2FkaW5nLCBubyBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciBNVVNUIGNhbGwgaW5pdGlhbGl6ZSgpIGR1cmluZyBpdHMgaW5pdGlhbGl6YXRpb24uXG4gKi9cbmNsYXNzIENhcHR1cmVyUmVnaXN0cnkge1xuICBwcml2YXRlIGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqXG4gICAgICogSW5pdGlhbGl6ZSB0aGUgY2FwdHVyZXIgKGNhbGxlZCBieSBPYnNlcnZhYmlsaXR5TWFuYWdlciBkdXJpbmcgaW5pdGlhbGl6YXRpb24pXG4gICAqL1xuICBpbml0aWFsaXplKGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVyKSB7XG4gICAgICB0aGlzLmNhcHR1cmVyID0gY2FwdHVyZXI7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAgICogR2V0IHRoZSBldmVudCBjYXB0dXJlci4gVGhyb3dzIGlmIG5vdCBpbml0aWFsaXplZC5cbiAgICovXG4gIGdldCgpOiBJRXZlbnRDYXB0dXJlIHtcbiAgICBpZiAoIXRoaXMuY2FwdHVyZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLiBPYnNlcnZhYmlsaXR5TWFuYWdlciBtdXN0IGluaXRpYWxpemUgYmVmb3JlIG9ic2VydmVycyBjYW4gYmUgdXNlZC4gJyArXG4gICAgICAgICdUaGlzIHVzdWFsbHkgbWVhbnMgeW91IGFyZSB1c2luZyBvYnNlcnZlcnMgYmVmb3JlIHRoZSBmcmFtZXdvcmsgaGFzIGluaXRpYWxpemVkLiAnICtcbiAgICAgICAgJ0lmIHlvdSBzZWUgdGhpcyBlcnJvciwgaW1wb3J0IE9ic2VydmFiaWxpdHlNYW5hZ2VyIHNvbWV3aGVyZSBpbiB5b3VyIGNvZGUgdG8gdHJpZ2dlciBpbml0aWFsaXphdGlvbi4nXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYXB0dXJlcjtcbiAgfVxuXG4gIC8qKlxuICAgICAqIFNldCBhIGN1c3RvbSBjYXB0dXJlciAoZm9yIHRlc3RpbmcpXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIC8vIEluIHRlc3RzOlxuICAgKiBjb25zdCBtb2NrQ2FwdHVyZXIgPSB7XG4gICAqICAgY2FwdHVyZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSgndGVzdC1sb2ctaWQnKSxcbiAgICogICBjYXB0dXJlQXN5bmM6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSgndGVzdC1sb2ctaWQnKSxcbiAgICogfTtcbiAgICogc2V0Q2FwdHVyZXIobW9ja0NhcHR1cmVyKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgc2V0KGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgdGhpcy5jYXB0dXJlciA9IGNhcHR1cmVyO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IHRvIHVuaW5pdGlhbGl6ZWQgc3RhdGUgKGZvciB0ZXN0aW5nIGNsZWFudXApXG4gICAqL1xuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLmNhcHR1cmVyID0gbnVsbDtcbiAgfVxufVxuXG4vLyBTaW5nbGV0b24gaW5zdGFuY2VcbmNvbnN0IGNhcHR1cmVyUmVnaXN0cnkgPSBuZXcgQ2FwdHVyZXJSZWdpc3RyeSgpO1xuXG4vKipcbiAqIEluaXRpYWxpemUgdGhlIGNhcHR1cmVyIC0gY2FsbGVkIGJ5IE9ic2VydmFiaWxpdHlNYW5hZ2VyXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluaXRpYWxpemVDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LmluaXRpYWxpemUoY2FwdHVyZXIpO1xufVxuXG4vKipcbiAqIEdldCB0aGUgZXZlbnQgY2FwdHVyZXIgKGxhenktbG9hZHMgbWFuYWdlciBpZiBuZWVkZWQpXG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gZ2V0Q2FwdHVyZXIoKTogSUV2ZW50Q2FwdHVyZSB7XG4gIHJldHVybiBjYXB0dXJlclJlZ2lzdHJ5LmdldCgpO1xufVxuXG4vKipcbiAqIFNldCBhIGN1c3RvbSBldmVudCBjYXB0dXJlciAoZm9yIHRlc3RpbmcpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LnNldChjYXB0dXJlcik7XG59XG5cbi8qKlxuICogUmVzZXQgY2FwdHVyZXIgdG8gZGVmYXVsdCAoZm9yIHRlc3RpbmcgY2xlYW51cClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0Q2FwdHVyZXIoKTogdm9pZCB7XG4gIGNhcHR1cmVyUmVnaXN0cnkucmVzZXQoKTtcbn1cblxuLyoqXG4gKiBTdGFuZGFyZCBvcHRpb25zIHNoYXJlZCBieSBhbGwgb2JzZXJ2ZXJzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIC8qKiBFeHBsaWNpdCBjb3JyZWxhdGlvbiBJRCAoZGVmYXVsdHMgdG8gY29udGV4dCkgKi9cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgLyoqIEFjdG9yIHBlcmZvcm1pbmcgdGhlIGFjdGlvbiAqL1xuICBhY3Rvcj86IEFjdG9yO1xuICAvKiogU291cmNlIGlkZW50aWZpZXIgKi9cbiAgc291cmNlPzogc3RyaW5nO1xuICAvKiogVGFncyBmb3IgZmlsdGVyaW5nICovXG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogQWRkaXRpb25hbCBtZXRhZGF0YSAqL1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIENvbW1vbiBmaWVsZHMgZGVyaXZlZCBmcm9tIGNvbnRleHQgYW5kIG9wdGlvbnNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21tb25GaWVsZHMge1xuICBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIGFjdG9yPzogQWN0b3I7XG4gIHNvdXJjZT86IHN0cmluZztcbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSB1bmlxdWUgSURcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlSWQoKTogc3RyaW5nIHtcbiAgcmV0dXJuIHJhbmRvbVVVSUQoKTtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGNvcnJlbGF0aW9uIElEIGZyb20gZXhwbGljaXQgdmFsdWUgb3IgY29udGV4dC5cbiAqIFxuICogSWYgbm8gY29ycmVsYXRpb25JZCBpcyBhdmFpbGFibGU6XG4gKiAtIEluIGRldmVsb3BtZW50IChOT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKTogdGhyb3dzIGVycm9yIGZvciBmYXN0IGZhaWx1cmVcbiAqIC0gSW4gcHJvZHVjdGlvbjogYXV0by1nZW5lcmF0ZXMgd2l0aCB3YXJuaW5nIGZvciByZXNpbGllbmNlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQ29ycmVsYXRpb25JZChcbiAgb2JzZXJ2ZXJOYW1lOiBzdHJpbmcsXG4gIGV4cGxpY2l0SWQ/OiBzdHJpbmdcbik6IHN0cmluZyB7XG4gIGxldCBjb3JyZWxhdGlvbklkID0gZXhwbGljaXRJZCA/PyBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTtcblxuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICBjb25zdCBtZXNzYWdlID1cbiAgICAgIGAke29ic2VydmVyTmFtZX06IE5vIG9ic2VydmFiaWxpdHkgY29udGV4dCBlc3RhYmxpc2hlZC4gYCArXG4gICAgICAnRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBydW5XaXRoQ29udGV4dCgpIGJlZm9yZSB1c2luZyBvYnNlcnZlcnMuICc7XG5cbiAgICAvLyBJbiBkZXZlbG9wbWVudCwgZmFpbCBmYXN0IHRvIGNhdGNoIGNvbnRleHQgaXNzdWVzIGVhcmx5XG4gICAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICAgIGJhc2VMb2dnZXIuZXJyb3IobWVzc2FnZSArICdUaGlzIHdpbGwgYXV0by1nZW5lcmF0ZSBpbiBwcm9kdWN0aW9uIGJ1dCBzaG91bGQgYmUgZml4ZWQuJyk7XG4gICAgICAvLyBEb24ndCB0aHJvdyAtIGp1c3QgbG9nIGVycm9yLiBPYnNlcnZhYmlsaXR5IHNob3VsZCBuZXZlciBjcmFzaCB0aGUgYXBwLlxuICAgIH1cblxuICAgIC8vIEF1dG8tZ2VuZXJhdGUgY29ycmVsYXRpb25JZCB0byBtYWludGFpbiBvYnNlcnZhYmlsaXR5XG4gICAgY29ycmVsYXRpb25JZCA9IGBhdXRvLSR7cmFuZG9tVVVJRCgpfWA7XG4gICAgYmFzZUxvZ2dlci53YXJuKG1lc3NhZ2UgKyBgQXV0by1nZW5lcmF0ZWQgY29ycmVsYXRpb25JZDogJHtjb3JyZWxhdGlvbklkfWApO1xuICB9XG5cbiAgcmV0dXJuIGNvcnJlbGF0aW9uSWQ7XG59XG5cbi8qKlxuICogTWVyZ2UgdGFncyBmcm9tIGNvbnRleHQgYW5kIG9wdGlvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlT2JzZXJ2ZXJUYWdzKFxuICBjb250ZXh0VGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIG9wdGlvblRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFjb250ZXh0VGFncyAmJiAhb3B0aW9uVGFncykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHsgLi4uY29udGV4dFRhZ3MsIC4uLm9wdGlvblRhZ3MgfTtcbn1cblxuLyoqXG4gKiBCdWlsZCBjb21tb24gZmllbGRzIGZyb20gY29udGV4dCBhbmQgb3B0aW9ucy5cbiAqIEFsd2F5cyByZXR1cm5zIGZpZWxkcyAtIGF1dG8tZ2VuZXJhdGVzIGNvcnJlbGF0aW9uSWQgaWYgbmVlZGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDb21tb25GaWVsZHMoXG4gIG9ic2VydmVyTmFtZTogc3RyaW5nLFxuICBvcHRpb25zPzogQmFzZU9ic2VydmVyT3B0aW9uc1xuKTogQ29tbW9uRmllbGRzIHtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSByZXNvbHZlQ29ycmVsYXRpb25JZChvYnNlcnZlck5hbWUsIG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQpO1xuXG4gIHJldHVybiB7XG4gICAgY29ycmVsYXRpb25JZCxcbiAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IgPz8gY29udGV4dD8uYWN0b3IsXG4gICAgc291cmNlOiBvcHRpb25zPy5zb3VyY2UgPz8gY29udGV4dD8uc291cmNlLFxuICAgIHRhZ3M6IG1lcmdlT2JzZXJ2ZXJUYWdzKGNvbnRleHQ/LnRhZ3MsIG9wdGlvbnM/LnRhZ3MpLFxuICAgIG1ldGFkYXRhOiBvcHRpb25zPy5tZXRhZGF0YSxcbiAgfTtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IEJhc2VPYnNlcnZlck9wdGlvbnMgZnJvbSBFeGVjdXRpb25Db250ZXh0IG9yIHBhc3MgdGhyb3VnaCBpZiBhbHJlYWR5IG9wdGlvbnMuXG4gKiBcbiAqIFdoZW4gYW4gRXhlY3V0aW9uQ29udGV4dCAodGhlIGhhbmRsZXIgY29udGV4dCB3aXRoIGV2ZW50L3JlcXVlc3QvcmVzcG9uc2UpIGlzIHBhc3NlZCxcbiAqIGV4dHJhY3RzIGNvcnJlbGF0aW9uSWQgZnJvbSBleGVjdXRpb25Db250ZXh0IGZpcnN0ICh0aGUgQXN5bmNMb2NhbFN0b3JhZ2UgY29udGV4dCksXG4gKiB0aGVuIGZhbGxzIGJhY2sgdG8gYWN0b3IuY29ycmVsYXRpb25JZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RPYnNlcnZlck9wdGlvbnMoXG4gIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQgfCBCYXNlT2JzZXJ2ZXJPcHRpb25zXG4pOiBCYXNlT2JzZXJ2ZXJPcHRpb25zIHtcbiAgaWYgKCFjdHgpIHJldHVybiB7fTtcblxuICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgaGFuZGxlciBFeGVjdXRpb25Db250ZXh0IChoYXMgZXZlbnQgYW5kIGxhbWJkYUNvbnRleHQpXG4gIGlmICgnZXZlbnQnIGluIGN0eCAmJiAnbGFtYmRhQ29udGV4dCcgaW4gY3R4KSB7XG4gICAgY29uc3QgaGFuZGxlckN0eCA9IGN0eCBhcyBFeGVjdXRpb25Db250ZXh0O1xuICAgIHJldHVybiB7XG4gICAgICAvLyBQcmVmZXIgZXhlY3V0aW9uQ29udGV4dC5jb3JyZWxhdGlvbklkICh0aGUgcmVhbCB0cmFjZSBJRCBmcm9tIEFzeW5jTG9jYWxTdG9yYWdlKVxuICAgICAgLy8gRmFsbCBiYWNrIHRvIGFjdG9yLmNvcnJlbGF0aW9uSWQgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGhhbmRsZXJDdHguZXhlY3V0aW9uQ29udGV4dD8uY29ycmVsYXRpb25JZCA/PyBoYW5kbGVyQ3R4LmFjdG9yPy5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGhhbmRsZXJDdHguYWN0b3IsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBjdHggYXMgQmFzZU9ic2VydmVyT3B0aW9ucztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYW4gdW5rbm93biBjYXVnaHQgdmFsdWUgdG8gYW4gRXJyb3IuXG4gKiBJbiBKYXZhU2NyaXB0LCBjYXRjaCBibG9ja3MgY2FuIHJlY2VpdmUgYW55IHZhbHVlLCBub3QganVzdCBFcnJvciBvYmplY3RzLlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdHJ5IHtcbiAqICAgLy8gLi4uXG4gKiB9IGNhdGNoIChlcnJvcikge1xuICogICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBub3JtYWxpemVFcnJvcihlcnJvcik7XG4gKiAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVkRXJyb3IgfSk7XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUVycm9yKGVycm9yOiB1bmtub3duKTogRXJyb3Ige1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiBlcnJvcjtcbiAgfVxuICBpZiAodHlwZW9mIGVycm9yID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBuZXcgRXJyb3IoZXJyb3IpO1xuICB9XG4gIGlmIChlcnJvciAhPT0gbnVsbCAmJiB0eXBlb2YgZXJyb3IgPT09ICdvYmplY3QnKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yLWxpa2Ugb2JqZWN0cyB3aXRoIG1lc3NhZ2UgcHJvcGVydHlcbiAgICBjb25zdCBlcnJvck9iaiA9IGVycm9yIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZXJyb3JPYmoubWVzc2FnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihlcnJvck9iai5tZXNzYWdlKTtcbiAgICAgIGlmICh0eXBlb2YgZXJyb3JPYmoubmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZXJyLm5hbWUgPSBlcnJvck9iai5uYW1lO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBlcnJvck9iai5zdGFjayA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZXJyLnN0YWNrID0gZXJyb3JPYmouc3RhY2s7XG4gICAgICB9XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH1cbiAgfVxuICAvLyBGYWxsYmFjazogc3RyaW5naWZ5IHdoYXRldmVyIHdlIGdvdFxuICByZXR1cm4gbmV3IEVycm9yKFN0cmluZyhlcnJvcikpO1xufVxuXG4vKipcbiAqIE1hcCBFcnJvciB0byBPYnNlcnZhYmlsaXR5RXJyb3IgZm9ybWF0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXBFcnJvcihlcnJvcjogRXJyb3IpOiBPYnNlcnZhYmlsaXR5RXJyb3Ige1xuICAvLyBDaGVjayBmb3IgY29kZSBwcm9wZXJ0eSAoY29tbW9uIGluIE5vZGUuanMgZXJyb3JzKVxuICBjb25zdCBjb2RlID0gJ2NvZGUnIGluIGVycm9yICYmIHR5cGVvZiBlcnJvci5jb2RlID09PSAnc3RyaW5nJyA/IGVycm9yLmNvZGUgOiB1bmRlZmluZWQ7XG4gIHJldHVybiB7XG4gICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICBjb2RlLFxuICB9O1xufVxuXG4vKipcbiAqIENhcHR1cmUgYW4gZXZlbnQgdXNpbmcgY29tbW9uIGZpZWxkcy5cbiAqIEhhbmRsZXMgYWxsIHRoZSBib2lsZXJwbGF0ZSAtIG9ic2VydmVycyBzaG91bGQgdXNlIHRoaXMgaW5zdGVhZCBvZiBjYWxsaW5nIGNhcHR1cmUgZGlyZWN0bHkuXG4gKiBcbiAqIFVzZXMgZ2V0Q2FwdHVyZXIoKSBmb3IgdGVzdGFiaWxpdHkgLSBpbiB0ZXN0cywgY2FsbCBzZXRDYXB0dXJlcihtb2NrQ2FwdHVyZXIpIGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZUV2ZW50KFxuICBmaWVsZHM6IENvbW1vbkZpZWxkcyxcbiAgZXZlbnQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYge1xuICAgIG9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgICB0aW1lc3RhbXBNcz86IG51bWJlcjtcbiAgfSxcbiAgb3B0aW9ucz86IENhcHR1cmVPcHRpb25zXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gZ2V0Q2FwdHVyZXIoKS5jYXB0dXJlKFxuICAgIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZDogZmllbGRzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCA/PyBnZW5lcmF0ZUlkKCksXG4gICAgICB0aW1lc3RhbXBNczogZXZlbnQudGltZXN0YW1wTXMgPz8gRGF0ZS5ub3coKSxcbiAgICAgIGFjdG9yOiBldmVudC5hY3RvciA/PyBmaWVsZHMuYWN0b3IsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSA/PyBmaWVsZHMuc291cmNlLFxuICAgICAgdGFnczogbWVyZ2VPYnNlcnZlclRhZ3MoZmllbGRzLnRhZ3MsIGV2ZW50LnRhZ3MpLFxuICAgICAgbWV0YWRhdGE6IGV2ZW50Lm1ldGFkYXRhID8/IGZpZWxkcy5tZXRhZGF0YSxcbiAgICB9LFxuICAgIG9wdGlvbnNcbiAgKTtcbn1cblxuLyoqXG4gKiBDYXB0dXJlIGFuIGV2ZW50IGFzeW5jaHJvbm91c2x5IHVzaW5nIGNvbW1vbiBmaWVsZHMuXG4gKiBVc2Ugd2hlbiB5b3UgbmVlZCB0byBhd2FpdCBiYWNrZW5kIGNvbXBsZXRpb24gKGUuZy4sIGZvciBjcml0aWNhbCBhdWRpdHMpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZUV2ZW50QXN5bmMoXG4gIGZpZWxkczogQ29tbW9uRmllbGRzLFxuICBldmVudDogT21pdDxDYXB0dXJlSW5wdXQsICdjb3JyZWxhdGlvbklkJyB8ICdvYnNlcnZhYmlsaXR5TG9nSWQnIHwgJ3RpbWVzdGFtcE1zJz4gJiB7XG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICAgIHRpbWVzdGFtcE1zPzogbnVtYmVyO1xuICB9LFxuICBvcHRpb25zPzogT21pdDxDYXB0dXJlT3B0aW9ucywgJ3N5bmMnPlxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgcmV0dXJuIGdldENhcHR1cmVyKCkuY2FwdHVyZUFzeW5jKFxuICAgIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZDogZmllbGRzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCA/PyBnZW5lcmF0ZUlkKCksXG4gICAgICB0aW1lc3RhbXBNczogZXZlbnQudGltZXN0YW1wTXMgPz8gRGF0ZS5ub3coKSxcbiAgICAgIGFjdG9yOiBldmVudC5hY3RvciA/PyBmaWVsZHMuYWN0b3IsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSA/PyBmaWVsZHMuc291cmNlLFxuICAgICAgdGFnczogbWVyZ2VPYnNlcnZlclRhZ3MoZmllbGRzLnRhZ3MsIGV2ZW50LnRhZ3MpLFxuICAgICAgbWV0YWRhdGE6IGV2ZW50Lm1ldGFkYXRhID8/IGZpZWxkcy5tZXRhZGF0YSxcbiAgICB9LFxuICAgIG9wdGlvbnNcbiAgKTtcbn1cbiJdfQ==