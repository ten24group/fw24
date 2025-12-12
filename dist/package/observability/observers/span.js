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
            entityName: 'span',
            entityId: this.spanId,
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
            correlationId: options?.correlationId,
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
            entityName: 'span',
            entityId: this.spanId,
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
            entityName: 'span',
            entityId: this.spanId, // References the same span
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7O0FBR0gsd0NBQStDO0FBRS9DLGlDQVNnQjtBQUNoQiwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQzVDLE1BQU0sYUFBYSxHQUFHLGNBQWMsQ0FBQztBQXdDckMsTUFBYSxZQUFZO0lBQ04sTUFBTSxDQUFTO0lBQ2YsYUFBYSxDQUFTO0lBQ3RCLHdCQUF3QixDQUFnQjtJQUN4QyxLQUFLLENBQTJCO0lBQ2hDLFNBQVMsQ0FBUztJQUNsQixNQUFNLENBQVU7SUFDaEIsSUFBSSxDQUEwQjtJQUM5QixLQUFLLENBQVM7SUFDdkIsVUFBVSxDQUEwQjtJQUMzQixTQUFTLENBQVM7SUFDM0IsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUV0QixZQUFvQixTQUFpQixFQUFFLE1BQW9CLEVBQUUsVUFBdUIsRUFBRTtRQUNwRixNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7UUFFcEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLGlCQUFVLEdBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsYUFBYSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUM7UUFDMUMsbUZBQW1GO1FBQ25GLGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsd0JBQXdCLEdBQUcsT0FBTyxDQUFDLHdCQUF3QixJQUFJLE9BQU8sRUFBRSx3QkFBd0IsSUFBSSxJQUFJLENBQUM7UUFDOUcsSUFBSSxDQUFDLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQztRQUNyQyxJQUFJLENBQUMs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QUFRLENBQUMsU0FBUyxFQUFFLEVBQUUsRUFBRTtZQUMxQyxHQUFHLE9BQU87WUFDVixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDckMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU07WUFDdEMsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBRTtZQUN4QyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxXQUFXLENBQ1QsU0FBaUIsRUFDakIsT0FBeUU7UUFFekUsT0FBTyxZQUFZLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtZQUNuQyxHQUFHLE9BQU87WUFDVixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDckMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU07WUFDdEMsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBRTtZQUN4QyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFwTUQsb0NBb01DO0FBRUQscUNBQXFDO0FBQ3hCLFFBQUEsUUFBUSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTcGFuT2JzZXJ2ZXIgLSBGb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHQgb3IgZXhwbGljaXQgb3B0aW9uXG4gKiAtIE5vIGF1dG8tZ2VuZXJhdGlvbiBvZiBjb3JyZWxhdGlvbklkIChtdXN0IGJlIHByb3BhZ2F0ZWQpXG4gKiAtIEhpZXJhcmNoaWNhbCBzcGFucyB2aWEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gKiAtIEZpcmUtYW5kLWZvcmdldCBjYXB0dXJlIHZpYSBjYXB0dXJlciBwYXR0ZXJuICh0ZXN0YWJsZSlcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBGSVJTVDogRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBjb3JyZWxhdGlvbklkXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBUaGVuIGNyZWF0ZSBzcGFuc1xuICogICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogICAgIHRyeSB7XG4gKiAgICAgICAvLyAuLi4gd29ya1xuICogICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICogICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gKiAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9KTtcbiAqICAgICB9XG4gKiAgIH1cbiAqICk7XG4gKiBcbiAqIC8vIE9yIHVzZSB3aXRoU3BhbiBoZWxwZXJcbiAqIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAqICAgc3Bhbi5hZGRFdmVudCgndmFsaWRhdGlvbl9jb21wbGV0ZScpO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIHJlc29sdmVDb3JyZWxhdGlvbklkLFxuICBnZW5lcmF0ZUlkLFxuICBjYXB0dXJlRXZlbnQsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG4gIG1lcmdlT2JzZXJ2ZXJUYWdzLFxuICBDb21tb25GaWVsZHMsXG59IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdTcGFuT2JzZXJ2ZXInKTtcbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnU3Bhbk9ic2VydmVyJztcblxuZXhwb3J0IGludGVyZmFjZSBTcGFuT3B0aW9ucyB7XG4gIC8qKiBDb3JyZWxhdGlvbiBJRCAtIGlmIG5vdCBwcm92aWRlZCwgbXVzdCBjb21lIGZyb20gY29udGV4dCAqL1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAvKiogUGFyZW50IG9ic2VydmFiaWxpdHkgbG9nIElEIGZvciBuZXN0ZWQgc3BhbnMgKi9cbiAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICAvKiogU2V2ZXJpdHkgbGV2ZWwgZm9yIHRoZSBzcGFuICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICAvKiogQWRkaXRpb25hbCBhdHRyaWJ1dGVzICovXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFNvdXJjZSBpZGVudGlmaWVyICovXG4gIHNvdXJjZT86IHN0cmluZztcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIEFjdG9yIHBlcmZvcm1pbmcgdGhlIG9wZXJhdGlvbiAqL1xuICBhY3Rvcj86IEFjdG9yO1xufVxuXG4vKipcbiAqIEludGVyZmFjZSBmb3Igc3BhbiBvcGVyYXRpb25zIChhbGxvd3MgTm9PcCBpbXBsZW1lbnRhdGlvbilcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU3Bhbk9ic2VydmVyIHtcbiAgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgdHJhY2VJZDogc3RyaW5nO1xuICBzZXRBdHRyaWJ1dGUoa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdGhpcztcbiAgc2V0QXR0cmlidXRlcyhhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzO1xuICBhZGRFdmVudChuYW1lOiBzdHJpbmcsIGV2ZW50QXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcztcbiAgZW5kKG9wdGlvbnM/OiB7IHN1Y2Nlc3M/OiBib29sZWFuOyBlcnJvcj86IEVycm9yOyBzdGF0dXM/OiBzdHJpbmcgfSk6IHZvaWQ7XG4gIHdpdGhDaGlsZDxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBQcm9taXNlPFQ+O1xuICBjcmVhdGVDaGlsZChcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBvcHRpb25zPzogT21pdDxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCc+XG4gICk6IElTcGFuT2JzZXJ2ZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBTcGFuT2JzZXJ2ZXIgaW1wbGVtZW50cyBJU3Bhbk9ic2VydmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBzcGFuSWQ6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIHJlYWRvbmx5IGxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RhcnRUaW1lOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc291cmNlPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBwcml2YXRlIHJlYWRvbmx5IGFjdG9yPzogQWN0b3I7XG4gIHByaXZhdGUgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHByaXZhdGUgcmVhZG9ubHkgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHByaXZhdGUgZW5kZWQgPSBmYWxzZTtcblxuICBwcml2YXRlIGNvbnN0cnVjdG9yKG9wZXJhdGlvbjogc3RyaW5nLCBmaWVsZHM6IENvbW1vbkZpZWxkcywgb3B0aW9uczogU3Bhbk9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gICAgdGhpcy5vcGVyYXRpb24gPSBvcGVyYXRpb247XG4gICAgdGhpcy5zcGFuSWQgPSBnZW5lcmF0ZUlkKCk7XG4gICAgdGhpcy5jb3JyZWxhdGlvbklkID0gZmllbGRzLmNvcnJlbGF0aW9uSWQ7XG4gICAgLy8gU3RvcmUgcGFyZW50IGF0IGNvbnN0cnVjdGlvbiB0aW1lIC0gdXNlIG51bGwgdG8gbWVhbiBcIm5vIHBhcmVudFwiIChub3QgdW5kZWZpbmVkKVxuICAgIC8vIFRoaXMgcHJldmVudHMgYnVpbGRFdmVudCBmcm9tIGZhbGxpbmcgYmFjayB0byBtdXRhdGVkIGNvbnRleHRcbiAgICB0aGlzLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IG9wdGlvbnMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGNvbnRleHQ/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyBudWxsO1xuICAgIHRoaXMubGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgICB0aGlzLmF0dHJpYnV0ZXMgPSBvcHRpb25zLmF0dHJpYnV0ZXMgPz8ge307XG4gICAgdGhpcy5zb3VyY2UgPSBvcHRpb25zLnNvdXJjZSA/PyBmaWVsZHMuc291cmNlO1xuICAgIHRoaXMudGFncyA9IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBvcHRpb25zLnRhZ3MpO1xuICAgIHRoaXMuYWN0b3IgPSBvcHRpb25zLmFjdG9yID8/IGZpZWxkcy5hY3RvcjtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAvLyBFbWl0IHNwYW4uc3RhcnQgZXZlbnQgdXNpbmcgY2FwdHVyZXIgcGF0dGVyblxuICAgIC8vIENSSVRJQ0FMOiBvYnNlcnZhYmlsaXR5TG9nSWQgTVVTVCBlcXVhbCBzcGFuSWQgZm9yIHBhcmVudC1jaGlsZCBsaW5raW5nIHRvIHdvcmtcbiAgICAvLyBDaGlsZCBzcGFucyByZWZlcmVuY2UgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gcGFyZW50LnNwYW5JZCwgd2hpY2ggbXVzdCBtYXRjaCBwYXJlbnQncyBvYnNlcnZhYmlsaXR5TG9nSWRcbiAgICBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnc3Bhbi5zdGFydCcsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuc3BhbklkLCAgLy8gVXNlIHNwYW5JZCBhcyB0aGUgREIgcmVjb3JkIElEIGZvciBwYXJlbnQtY2hpbGQgbGlua2luZ1xuICAgICAgbGV2ZWw6IHRoaXMubGV2ZWwsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgZW50aXR5TmFtZTogJ3NwYW4nLFxuICAgICAgZW50aXR5SWQ6IHRoaXMuc3BhbklkLFxuICAgICAgdGltZXN0YW1wTXM6IHRoaXMuc3RhcnRUaW1lLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLm9wZXJhdGlvbixcbiAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuYXR0cmlidXRlcyxcbiAgICAgIHNvdXJjZTogdGhpcy5zb3VyY2UsXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgICBhY3RvcjogdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydCBhIG5ldyBzcGFuXG4gICAqIFxuICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gTmFtZSBvZiB0aGUgb3BlcmF0aW9uIGJlaW5nIHRyYWNlZFxuICAgKiBAcGFyYW0gb3B0aW9ucyAtIFNwYW4gb3B0aW9ucyAoY29ycmVsYXRpb25JZCBhdXRvLWdlbmVyYXRlZCBpZiBubyBjb250ZXh0KVxuICAgKiBAcmV0dXJucyBTcGFuT2JzZXJ2ZXIgaW5zdGFuY2UgKGFsd2F5cyBzdWNjZWVkcylcbiAgICovXG4gIHN0YXRpYyBzdGFydChvcGVyYXRpb246IHN0cmluZywgb3B0aW9ucz86IFNwYW5PcHRpb25zKTogSVNwYW5PYnNlcnZlciB7XG4gICAgLy8gQnVpbGQgY29tbW9uIGZpZWxkcyB1c2luZyBiYXNlIHV0aWxpdGllc1xuICAgIC8vIE5vdGU6IGJ1aWxkQ29tbW9uRmllbGRzIG5vdyBhbHdheXMgcmV0dXJucyBmaWVsZHMgKGF1dG8tZ2VuZXJhdGVzIGNvcnJlbGF0aW9uSWQgaWYgbmVlZGVkKVxuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSxcbiAgICAgIHRhZ3M6IG9wdGlvbnM/LnRhZ3MsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gbmV3IFNwYW5PYnNlcnZlcihvcGVyYXRpb24sIGZpZWxkcywgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBmdW5jdGlvbiB3aXRoaW4gYSBzcGFuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aFNwYW48VD4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46IChzcGFuOiBJU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9uc1xuICApOiBQcm9taXNlPFQ+IHtcbiAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KG9wZXJhdGlvbiwgb3B0aW9ucyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZuKHNwYW4pO1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8vID09PSBHZXR0ZXJzID09PVxuICBnZXQgaWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5zcGFuSWQ7XG4gIH1cblxuICBnZXQgdHJhY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvcnJlbGF0aW9uSWQ7XG4gIH1cblxuICAvLyA9PT0gQXR0cmlidXRlIG1hbmFnZW1lbnQgPT09XG4gIHNldEF0dHJpYnV0ZShrZXk6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiB0aGlzIHtcbiAgICB0aGlzLmF0dHJpYnV0ZXNbIGtleSBdID0gdmFsdWU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBzZXRBdHRyaWJ1dGVzKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXMge1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5hdHRyaWJ1dGVzLCBhdHRycyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyA9PT0gRXZlbnRzID09PVxuICBhZGRFdmVudChuYW1lOiBzdHJpbmcsIGV2ZW50QXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcyB7XG4gICAgY2FwdHVyZUV2ZW50KFxuICAgICAge1xuICAgICAgICBhY3RvcjogdGhpcy5hY3RvcixcbiAgICAgICAgY29ycmVsYXRpb25JZDogdGhpcy5jb3JyZWxhdGlvbklkLFxuICAgICAgICBzb3VyY2U6IHRoaXMuc291cmNlLFxuICAgICAgICB0YWdzOiB0aGlzLnRhZ3NcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdzcGFuLmV2ZW50JyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBnZW5lcmF0ZUlkKCksICAvLyBFdmVudHMgZ2V0IHRoZWlyIG93biB1bmlxdWUgSURcbiAgICAgICAgbGV2ZWw6IHRoaXMubGV2ZWwsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5zcGFuSWQsICAvLyBQYXJlbnQgaXMgdGhpcyBzcGFuXG4gICAgICAgIGVudGl0eU5hbWU6ICdzcGFuJyxcbiAgICAgICAgZW50aXR5SWQ6IHRoaXMuc3BhbklkLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgb3BlcmF0aW9uOiBuYW1lLFxuICAgICAgICBhdHRyaWJ1dGVzOiBldmVudEF0dHJpYnV0ZXMsXG4gICAgICB9XG4gICAgKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vID09PSBFbmQgc3BhbiA9PT1cbiAgZW5kKG9wdGlvbnM/OiB7IHN1Y2Nlc3M/OiBib29sZWFuOyBlcnJvcj86IEVycm9yOyBzdGF0dXM/OiBzdHJpbmcgfSk6IHZvaWQge1xuICAgIGlmICh0aGlzLmVuZGVkKSByZXR1cm47XG4gICAgdGhpcy5lbmRlZCA9IHRydWU7XG5cbiAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBkdXJhdGlvbiA9IGVuZFRpbWUgLSB0aGlzLnN0YXJ0VGltZTtcblxuICAgIGNhcHR1cmVFdmVudChcbiAgICAgIHsgY29ycmVsYXRpb25JZDogdGhpcy5jb3JyZWxhdGlvbklkLCBhY3RvcjogdGhpcy5hY3Rvciwgc291cmNlOiB0aGlzLnNvdXJjZSwgdGFnczogdGhpcy50YWdzIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdzcGFuLmVuZCcsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZ2VuZXJhdGVJZCgpLCAgLy8gc3Bhbi5lbmQgZ2V0cyBpdHMgb3duIHVuaXF1ZSBJRFxuICAgICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCwgIC8vIFBhcmVudCBpcyBUSElTIHNwYW4gKHNwYW4uc3RhcnQgcmVjb3JkKSwgY29uc2lzdGVudCB3aXRoIHNwYW4uZXZlbnRcbiAgICAgICAgZW50aXR5TmFtZTogJ3NwYW4nLFxuICAgICAgICBlbnRpdHlJZDogdGhpcy5zcGFuSWQsICAvLyBSZWZlcmVuY2VzIHRoZSBzYW1lIHNwYW5cbiAgICAgICAgdGltZXN0YW1wTXM6IGVuZFRpbWUsXG4gICAgICAgIGR1cmF0aW9uTXM6IGR1cmF0aW9uLFxuICAgICAgICBvcGVyYXRpb246IHRoaXMub3BlcmF0aW9uLFxuICAgICAgICBzdWNjZXNzOiBvcHRpb25zPy5zdWNjZXNzID8/ICFvcHRpb25zPy5lcnJvcixcbiAgICAgICAgc3RhdHVzOiBvcHRpb25zPy5zdGF0dXMgPz8gKG9wdGlvbnM/LmVycm9yID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJyksXG4gICAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuYXR0cmlidXRlcyxcbiAgICAgICAgZXJyb3I6IG9wdGlvbnM/LmVycm9yID8gbWFwRXJyb3Iob3B0aW9ucy5lcnJvcikgOiB1bmRlZmluZWQsXG4gICAgICAgIG1ldHJpY3M6IHsgZHVyYXRpb24gfSxcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgLy8gPT09IENoaWxkIHNwYW5zID09PVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGZ1bmN0aW9uIHdpdGhpbiBhIGNoaWxkIHNwYW5cbiAgICovXG4gIGFzeW5jIHdpdGhDaGlsZDxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLndpdGhTcGFuKG9wZXJhdGlvbiwgZm4sIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuc3BhbklkLFxuICAgICAgc291cmNlOiBvcHRpb25zPy5zb3VyY2UgPz8gdGhpcy5zb3VyY2UsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgLi4ub3B0aW9ucz8udGFncyB9LFxuICAgICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yID8/IHRoaXMuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgY2hpbGQgc3BhblxuICAgKi9cbiAgY3JlYXRlQ2hpbGQoXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBJU3Bhbk9ic2VydmVyIHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLnN0YXJ0KG9wZXJhdGlvbiwge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5zcGFuSWQsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSA/PyB0aGlzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCAuLi5vcHRpb25zPy50YWdzIH0sXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IgPz8gdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxufVxuXG4vLyBSZS1leHBvcnQgd2l0aFNwYW4gZm9yIGNvbnZlbmllbmNlXG5leHBvcnQgY29uc3Qgd2l0aFNwYW4gPSBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4uYmluZChTcGFuT2JzZXJ2ZXIpO1xuIl19