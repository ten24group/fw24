"use strict";
/**
 * Base Observer Utilities
 *
 * Provides shared functionality for all observers:
 * - Event capture via IEventCapture interface
 * - Context resolution utilities
 * - Error normalization
 * - ID generation
 *
 * DESIGN:
 * - Observers use RecordOverrides from types.ts for options
 * - No duplicate type definitions here
 * - Simple capture function that takes CaptureInput
 * - Context resolution handled by manager
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeCapturer = initializeCapturer;
exports.setCapturer = setCapturer;
exports.resetCapturer = resetCapturer;
exports.generateId = generateId;
exports.resolveCorrelationId = resolveCorrelationId;
exports.mergeTags = mergeTags;
exports.normalizeError = normalizeError;
exports.mapError = mapError;
exports.buildCaptureInput = buildCaptureInput;
exports.captureRecord = captureRecord;
exports.captureRecordAsync = captureRecordAsync;
const storage_1 = require("../../core/runtime/execution-context/storage");
const logging_1 = require("../../logging");
const id_generator_1 = require("../utils/id-generator");
const merge_1 = require("../../utils/merge");
const baseLogger = (0, logging_1.createLogger)('Observer');
// ═══════════════════════════════════════════════════════════════════════════
// CAPTURER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Event Capturer Registry
 *
 * Simple registry for the event capturer (ObservabilityManager).
 * Enables testability via dependency injection.
 */
class CapturerRegistry {
    capturer = null;
    warnedNotInitialized = false;
    /** Initialize the capturer (called by ObservabilityManager during initialization) */
    initialize(capturer) {
        if (!this.capturer) {
            this.capturer = capturer;
            this.warnedNotInitialized = false; // Reset warning flag on initialization
        }
    }
    /**
     * Get the event capturer or null if not initialized.
     * Use this for soft-fail capture (won't crash application code if observability isn't initialized yet).
     */
    tryGet() {
        if (!this.capturer && !this.warnedNotInitialized) {
            this.warnedNotInitialized = true;
            baseLogger.warn('Observability not initialized. ObservabilityManager must initialize before observers can be used. ' +
                'Observability events will be silently dropped until initialization. ' +
                'This usually means observers are being used before the framework has initialized.');
        }
        return this.capturer;
    }
    /** Get the event capturer. Throws if not initialized. */
    get() {
        if (!this.capturer) {
            throw new Error('Observability not initialized. ObservabilityManager must initialize before observers can be used. ' +
                'This usually means you are using observers before the framework has initialized. ' +
                'If you see this error, import ObservabilityManager somewhere in your code to trigger initialization.');
        }
        return this.capturer;
    }
    /** Set a custom capturer (for testing) */
    set(capturer) {
        this.capturer = capturer;
    }
    /** Reset to uninitialized state (for testing cleanup) */
    reset() {
        this.capturer = null;
        this.warnedNotInitialized = false;
    }
}
const capturerRegistry = new CapturerRegistry();
/** Initialize the capturer - called by ObservabilityManager @internal */
function initializeCapturer(capturer) {
    capturerRegistry.initialize(capturer);
}
/** Set a custom event capturer (for testing) */
function setCapturer(capturer) {
    capturerRegistry.set(capturer);
}
/** Reset capturer to default (for testing cleanup) */
function resetCapturer() {
    capturerRegistry.reset();
}
// ═══════════════════════════════════════════════════════════════════════════
// ID GENERATION
// ═══════════════════════════════════════════════════════════════════════════
/** Generate a unique ID (W3C Span ID format - 16 hex chars) */
function generateId() {
    return (0, id_generator_1.generateSpanId)();
}
// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Resolve correlation ID from explicit value or context.
 *
 * Returns undefined if no correlationId is available - caller should NOT capture.
 * NEVER auto-generates - that would break trace continuity and hide bugs.
 */
function resolveCorrelationId(observerName, explicitId) {
    const ctx = (0, storage_1.getCurrentExecutionContext)();
    const correlationId = explicitId ?? ctx?.correlationId;
    if (!correlationId) {
        baseLogger.warn(`${observerName}: No execution context established. ` +
            'Context is auto-established in controllers, or use runWithExecutionContext() before using observers. ' +
            'Event will NOT be captured - fix the missing context.');
        return undefined;
    }
    return correlationId;
}
/**
 * Merge tags from multiple sources.
 * Later sources override earlier ones.
 */
function mergeTags(...sources) {
    const result = {};
    let hasAny = false;
    for (const source of sources) {
        if (source) {
            Object.assign(result, source);
            hasAny = true;
        }
    }
    return hasAny ? result : undefined;
}
// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Normalize an unknown caught value to an Error.
 * In JavaScript, catch blocks can receive any value.
 */
