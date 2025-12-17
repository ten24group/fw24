"use strict";
/**
 * SpanObserver - For distributed tracing
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - No auto-generation of correlationId (must be propagated)
 * - Hierarchical spans via parentObservabilityLogId
 * - Fire-and-forget capture via capturer pattern (testable)
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context with correlationId
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Then create spans
 *     const span = SpanObserver.start('processOrder');
 *     try {
 *       // ... work
 *       span.end({ success: true });
 *     } catch (error) {
 *       span.end({ success: false, error });
 *     }
 *   }
 * );
 *
 * // Or use withSpan helper
 * await SpanObserver.withSpan('processOrder', async (span) => {
 *   span.addEvent('validation_complete');
 * });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSpan = exports.SpanObserver = void 0;
const context_1 = require("../context");
const id_generator_1 = require("../utils/id-generator");
const base_1 = require("./base");
const logging_1 = require("../../logging");
const logger = (0, logging_1.createLogger)('SpanObserver');
const OBSERVER_NAME = 'SpanObserver';
class SpanObserver {
    spanId;
    correlationId;
    parentObservabilityLogId;
    level;
    startTime;
    source;
    tags;
    actor;
    attributes;
    operation;
    ended = false;
    constructor(operation, fields, options = {}) {
        const context = (0, context_1.getCurrentContext)();
        this.operation = operation;
        this.spanId = (0, base_1.generateId)();
        this.correlationId = fields.correlationId;
        // Store parent at construction time - use null to mean "no parent" (not undefined)
        // This prevents buildEvent from falling back to mutated context
        this.parentObservabilityLogId = options.parentObservabilityLogId ?? context?.parentObservabilityLogId ?? null;
        this.level = options.level ?? 'info';
        this.attributes = options.attributes ?? {};
        this.source = options.source ?? fields.source;
        this.tags = (0, base_1.mergeObserverTags)(fields.tags, options.tags);
        this.actor = options.actor ?? fields.actor;
        this.startTime = Date.now();
        // Emit span.start event using capturer pattern
        // CRITICAL: observabilityLogId MUST equal spanId for parent-child linking to work
        // Child spans reference parentObservabilityLogId = parent.spanId, which must match parent's observabilityLogId
        (0, base_1.captureEvent)(fields, {
            type: 'span.start',
            observabilityLogId: this.spanId, // Use spanId as the DB record ID for parent-child linking
            level: this.level,
            parentObservabilityLogId: this.parentObservabilityLogId,
            // NOTE: entityName/entityId NOT set for spans - spans are observability primitives, not business entities
            // If you need to track which business entity a span is for, use tags or attributes
            timestampMs: this.startTime,
            operation: this.operation,
            attributes: this.attributes,
            source: this.source,
            tags: this.tags,
            actor: this.actor,
        });
    }
    /**
     * Start a new span
     *
     * @param operation - Name of the operation being traced
     * @param options - Span options (correlationId auto-generated if no context)
     * @returns SpanObserver instance (always succeeds)
     */
    static start(operation, options) {
        // Build common fields using base utilities
        // Note: buildCommonFields now always returns fields (auto-generates correlationId if needed)
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            // Use W3C Trace ID if no correlationId provided
            correlationId: options?.correlationId ?? (0, id_generator_1.generateTraceId)(),
            actor: options?.actor,
            source: options?.source,
            tags: options?.tags,
        });
        return new SpanObserver(operation, fields, options);
    }
    /**
     * Execute function within a span
     */
    static async withSpan(operation, fn, options) {
        const span = SpanObserver.start(operation, options);
        try {
            const result = await fn(span);
            span.end({ success: true });
            return result;
        }
        catch (error) {
            span.end({ success: false, error: (0, base_1.normalizeError)(error) });
            throw error;
        }
    }
    // === Getters ===
    get id() {
        return this.spanId;
    }
    get traceId() {
        return this.correlationId;
    }
    // === Attribute management ===
    setAttribute(key, value) {
        this.attributes[key] = value;
        return this;
    }
    setAttributes(attrs) {
        Object.assign(this.attributes, attrs);
        return this;
    }
    // === OTEL Compliance ===
    setStatus(code, message) {
        // We map OTEL status to our internal attributes/status
        // Note: Actual end() call will finalize the status, but this allows intermediate updates
        this.attributes['otel.status_code'] = code;
        if (message) {
            this.attributes['otel.status_description'] = message;
        }
        return this;
    }
    recordException(exception) {
        const error = (0, base_1.normalizeError)(exception);
        this.addEvent('exception', {
            'exception.type': error.name,
            'exception.message': error.message,
            'exception.stacktrace': error.stack,
        });
        // Also track the last error on the span itself for easy access
        this.setAttribute('error', true);
        return this;
    }
    // === Events ===
    addEvent(name, eventAttributes) {
        (0, base_1.captureEvent)({
            actor: this.actor,
            correlationId: this.correlationId,
            source: this.source,
            tags: this.tags
        }, {
            type: 'span.event',
            observabilityLogId: (0, base_1.generateId)(), // Events get their own unique ID
            level: this.level,
            parentObservabilityLogId: this.spanId, // Parent is this span
            // NOTE: entityName/entityId NOT set - span events are observability primitives
            timestampMs: Date.now(),
            operation: name,
            attributes: eventAttributes,
        });
        return this;
    }
    // === End span ===
    end(options) {
        if (this.ended)
            return;
        this.ended = true;
        const endTime = Date.now();
        const duration = endTime - this.startTime;
        (0, base_1.captureEvent)({ correlationId: this.correlationId, actor: this.actor, source: this.source, tags: this.tags }, {
            type: 'span.end',
            observabilityLogId: (0, base_1.generateId)(), // span.end gets its own unique ID
            level: options?.error ? 'error' : this.level,
            parentObservabilityLogId: this.spanId, // Parent is THIS span (span.start record), consistent with span.event
            // NOTE: entityName/entityId NOT set - spans are observability primitives
            timestampMs: endTime,
            durationMs: duration,
            operation: this.operation,
            success: options?.success ?? !options?.error,
            status: options?.status ?? (options?.error ? 'failed' : 'completed'),
            attributes: this.attributes,
            error: options?.error ? (0, base_1.mapError)(options.error) : undefined,
            metrics: { duration },
        });
    }
    // === Child spans ===
    /**
     * Execute function within a child span
     */
    async withChild(operation, fn, options) {
        return SpanObserver.withSpan(operation, fn, {
            ...options,
            correlationId: this.correlationId,
            parentObservabilityLogId: this.spanId,
            source: options?.source ?? this.source,
            tags: { ...this.tags, ...options?.tags },
            actor: options?.actor ?? this.actor,
        });
    }
    /**
     * Create a child span
     */
    createChild(operation, options) {
        return SpanObserver.start(operation, {
            ...options,
            correlationId: this.correlationId,
            parentObservabilityLogId: this.spanId,
            source: options?.source ?? this.source,
            tags: { ...this.tags, ...options?.tags },
            actor: options?.actor ?? this.actor,
        });
    }
}
exports.SpanObserver = SpanObserver;
// Re-export withSpan for convenience
exports.withSpan = SpanObserver.withSpan.bind(SpanObserver);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7O0FBR0gsd0NBQStDO0FBRS9DLHdEQUF3RDtBQUN4RCxpQ0FTZ0I7QUFDaEIsMkNBQTZDO0FBRTdDLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsQ0FBQztBQUM1QyxNQUFNLGFBQWEsR0FBRyxjQUFjLENBQUM7QUFtRHJDLE1BQWEsWUFBWTtJQUNOLE1BQU0sQ0FBUztJQUNmLGFBQWEsQ0FBUztJQUN0Qix3QkFBd0IsQ0FBZ0I7SUFDeEMsS0FBSyxDQUEyQjtJQUNoQyxTQUFTLENBQVM7SUFDbEIsTUFBTSxDQUFVO0lBQ2hCLElBQUksQ0FBMEI7SUFDOUIsS0FBSyxDQUFTO0lBQ3ZCLFVBQVUsQ0FBMEI7SUFDM0IsU0FBUyxDQUFTO0lBQzNCLEtBQUssR0FBRyxLQUFLLENBQUM7SUFFdEIsWUFBb0IsU0FBaUIsRUFBRSxNQUFvQixFQUFFLFVBQXVCLEVBQUU7UUFDcEYsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1FBRXBDLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxpQkFBVSxHQUFFLENBQUM7UUFDM0IsSUFBSSxDQUFDLGFBQWEsR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDO1FBQzFDLG1GQUFtRjtRQUNuRixnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLHdCQUF3QixHQUFHLE9BQU8sQ0FBQyx3QkFBd0IsSUFBSSxPQUFPLEVBQUUsd0JBQXdCLElBQUksSUFBSSxDQUFDO1FBQzlHLElBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUM7UUFD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WUFDVixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDckMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU07WUFDdEMsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBRTtZQUN4QyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExTkQsb0NBME5DO0FBRUQscUNBQXFDO0FBQ3hCLFFBQUEsUUFBUSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTcGFuT2JzZXJ2ZXIgLSBGb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHQgb3IgZXhwbGljaXQgb3B0aW9uXG4gKiAtIE5vIGF1dG8tZ2VuZXJhdGlvbiBvZiBjb3JyZWxhdGlvbklkIChtdXN0IGJlIHByb3BhZ2F0ZWQpXG4gKiAtIEhpZXJhcmNoaWNhbCBzcGFucyB2aWEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gKiAtIEZpcmUtYW5kLWZvcmdldCBjYXB0dXJlIHZpYSBjYXB0dXJlciBwYXR0ZXJuICh0ZXN0YWJsZSlcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBGSVJTVDogRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBjb3JyZWxhdGlvbklkXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBUaGVuIGNyZWF0ZSBzcGFuc1xuICogICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogICAgIHRyeSB7XG4gKiAgICAgICAvLyAuLi4gd29ya1xuICogICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICogICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gKiAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9KTtcbiAqICAgICB9XG4gKiAgIH1cbiAqICk7XG4gKiBcbiAqIC8vIE9yIHVzZSB3aXRoU3BhbiBoZWxwZXJcbiAqIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAqICAgc3Bhbi5hZGRFdmVudCgndmFsaWRhdGlvbl9jb21wbGV0ZScpO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4uL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQge1xuICByZXNvbHZlQ29ycmVsYXRpb25JZCxcbiAgZ2VuZXJhdGVJZCxcbiAgY2FwdHVyZUV2ZW50LFxuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBtZXJnZU9ic2VydmVyVGFncyxcbiAgQ29tbW9uRmllbGRzLFxufSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignU3Bhbk9ic2VydmVyJyk7XG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ1NwYW5PYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3Bhbk9wdGlvbnMge1xuICAvKiogQ29ycmVsYXRpb24gSUQgLSBpZiBub3QgcHJvdmlkZWQsIG11c3QgY29tZSBmcm9tIGNvbnRleHQgKi9cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgLyoqIFBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZyBJRCBmb3IgbmVzdGVkIHNwYW5zICovXG4gIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZztcbiAgLyoqIFNldmVyaXR5IGxldmVsIGZvciB0aGUgc3BhbiAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgYXR0cmlidXRlcyAqL1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBTb3VyY2UgaWRlbnRpZmllciAqL1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIC8qKiBUYWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBBY3RvciBwZXJmb3JtaW5nIHRoZSBvcGVyYXRpb24gKi9cbiAgYWN0b3I/OiBBY3Rvcjtcbn1cblxuLyoqXG4gKiBJbnRlcmZhY2UgZm9yIHNwYW4gb3BlcmF0aW9ucyAoYWxsb3dzIE5vT3AgaW1wbGVtZW50YXRpb24pXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVNwYW5PYnNlcnZlciB7XG4gIHJlYWRvbmx5IGlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHRyYWNlSWQ6IHN0cmluZztcbiAgc2V0QXR0cmlidXRlKGtleTogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IHRoaXM7XG4gIHNldEF0dHJpYnV0ZXMoYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcztcbiAgLyoqXG4gICAqIFNldCBzcGFuIHN0YXR1cyAoT1RFTCBjb21wbGlhbnQpXG4gICAqIEBwYXJhbSBjb2RlIC0gU3RhdHVzIGNvZGUgKCdPSycgfCAnRVJST1InIHwgJ1VOU0VUJylcbiAgICogQHBhcmFtIG1lc3NhZ2UgLSBPcHRpb25hbCBkZXNjcmlwdGlvblxuICAgKi9cbiAgc2V0U3RhdHVzKGNvZGU6ICdPSycgfCAnRVJST1InIHwgJ1VOU0VUJywgbWVzc2FnZT86IHN0cmluZyk6IHRoaXM7XG4gIC8qKlxuICAgKiBSZWNvcmQgYW4gZXhjZXB0aW9uIChPVEVMIGNvbXBsaWFudClcbiAgICogQWRkcyBhbiBleGNlcHRpb24gZXZlbnQgdG8gdGhlIHNwYW5cbiAgICovXG4gIHJlY29yZEV4Y2VwdGlvbihleGNlcHRpb246IEVycm9yIHwgc3RyaW5nKTogdGhpcztcbiAgYWRkRXZlbnQobmFtZTogc3RyaW5nLCBldmVudEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXM7XG4gIGVuZChvcHRpb25zPzogeyBzdWNjZXNzPzogYm9vbGVhbjsgZXJyb3I/OiBFcnJvcjsgc3RhdHVzPzogc3RyaW5nIH0pOiB2b2lkO1xuICB3aXRoQ2hpbGQ8VD4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46IChzcGFuOiBJU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBPbWl0PFNwYW5PcHRpb25zLCAnY29ycmVsYXRpb25JZCcgfCAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJz5cbiAgKTogUHJvbWlzZTxUPjtcbiAgY3JlYXRlQ2hpbGQoXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBJU3Bhbk9ic2VydmVyO1xufVxuXG5leHBvcnQgY2xhc3MgU3Bhbk9ic2VydmVyIGltcGxlbWVudHMgSVNwYW5PYnNlcnZlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3BhbklkOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgY29ycmVsYXRpb25JZDogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSByZWFkb25seSBsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0VGltZTogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNvdXJjZT86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgcHJpdmF0ZSByZWFkb25seSBhY3Rvcj86IEFjdG9yO1xuICBwcml2YXRlIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBwcml2YXRlIHJlYWRvbmx5IG9wZXJhdGlvbjogc3RyaW5nO1xuICBwcml2YXRlIGVuZGVkID0gZmFsc2U7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihvcGVyYXRpb246IHN0cmluZywgZmllbGRzOiBDb21tb25GaWVsZHMsIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICAgIHRoaXMub3BlcmF0aW9uID0gb3BlcmF0aW9uO1xuICAgIHRoaXMuc3BhbklkID0gZ2VuZXJhdGVJZCgpO1xuICAgIHRoaXMuY29ycmVsYXRpb25JZCA9IGZpZWxkcy5jb3JyZWxhdGlvbklkO1xuICAgIC8vIFN0b3JlIHBhcmVudCBhdCBjb25zdHJ1Y3Rpb24gdGltZSAtIHVzZSBudWxsIHRvIG1lYW4gXCJubyBwYXJlbnRcIiAobm90IHVuZGVmaW5lZClcbiAgICAvLyBUaGlzIHByZXZlbnRzIGJ1aWxkRXZlbnQgZnJvbSBmYWxsaW5nIGJhY2sgdG8gbXV0YXRlZCBjb250ZXh0XG4gICAgdGhpcy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBvcHRpb25zLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyBjb250ZXh0Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gbnVsbDtcbiAgICB0aGlzLmxldmVsID0gb3B0aW9ucy5sZXZlbCA/PyAnaW5mbyc7XG4gICAgdGhpcy5hdHRyaWJ1dGVzID0gb3B0aW9ucy5hdHRyaWJ1dGVzID8/IHt9O1xuICAgIHRoaXMuc291cmNlID0gb3B0aW9ucy5zb3VyY2UgPz8gZmllbGRzLnNvdXJjZTtcbiAgICB0aGlzLnRhZ3MgPSBtZXJnZU9ic2VydmVyVGFncyhmaWVsZHMudGFncywgb3B0aW9ucy50YWdzKTtcbiAgICB0aGlzLmFjdG9yID0gb3B0aW9ucy5hY3RvciA/PyBmaWVsZHMuYWN0b3I7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gRW1pdCBzcGFuLnN0YXJ0IGV2ZW50IHVzaW5nIGNhcHR1cmVyIHBhdHRlcm5cbiAgICAvLyBDUklUSUNBTDogb2JzZXJ2YWJpbGl0eUxvZ0lkIE1VU1QgZXF1YWwgc3BhbklkIGZvciBwYXJlbnQtY2hpbGQgbGlua2luZyB0byB3b3JrXG4gICAgLy8gQ2hpbGQgc3BhbnMgcmVmZXJlbmNlIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHBhcmVudC5zcGFuSWQsIHdoaWNoIG11c3QgbWF0Y2ggcGFyZW50J3Mgb2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ3NwYW4uc3RhcnQnLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCwgIC8vIFVzZSBzcGFuSWQgYXMgdGhlIERCIHJlY29yZCBJRCBmb3IgcGFyZW50LWNoaWxkIGxpbmtpbmdcbiAgICAgIGxldmVsOiB0aGlzLmxldmVsLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIC8vIE5PVEU6IGVudGl0eU5hbWUvZW50aXR5SWQgTk9UIHNldCBmb3Igc3BhbnMgLSBzcGFucyBhcmUgb2JzZXJ2YWJpbGl0eSBwcmltaXRpdmVzLCBub3QgYnVzaW5lc3MgZW50aXRpZXNcbiAgICAgIC8vIElmIHlvdSBuZWVkIHRvIHRyYWNrIHdoaWNoIGJ1c2luZXNzIGVudGl0eSBhIHNwYW4gaXMgZm9yLCB1c2UgdGFncyBvciBhdHRyaWJ1dGVzXG4gICAgICB0aW1lc3RhbXBNczogdGhpcy5zdGFydFRpbWUsXG4gICAgICBvcGVyYXRpb246IHRoaXMub3BlcmF0aW9uLFxuICAgICAgYXR0cmlidXRlczogdGhpcy5hdHRyaWJ1dGVzLFxuICAgICAgc291cmNlOiB0aGlzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0IGEgbmV3IHNwYW5cbiAgICogXG4gICAqIEBwYXJhbSBvcGVyYXRpb24gLSBOYW1lIG9mIHRoZSBvcGVyYXRpb24gYmVpbmcgdHJhY2VkXG4gICAqIEBwYXJhbSBvcHRpb25zIC0gU3BhbiBvcHRpb25zIChjb3JyZWxhdGlvbklkIGF1dG8tZ2VuZXJhdGVkIGlmIG5vIGNvbnRleHQpXG4gICAqIEByZXR1cm5zIFNwYW5PYnNlcnZlciBpbnN0YW5jZSAoYWx3YXlzIHN1Y2NlZWRzKVxuICAgKi9cbiAgc3RhdGljIHN0YXJ0KG9wZXJhdGlvbjogc3RyaW5nLCBvcHRpb25zPzogU3Bhbk9wdGlvbnMpOiBJU3Bhbk9ic2VydmVyIHtcbiAgICAvLyBCdWlsZCBjb21tb24gZmllbGRzIHVzaW5nIGJhc2UgdXRpbGl0aWVzXG4gICAgLy8gTm90ZTogYnVpbGRDb21tb25GaWVsZHMgbm93IGFsd2F5cyByZXR1cm5zIGZpZWxkcyAoYXV0by1nZW5lcmF0ZXMgY29ycmVsYXRpb25JZCBpZiBuZWVkZWQpXG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgLy8gVXNlIFczQyBUcmFjZSBJRCBpZiBubyBjb3JyZWxhdGlvbklkIHByb3ZpZGVkXG4gICAgICBjb3JyZWxhdGlvbklkOiBvcHRpb25zPy5jb3JyZWxhdGlvbklkID8/IGdlbmVyYXRlVHJhY2VJZCgpLFxuICAgICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yLFxuICAgICAgc291cmNlOiBvcHRpb25zPy5zb3VyY2UsXG4gICAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBTcGFuT2JzZXJ2ZXIob3BlcmF0aW9uLCBmaWVsZHMsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgZnVuY3Rpb24gd2l0aGluIGEgc3BhblxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhTcGFuPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogSVNwYW5PYnNlcnZlcikgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zPzogU3Bhbk9wdGlvbnNcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChvcGVyYXRpb24sIG9wdGlvbnMpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmbihzcGFuKTtcbiAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvLyA9PT0gR2V0dGVycyA9PT1cbiAgZ2V0IGlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc3BhbklkO1xuICB9XG5cbiAgZ2V0IHRyYWNlSWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5jb3JyZWxhdGlvbklkO1xuICB9XG5cbiAgLy8gPT09IEF0dHJpYnV0ZSBtYW5hZ2VtZW50ID09PVxuICBzZXRBdHRyaWJ1dGUoa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdGhpcyB7XG4gICAgdGhpcy5hdHRyaWJ1dGVzWyBrZXkgXSA9IHZhbHVlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgc2V0QXR0cmlidXRlcyhhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICBPYmplY3QuYXNzaWduKHRoaXMuYXR0cmlidXRlcywgYXR0cnMpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gPT09IE9URUwgQ29tcGxpYW5jZSA9PT1cbiAgc2V0U3RhdHVzKGNvZGU6ICdPSycgfCAnRVJST1InIHwgJ1VOU0VUJywgbWVzc2FnZT86IHN0cmluZyk6IHRoaXMge1xuICAgIC8vIFdlIG1hcCBPVEVMIHN0YXR1cyB0byBvdXIgaW50ZXJuYWwgYXR0cmlidXRlcy9zdGF0dXNcbiAgICAvLyBOb3RlOiBBY3R1YWwgZW5kKCkgY2FsbCB3aWxsIGZpbmFsaXplIHRoZSBzdGF0dXMsIGJ1dCB0aGlzIGFsbG93cyBpbnRlcm1lZGlhdGUgdXBkYXRlc1xuICAgIHRoaXMuYXR0cmlidXRlc1sgJ290ZWwuc3RhdHVzX2NvZGUnIF0gPSBjb2RlO1xuICAgIGlmIChtZXNzYWdlKSB7XG4gICAgICB0aGlzLmF0dHJpYnV0ZXNbICdvdGVsLnN0YXR1c19kZXNjcmlwdGlvbicgXSA9IG1lc3NhZ2U7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcmVjb3JkRXhjZXB0aW9uKGV4Y2VwdGlvbjogRXJyb3IgfCBzdHJpbmcpOiB0aGlzIHtcbiAgICBjb25zdCBlcnJvciA9IG5vcm1hbGl6ZUVycm9yKGV4Y2VwdGlvbik7XG4gICAgdGhpcy5hZGRFdmVudCgnZXhjZXB0aW9uJywge1xuICAgICAgJ2V4Y2VwdGlvbi50eXBlJzogZXJyb3IubmFtZSxcbiAgICAgICdleGNlcHRpb24ubWVzc2FnZSc6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAnZXhjZXB0aW9uLnN0YWNrdHJhY2UnOiBlcnJvci5zdGFjayxcbiAgICB9KTtcbiAgICAvLyBBbHNvIHRyYWNrIHRoZSBsYXN0IGVycm9yIG9uIHRoZSBzcGFuIGl0c2VsZiBmb3IgZWFzeSBhY2Nlc3NcbiAgICB0aGlzLnNldEF0dHJpYnV0ZSgnZXJyb3InLCB0cnVlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vID09PSBFdmVudHMgPT09XG4gIGFkZEV2ZW50KG5hbWU6IHN0cmluZywgZXZlbnRBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICBjYXB0dXJlRXZlbnQoXG4gICAgICB7XG4gICAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIHNvdXJjZTogdGhpcy5zb3VyY2UsXG4gICAgICAgIHRhZ3M6IHRoaXMudGFnc1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ3NwYW4uZXZlbnQnLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGdlbmVyYXRlSWQoKSwgIC8vIEV2ZW50cyBnZXQgdGhlaXIgb3duIHVuaXF1ZSBJRFxuICAgICAgICBsZXZlbDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCwgIC8vIFBhcmVudCBpcyB0aGlzIHNwYW5cbiAgICAgICAgLy8gTk9URTogZW50aXR5TmFtZS9lbnRpdHlJZCBOT1Qgc2V0IC0gc3BhbiBldmVudHMgYXJlIG9ic2VydmFiaWxpdHkgcHJpbWl0aXZlc1xuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgb3BlcmF0aW9uOiBuYW1lLFxuICAgICAgICBhdHRyaWJ1dGVzOiBldmVudEF0dHJpYnV0ZXMsXG4gICAgICB9XG4gICAgKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vID09PSBFbmQgc3BhbiA9PT1cbiAgZW5kKG9wdGlvbnM/OiB7IHN1Y2Nlc3M/OiBib29sZWFuOyBlcnJvcj86IEVycm9yOyBzdGF0dXM/OiBzdHJpbmcgfSk6IHZvaWQge1xuICAgIGlmICh0aGlzLmVuZGVkKSByZXR1cm47XG4gICAgdGhpcy5lbmRlZCA9IHRydWU7XG5cbiAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBkdXJhdGlvbiA9IGVuZFRpbWUgLSB0aGlzLnN0YXJ0VGltZTtcblxuICAgIGNhcHR1cmVFdmVudChcbiAgICAgIHsgY29ycmVsYXRpb25JZDogdGhpcy5jb3JyZWxhdGlvbklkLCBhY3RvcjogdGhpcy5hY3Rvciwgc291cmNlOiB0aGlzLnNvdXJjZSwgdGFnczogdGhpcy50YWdzIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdzcGFuLmVuZCcsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZ2VuZXJhdGVJZCgpLCAgLy8gc3Bhbi5lbmQgZ2V0cyBpdHMgb3duIHVuaXF1ZSBJRFxuICAgICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCwgIC8vIFBhcmVudCBpcyBUSElTIHNwYW4gKHNwYW4uc3RhcnQgcmVjb3JkKSwgY29uc2lzdGVudCB3aXRoIHNwYW4uZXZlbnRcbiAgICAgICAgLy8gTk9URTogZW50aXR5TmFtZS9lbnRpdHlJZCBOT1Qgc2V0IC0gc3BhbnMgYXJlIG9ic2VydmFiaWxpdHkgcHJpbWl0aXZlc1xuICAgICAgICB0aW1lc3RhbXBNczogZW5kVGltZSxcbiAgICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICAgIHN1Y2Nlc3M6IG9wdGlvbnM/LnN1Y2Nlc3MgPz8gIW9wdGlvbnM/LmVycm9yLFxuICAgICAgICBzdGF0dXM6IG9wdGlvbnM/LnN0YXR1cyA/PyAob3B0aW9ucz8uZXJyb3IgPyAnZmFpbGVkJyA6ICdjb21wbGV0ZWQnKSxcbiAgICAgICAgYXR0cmlidXRlczogdGhpcy5hdHRyaWJ1dGVzLFxuICAgICAgICBlcnJvcjogb3B0aW9ucz8uZXJyb3IgPyBtYXBFcnJvcihvcHRpb25zLmVycm9yKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgbWV0cmljczogeyBkdXJhdGlvbiB9LFxuICAgICAgfVxuICAgICk7XG4gIH1cblxuICAvLyA9PT0gQ2hpbGQgc3BhbnMgPT09XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgZnVuY3Rpb24gd2l0aGluIGEgY2hpbGQgc3BhblxuICAgKi9cbiAgYXN5bmMgd2l0aENoaWxkPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogSVNwYW5PYnNlcnZlcikgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zPzogT21pdDxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCc+XG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4ob3BlcmF0aW9uLCBmbiwge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5zcGFuSWQsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSA/PyB0aGlzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCAuLi5vcHRpb25zPy50YWdzIH0sXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IgPz8gdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBjaGlsZCBzcGFuXG4gICAqL1xuICBjcmVhdGVDaGlsZChcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBvcHRpb25zPzogT21pdDxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCc+XG4gICk6IElTcGFuT2JzZXJ2ZXIge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIuc3RhcnQob3BlcmF0aW9uLCB7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgY29ycmVsYXRpb25JZDogdGhpcy5jb3JyZWxhdGlvbklkLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCxcbiAgICAgIHNvdXJjZTogb3B0aW9ucz8uc291cmNlID8/IHRoaXMuc291cmNlLFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIC4uLm9wdGlvbnM/LnRhZ3MgfSxcbiAgICAgIGFjdG9yOiBvcHRpb25zPy5hY3RvciA/PyB0aGlzLmFjdG9yLFxuICAgIH0pO1xuICB9XG59XG5cbi8vIFJlLWV4cG9ydCB3aXRoU3BhbiBmb3IgY29udmVuaWVuY2VcbmV4cG9ydCBjb25zdCB3aXRoU3BhbiA9IFNwYW5PYnNlcnZlci53aXRoU3Bhbi5iaW5kKFNwYW5PYnNlcnZlcik7XG4iXX0=