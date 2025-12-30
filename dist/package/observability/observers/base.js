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
    const parentLogId = input.parentObservabilityLogId !== undefined
        ? input.parentObservabilityLogId
        : (0, storage_1.getCurrentParentObservabilityLogId)();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7R0FjRzs7QUFnRkgsZ0RBRUM7QUFHRCxrQ0FFQztBQUdELHNDQUVDO0FBT0QsZ0NBRUM7QUFZRCxvREFjQztBQU1ELDhCQWNDO0FBVUQsd0NBcUJDO0FBS0QsNEJBUUM7QUFjRCw4Q0F3RUM7QUFrQkQsc0NBb0JDO0FBV0QsZ0RBb0JDO0FBdlZELDBFQUlzRDtBQUV0RCwyQ0FBNkM7QUFDN0Msd0RBQW9HO0FBQ3BHLDZDQUEwQztBQUUxQyxNQUFNLFVBQVUsR0FBRyxJQUFBLHNCQUFZLEVBQUMsVUFBVSxDQUFDLENBQUM7QUFFNUMsOEVBQThFO0FBQzlFLG9CQUFvQjtBQUNwQiw4RUFBOEU7QUFFOUU7Ozs7O0dBS0c7QUFDSCxNQUFNLGdCQUFnQjtJQUNaLFFBQVEsR0FBeUIsSUFBSSxDQUFDO0lBQ3RDLG9CQUFvQixHQUFHLEtBQUssQ0FBQztJQUVyQyxxRkFBcUY7SUFDckYsVUFBVSxDQUFDLFFBQXVCO1FBQ2hDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7WUFDekIsSUFBSSxDQUFDLG9CQUFvQixHQUFHLEtBQUssQ0FBQyxDQUFDLHVDQUF1QztRQUM1RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQ2pELElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUM7WUFDakMsVUFBVSxDQUFDLElBQUksQ0FDYixvR0FBb0c7Z0JBQ3BHLHNFQUFzRTtnQkFDdEUsbUZBQW1GLENBQ3BGLENBQUM7UUFDSixD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eEUsTUFBTSxTQUFTLEdBQUcsaUJBQWlCLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3pELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNmLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDckMsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0ksS0FBSyxVQUFVLGtCQUFrQixDQUN0QyxZQUFvQixFQUNwQixLQUdDO0lBRUQsb0VBQW9FO0lBQ3BFLE1BQU0sUUFBUSxHQUFHLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxDQUFDO0lBQzNDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNkLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCx3RUFBd0U7SUFDeEUsTUFBTSxTQUFTLEdBQUcsaUJBQWlCLENBQUMsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3pELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNmLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDMUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQmFzZSBPYnNlcnZlciBVdGlsaXRpZXNcbiAqIFxuICogUHJvdmlkZXMgc2hhcmVkIGZ1bmN0aW9uYWxpdHkgZm9yIGFsbCBvYnNlcnZlcnM6XG4gKiAtIEV2ZW50IGNhcHR1cmUgdmlhIElFdmVudENhcHR1cmUgaW50ZXJmYWNlXG4gKiAtIENvbnRleHQgcmVzb2x1dGlvbiB1dGlsaXRpZXNcbiAqIC0gRXJyb3Igbm9ybWFsaXphdGlvblxuICogLSBJRCBnZW5lcmF0aW9uXG4gKiBcbiAqIERFU0lHTjpcbiAqIC0gT2JzZXJ2ZXJzIHVzZSBSZWNvcmRPdmVycmlkZXMgZnJvbSB0eXBlcy50cyBmb3Igb3B0aW9uc1xuICogLSBObyBkdXBsaWNhdGUgdHlwZSBkZWZpbml0aW9ucyBoZXJlXG4gKiAtIFNpbXBsZSBjYXB0dXJlIGZ1bmN0aW9uIHRoYXQgdGFrZXMgQ2FwdHVyZUlucHV0XG4gKiAtIENvbnRleHQgcmVzb2x1dGlvbiBoYW5kbGVkIGJ5IG1hbmFnZXJcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQge1xuICBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCxcbiAgZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlLFxuICBnZXRDdXJyZW50UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxufSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZSc7XG5pbXBvcnQgdHlwZSB7IENhcHR1cmVJbnB1dCwgSUV2ZW50Q2FwdHVyZSwgT2JzZXJ2YWJpbGl0eUVycm9yLCBSZWNvcmRPdmVycmlkZXMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IGdlbmVyYXRlVHJhY2VJZCwgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkIH0gZnJvbSAnLi4vdXRpbHMvaWQtZ2VuZXJhdG9yJztcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSAnLi4vLi4vdXRpbHMvbWVyZ2UnO1xuXG5jb25zdCBiYXNlTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZlcicpO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIENBUFRVUkVSIFJFR0lTVFJZXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBFdmVudCBDYXB0dXJlciBSZWdpc3RyeVxuICogXG4gKiBTaW1wbGUgcmVnaXN0cnkgZm9yIHRoZSBldmVudCBjYXB0dXJlciAoT2JzZXJ2YWJpbGl0eU1hbmFnZXIpLlxuICogRW5hYmxlcyB0ZXN0YWJpbGl0eSB2aWEgZGVwZW5kZW5jeSBpbmplY3Rpb24uXG4gKi9cbmNsYXNzIENhcHR1cmVyUmVnaXN0cnkge1xuICBwcml2YXRlIGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgd2FybmVkTm90SW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICAvKiogSW5pdGlhbGl6ZSB0aGUgY2FwdHVyZXIgKGNhbGxlZCBieSBPYnNlcnZhYmlsaXR5TWFuYWdlciBkdXJpbmcgaW5pdGlhbGl6YXRpb24pICovXG4gIGluaXRpYWxpemUoY2FwdHVyZXI6IElFdmVudENhcHR1cmUpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuY2FwdHVyZXIpIHtcbiAgICAgIHRoaXMuY2FwdHVyZXIgPSBjYXB0dXJlcjtcbiAgICAgIHRoaXMud2FybmVkTm90SW5pdGlhbGl6ZWQgPSBmYWxzZTsgLy8gUmVzZXQgd2FybmluZyBmbGFnIG9uIGluaXRpYWxpemF0aW9uXG4gICAgfVxuICB9XG5cbiAgLyoqIFxuICAgKiBHZXQgdGhlIGV2ZW50IGNhcHR1cmVyIG9yIG51bGwgaWYgbm90IGluaXRpYWxpemVkLlxuICAgKiBVc2UgdGhpcyBmb3Igc29mdC1mYWlsIGNhcHR1cmUgKHdvbid0IGNyYXNoIGFwcGxpY2F0aW9uIGNvZGUgaWYgb2JzZXJ2YWJpbGl0eSBpc24ndCBpbml0aWFsaXplZCB5ZXQpLlxuICAgKi9cbiAgdHJ5R2V0KCk6IElFdmVudENhcHR1cmUgfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuY2FwdHVyZXIgJiYgIXRoaXMud2FybmVkTm90SW5pdGlhbGl6ZWQpIHtcbiAgICAgIHRoaXMud2FybmVkTm90SW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgYmFzZUxvZ2dlci53YXJuKFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWQuIE9ic2VydmFiaWxpdHlNYW5hZ2VyIG11c3QgaW5pdGlhbGl6ZSBiZWZvcmUgb2JzZXJ2ZXJzIGNhbiBiZSB1c2VkLiAnICtcbiAgICAgICAgJ09ic2VydmFiaWxpdHkgZXZlbnRzIHdpbGwgYmUgc2lsZW50bHkgZHJvcHBlZCB1bnRpbCBpbml0aWFsaXphdGlvbi4gJyArXG4gICAgICAgICdUaGlzIHVzdWFsbHkgbWVhbnMgb2JzZXJ2ZXJzIGFyZSBiZWluZyB1c2VkIGJlZm9yZSB0aGUgZnJhbWV3b3JrIGhhcyBpbml0aWFsaXplZC4nXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYXB0dXJlcjtcbiAgfVxuXG4gIC8qKiBHZXQgdGhlIGV2ZW50IGNhcHR1cmVyLiBUaHJvd3MgaWYgbm90IGluaXRpYWxpemVkLiAqL1xuICBnZXQoKTogSUV2ZW50Q2FwdHVyZSB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZC4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbXVzdCBpbml0aWFsaXplIGJlZm9yZSBvYnNlcnZlcnMgY2FuIGJlIHVzZWQuICcgK1xuICAgICAgICAnVGhpcyB1c3VhbGx5IG1lYW5zIHlvdSBhcmUgdXNpbmcgb2JzZXJ2ZXJzIGJlZm9yZSB0aGUgZnJhbWV3b3JrIGhhcyBpbml0aWFsaXplZC4gJyArXG4gICAgICAgICdJZiB5b3Ugc2VlIHRoaXMgZXJyb3IsIGltcG9ydCBPYnNlcnZhYmlsaXR5TWFuYWdlciBzb21ld2hlcmUgaW4geW91ciBjb2RlIHRvIHRyaWdnZXIgaW5pdGlhbGl6YXRpb24uJ1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY2FwdHVyZXI7XG4gIH1cblxuICAvKiogU2V0IGEgY3VzdG9tIGNhcHR1cmVyIChmb3IgdGVzdGluZykgKi9cbiAgc2V0KGNhcHR1cmVyOiBJRXZlbnRDYXB0dXJlKTogdm9pZCB7XG4gICAgdGhpcy5jYXB0dXJlciA9IGNhcHR1cmVyO1xuICB9XG5cbiAgLyoqIFJlc2V0IHRvIHVuaW5pdGlhbGl6ZWQgc3RhdGUgKGZvciB0ZXN0aW5nIGNsZWFudXApICovXG4gIHJlc2V0KCk6IHZvaWQge1xuICAgIHRoaXMuY2FwdHVyZXIgPSBudWxsO1xuICAgIHRoaXMud2FybmVkTm90SW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgfVxufVxuXG5jb25zdCBjYXB0dXJlclJlZ2lzdHJ5ID0gbmV3IENhcHR1cmVyUmVnaXN0cnkoKTtcblxuLyoqIEluaXRpYWxpemUgdGhlIGNhcHR1cmVyIC0gY2FsbGVkIGJ5IE9ic2VydmFiaWxpdHlNYW5hZ2VyIEBpbnRlcm5hbCAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluaXRpYWxpemVDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LmluaXRpYWxpemUoY2FwdHVyZXIpO1xufVxuXG4vKiogU2V0IGEgY3VzdG9tIGV2ZW50IGNhcHR1cmVyIChmb3IgdGVzdGluZykgKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRDYXB0dXJlcihjYXB0dXJlcjogSUV2ZW50Q2FwdHVyZSk6IHZvaWQge1xuICBjYXB0dXJlclJlZ2lzdHJ5LnNldChjYXB0dXJlcik7XG59XG5cbi8qKiBSZXNldCBjYXB0dXJlciB0byBkZWZhdWx0IChmb3IgdGVzdGluZyBjbGVhbnVwKSAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc2V0Q2FwdHVyZXIoKTogdm9pZCB7XG4gIGNhcHR1cmVyUmVnaXN0cnkucmVzZXQoKTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBJRCBHRU5FUkFUSU9OXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqIEdlbmVyYXRlIGEgdW5pcXVlIElEIChXM0MgU3BhbiBJRCBmb3JtYXQgLSAxNiBoZXggY2hhcnMpICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVJZCgpOiBzdHJpbmcge1xuICByZXR1cm4gZ2VuZXJhdGVTcGFuSWQoKTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDT05URVhUIFJFU09MVVRJT05cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIFJlc29sdmUgY29ycmVsYXRpb24gSUQgZnJvbSBleHBsaWNpdCB2YWx1ZSBvciBjb250ZXh0LlxuICogXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiBubyBjb3JyZWxhdGlvbklkIGlzIGF2YWlsYWJsZSAtIGNhbGxlciBzaG91bGQgTk9UIGNhcHR1cmUuXG4gKiBORVZFUiBhdXRvLWdlbmVyYXRlcyAtIHRoYXQgd291bGQgYnJlYWsgdHJhY2UgY29udGludWl0eSBhbmQgaGlkZSBidWdzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUNvcnJlbGF0aW9uSWQob2JzZXJ2ZXJOYW1lOiBzdHJpbmcsIGV4cGxpY2l0SWQ/OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gZXhwbGljaXRJZCA/PyBjdHg/LmNvcnJlbGF0aW9uSWQ7XG5cbiAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgYmFzZUxvZ2dlci53YXJuKFxuICAgICAgYCR7b2JzZXJ2ZXJOYW1lfTogTm8gZXhlY3V0aW9uIGNvbnRleHQgZXN0YWJsaXNoZWQuIGAgK1xuICAgICAgJ0NvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVycywgb3IgdXNlIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KCkgYmVmb3JlIHVzaW5nIG9ic2VydmVycy4gJyArXG4gICAgICAnRXZlbnQgd2lsbCBOT1QgYmUgY2FwdHVyZWQgLSBmaXggdGhlIG1pc3NpbmcgY29udGV4dC4nXG4gICAgKTtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIGNvcnJlbGF0aW9uSWQ7XG59XG5cbi8qKlxuICogTWVyZ2UgdGFncyBmcm9tIG11bHRpcGxlIHNvdXJjZXMuXG4gKiBMYXRlciBzb3VyY2VzIG92ZXJyaWRlIGVhcmxpZXIgb25lcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlVGFncyhcbiAgLi4uc291cmNlczogQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZD5cbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICBjb25zdCByZXN1bHQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgbGV0IGhhc0FueSA9IGZhbHNlO1xuXG4gIGZvciAoY29uc3Qgc291cmNlIG9mIHNvdXJjZXMpIHtcbiAgICBpZiAoc291cmNlKSB7XG4gICAgICBPYmplY3QuYXNzaWduKHJlc3VsdCwgc291cmNlKTtcbiAgICAgIGhhc0FueSA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGhhc0FueSA/IHJlc3VsdCA6IHVuZGVmaW5lZDtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBFUlJPUiBIQU5ETElOR1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogTm9ybWFsaXplIGFuIHVua25vd24gY2F1Z2h0IHZhbHVlIHRvIGFuIEVycm9yLlxuICogSW4gSmF2YVNjcmlwdCwgY2F0Y2ggYmxvY2tzIGNhbiByZWNlaXZlIGFueSB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUVycm9yKGVycm9yOiB1bmtub3duKTogRXJyb3Ige1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiBlcnJvcjtcbiAgfVxuICBpZiAodHlwZW9mIGVycm9yID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBuZXcgRXJyb3IoZXJyb3IpO1xuICB9XG4gIGlmIChlcnJvciAhPT0gbnVsbCAmJiB0eXBlb2YgZXJyb3IgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgZXJyb3JPYmogPSBlcnJvciBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBpZiAodHlwZW9mIGVycm9yT2JqLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoZXJyb3JPYmoubWVzc2FnZSk7XG4gICAgICBpZiAodHlwZW9mIGVycm9yT2JqLm5hbWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGVyci5uYW1lID0gZXJyb3JPYmoubmFtZTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgZXJyb3JPYmouc3RhY2sgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGVyci5zdGFjayA9IGVycm9yT2JqLnN0YWNrO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGVycjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKTtcbn1cblxuLyoqXG4gKiBNYXAgRXJyb3IgdG8gT2JzZXJ2YWJpbGl0eUVycm9yIGZvcm1hdFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFwRXJyb3IoZXJyb3I6IEVycm9yKTogT2JzZXJ2YWJpbGl0eUVycm9yIHtcbiAgY29uc3QgY29kZSA9ICdjb2RlJyBpbiBlcnJvciAmJiB0eXBlb2YgZXJyb3IuY29kZSA9PT0gJ3N0cmluZycgPyBlcnJvci5jb2RlIDogdW5kZWZpbmVkO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IGVycm9yLm5hbWUsXG4gICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgY29kZSxcbiAgfTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDQVBUVVJFIEZVTkNUSU9OU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogQnVpbGQgY29tcGxldGUgQ2FwdHVyZUlucHV0IGZyb20gcGFydGlhbCBpbnB1dCArIGNvbnRleHQuXG4gKiBcbiAqIFRoaXMgaXMgdGhlIGtleSBmdW5jdGlvbiB0aGF0IHJlc29sdmVzIGNvbnRleHQgYW5kIGZpbGxzIGluIGRlZmF1bHRzLlxuICogT2JzZXJ2ZXJzIGNhbGwgdGhpcyB3aXRoIHRoZWlyIHNwZWNpZmljIGZpZWxkcywgY29udGV4dCBmaWxscyB0aGUgcmVzdC5cbiAqIFxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gY29ycmVsYXRpb25JZCBjYW4gYmUgcmVzb2x2ZWQgLSBldmVudCBzaG91bGQgTk9UIGJlIGNhcHR1cmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYXB0dXJlSW5wdXQoXG4gIG9ic2VydmVyTmFtZTogc3RyaW5nLFxuICBpbnB1dDogT21pdDxDYXB0dXJlSW5wdXQsICdjb3JyZWxhdGlvbklkJyB8ICdvYnNlcnZhYmlsaXR5TG9nSWQnIHwgJ3RpbWVzdGFtcE1zJz4gJiB7XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmc7XG4gICAgdGltZXN0YW1wTXM/OiBudW1iZXI7XG4gIH1cbik6IENhcHR1cmVJbnB1dCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gIGNvbnN0IHN0YXRlID0gZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlKCk7XG5cbiAgLy8gUmVzb2x2ZSBjb3JyZWxhdGlvbklkIC0gaWYgdW5kZWZpbmVkLCB3ZSBjYW4ndCBjYXB0dXJlXG4gIC8vIFBhc3Mgb25seSBleHBsaWNpdCBpbnB1dC5jb3JyZWxhdGlvbklkIC0gcmVzb2x2ZUNvcnJlbGF0aW9uSWQgaGFuZGxlcyBjb250ZXh0IGZhbGxiYWNrXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSByZXNvbHZlQ29ycmVsYXRpb25JZChvYnNlcnZlck5hbWUsIGlucHV0LmNvcnJlbGF0aW9uSWQpO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gUmVzb2x2ZSBwYXJlbnQ6IGV4cGxpY2l0ID4gY29udGV4dCBzcGFuIHRyZWUgPiB1bmRlZmluZWRcbiAgY29uc3QgcGFyZW50TG9nSWQgPSBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgIT09IHVuZGVmaW5lZFxuICAgID8gaW5wdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgOiBnZXRDdXJyZW50UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKCk7XG5cbiAgLy8gTk9URTpcbiAgLy8gUGFyZW50L2NoaWxkIGludGVncml0eSBpcyBlbmZvcmNlZCBhdCBmbHVzaC10aW1lIGJ5IGJ1aWxkaW5nIGEgZ3JhcGggb2YgYnVmZmVyZWQgZXZlbnRzLlxuICAvLyBXZSBpbnRlbnRpb25hbGx5IGRvIG5vdCBkbyBhbnkgbWFudWFsIFwicGFyZW50IHJlZmVyZW5jZSByZWdpc3RyYXRpb25cIiBoZXJlLlxuXG4gIHJldHVybiB7XG4gICAgLy8gSWRlbnRpdHlcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0Lm9ic2VydmFiaWxpdHlMb2dJZCA/PyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZChjb3JyZWxhdGlvbklkKSxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gRGF0ZS5ub3coKSxcblxuICAgIC8vIENsYXNzaWZpY2F0aW9uIChyZXF1aXJlZCBmcm9tIGlucHV0KVxuICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgbGV2ZWw6IGlucHV0LmxldmVsLFxuXG4gICAgLy8gVHJhY2UgY29udGV4dFxuICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBwYXJlbnRMb2dJZCA/PyB1bmRlZmluZWQsXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5ID8/IGN0eD8uY2F1c2VkQnksXG4gICAgcmVsYXRlZFRyYWNlczogaW5wdXQucmVsYXRlZFRyYWNlcyxcblxuICAgIC8vIEVudGl0eVxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuXG4gICAgLy8gT3BlcmF0aW9uXG4gICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgc3ViVHlwZTogaW5wdXQuc3ViVHlwZSxcbiAgICBzdGF0dXM6IGlucHV0LnN0YXR1cyxcbiAgICBzdWNjZXNzOiBpbnB1dC5zdWNjZXNzLFxuICAgIGR1cmF0aW9uTXM6IGlucHV0LmR1cmF0aW9uTXMsXG5cbiAgICAvLyBBY3RvciAmIHNvdXJjZSAoZnJvbSBpbnB1dCBvciBjb250ZXh0KVxuICAgIGFjdG9yOiBpbnB1dC5hY3RvciA/PyBjdHg/LmFjdG9yLFxuICAgIHNvdXJjZTogaW5wdXQuc291cmNlID8/IHN0YXRlPy5zb3VyY2UsXG4gICAgdGFnczogbWVyZ2VUYWdzKHN0YXRlPy50YWdzLCBpbnB1dC50YWdzKSxcblxuICAgIC8vIFBheWxvYWRzXG4gICAgZGF0YTogaW5wdXQuZGF0YSxcbiAgICBhdHRyaWJ1dGVzOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgIC8vIERlZXAgbWVyZ2UgY29udGV4dC1sZXZlbCBtZXRhZGF0YSAoZnJvbSB3aXRoQ29udGV4dCkgd2l0aCBldmVudC1sZXZlbCBtZXRhZGF0YVxuICAgIG1ldGFkYXRhOiBzdGF0ZT8ubWV0YWRhdGEgfHwgaW5wdXQubWV0YWRhdGFcbiAgICAgID8gKG1lcmdlKFsgc3RhdGU/Lm1ldGFkYXRhLCBpbnB1dC5tZXRhZGF0YSBdKSA/PyB1bmRlZmluZWQpXG4gICAgICA6IHVuZGVmaW5lZCxcbiAgICBtZXRyaWNzOiBpbnB1dC5tZXRyaWNzLFxuICAgIGNvbnRleHQ6IGlucHV0LmNvbnRleHQsXG4gICAgZXJyb3I6IGlucHV0LmVycm9yLFxuXG4gICAgLy8gQ2FwdHVyZSBjb250cm9sIChwYXNzIHRocm91Z2ggYXMtaXMpXG4gICAgY2FwdHVyZTogaW5wdXQuY2FwdHVyZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXB0dXJlIGFuIGV2ZW50LlxuICogXG4gKiBUaGlzIGlzIHRoZSBtYWluIGZ1bmN0aW9uIG9ic2VydmVycyB1c2UuIEl0OlxuICogMS4gQnVpbGRzIGNvbXBsZXRlIENhcHR1cmVJbnB1dCBmcm9tIHBhcnRpYWwgaW5wdXQgKyBjb250ZXh0XG4gKiAyLiBTZW5kcyB0byBjYXB0dXJlciAoT2JzZXJ2YWJpbGl0eU1hbmFnZXIpXG4gKiBcbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmOlxuICogLSBPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZFxuICogLSBObyBleGVjdXRpb24gY29udGV4dCAobm8gY29ycmVsYXRpb25JZClcbiAqIC0gRmlsdGVyZWQvc2FtcGxlZCBvdXRcbiAqIFxuICogQHBhcmFtIG9ic2VydmVyTmFtZSAtIE5hbWUgb2YgdGhlIGNhbGxpbmcgb2JzZXJ2ZXIgKGZvciBlcnJvciBtZXNzYWdlcylcbiAqIEBwYXJhbSBpbnB1dCAtIFBhcnRpYWwgaW5wdXQgKHJlcXVpcmVkOiB0eXBlLCBsZXZlbClcbiAqIEByZXR1cm5zIG9ic2VydmFiaWxpdHlMb2dJZCBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIG90aGVyd2lzZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZVJlY29yZChcbiAgb2JzZXJ2ZXJOYW1lOiBzdHJpbmcsXG4gIGlucHV0OiBPbWl0PENhcHR1cmVJbnB1dCwgJ2NvcnJlbGF0aW9uSWQnIHwgJ29ic2VydmFiaWxpdHlMb2dJZCcgfCAndGltZXN0YW1wTXMnPiAmIFJlY29yZE92ZXJyaWRlcyAmIHtcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmc7XG4gICAgdGltZXN0YW1wTXM/OiBudW1iZXI7XG4gIH1cbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIERlZmVuc2l2ZTogZG9uJ3QgY3Jhc2ggdXNlciBjb2RlIGlmIG9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkXG4gIGNvbnN0IGNhcHR1cmVyID0gY2FwdHVyZXJSZWdpc3RyeS50cnlHZXQoKTtcbiAgaWYgKCFjYXB0dXJlcikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBCdWlsZCBmdWxsIGlucHV0IC0gcmV0dXJucyB1bmRlZmluZWQgaWYgbm8gY29udGV4dCAobm8gY29ycmVsYXRpb25JZClcbiAgY29uc3QgZnVsbElucHV0ID0gYnVpbGRDYXB0dXJlSW5wdXQob2JzZXJ2ZXJOYW1lLCBpbnB1dCk7XG4gIGlmICghZnVsbElucHV0KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiBjYXB0dXJlci5jYXB0dXJlKGZ1bGxJbnB1dCk7XG59XG5cbi8qKlxuICogQ2FwdHVyZSBhbiBldmVudCBhc3luY2hyb25vdXNseS5cbiAqIFVzZSB3aGVuIHlvdSBuZWVkIHRvIGF3YWl0IGJhY2tlbmQgY29tcGxldGlvbi5cbiAqIFxuICogUmV0dXJucyB1bmRlZmluZWQgaWY6XG4gKiAtIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkXG4gKiAtIE5vIGV4ZWN1dGlvbiBjb250ZXh0IChubyBjb3JyZWxhdGlvbklkKVxuICogLSBGaWx0ZXJlZC9zYW1wbGVkIG91dFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FwdHVyZVJlY29yZEFzeW5jKFxuICBvYnNlcnZlck5hbWU6IHN0cmluZyxcbiAgaW5wdXQ6IE9taXQ8Q2FwdHVyZUlucHV0LCAnY29ycmVsYXRpb25JZCcgfCAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB8ICd0aW1lc3RhbXBNcyc+ICYgUmVjb3JkT3ZlcnJpZGVzICYge1xuICAgIG9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgICB0aW1lc3RhbXBNcz86IG51bWJlcjtcbiAgfVxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgLy8gRGVmZW5zaXZlOiBkb24ndCBjcmFzaCB1c2VyIGNvZGUgaWYgb2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWRcbiAgY29uc3QgY2FwdHVyZXIgPSBjYXB0dXJlclJlZ2lzdHJ5LnRyeUdldCgpO1xuICBpZiAoIWNhcHR1cmVyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIEJ1aWxkIGZ1bGwgaW5wdXQgLSByZXR1cm5zIHVuZGVmaW5lZCBpZiBubyBjb250ZXh0IChubyBjb3JyZWxhdGlvbklkKVxuICBjb25zdCBmdWxsSW5wdXQgPSBidWlsZENhcHR1cmVJbnB1dChvYnNlcnZlck5hbWUsIGlucHV0KTtcbiAgaWYgKCFmdWxsSW5wdXQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIGNhcHR1cmVyLmNhcHR1cmVBc3luYyhmdWxsSW5wdXQpO1xufSJdfQ==