function normalizeError(error) {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }
    if (error !== null && typeof error === 'object') {
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
    return new Error(String(error));
}
/**
 * Map Error to ObservabilityError format
 */
function mapError(error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
        type: error.name,
        message: error.message,
        stack: error.stack,
        code,
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// CAPTURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Build complete CaptureInput from partial input + context.
 *
 * This is the key function that resolves context and fills in defaults.
 * Observers call this with their specific fields, context fills the rest.
 *
 * Returns undefined if no correlationId can be resolved - event should NOT be captured.
 */
function buildCaptureInput(observerName, input) {
    const ctx = (0, storage_1.getCurrentExecutionContext)();
    const state = (0, storage_1.getObservabilityState)();
    // Resolve correlationId - if undefined, we can't capture
    // Pass only explicit input.correlationId - resolveCorrelationId handles context fallback
    const correlationId = resolveCorrelationId(observerName, input.correlationId);
    if (!correlationId) {
        return undefined;
    }
    // Resolve parent: explicit > context span tree > undefined
    // CRITICAL: If causedBy is explicitly provided, DO NOT auto-populate parent.
    // causedBy indicates cross-invocation linkage (e.g., stream processing → original request).
    // In this case, the event is a ROOT in the current invocation, not a child.
    const parentLogId = input.parentObservabilityLogId !== undefined
        ? input.parentObservabilityLogId
        : (input.causedBy === undefined ? (0, storage_1.getCurrentParentObservabilityLogId)() : undefined);
    // NOTE:
    // Parent/child integrity is enforced at flush-time by building a graph of buffered events.
    // We intentionally do not do any manual "parent reference registration" here.
    return {
        // Identity
        observabilityLogId: input.observabilityLogId ?? (0, id_generator_1.generateObservabilityLogId)(correlationId),
        timestampMs: input.timestampMs ?? Date.now(),
        // Classification (required from input)
        type: input.type,
        level: input.level,
        // Trace context
        correlationId,
        parentObservabilityLogId: parentLogId ?? undefined,
        causedBy: input.causedBy ?? ctx?.causedBy,
        relatedTraces: input.relatedTraces,
        // Entity
        entityName: input.entityName,
        entityId: input.entityId,
        // Operation
        operation: input.operation,
        subType: input.subType,
        status: input.status,
        success: input.success,
        durationMs: input.durationMs,
        // Actor & source (from input or context)
        actor: input.actor ?? ctx?.actor,
        source: input.source ?? state?.source,
        tags: mergeTags(state?.tags, input.tags),
        // Payloads
        data: input.data,
        attributes: input.attributes,
        // Deep merge context-level metadata (from withContext) with event-level metadata
        metadata: state?.metadata || input.metadata
            ? ((0, merge_1.merge)([state?.metadata, input.metadata]) ?? undefined)
            : undefined,
        metrics: input.metrics,
        context: input.context,
        error: input.error,
        // Capture control (pass through as-is)
        capture: input.capture,
    };
}
/**
 * Capture an event.
 *
 * This is the main function observers use. It:
 * 1. Builds complete CaptureInput from partial input + context
 * 2. Sends to capturer (ObservabilityManager)
 *
 * Returns undefined if:
 * - Observability not initialized
 * - No execution context (no correlationId)
 * - Filtered/sampled out
 *
 * @param observerName - Name of the calling observer (for error messages)
 * @param input - Partial input (required: type, level)
 * @returns observabilityLogId if captured, undefined otherwise
 */
function captureRecord(observerName, input) {
    // Defensive: don't crash user code if observability not initialized
    const capturer = capturerRegistry.tryGet();
    if (!capturer) {
        return undefined;
    }
    // Build full input - returns undefined if no context (no correlationId)
    const fullInput = buildCaptureInput(observerName, input);
    if (!fullInput) {
        return undefined;
    }
    return capturer.capture(fullInput);
}
/**
 * Capture an event asynchronously.
 * Use when you need to await backend completion.
 *
 * Returns undefined if:
 * - Observability not initialized
 * - No execution context (no correlationId)
 * - Filtered/sampled out
 */
async function captureRecordAsync(observerName, input) {
    // Defensive: don't crash user code if observability not initialized
    const capturer = capturerRegistry.tryGet();
    if (!capturer) {
        return undefined;
    }
    // Build full input - returns undefined if no context (no correlationId)
    const fullInput = buildCaptureInput(observerName, input);
    if (!fullInput) {
        return undefined;
    }
    return capturer.captureAsync(fullInput);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7R0FjRzs7QUFnRkgsZ0RBRUM7QUFHRCxrQ0FFQztBQUdELHNDQUVDO0FBT0QsZ0NBRUM7QUFZRCxvREFjQztBQU1ELDhCQWNDO0FBVUQsd0NBcUJDO0FBS0QsNEJBUUM7QUFjRCw4Q0EyRUM7QUFrQkQsc0NBb0JDO0FBV0QsZ0RBb0JDO0FBMVZELDBFQUlzRDtBQUV0RCwyQ0FBNkM7QUFDN0Msd0RBQW9HO0FBQ3BHLDZDQUEwQztBQUUxQyxNQUFNLFVBQVUsR0FBRyxJQUFBLHNCQUFZLEVBQUMsVUFBVSxDQUFDLENBQUM7QUFFNUMsOEVBQThFO0FBQzlFLG9CQUFvQjtBQUNwQiw4RUFBOEU7QUFFOUU7Ozs7O0dBS0c7QUFDSCxNQUFNLGdCQUFnQjtJQUNaLFFBQVEsR0FBeUIsSUFBSSxDQUFDO0lBQ3RDLG9CQUFvQixHQUFHLEtBQUssQ0FBQztJQUVyQyxxRkFBcUY7SUFDckYsVUFBVSxDQUFDLFFBQXVCO1FBQ2hDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7WUFDekIsSUFBSSxDQUFDLG9CQUFvQixHQUFHLEtBQUssQ0FBQyxDQUFDLHVDQUF1QztRQUM1RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQ2pELElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUM7WUFDakMsVUFBVSxDQUFDLElBQUksQ0FDYixvR0FBb0c7Z0JBQ3BHLHNFQUFzRTtnQkFDdEUsbUZBQW1GLENBQ3BGLENBQUM7UUFDSixD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R0FBRyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUMzQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDZCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsd0VBQXdFO0lBQ3hFLE1BQU0sU0FBUyxHQUFHLGlCQUFpQixDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN6RCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDZixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3JDLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNJLEtBQUssVUFBVSxrQkFBa0IsQ0FDdEMsWUFBb0IsRUFDcEIsS0FHQztJQUVELG9FQUFvRTtJQUNwRSxNQUFNLFFBQVEsR0FBRyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUMzQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDZCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsd0VBQXdFO0lBQ3hFLE1BQU0sU0FBUyxHQUFHLGlCQUFpQixDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN6RCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDZixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEJhc2UgT2JzZXJ2ZXIgVXRpbGl0aWVzXG4gKiBcbiAqIFByb3ZpZGVzIHNoYXJlZCBmdW5jdGlvbmFsaXR5IGZvciBhbGwgb2JzZXJ2ZXJzOlxuICogLSBFdmVudCBjYXB0dXJlIHZpYSBJRXZlbnRDYXB0dXJlIGludGVyZmFjZVxuICogLSBDb250ZXh0IHJlc29sdXRpb24gdXRpbGl0aWVzXG4gKiAtIEVycm9yIG5vcm1hbGl6YXRpb25cbiAqIC0gSUQgZ2VuZXJhdGlvblxuICogXG4gKiBERVNJR046XG4gKiAtIE9ic2VydmVycyB1c2UgUmVjb3JkT3ZlcnJpZGVzIGZyb20gdHlwZXMudHMgZm9yIG9wdGlvbnNcbiAqIC0gTm8gZHVwbGljYXRlIHR5cGUgZGVmaW5pdGlvbnMgaGVyZVxuICogLSBTaW1wbGUgY2FwdHVyZSBmdW5jdGlvbiB0aGF0IHRha2VzIENhcHR1cmVJbnB1dFxuICogLSBDb250ZXh0IHJlc29sdXRpb24gaGFuZGxlZCBieSBtYW5hZ2VyXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHtcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG4gIGdldE9ic2VydmFiaWxpdHlTdGF0ZSxcbiAgZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbn0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3N0b3JhZ2UnO1xuaW1wb3J0IHR5cGUgeyBDYXB0dXJlSW5wdXQsIElFdmVudENhcHR1cmUsIE9ic2VydmFiaWxpdHlFcnJvciwgUmVjb3JkT3ZlcnJpZGVzIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBnZW5lcmF0ZVRyYWNlSWQsIGdlbmVyYXRlU3BhbklkLCBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZCB9IGZyb20gJy4uL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gJy4uLy4uL3V0aWxzL21lcmdlJztcblxuY29uc3QgYmFzZUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2ZXInKTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDQVBUVVJFUiBSRUdJU1RSWVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogRXZlbnQgQ2FwdHVyZXIgUmVnaXN0cnlcbiAqIFxuICogU2ltcGxlIHJlZ2lzdHJ5IGZvciB0aGUgZXZlbnQgY2FwdHVyZXIgKE9ic2VydmFiaWxpdHlNYW5hZ2VyKS5cbiAqIEVuYWJsZXMgdGVzdGFiaWxpdHkgdmlhIGRlcGVuZGVuY3kgaW5qZWN0aW9uLlxuICovXG5jbGFzcyBDYXB0dXJlclJlZ2lzdHJ5IHtcbiAgcHJpdmF0ZSBjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHdhcm5lZE5vdEluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgLyoqIEluaXRpYWxpemUgdGhlIGNhcHR1cmVyIChjYWxsZWQgYnkgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgZHVyaW5nIGluaXRpYWxpemF0aW9uKSAqL1xuICBpbml0aWFsaXplKGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVyKSB7XG4gICAgICB0aGlzLmNhcHR1cmVyID0gY2FwdHVyZXI7XG4gICAgICB0aGlzLndhcm5lZE5vdEluaXRpYWxpemVkID0gZmFsc2U7IC8vIFJlc2V0IHdhcm5pbmcgZmxhZyBvbiBpbml0aWFsaXphdGlvblxuICAgIH1cbiAgfVxuXG4gIC8qKiBcbiAgICogR2V0IHRoZSBldmVudCBjYXB0dXJlciBvciBudWxsIGlmIG5vdCBpbml0aWFsaXplZC5cbiAgICogVXNlIHRoaXMgZm9yIHNvZnQtZmFpbCBjYXB0dXJlICh3b24ndCBjcmFzaCBhcHBsaWNhdGlvbiBjb2RlIGlmIG9ic2VydmFiaWxpdHkgaXNuJ3QgaW5pdGlhbGl6ZWQgeWV0KS5cbiAgICovXG4gIHRyeUdldCgpOiBJRXZlbnRDYXB0dXJlIHwgbnVsbCB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVyICYmICF0aGlzLndhcm5lZE5vdEluaXRpYWxpemVkKSB7XG4gICAgICB0aGlzLndhcm5lZE5vdEluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIGJhc2VMb2dnZXIud2FybihcbiAgICAgICAgJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLiBPYnNlcnZhYmlsaXR5TWFuYWdlciBtdXN0IGluaXRpYWxpemUgYmVmb3JlIG9ic2VydmVycyBjYW4gYmUgdXNlZC4gJyArXG4gICAgICAgICdPYnNlcnZhYmlsaXR5IGV2ZW50cyB3aWxsIGJlIHNpbGVudGx5IGRyb3BwZWQgdW50aWwgaW5pdGlhbGl6YXRpb24uICcgK1xuICAgICAgICAnVGhpcyB1c3VhbGx5IG1lYW5zIG9ic2VydmVycyBhcmUgYmVpbmcgdXNlZCBiZWZvcmUgdGhlIGZyYW1ld29yayBoYXMgaW5pdGlhbGl6ZWQuJ1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY2FwdHVyZXI7XG4gIH1cblxuICAvKiogR2V0IHRoZSBldmVudCBjYXB0dXJlci4gVGhyb3dzIGlmIG5vdCBpbml0aWFsaXplZC4gKi9cbiAgZ2V0KCk6IElFdmVudENhcHR1cmUge1xuICAgIGlmICghdGhpcy5jYXB0dXJlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWQuIE9ic2VydmFiaWxpdHlNYW5hZ2VyIG11c3QgaW5pdGlhbGl6ZSBiZWZvcmUgb2JzZXJ2ZXJzIGNhbiBiZSB1c2VkLiAnICtcbiAgICAgICAgJ1RoaXMgdXN1YWxseSBtZWFucyB5b3UgYXJlIHVzaW5nIG9ic2VydmVycyBiZWZvcmUgdGhlIGZyYW1ld29yayBoYXMgaW5pdGlhbGl6ZWQuICcgK1xuICAgICAgICAnSWYgeW91IHNlZSB0aGlzIGVycm9yLCBpbXBvcnQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgc29tZXdoZXJlIGluIHlvdXIgY29kZSB0byB0cmlnZ2VyIGluaXRpYWxpemF0aW9uLidcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNhcHR1cmVyO1xuICB9XG5cbiAgLyoqIFNldCBhIGN1c3RvbSBjYXB0dXJlciAoZm9yIHRlc3RpbmcpICovXG4gIHNldChjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICAgIHRoaXMuY2FwdHVyZXIgPSBjYXB0dXJlcjtcbiAgfVxuXG4gIC8qKiBSZXNldCB0byB1bmluaXRpYWxpemVkIHN0YXRlIChmb3IgdGVzdGluZyBjbGVhbnVwKSAqL1xuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLmNhcHR1cmVyID0gbnVsbDtcbiAgICB0aGlzLndhcm5lZE5vdEluaXRpYWxpemVkID0gZmFsc2U7XG4gIH1cbn1cblxuY29uc3QgY2FwdHVyZXJSZWdpc3RyeSA9IG5ldyBDYXB0dXJlclJlZ2lzdHJ5KCk7XG5cbi8qKiBJbml0aWFsaXplIHRoZSBjYXB0dXJlciAtIGNhbGxlZCBieSBPYnNlcnZhYmlsaXR5TWFuYWdlciBAaW50ZXJuYWwgKi9cbmV4cG9ydCBmdW5jdGlvbiBpbml0aWFsaXplQ2FwdHVyZXIoY2FwdHVyZXI6IElFdmVudENhcHR1cmUpOiB2b2lkIHtcbiAgY2FwdHVyZXJSZWdpc3RyeS5pbml0aWFsaXplKGNhcHR1cmVyKTtcbn1cblxuLyoqIFNldCBhIGN1c3RvbSBldmVudCBjYXB0dXJlciAoZm9yIHRlc3RpbmcpICovXG5leHBvcnQgZnVuY3Rpb24gc2V0Q2FwdHVyZXIoY2FwdHVyZXI6IElFdmVudENhcHR1cmUpOiB2b2lkIHtcbiAgY2FwdHVyZXJSZWdpc3RyeS5zZXQoY2FwdHVyZXIpO1xufVxuXG4vKiogUmVzZXQgY2FwdHVyZXIgdG8gZGVmYXVsdCAoZm9yIHRlc3RpbmcgY2xlYW51cCkgKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldENhcHR1cmVyKCk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LnJlc2V0KCk7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSUQgR0VORVJBVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKiBHZW5lcmF0ZSBhIHVuaXF1ZSBJRCAoVzNDIFNwYW4gSUQgZm9ybWF0IC0gMTYgaGV4IGNoYXJzKSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlSWQoKTogc3RyaW5nIHtcbiAgcmV0dXJuIGdlbmVyYXRlU3BhbklkKCk7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gQ09OVEVYVCBSRVNPTFVUSU9OXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBSZXNvbHZlIGNvcnJlbGF0aW9uIElEIGZyb20gZXhwbGljaXQgdmFsdWUgb3IgY29udGV4dC5cbiAqIFxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gY29ycmVsYXRpb25JZCBpcyBhdmFpbGFibGUgLSBjYWxsZXIgc2hvdWxkIE5PVCBjYXB0dXJlLlxuICogTkVWRVIgYXV0by1nZW5lcmF0ZXMgLSB0aGF0IHdvdWxkIGJyZWFrIHRyYWNlIGNvbnRpbnVpdHkgYW5kIGhpZGUgYnVncy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVDb3JyZWxhdGlvbklkKG9ic2VydmVyTmFtZTogc3RyaW5nLCBleHBsaWNpdElkPzogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGV4cGxpY2l0SWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkO1xuXG4gIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgIGJhc2VMb2dnZXIud2FybihcbiAgICAgIGAke29ic2VydmVyTmFtZX06IE5vIGV4ZWN1dGlvbiBjb250ZXh0IGVzdGFibGlzaGVkLiBgICtcbiAgICAgICdDb250ZXh0IGlzIGF1dG8tZXN0YWJsaXNoZWQgaW4gY29udHJvbGxlcnMsIG9yIHVzZSBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCgpIGJlZm9yZSB1c2luZyBvYnNlcnZlcnMuICcgK1xuICAgICAgJ0V2ZW50IHdpbGwgTk9UIGJlIGNhcHR1cmVkIC0gZml4IHRoZSBtaXNzaW5nIGNvbnRleHQuJ1xuICAgICk7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiBjb3JyZWxhdGlvbklkO1xufVxuXG4vKipcbiAqIE1lcmdlIHRhZ3MgZnJvbSBtdWx0aXBsZSBzb3VyY2VzLlxuICogTGF0ZXIgc291cmNlcyBvdmVycmlkZSBlYXJsaWVyIG9uZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVRhZ3MoXG4gIC4uLnNvdXJjZXM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQ+XG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGxldCBoYXNBbnkgPSBmYWxzZTtcblxuICBmb3IgKGNvbnN0IHNvdXJjZSBvZiBzb3VyY2VzKSB7XG4gICAgaWYgKHNvdXJjZSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihyZXN1bHQsIHNvdXJjZSk7XG4gICAgICBoYXNBbnkgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBoYXNBbnkgPyByZXN1bHQgOiB1bmRlZmluZWQ7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gRVJST1IgSEFORExJTkdcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhbiB1bmtub3duIGNhdWdodCB2YWx1ZSB0byBhbiBFcnJvci5cbiAqIEluIEphdmFTY3JpcHQsIGNhdGNoIGJsb2NrcyBjYW4gcmVjZWl2ZSBhbnkgdmFsdWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVFcnJvcihlcnJvcjogdW5rbm93bik6IEVycm9yIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3I7XG4gIH1cbiAgaWYgKHR5cGVvZiBlcnJvciA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbmV3IEVycm9yKGVycm9yKTtcbiAgfVxuICBpZiAoZXJyb3IgIT09IG51bGwgJiYgdHlwZW9mIGVycm9yID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IGVycm9yT2JqID0gZXJyb3IgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKHR5cGVvZiBlcnJvck9iai5tZXNzYWdlID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKGVycm9yT2JqLm1lc3NhZ2UpO1xuICAgICAgaWYgKHR5cGVvZiBlcnJvck9iai5uYW1lID09PSAnc3RyaW5nJykge1xuICAgICAgICBlcnIubmFtZSA9IGVycm9yT2JqLm5hbWU7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIGVycm9yT2JqLnN0YWNrID09PSAnc3RyaW5nJykge1xuICAgICAgICBlcnIuc3RhY2sgPSBlcnJvck9iai5zdGFjaztcbiAgICAgIH1cbiAgICAgIHJldHVybiBlcnI7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSk7XG59XG5cbi8qKlxuICogTWFwIEVycm9yIHRvIE9ic2VydmFiaWxpdHlFcnJvciBmb3JtYXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hcEVycm9yKGVycm9yOiBFcnJvcik6IE9ic2VydmFiaWxpdHlFcnJvciB7XG4gIGNvbnN0IGNvZGUgPSAnY29kZScgaW4gZXJyb3IgJiYgdHlwZW9mIGVycm9yLmNvZGUgPT09ICdzdHJpbmcnID8gZXJyb3IuY29kZSA6IHVuZGVmaW5lZDtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBlcnJvci5uYW1lLFxuICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgIGNvZGUsXG4gIH07XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gQ0FQVFVSRSBGVU5DVElPTlNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIEJ1aWxkIGNvbXBsZXRlIENhcHR1cmVJbnB1dCBmcm9tIHBhcnRpYWwgaW5wdXQgKyBjb250ZXh0LlxuICogXG4gKiBUaGlzIGlzIHRoZSBrZXkgZnVuY3Rpb24gdGhhdCByZXNvbHZlcyBjb250ZXh0IGFuZCBmaWxscyBpbiBkZWZhdWx0cy5cbiAqIE9ic2VydmVycyBjYWxsIHRoaXMgd2l0aCB0aGVpciBzcGVjaWZpYyBmaWVsZHMsIGNvbnRleHQgZmlsbHMgdGhlIHJlc3QuXG4gKiBcbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNvcnJlbGF0aW9uSWQgY2FuIGJlIHJlc29sdmVkIC0gZXZlbnQgc2hvdWxkIE5PVCBiZSBjYXB0dXJlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ2FwdHVyZUlucHV0KFxuICBvYnNlcnZlck5hbWU6IHN0cmluZyxcbiAgaW5wdXQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYge1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICAgIHRpbWVzdGFtcE1zPzogbnVtYmVyO1xuICB9XG4pOiBDYXB0dXJlSW5wdXQgfCB1bmRlZmluZWQge1xuICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICBjb25zdCBzdGF0ZSA9IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpO1xuXG4gIC8vIFJlc29sdmUgY29ycmVsYXRpb25JZCAtIGlmIHVuZGVmaW5lZCwgd2UgY2FuJ3QgY2FwdHVyZVxuICAvLyBQYXNzIG9ubHkgZXhwbGljaXQgaW5wdXQuY29ycmVsYXRpb25JZCAtIHJlc29sdmVDb3JyZWxhdGlvbklkIGhhbmRsZXMgY29udGV4dCBmYWxsYmFja1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gcmVzb2x2ZUNvcnJlbGF0aW9uSWQob2JzZXJ2ZXJOYW1lLCBpbnB1dC5jb3JyZWxhdGlvbklkKTtcbiAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIFJlc29sdmUgcGFyZW50OiBleHBsaWNpdCA+IGNvbnRleHQgc3BhbiB0cmVlID4gdW5kZWZpbmVkXG4gIC8vIENSSVRJQ0FMOiBJZiBjYXVzZWRCeSBpcyBleHBsaWNpdGx5IHByb3ZpZGVkLCBETyBOT1QgYXV0by1wb3B1bGF0ZSBwYXJlbnQuXG4gIC8vIGNhdXNlZEJ5IGluZGljYXRlcyBjcm9zcy1pbnZvY2F0aW9uIGxpbmthZ2UgKGUuZy4sIHN0cmVhbSBwcm9jZXNzaW5nIOKGkiBvcmlnaW5hbCByZXF1ZXN0KS5cbiAgLy8gSW4gdGhpcyBjYXNlLCB0aGUgZXZlbnQgaXMgYSBST09UIGluIHRoZSBjdXJyZW50IGludm9jYXRpb24sIG5vdCBhIGNoaWxkLlxuICBjb25zdCBwYXJlbnRMb2dJZCA9IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAhPT0gdW5kZWZpbmVkXG4gICAgPyBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgICA6IChpbnB1dC5jYXVzZWRCeSA9PT0gdW5kZWZpbmVkID8gZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCgpIDogdW5kZWZpbmVkKTtcblxuICAvLyBOT1RFOlxuICAvLyBQYXJlbnQvY2hpbGQgaW50ZWdyaXR5IGlzIGVuZm9yY2VkIGF0IGZsdXNoLXRpbWUgYnkgYnVpbGRpbmcgYSBncmFwaCBvZiBidWZmZXJlZCBldmVudHMuXG4gIC8vIFdlIGludGVudGlvbmFsbHkgZG8gbm90IGRvIGFueSBtYW51YWwgXCJwYXJlbnQgcmVmZXJlbmNlIHJlZ2lzdHJhdGlvblwiIGhlcmUuXG5cbiAgcmV0dXJuIHtcbiAgICAvLyBJZGVudGl0eVxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGNvcnJlbGF0aW9uSWQpLFxuICAgIHRpbWVzdGFtcE1zOiBpbnB1dC50aW1lc3RhbXBNcyA/PyBEYXRlLm5vdygpLFxuXG4gICAgLy8gQ2xhc3NpZmljYXRpb24gKHJlcXVpcmVkIGZyb20gaW5wdXQpXG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG5cbiAgICAvLyBUcmFjZSBjb250ZXh0XG4gICAgY29ycmVsYXRpb25JZCxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHBhcmVudExvZ0lkID8/IHVuZGVmaW5lZCxcbiAgICBjYXVzZWRCeTogaW5wdXQuY2F1c2VkQnkgPz8gY3R4Py5jYXVzZWRCeSxcbiAgICByZWxhdGVkVHJhY2VzOiBpbnB1dC5yZWxhdGVkVHJhY2VzLFxuXG4gICAgLy8gRW50aXR5XG4gICAgZW50aXR5TmFtZTogaW5wdXQuZW50aXR5TmFtZSxcbiAgICBlbnRpdHlJZDogaW5wdXQuZW50aXR5SWQsXG5cbiAgICAvLyBPcGVyYXRpb25cbiAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcblxuICAgIC8vIEFjdG9yICYgc291cmNlIChmcm9tIGlucHV0IG9yIGNvbnRleHQpXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gc3RhdGU/LnNvdXJjZSxcbiAgICB0YWdzOiBtZXJnZVRhZ3Moc3RhdGU/LnRhZ3MsIGlucHV0LnRhZ3MpLFxuXG4gICAgLy8gUGF5bG9hZHNcbiAgICBkYXRhOiBpbnB1dC5kYXRhLFxuICAgIGF0dHJpYnV0ZXM6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgLy8gRGVlcCBtZXJnZSBjb250ZXh0LWxldmVsIG1ldGFkYXRhIChmcm9tIHdpdGhDb250ZXh0KSB3aXRoIGV2ZW50LWxldmVsIG1ldGFkYXRhXG4gICAgbWV0YWRhdGE6IHN0YXRlPy5tZXRhZGF0YSB8fCBpbnB1dC5tZXRhZGF0YVxuICAgICAgPyAobWVyZ2UoWyBzdGF0ZT8ubWV0YWRhdGEsIGlucHV0Lm1ldGFkYXRhIF0pID8/IHVuZGVmaW5lZClcbiAgICAgIDogdW5kZWZpbmVkLFxuICAgIG1ldHJpY3M6IGlucHV0Lm1ldHJpY3MsXG4gICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICBlcnJvcjogaW5wdXQuZXJyb3IsXG5cbiAgICAvLyBDYXB0dXJlIGNvbnRyb2wgKHBhc3MgdGhyb3VnaCBhcy1pcylcbiAgICBjYXB0dXJlOiBpbnB1dC5jYXB0dXJlLFxuICB9O1xufVxuXG4vKipcbiAqIENhcHR1cmUgYW4gZXZlbnQuXG4gKiBcbiAqIFRoaXMgaXMgdGhlIG1haW4gZnVuY3Rpb24gb2JzZXJ2ZXJzIHVzZS4gSXQ6XG4gKiAxLiBCdWlsZHMgY29tcGxldGUgQ2FwdHVyZUlucHV0IGZyb20gcGFydGlhbCBpbnB1dCArIGNvbnRleHRcbiAqIDIuIFNlbmRzIHRvIGNhcHR1cmVyIChPYnNlcnZhYmlsaXR5TWFuYWdlcilcbiAqIFxuICogUmV0dXJucyB1bmRlZmluZWQgaWY6XG4gKiAtIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkXG4gKiAtIE5vIGV4ZWN1dGlvbiBjb250ZXh0IChubyBjb3JyZWxhdGlvbklkKVxuICogLSBGaWx0ZXJlZC9zYW1wbGVkIG91dFxuICogXG4gKiBAcGFyYW0gb2JzZXJ2ZXJOYW1lIC0gTmFtZSBvZiB0aGUgY2FsbGluZyBvYnNlcnZlciAoZm9yIGVycm9yIG1lc3NhZ2VzKVxuICogQHBhcmFtIGlucHV0IC0gUGFydGlhbCBpbnB1dCAocmVxdWlyZWQ6IHR5cGUsIGxldmVsKVxuICogQHJldHVybnMgb2JzZXJ2YWJpbGl0eUxvZ0lkIGlmIGNhcHR1cmVkLCB1bmRlZmluZWQgb3RoZXJ3aXNlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYXB0dXJlUmVjb3JkKFxuICBvYnNlcnZlck5hbWU6IHN0cmluZyxcbiAgaW5wdXQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYgUmVjb3JkT3ZlcnJpZGVzICYge1xuICAgIG9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgICB0aW1lc3RhbXBNcz86IG51bWJlcjtcbiAgfVxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgLy8gRGVmZW5zaXZlOiBkb24ndCBjcmFzaCB1c2VyIGNvZGUgaWYgb2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWRcbiAgY29uc3QgY2FwdHVyZXIgPSBjYXB0dXJlclJlZ2lzdHJ5LnRyeUdldCgpO1xuICBpZiAoIWNhcHR1cmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIEJ1aWxkIGZ1bGwgaW5wdXQgLSByZXR1cm5zIHVuZGVmaW5lZCBpZiBubyBjb250ZXh0IChubyBjb3JyZWxhdGlvbklkKVxuICBjb25zdCBmdWxsSW5wdXQgPSBidWlsZENhcHR1cmVJbnB1dChvYnNlcnZlck5hbWUsIGlucHV0KTtcbiAgaWYgKCFmdWxsSW5wdXQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIGNhcHR1cmVyLmNhcHR1cmUoZnVsbElucHV0KTtcbn1cblxuLyoqXG4gKiBDYXB0dXJlIGFuIGV2ZW50IGFzeW5jaHJvbm91c2x5LlxuICogVXNlIHdoZW4geW91IG5lZWQgdG8gYXdhaXQgYmFja2VuZCBjb21wbGV0aW9uLlxuICogXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZjpcbiAqIC0gT2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWRcbiAqIC0gTm8gZXhlY3V0aW9uIGNvbnRleHQgKG5vIGNvcnJlbGF0aW9uSWQpXG4gKiAtIEZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYXB0dXJlUmVjb3JkQXN5bmMoXG4gIG9ic2VydmVyTmFtZTogc3RyaW5nLFxuICBpbnB1dDogT21pdDxDYXB0dXJlSW5wdXQsICdjb3JyZWxhdGlvbklkJyB8ICdvYnNlcnZhYmlsaXR5TG9nSWQnIHwgJ3RpbWVzdGFtcE1zJz4gJiBSZWNvcmRPdmVycmlkZXMgJiB7XG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICAgIHRpbWVzdGFtcE1zPzogbnVtYmVyO1xuICB9XG4pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAvLyBEZWZlbnNpdmU6IGRvbid0IGNyYXNoIHVzZXIgY29kZSBpZiBvYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZFxuICBjb25zdCBjYXB0dXJlciA9IGNhcHR1cmVyUmVnaXN0cnkudHJ5R2V0KCk7XG4gIGlmICghY2FwdHVyZXIpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQnVpbGQgZnVsbCBpbnB1dCAtIHJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNvbnRleHQgKG5vIGNvcnJlbGF0aW9uSWQpXG4gIGNvbnN0IGZ1bGxJbnB1dCA9IGJ1aWxkQ2FwdHVyZUlucHV0KG9ic2VydmVyTmFtZSwgaW5wdXQpO1xuICBpZiAoIWZ1bGxJbnB1dCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gY2FwdHVyZXIuY2FwdHVyZUFzeW5jKGZ1bGxJbnB1dCk7XG59Il19