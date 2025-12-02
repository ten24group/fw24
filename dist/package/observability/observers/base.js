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
 * The event capturer - MUST be set by manager.ts during initialization
 *
 * This breaks the circular dependency:
 * - base.ts defines the interface and placeholder
 * - manager.ts imports base.ts (no circular dep since we don't import manager)
 * - manager.ts calls initializeCapturer() to inject itself
 */
let eventCapturer = null;
/**
 * Initialize the capturer - called by ObservabilityManager during initialization.
 * This breaks the circular dependency by having the manager inject itself.
 *
 * @internal - Only called by manager.ts
 */
function initializeCapturer(capturer) {
    if (!eventCapturer) {
        eventCapturer = capturer;
    }
}
/**
 * Get the event capturer.
 * Throws if not initialized - manager.ts must call initializeCapturer() first.
 */
function getCapturer() {
    if (!eventCapturer) {
        throw new Error('Observer not initialized. Ensure ObservabilityManager is imported before using observers. ' +
            'This is a framework bug if you see this error.');
    }
    return eventCapturer;
}
/**
 * Set a custom event capturer (for testing)
 *
 * @example
 * ```typescript
 * // In tests:
 * const mockCapturer = {
 *   capture: jest.fn().mockReturnValue('test-log-id'),
 *   captureAsync: jest.fn().mockResolvedValue('test-log-id'),
 * };
 * setCapturer(mockCapturer);
 *
 * // Run your observer tests...
 *
 * // Reset after tests:
 * resetCapturer();
 * ```
 */
function setCapturer(capturer) {
    eventCapturer = capturer;
}
/**
 * Reset capturer to default (for testing cleanup)
 */
function resetCapturer() {
    eventCapturer = null;
}
/**
 * Generate a unique ID
 */
function generateId() {
    return (0, crypto_1.randomUUID)();
}
/**
 * Resolve correlation ID from explicit value or context
 */
function resolveCorrelationId(observerName, explicitId) {
    const correlationId = explicitId ?? (0, context_1.getCorrelationIdIfExists)();
    if (!correlationId) {
        baseLogger.warn(`${observerName}: No correlationId available. ` +
            'Establish context with runWithContext() or use middleware.');
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
 * Returns undefined if correlationId is not available.
 */
function buildCommonFields(observerName, options) {
    const context = (0, context_1.getCurrentContext)();
    const correlationId = resolveCorrelationId(observerName, options?.correlationId);
    if (!correlationId)
        return undefined;
    return {
        correlationId,
        actor: options?.actor ?? context?.actor,
        source: options?.source ?? context?.source,
        tags: mergeObserverTags(context?.tags, options?.tags),
        metadata: options?.metadata,
    };
}
/**
 * Extract BaseObserverOptions from ExecutionContext or pass through if already options
 */
function extractObserverOptions(ctx) {
    if (!ctx)
        return {};
    if ('event' in ctx && 'lambdaContext' in ctx) {
        const execCtx = ctx;
        return {
            correlationId: execCtx.actor?.correlationId,
            actor: execCtx.actor,
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
        logId: event.logId ?? generateId(),
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
        logId: event.logId ?? generateId(),
        timestampMs: event.timestampMs ?? Date.now(),
        actor: event.actor ?? fields.actor,
        source: event.source ?? fields.source,
        tags: mergeObserverTags(fields.tags, event.tags),
        metadata: event.metadata ?? fields.metadata,
    }, options);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUEwQkgsZ0RBSUM7QUFrQ0Qsa0NBRUM7QUFLRCxzQ0FFQztBQWdDRCxnQ0FFQztBQUtELG9EQVlDO0FBS0QsOENBTUM7QUFNRCw4Q0FnQkM7QUFLRCx3REFjQztBQWdCRCx3Q0F1QkM7QUFLRCw0QkFTQztBQVFELG9DQXFCQztBQU1ELDhDQXFCQztBQTNSRCxtQ0FBb0M7QUFFcEMsd0NBQXlFO0FBRXpFLDJDQUE2QztBQUU3QyxNQUFNLFVBQVUsR0FBRyxJQUFBLHNCQUFZLEVBQUMsVUFBVSxDQUFDLENBQUM7QUFFNUM7Ozs7Ozs7R0FPRztBQUNILElBQUksYUFBYSxHQUF5QixJQUFJLENBQUM7QUFFL0M7Ozs7O0dBS0c7QUFDSCxTQUFnQixrQkFBa0IsQ0FBQyxRQUF1QjtJQUN4RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDbkIsYUFBYSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsV0FBVztJQUNsQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FDYiw0RkFBNEY7WUFDNUYsZ0RBQWdELENBQ2pELENBQUM7SUFDSixDQUFDO0lBQ0QsT0FBTyxhQUFhLENBQUM7QUFDdkIsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUNILFNBQWdCLFdBQVcsQ0FBQyxRQUF1QjtJQUNqRCxhQUFhLEdBQUcsUUFBUSxDQUFDO0FBQzNCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGFBQWE7SUFDM0IsYUFBYSxHQUFHLElBQUksQ0FBQztBQUN2QixDQUFDO0FBNkJEOztHQUVHO0FBQ0gsU0FBZ0IsVUFBVTtJQUN4QixPQUFP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LEVBQUUsS0FBSyxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUTtLQUM1QyxFQUNELE9BQU8sQ0FDUixDQUFDO0FBQ0osQ0FBQztBQUVEOzs7R0FHRztBQUNJLEtBQUssVUFBVSxpQkFBaUIsQ0FDckMsTUFBb0IsRUFDcEIsS0FHQyxFQUNELE9BQXNDO0lBRXRDLE9BQU8sV0FBVyxFQUFFLENBQUMsWUFBWSxDQUMvQjtRQUNFLEdBQUcsS0FBSztRQUNSLGFBQWEsRUFBRSxNQUFNLENBQUMsYUFBYTtRQUNuQyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssSUFBSSxVQUFVLEVBQUU7UUFDbEMsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUM1QyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUMsS0FBSztRQUNsQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTTtRQUNyQyxJQUFJLEVBQUUsaUJBQWlCLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDO1FBQ2hELFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRO0tBQzVDLEVBQ0QsT0FBTyxDQUNSLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBCYXNlIHV0aWxpdGllcyBmb3Igb2JzZXJ2ZXJzXG4gKiBcbiAqIFByb3ZpZGVzIHNoYXJlZCBmdW5jdGlvbmFsaXR5IHRvIHJlZHVjZSBjb2RlIGR1cGxpY2F0aW9uIGFjcm9zcyBvYnNlcnZlcnMuXG4gKiBBbGwgb2JzZXJ2ZXJzIHNob3VsZCB1c2UgdGhlc2UgdXRpbGl0aWVzIGluc3RlYWQgb2YgZHVwbGljYXRpbmcgbG9naWMuXG4gKiBcbiAqIFRFU1RBQklMSVRZOiBVc2VzIElFdmVudENhcHR1cmUgaW50ZXJmYWNlIHdpdGggc2V0Q2FwdHVyZXIoKSBmb3IgZGVwZW5kZW5jeSBpbmplY3Rpb24uXG4gKiBJbiB0ZXN0cywgY2FsbCBzZXRDYXB0dXJlcihtb2NrQ2FwdHVyZXIpIGJlZm9yZSBydW5uaW5nIG9ic2VydmVyIHRlc3RzLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IENhcHR1cmVJbnB1dCwgQ2FwdHVyZU9wdGlvbnMsIElFdmVudENhcHR1cmUsIE9ic2VydmFiaWxpdHlFcnJvciB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuXG5jb25zdCBiYXNlTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZlcicpO1xuXG4vKipcbiAqIFRoZSBldmVudCBjYXB0dXJlciAtIE1VU1QgYmUgc2V0IGJ5IG1hbmFnZXIudHMgZHVyaW5nIGluaXRpYWxpemF0aW9uXG4gKiBcbiAqIFRoaXMgYnJlYWtzIHRoZSBjaXJjdWxhciBkZXBlbmRlbmN5OlxuICogLSBiYXNlLnRzIGRlZmluZXMgdGhlIGludGVyZmFjZSBhbmQgcGxhY2Vob2xkZXJcbiAqIC0gbWFuYWdlci50cyBpbXBvcnRzIGJhc2UudHMgKG5vIGNpcmN1bGFyIGRlcCBzaW5jZSB3ZSBkb24ndCBpbXBvcnQgbWFuYWdlcilcbiAqIC0gbWFuYWdlci50cyBjYWxscyBpbml0aWFsaXplQ2FwdHVyZXIoKSB0byBpbmplY3QgaXRzZWxmXG4gKi9cbmxldCBldmVudENhcHR1cmVyOiBJRXZlbnRDYXB0dXJlIHwgbnVsbCA9IG51bGw7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSB0aGUgY2FwdHVyZXIgLSBjYWxsZWQgYnkgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgZHVyaW5nIGluaXRpYWxpemF0aW9uLlxuICogVGhpcyBicmVha3MgdGhlIGNpcmN1bGFyIGRlcGVuZGVuY3kgYnkgaGF2aW5nIHRoZSBtYW5hZ2VyIGluamVjdCBpdHNlbGYuXG4gKiBcbiAqIEBpbnRlcm5hbCAtIE9ubHkgY2FsbGVkIGJ5IG1hbmFnZXIudHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluaXRpYWxpemVDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBpZiAoIWV2ZW50Q2FwdHVyZXIpIHtcbiAgICBldmVudENhcHR1cmVyID0gY2FwdHVyZXI7XG4gIH1cbn1cblxuLyoqXG4gKiBHZXQgdGhlIGV2ZW50IGNhcHR1cmVyLlxuICogVGhyb3dzIGlmIG5vdCBpbml0aWFsaXplZCAtIG1hbmFnZXIudHMgbXVzdCBjYWxsIGluaXRpYWxpemVDYXB0dXJlcigpIGZpcnN0LlxuICovXG5mdW5jdGlvbiBnZXRDYXB0dXJlcigpOiBJRXZlbnRDYXB0dXJlIHtcbiAgaWYgKCFldmVudENhcHR1cmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ09ic2VydmVyIG5vdCBpbml0aWFsaXplZC4gRW5zdXJlIE9ic2VydmFiaWxpdHlNYW5hZ2VyIGlzIGltcG9ydGVkIGJlZm9yZSB1c2luZyBvYnNlcnZlcnMuICcgK1xuICAgICAgJ1RoaXMgaXMgYSBmcmFtZXdvcmsgYnVnIGlmIHlvdSBzZWUgdGhpcyBlcnJvci4nXG4gICAgKTtcbiAgfVxuICByZXR1cm4gZXZlbnRDYXB0dXJlcjtcbn1cblxuLyoqXG4gKiBTZXQgYSBjdXN0b20gZXZlbnQgY2FwdHVyZXIgKGZvciB0ZXN0aW5nKVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gSW4gdGVzdHM6XG4gKiBjb25zdCBtb2NrQ2FwdHVyZXIgPSB7XG4gKiAgIGNhcHR1cmU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoJ3Rlc3QtbG9nLWlkJyksXG4gKiAgIGNhcHR1cmVBc3luYzogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKCd0ZXN0LWxvZy1pZCcpLFxuICogfTtcbiAqIHNldENhcHR1cmVyKG1vY2tDYXB0dXJlcik7XG4gKiBcbiAqIC8vIFJ1biB5b3VyIG9ic2VydmVyIHRlc3RzLi4uXG4gKiBcbiAqIC8vIFJlc2V0IGFmdGVyIHRlc3RzOlxuICogcmVzZXRDYXB0dXJlcigpO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBldmVudENhcHR1cmVyID0gY2FwdHVyZXI7XG59XG5cbi8qKlxuICogUmVzZXQgY2FwdHVyZXIgdG8gZGVmYXVsdCAoZm9yIHRlc3RpbmcgY2xlYW51cClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0Q2FwdHVyZXIoKTogdm9pZCB7XG4gIGV2ZW50Q2FwdHVyZXIgPSBudWxsO1xufVxuXG4vKipcbiAqIFN0YW5kYXJkIG9wdGlvbnMgc2hhcmVkIGJ5IGFsbCBvYnNlcnZlcnNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBCYXNlT2JzZXJ2ZXJPcHRpb25zIHtcbiAgLyoqIEV4cGxpY2l0IGNvcnJlbGF0aW9uIElEIChkZWZhdWx0cyB0byBjb250ZXh0KSAqL1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAvKiogQWN0b3IgcGVyZm9ybWluZyB0aGUgYWN0aW9uICovXG4gIGFjdG9yPzogQWN0b3I7XG4gIC8qKiBTb3VyY2UgaWRlbnRpZmllciAqL1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIC8qKiBUYWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBBZGRpdGlvbmFsIG1ldGFkYXRhICovXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogQ29tbW9uIGZpZWxkcyBkZXJpdmVkIGZyb20gY29udGV4dCBhbmQgb3B0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1vbkZpZWxkcyB7XG4gIGNvcnJlbGF0aW9uSWQ6IHN0cmluZztcbiAgYWN0b3I/OiBBY3RvcjtcbiAgc291cmNlPzogc3RyaW5nO1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHVuaXF1ZSBJRFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVJZCgpOiBzdHJpbmcge1xuICByZXR1cm4gcmFuZG9tVVVJRCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmUgY29ycmVsYXRpb24gSUQgZnJvbSBleHBsaWNpdCB2YWx1ZSBvciBjb250ZXh0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQ29ycmVsYXRpb25JZChcbiAgb2JzZXJ2ZXJOYW1lOiBzdHJpbmcsXG4gIGV4cGxpY2l0SWQ/OiBzdHJpbmdcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBleHBsaWNpdElkID8/IGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cygpO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICBiYXNlTG9nZ2VyLndhcm4oXG4gICAgICBgJHtvYnNlcnZlck5hbWV9OiBObyBjb3JyZWxhdGlvbklkIGF2YWlsYWJsZS4gYCArXG4gICAgICAnRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBydW5XaXRoQ29udGV4dCgpIG9yIHVzZSBtaWRkbGV3YXJlLidcbiAgICApO1xuICB9XG4gIHJldHVybiBjb3JyZWxhdGlvbklkO1xufVxuXG4vKipcbiAqIE1lcmdlIHRhZ3MgZnJvbSBjb250ZXh0IGFuZCBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZU9ic2VydmVyVGFncyhcbiAgY29udGV4dFRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICBvcHRpb25UYWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCB7XG4gIGlmICghY29udGV4dFRhZ3MgJiYgIW9wdGlvblRhZ3MpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB7IC4uLmNvbnRleHRUYWdzLCAuLi5vcHRpb25UYWdzIH07XG59XG5cbi8qKlxuICogQnVpbGQgY29tbW9uIGZpZWxkcyBmcm9tIGNvbnRleHQgYW5kIG9wdGlvbnMuXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiBjb3JyZWxhdGlvbklkIGlzIG5vdCBhdmFpbGFibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENvbW1vbkZpZWxkcyhcbiAgb2JzZXJ2ZXJOYW1lOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiBCYXNlT2JzZXJ2ZXJPcHRpb25zXG4pOiBDb21tb25GaWVsZHMgfCB1bmRlZmluZWQge1xuICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IHJlc29sdmVDb3JyZWxhdGlvbklkKG9ic2VydmVyTmFtZSwgb3B0aW9ucz8uY29ycmVsYXRpb25JZCk7XG4gIFxuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICBjb3JyZWxhdGlvbklkLFxuICAgIGFjdG9yOiBvcHRpb25zPy5hY3RvciA/PyBjb250ZXh0Py5hY3RvcixcbiAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSA/PyBjb250ZXh0Py5zb3VyY2UsXG4gICAgdGFnczogbWVyZ2VPYnNlcnZlclRhZ3MoY29udGV4dD8udGFncywgb3B0aW9ucz8udGFncyksXG4gICAgbWV0YWRhdGE6IG9wdGlvbnM/Lm1ldGFkYXRhLFxuICB9O1xufVxuXG4vKipcbiAqIEV4dHJhY3QgQmFzZU9ic2VydmVyT3B0aW9ucyBmcm9tIEV4ZWN1dGlvbkNvbnRleHQgb3IgcGFzcyB0aHJvdWdoIGlmIGFscmVhZHkgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE9ic2VydmVyT3B0aW9ucyhcbiAgY3R4PzogRXhlY3V0aW9uQ29udGV4dCB8IEJhc2VPYnNlcnZlck9wdGlvbnNcbik6IEJhc2VPYnNlcnZlck9wdGlvbnMge1xuICBpZiAoIWN0eCkgcmV0dXJuIHt9O1xuXG4gIGlmICgnZXZlbnQnIGluIGN0eCAmJiAnbGFtYmRhQ29udGV4dCcgaW4gY3R4KSB7XG4gICAgY29uc3QgZXhlY0N0eCA9IGN0eCBhcyBFeGVjdXRpb25Db250ZXh0O1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBleGVjQ3R4LmFjdG9yPy5jb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IGV4ZWNDdHguYWN0b3IsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBjdHggYXMgQmFzZU9ic2VydmVyT3B0aW9ucztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYW4gdW5rbm93biBjYXVnaHQgdmFsdWUgdG8gYW4gRXJyb3IuXG4gKiBJbiBKYXZhU2NyaXB0LCBjYXRjaCBibG9ja3MgY2FuIHJlY2VpdmUgYW55IHZhbHVlLCBub3QganVzdCBFcnJvciBvYmplY3RzLlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdHJ5IHtcbiAqICAgLy8gLi4uXG4gKiB9IGNhdGNoIChlcnJvcikge1xuICogICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBub3JtYWxpemVFcnJvcihlcnJvcik7XG4gKiAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVkRXJyb3IgfSk7XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUVycm9yKGVycm9yOiB1bmtub3duKTogRXJyb3Ige1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiBlcnJvcjtcbiAgfVxuICBpZiAodHlwZW9mIGVycm9yID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBuZXcgRXJyb3IoZXJyb3IpO1xuICB9XG4gIGlmIChlcnJvciAhPT0gbnVsbCAmJiB0eXBlb2YgZXJyb3IgPT09ICdvYmplY3QnKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yLWxpa2Ugb2JqZWN0cyB3aXRoIG1lc3NhZ2UgcHJvcGVydHlcbiAgICBjb25zdCBlcnJvck9iaiA9IGVycm9yIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICh0eXBlb2YgZXJyb3JPYmoubWVzc2FnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihlcnJvck9iai5tZXNzYWdlKTtcbiAgICAgIGlmICh0eXBlb2YgZXJyb3JPYmoubmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZXJyLm5hbWUgPSBlcnJvck9iai5uYW1lO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBlcnJvck9iai5zdGFjayA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgZXJyLnN0YWNrID0gZXJyb3JPYmouc3RhY2s7XG4gICAgICB9XG4gICAgICByZXR1cm4gZXJyO1xuICAgIH1cbiAgfVxuICAvLyBGYWxsYmFjazogc3RyaW5naWZ5IHdoYXRldmVyIHdlIGdvdFxuICByZXR1cm4gbmV3IEVycm9yKFN0cmluZyhlcnJvcikpO1xufVxuXG4vKipcbiAqIE1hcCBFcnJvciB0byBPYnNlcnZhYmlsaXR5RXJyb3IgZm9ybWF0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXBFcnJvcihlcnJvcjogRXJyb3IpOiBPYnNlcnZhYmlsaXR5RXJyb3Ige1xuICAvLyBDaGVjayBmb3IgY29kZSBwcm9wZXJ0eSAoY29tbW9uIGluIE5vZGUuanMgZXJyb3JzKVxuICBjb25zdCBjb2RlID0gJ2NvZGUnIGluIGVycm9yICYmIHR5cGVvZiBlcnJvci5jb2RlID09PSAnc3RyaW5nJyA/IGVycm9yLmNvZGUgOiB1bmRlZmluZWQ7XG4gIHJldHVybiB7XG4gICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICBjb2RlLFxuICB9O1xufVxuXG4vKipcbiAqIENhcHR1cmUgYW4gZXZlbnQgdXNpbmcgY29tbW9uIGZpZWxkcy5cbiAqIEhhbmRsZXMgYWxsIHRoZSBib2lsZXJwbGF0ZSAtIG9ic2VydmVycyBzaG91bGQgdXNlIHRoaXMgaW5zdGVhZCBvZiBjYWxsaW5nIGNhcHR1cmUgZGlyZWN0bHkuXG4gKiBcbiAqIFVzZXMgZ2V0Q2FwdHVyZXIoKSBmb3IgdGVzdGFiaWxpdHkgLSBpbiB0ZXN0cywgY2FsbCBzZXRDYXB0dXJlcihtb2NrQ2FwdHVyZXIpIGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZUV2ZW50KFxuICBmaWVsZHM6IENvbW1vbkZpZWxkcyxcbiAgZXZlbnQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnbG9nSWQnIHwgJ3RpbWVzdGFtcE1zJz4gJiB7XG4gICAgbG9nSWQ/OiBzdHJpbmc7XG4gICAgdGltZXN0YW1wTXM/OiBudW1iZXI7XG4gIH0sXG4gIG9wdGlvbnM/OiBDYXB0dXJlT3B0aW9uc1xuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGdldENhcHR1cmVyKCkuY2FwdHVyZShcbiAgICB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGZpZWxkcy5jb3JyZWxhdGlvbklkLFxuICAgICAgbG9nSWQ6IGV2ZW50LmxvZ0lkID8/IGdlbmVyYXRlSWQoKSxcbiAgICAgIHRpbWVzdGFtcE1zOiBldmVudC50aW1lc3RhbXBNcyA/PyBEYXRlLm5vdygpLFxuICAgICAgYWN0b3I6IGV2ZW50LmFjdG9yID8/IGZpZWxkcy5hY3RvcixcbiAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlID8/IGZpZWxkcy5zb3VyY2UsXG4gICAgICB0YWdzOiBtZXJnZU9ic2VydmVyVGFncyhmaWVsZHMudGFncywgZXZlbnQudGFncyksXG4gICAgICBtZXRhZGF0YTogZXZlbnQubWV0YWRhdGEgPz8gZmllbGRzLm1ldGFkYXRhLFxuICAgIH0sXG4gICAgb3B0aW9uc1xuICApO1xufVxuXG4vKipcbiAqIENhcHR1cmUgYW4gZXZlbnQgYXN5bmNocm9ub3VzbHkgdXNpbmcgY29tbW9uIGZpZWxkcy5cbiAqIFVzZSB3aGVuIHlvdSBuZWVkIHRvIGF3YWl0IGJhY2tlbmQgY29tcGxldGlvbiAoZS5nLiwgZm9yIGNyaXRpY2FsIGF1ZGl0cykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYXB0dXJlRXZlbnRBc3luYyhcbiAgZmllbGRzOiBDb21tb25GaWVsZHMsXG4gIGV2ZW50OiBPbWl0PENhcHR1cmVJbnB1dCwgJ2NvcnJlbGF0aW9uSWQnIHwgJ2xvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYge1xuICAgIGxvZ0lkPzogc3RyaW5nO1xuICAgIHRpbWVzdGFtcE1zPzogbnVtYmVyO1xuICB9LFxuICBvcHRpb25zPzogT21pdDxDYXB0dXJlT3B0aW9ucywgJ3N5bmMnPlxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgcmV0dXJuIGdldENhcHR1cmVyKCkuY2FwdHVyZUFzeW5jKFxuICAgIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZDogZmllbGRzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBsb2dJZDogZXZlbnQubG9nSWQgPz8gZ2VuZXJhdGVJZCgpLFxuICAgICAgdGltZXN0YW1wTXM6IGV2ZW50LnRpbWVzdGFtcE1zID8/IERhdGUubm93KCksXG4gICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPz8gZmllbGRzLmFjdG9yLFxuICAgICAgc291cmNlOiBldmVudC5zb3VyY2UgPz8gZmllbGRzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBldmVudC50YWdzKSxcbiAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSA/PyBmaWVsZHMubWV0YWRhdGEsXG4gICAgfSxcbiAgICBvcHRpb25zXG4gICk7XG59XG4iXX0=