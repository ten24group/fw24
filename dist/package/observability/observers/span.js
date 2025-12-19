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
    causedBy;
    relatedTraces;
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
        this.causedBy = fields.causedBy;
        this.relatedTraces = fields.relatedTraces;
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
        // Pass entire options - buildCommonFields extracts only the fields it needs
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
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
    /**
     * Add an event to the current span context.
     * This is a convenience method for adding events when you don't have direct access to the span object.
     * The event will be linked to the current span via parentObservabilityLogId from context.
     *
     * @param name - Event name
     * @param options - Event options (attributes, metrics, data, level, tags)
     *
     * @example
     * ```typescript
     * // From anywhere in the call stack within an observed context:
     * SpanObserver.addEventToCurrentSpan('database.full_scan', {
     *   attributes: { entityName: 'User', operation: 'query' },
     *   metrics: { records_scanned: 1000 },
     *   level: 'warn'
     * });
     * ```
     */
    static addEventToCurrentSpan(name, options) {
        try {
            const context = (0, context_1.getCurrentContext)();
            if (!context?.correlationId) {
                logger.debug('No execution context found, skipping event');
                return;
            }
            const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME);
            // Merge tags from options with context tags (options take precedence)
            const mergedTags = { ...context.tags, ...(options?.tags || {}) };
            (0, base_1.captureEvent)({ ...fields, tags: mergedTags }, {
                type: 'span.event',
                observabilityLogId: (0, base_1.generateId)(),
                level: options?.level || 'info',
                parentObservabilityLogId: context.parentObservabilityLogId || null,
                timestampMs: Date.now(),
                operation: name,
                attributes: options?.attributes,
                metrics: options?.metrics,
                data: options?.data,
            });
        }
        catch (error) {
            logger.warn('Failed to add event to current span', error);
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
            level: 'error',
            attributes: {
                'exception.type': error.name,
                'exception.message': error.message,
                'exception.stacktrace': error.stack,
            }
        });
        // Also track the last error on the span itself for easy access
        this.setAttribute('error', true);
        return this;
    }
    // === Events ===
    addEvent(name, options) {
        // Merge tags from options with span tags (options take precedence)
        const mergedTags = { ...this.tags, ...(options?.tags || {}) };
        (0, base_1.captureEvent)({
            correlationId: this.correlationId,
            causedBy: this.causedBy,
            relatedTraces: this.relatedTraces,
            actor: this.actor,
            source: this.source,
            tags: mergedTags
        }, {
            type: 'span.event',
            observabilityLogId: (0, base_1.generateId)(), // Events get their own unique ID
            level: options?.level || this.level,
            parentObservabilityLogId: this.spanId, // Parent is this span
            // NOTE: entityName/entityId NOT set - span events are observability primitives
            timestampMs: Date.now(),
            operation: name,
            attributes: options?.attributes,
            metrics: options?.metrics,
            data: options?.data,
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
        (0, base_1.captureEvent)({
            correlationId: this.correlationId,
            causedBy: this.causedBy,
            relatedTraces: this.relatedTraces,
            actor: this.actor,
            source: this.source,
            tags: this.tags
        }, {
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
            // Merge span attributes with end attributes
            attributes: {
                ...this.attributes,
                ...(options?.attributes || {})
            },
            error: options?.error ? (0, base_1.mapError)(options.error) : undefined,
            // Merge duration with custom metrics
            metrics: {
                duration,
                ...(options?.metrics || {})
            },
            // Support data in span.end
            data: options?.data,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7O0FBR0gsd0NBQStDO0FBRy9DLGlDQVdnQjtBQUNoQiwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQzVDLE1BQU0sYUFBYSxHQUFHLGNBQWMsQ0FBQztBQWtFckMsTUFBYSxZQUFZO0lBQ04sTUFBTSxDQUFTO0lBQ2YsYUFBYSxDQUFTO0lBQ3RCLHdCQUF3QixDQUFnQjtJQUN4QyxRQUFRLENBQVU7SUFDbEIsYUFBYSxDQUFZO0lBQ3pCLEtBQUssQ0FBMkI7SUFDaEMsU0FBUyxDQUFTO0lBQ2xCLE1BQU0sQ0FBVTtJQUNoQixJQUFJLENBQTBCO0lBQzlCLEtBQUssQ0FBUztJQUN2QixVQUFVLENBQTBCO0lBQzNCLFNBQVMsQ0FBUztJQUMzQixLQUFLLEdBQUcsS0FBSyxDQUFDO0lBRXRCLFlBQW9CLFNBQWlCLEVBQUUsTUFBb0IsRUFBRSxVQUF1QixFQUFFO1FBQ3BGLE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztRQUVwQyxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsaUJBQVUsR0FBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQztRQUMxQyxtRkFBbUY7UUFDbkYsZ0VBQWdFO1FBQ2hFLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxPQUFPLENBQUMsd0JBQXdCLElBQUksT0FBTyxFQUFFLHdCQUF3QixJQUFJLElBQUksQ0FBQztRQUM5RyxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFR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ciAtIEZvciBkaXN0cmlidXRlZCB0cmFjaW5nXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBSZXF1aXJlcyBjb3JyZWxhdGlvbklkIGZyb20gY29udGV4dCBvciBleHBsaWNpdCBvcHRpb25cbiAqIC0gTm8gYXV0by1nZW5lcmF0aW9uIG9mIGNvcnJlbGF0aW9uSWQgKG11c3QgYmUgcHJvcGFnYXRlZClcbiAqIC0gSGllcmFyY2hpY2FsIHNwYW5zIHZpYSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAqIC0gRmlyZS1hbmQtZm9yZ2V0IGNhcHR1cmUgdmlhIGNhcHR1cmVyIHBhdHRlcm4gKHRlc3RhYmxlKVxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dCB3aXRoIGNvcnJlbGF0aW9uSWRcbiAqIGF3YWl0IHJ1bldpdGhDb250ZXh0KFxuICogICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQocmVxdWVzdElkKSxcbiAqICAgYXN5bmMgKCkgPT4ge1xuICogICAgIC8vIFRoZW4gY3JlYXRlIHNwYW5zXG4gKiAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydCgncHJvY2Vzc09yZGVyJyk7XG4gKiAgICAgdHJ5IHtcbiAqICAgICAgIC8vIC4uLiB3b3JrXG4gKiAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gKiAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAqICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yIH0pO1xuICogICAgIH1cbiAqICAgfVxuICogKTtcbiAqIFxuICogLy8gT3IgdXNlIHdpdGhTcGFuIGhlbHBlclxuICogYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKCdwcm9jZXNzT3JkZXInLCBhc3luYyAoc3BhbikgPT4ge1xuICogICBzcGFuLmFkZEV2ZW50KCd2YWxpZGF0aW9uX2NvbXBsZXRlJyk7XG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50Q29udGV4dCB9IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgZ2VuZXJhdGVUcmFjZUlkIH0gZnJvbSAnLi4vdXRpbHMvaWQtZ2VuZXJhdG9yJztcbmltcG9ydCB7XG4gIHJlc29sdmVDb3JyZWxhdGlvbklkLFxuICBnZW5lcmF0ZUlkLFxuICBjYXB0dXJlRXZlbnQsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG4gIG1lcmdlT2JzZXJ2ZXJUYWdzLFxuICBDb21tb25GaWVsZHMsXG4gIEJhc2VPYnNlcnZlck9wdGlvbnMsXG4gIE9ic2VydmFiaWxpdHlQYXlsb2FkLFxufSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignU3Bhbk9ic2VydmVyJyk7XG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ1NwYW5PYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3Bhbk9wdGlvbnMgZXh0ZW5kcyBCYXNlT2JzZXJ2ZXJPcHRpb25zIHtcbiAgLy8gSW5oZXJpdHM6IGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCByZWxhdGVkVHJhY2VzLCBhY3Rvciwgc291cmNlLCB0YWdzLCBtZXRhZGF0YVxuICAvKiogUGFyZW50IG9ic2VydmFiaWxpdHkgbG9nIElEIGZvciBuZXN0ZWQgc3BhbnMgKi9cbiAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nO1xuICAvKiogU2V2ZXJpdHkgbGV2ZWwgZm9yIHRoZSBzcGFuICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICAvKiogQWRkaXRpb25hbCBhdHRyaWJ1dGVzICovXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciBhZGRpbmcgZXZlbnRzIHRvIGEgc3BhblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwYW5FdmVudE9wdGlvbnMgZXh0ZW5kcyBPYnNlcnZhYmlsaXR5UGF5bG9hZCB7XG4gIC8qKiBFdmVudCBzZXZlcml0eSBsZXZlbCAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgdGFncyBmb3IgdGhpcyBldmVudCAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciBlbmRpbmcgYSBzcGFuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BhbkVuZE9wdGlvbnMgZXh0ZW5kcyBPYnNlcnZhYmlsaXR5UGF5bG9hZCB7XG4gIC8qKiBXaGV0aGVyIHRoZSBvcGVyYXRpb24gc3VjY2VlZGVkICovXG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuICAvKiogRXJyb3IgaWYgb3BlcmF0aW9uIGZhaWxlZCAqL1xuICBlcnJvcj86IEVycm9yO1xuICAvKiogQ3VzdG9tIHN0YXR1cyBzdHJpbmcgKi9cbiAgc3RhdHVzPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEludGVyZmFjZSBmb3Igc3BhbiBvcGVyYXRpb25zIChhbGxvd3MgTm9PcCBpbXBsZW1lbnRhdGlvbilcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU3Bhbk9ic2VydmVyIHtcbiAgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgdHJhY2VJZDogc3RyaW5nO1xuICBzZXRBdHRyaWJ1dGUoa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdGhpcztcbiAgc2V0QXR0cmlidXRlcyhhdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzO1xuICAvKipcbiAgICogU2V0IHNwYW4gc3RhdHVzIChPVEVMIGNvbXBsaWFudClcbiAgICogQHBhcmFtIGNvZGUgLSBTdGF0dXMgY29kZSAoJ09LJyB8ICdFUlJPUicgfCAnVU5TRVQnKVxuICAgKiBAcGFyYW0gbWVzc2FnZSAtIE9wdGlvbmFsIGRlc2NyaXB0aW9uXG4gICAqL1xuICBzZXRTdGF0dXMoY29kZTogJ09LJyB8ICdFUlJPUicgfCAnVU5TRVQnLCBtZXNzYWdlPzogc3RyaW5nKTogdGhpcztcbiAgLyoqXG4gICAqIFJlY29yZCBhbiBleGNlcHRpb24gKE9URUwgY29tcGxpYW50KVxuICAgKiBBZGRzIGFuIGV4Y2VwdGlvbiBldmVudCB0byB0aGUgc3BhblxuICAgKi9cbiAgcmVjb3JkRXhjZXB0aW9uKGV4Y2VwdGlvbjogRXJyb3IgfCBzdHJpbmcpOiB0aGlzO1xuICBhZGRFdmVudChuYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiBTcGFuRXZlbnRPcHRpb25zKTogdGhpcztcbiAgZW5kKG9wdGlvbnM/OiBTcGFuRW5kT3B0aW9ucyk6IHZvaWQ7XG4gIHdpdGhDaGlsZDxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBQcm9taXNlPFQ+O1xuICBjcmVhdGVDaGlsZChcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBvcHRpb25zPzogT21pdDxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCc+XG4gICk6IElTcGFuT2JzZXJ2ZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBTcGFuT2JzZXJ2ZXIgaW1wbGVtZW50cyBJU3Bhbk9ic2VydmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBzcGFuSWQ6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIHJlYWRvbmx5IGNhdXNlZEJ5Pzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlbGF0ZWRUcmFjZXM/OiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0VGltZTogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNvdXJjZT86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgcHJpdmF0ZSByZWFkb25seSBhY3Rvcj86IEFjdG9yO1xuICBwcml2YXRlIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBwcml2YXRlIHJlYWRvbmx5IG9wZXJhdGlvbjogc3RyaW5nO1xuICBwcml2YXRlIGVuZGVkID0gZmFsc2U7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihvcGVyYXRpb246IHN0cmluZywgZmllbGRzOiBDb21tb25GaWVsZHMsIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICAgIHRoaXMub3BlcmF0aW9uID0gb3BlcmF0aW9uO1xuICAgIHRoaXMuc3BhbklkID0gZ2VuZXJhdGVJZCgpO1xuICAgIHRoaXMuY29ycmVsYXRpb25JZCA9IGZpZWxkcy5jb3JyZWxhdGlvbklkO1xuICAgIC8vIFN0b3JlIHBhcmVudCBhdCBjb25zdHJ1Y3Rpb24gdGltZSAtIHVzZSBudWxsIHRvIG1lYW4gXCJubyBwYXJlbnRcIiAobm90IHVuZGVmaW5lZClcbiAgICAvLyBUaGlzIHByZXZlbnRzIGJ1aWxkRXZlbnQgZnJvbSBmYWxsaW5nIGJhY2sgdG8gbXV0YXRlZCBjb250ZXh0XG4gICAgdGhpcy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBvcHRpb25zLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyBjb250ZXh0Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gbnVsbDtcbiAgICB0aGlzLmNhdXNlZEJ5ID0gZmllbGRzLmNhdXNlZEJ5O1xuICAgIHRoaXMucmVsYXRlZFRyYWNlcyA9IGZpZWxkcy5yZWxhdGVkVHJhY2VzO1xuICAgIHRoaXMubGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgICB0aGlzLmF0dHJpYnV0ZXMgPSBvcHRpb25zLmF0dHJpYnV0ZXMgPz8ge307XG4gICAgdGhpcy5zb3VyY2UgPSBvcHRpb25zLnNvdXJjZSA/PyBmaWVsZHMuc291cmNlO1xuICAgIHRoaXMudGFncyA9IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBvcHRpb25zLnRhZ3MpO1xuICAgIHRoaXMuYWN0b3IgPSBvcHRpb25zLmFjdG9yID8/IGZpZWxkcy5hY3RvcjtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAvLyBFbWl0IHNwYW4uc3RhcnQgZXZlbnQgdXNpbmcgY2FwdHVyZXIgcGF0dGVyblxuICAgIC8vIENSSVRJQ0FMOiBvYnNlcnZhYmlsaXR5TG9nSWQgTVVTVCBlcXVhbCBzcGFuSWQgZm9yIHBhcmVudC1jaGlsZCBsaW5raW5nIHRvIHdvcmtcbiAgICAvLyBDaGlsZCBzcGFucyByZWZlcmVuY2UgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gcGFyZW50LnNwYW5JZCwgd2hpY2ggbXVzdCBtYXRjaCBwYXJlbnQncyBvYnNlcnZhYmlsaXR5TG9nSWRcbiAgICBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnc3Bhbi5zdGFydCcsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuc3BhbklkLCAgLy8gVXNlIHNwYW5JZCBhcyB0aGUgREIgcmVjb3JkIElEIGZvciBwYXJlbnQtY2hpbGQgbGlua2luZ1xuICAgICAgbGV2ZWw6IHRoaXMubGV2ZWwsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgLy8gTk9URTogZW50aXR5TmFtZS9lbnRpdHlJZCBOT1Qgc2V0IGZvciBzcGFucyAtIHNwYW5zIGFyZSBvYnNlcnZhYmlsaXR5IHByaW1pdGl2ZXMsIG5vdCBidXNpbmVzcyBlbnRpdGllc1xuICAgICAgLy8gSWYgeW91IG5lZWQgdG8gdHJhY2sgd2hpY2ggYnVzaW5lc3MgZW50aXR5IGEgc3BhbiBpcyBmb3IsIHVzZSB0YWdzIG9yIGF0dHJpYnV0ZXNcbiAgICAgIHRpbWVzdGFtcE1zOiB0aGlzLnN0YXJ0VGltZSxcbiAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLmF0dHJpYnV0ZXMsXG4gICAgICBzb3VyY2U6IHRoaXMuc291cmNlLFxuICAgICAgdGFnczogdGhpcy50YWdzLFxuICAgICAgYWN0b3I6IHRoaXMuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogU3RhcnQgYSBuZXcgc3BhblxuICAgKiBcbiAgICogQHBhcmFtIG9wZXJhdGlvbiAtIE5hbWUgb2YgdGhlIG9wZXJhdGlvbiBiZWluZyB0cmFjZWRcbiAgICogQHBhcmFtIG9wdGlvbnMgLSBTcGFuIG9wdGlvbnMgKGNvcnJlbGF0aW9uSWQgYXV0by1nZW5lcmF0ZWQgaWYgbm8gY29udGV4dClcbiAgICogQHJldHVybnMgU3Bhbk9ic2VydmVyIGluc3RhbmNlIChhbHdheXMgc3VjY2VlZHMpXG4gICAqL1xuICBzdGF0aWMgc3RhcnQob3BlcmF0aW9uOiBzdHJpbmcsIG9wdGlvbnM/OiBTcGFuT3B0aW9ucyk6IElTcGFuT2JzZXJ2ZXIge1xuICAgIC8vIEJ1aWxkIGNvbW1vbiBmaWVsZHMgdXNpbmcgYmFzZSB1dGlsaXRpZXNcbiAgICAvLyBOb3RlOiBidWlsZENvbW1vbkZpZWxkcyBub3cgYWx3YXlzIHJldHVybnMgZmllbGRzIChhdXRvLWdlbmVyYXRlcyBjb3JyZWxhdGlvbklkIGlmIG5lZWRlZClcbiAgICAvLyBQYXNzIGVudGlyZSBvcHRpb25zIC0gYnVpbGRDb21tb25GaWVsZHMgZXh0cmFjdHMgb25seSB0aGUgZmllbGRzIGl0IG5lZWRzXG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICByZXR1cm4gbmV3IFNwYW5PYnNlcnZlcihvcGVyYXRpb24sIGZpZWxkcywgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBmdW5jdGlvbiB3aXRoaW4gYSBzcGFuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aFNwYW48VD4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46IChzcGFuOiBJU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9uc1xuICApOiBQcm9taXNlPFQ+IHtcbiAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KG9wZXJhdGlvbiwgb3B0aW9ucyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZuKHNwYW4pO1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYW4gZXZlbnQgdG8gdGhlIGN1cnJlbnQgc3BhbiBjb250ZXh0LlxuICAgKiBUaGlzIGlzIGEgY29udmVuaWVuY2UgbWV0aG9kIGZvciBhZGRpbmcgZXZlbnRzIHdoZW4geW91IGRvbid0IGhhdmUgZGlyZWN0IGFjY2VzcyB0byB0aGUgc3BhbiBvYmplY3QuXG4gICAqIFRoZSBldmVudCB3aWxsIGJlIGxpbmtlZCB0byB0aGUgY3VycmVudCBzcGFuIHZpYSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgZnJvbSBjb250ZXh0LlxuICAgKiBcbiAgICogQHBhcmFtIG5hbWUgLSBFdmVudCBuYW1lXG4gICAqIEBwYXJhbSBvcHRpb25zIC0gRXZlbnQgb3B0aW9ucyAoYXR0cmlidXRlcywgbWV0cmljcywgZGF0YSwgbGV2ZWwsIHRhZ3MpXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIC8vIEZyb20gYW55d2hlcmUgaW4gdGhlIGNhbGwgc3RhY2sgd2l0aGluIGFuIG9ic2VydmVkIGNvbnRleHQ6XG4gICAqIFNwYW5PYnNlcnZlci5hZGRFdmVudFRvQ3VycmVudFNwYW4oJ2RhdGFiYXNlLmZ1bGxfc2NhbicsIHtcbiAgICogICBhdHRyaWJ1dGVzOiB7IGVudGl0eU5hbWU6ICdVc2VyJywgb3BlcmF0aW9uOiAncXVlcnknIH0sXG4gICAqICAgbWV0cmljczogeyByZWNvcmRzX3NjYW5uZWQ6IDEwMDAgfSxcbiAgICogICBsZXZlbDogJ3dhcm4nXG4gICAqIH0pO1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBhZGRFdmVudFRvQ3VycmVudFNwYW4obmFtZTogc3RyaW5nLCBvcHRpb25zPzogU3BhbkV2ZW50T3B0aW9ucyk6IHZvaWQge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICAgIGlmICghY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoJ05vIGV4ZWN1dGlvbiBjb250ZXh0IGZvdW5kLCBza2lwcGluZyBldmVudCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUpO1xuXG4gICAgICAvLyBNZXJnZSB0YWdzIGZyb20gb3B0aW9ucyB3aXRoIGNvbnRleHQgdGFncyAob3B0aW9ucyB0YWtlIHByZWNlZGVuY2UpXG4gICAgICBjb25zdCBtZXJnZWRUYWdzID0geyAuLi5jb250ZXh0LnRhZ3MsIC4uLihvcHRpb25zPy50YWdzIHx8IHt9KSB9O1xuXG4gICAgICBjYXB0dXJlRXZlbnQoeyAuLi5maWVsZHMsIHRhZ3M6IG1lcmdlZFRhZ3MgfSwge1xuICAgICAgICB0eXBlOiAnc3Bhbi5ldmVudCcsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZ2VuZXJhdGVJZCgpLFxuICAgICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgfHwgJ2luZm8nLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHx8IG51bGwsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBvcGVyYXRpb246IG5hbWUsXG4gICAgICAgIGF0dHJpYnV0ZXM6IG9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICAgIG1ldHJpY3M6IG9wdGlvbnM/Lm1ldHJpY3MsXG4gICAgICAgIGRhdGE6IG9wdGlvbnM/LmRhdGEsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBhZGQgZXZlbnQgdG8gY3VycmVudCBzcGFuJywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vID09PSBHZXR0ZXJzID09PVxuICBnZXQgaWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5zcGFuSWQ7XG4gIH1cblxuICBnZXQgdHJhY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvcnJlbGF0aW9uSWQ7XG4gIH1cblxuICAvLyA9PT0gQXR0cmlidXRlIG1hbmFnZW1lbnQgPT09XG4gIHNldEF0dHJpYnV0ZShrZXk6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiB0aGlzIHtcbiAgICB0aGlzLmF0dHJpYnV0ZXNbIGtleSBdID0gdmFsdWU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBzZXRBdHRyaWJ1dGVzKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXMge1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5hdHRyaWJ1dGVzLCBhdHRycyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyA9PT0gT1RFTCBDb21wbGlhbmNlID09PVxuICBzZXRTdGF0dXMoY29kZTogJ09LJyB8ICdFUlJPUicgfCAnVU5TRVQnLCBtZXNzYWdlPzogc3RyaW5nKTogdGhpcyB7XG4gICAgLy8gV2UgbWFwIE9URUwgc3RhdHVzIHRvIG91ciBpbnRlcm5hbCBhdHRyaWJ1dGVzL3N0YXR1c1xuICAgIC8vIE5vdGU6IEFjdHVhbCBlbmQoKSBjYWxsIHdpbGwgZmluYWxpemUgdGhlIHN0YXR1cywgYnV0IHRoaXMgYWxsb3dzIGludGVybWVkaWF0ZSB1cGRhdGVzXG4gICAgdGhpcy5hdHRyaWJ1dGVzWyAnb3RlbC5zdGF0dXNfY29kZScgXSA9IGNvZGU7XG4gICAgaWYgKG1lc3NhZ2UpIHtcbiAgICAgIHRoaXMuYXR0cmlidXRlc1sgJ290ZWwuc3RhdHVzX2Rlc2NyaXB0aW9uJyBdID0gbWVzc2FnZTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICByZWNvcmRFeGNlcHRpb24oZXhjZXB0aW9uOiBFcnJvciB8IHN0cmluZyk6IHRoaXMge1xuICAgIGNvbnN0IGVycm9yID0gbm9ybWFsaXplRXJyb3IoZXhjZXB0aW9uKTtcbiAgICB0aGlzLmFkZEV2ZW50KCdleGNlcHRpb24nLCB7XG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgJ2V4Y2VwdGlvbi50eXBlJzogZXJyb3IubmFtZSxcbiAgICAgICAgJ2V4Y2VwdGlvbi5tZXNzYWdlJzogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgJ2V4Y2VwdGlvbi5zdGFja3RyYWNlJzogZXJyb3Iuc3RhY2ssXG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gQWxzbyB0cmFjayB0aGUgbGFzdCBlcnJvciBvbiB0aGUgc3BhbiBpdHNlbGYgZm9yIGVhc3kgYWNjZXNzXG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUoJ2Vycm9yJywgdHJ1ZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyA9PT0gRXZlbnRzID09PVxuICBhZGRFdmVudChuYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiBTcGFuRXZlbnRPcHRpb25zKTogdGhpcyB7XG4gICAgLy8gTWVyZ2UgdGFncyBmcm9tIG9wdGlvbnMgd2l0aCBzcGFuIHRhZ3MgKG9wdGlvbnMgdGFrZSBwcmVjZWRlbmNlKVxuICAgIGNvbnN0IG1lcmdlZFRhZ3MgPSB7IC4uLnRoaXMudGFncywgLi4uKG9wdGlvbnM/LnRhZ3MgfHwge30pIH07XG5cbiAgICBjYXB0dXJlRXZlbnQoXG4gICAgICB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgICAgY2F1c2VkQnk6IHRoaXMuY2F1c2VkQnksXG4gICAgICAgIHJlbGF0ZWRUcmFjZXM6IHRoaXMucmVsYXRlZFRyYWNlcyxcbiAgICAgICAgYWN0b3I6IHRoaXMuYWN0b3IsXG4gICAgICAgIHNvdXJjZTogdGhpcy5zb3VyY2UsXG4gICAgICAgIHRhZ3M6IG1lcmdlZFRhZ3NcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdzcGFuLmV2ZW50JyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBnZW5lcmF0ZUlkKCksICAvLyBFdmVudHMgZ2V0IHRoZWlyIG93biB1bmlxdWUgSURcbiAgICAgICAgbGV2ZWw6IG9wdGlvbnM/LmxldmVsIHx8IHRoaXMubGV2ZWwsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5zcGFuSWQsICAvLyBQYXJlbnQgaXMgdGhpcyBzcGFuXG4gICAgICAgIC8vIE5PVEU6IGVudGl0eU5hbWUvZW50aXR5SWQgTk9UIHNldCAtIHNwYW4gZXZlbnRzIGFyZSBvYnNlcnZhYmlsaXR5IHByaW1pdGl2ZXNcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIG9wZXJhdGlvbjogbmFtZSxcbiAgICAgICAgYXR0cmlidXRlczogb3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgICAgbWV0cmljczogb3B0aW9ucz8ubWV0cmljcyxcbiAgICAgICAgZGF0YTogb3B0aW9ucz8uZGF0YSxcbiAgICAgIH1cbiAgICApO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gPT09IEVuZCBzcGFuID09PVxuICBlbmQob3B0aW9ucz86IFNwYW5FbmRPcHRpb25zKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZW5kZWQpIHJldHVybjtcbiAgICB0aGlzLmVuZGVkID0gdHJ1ZTtcblxuICAgIGNvbnN0IGVuZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IGR1cmF0aW9uID0gZW5kVGltZSAtIHRoaXMuc3RhcnRUaW1lO1xuXG4gICAgY2FwdHVyZUV2ZW50KFxuICAgICAge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGNhdXNlZEJ5OiB0aGlzLmNhdXNlZEJ5LFxuICAgICAgICByZWxhdGVkVHJhY2VzOiB0aGlzLnJlbGF0ZWRUcmFjZXMsXG4gICAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgICAgICBzb3VyY2U6IHRoaXMuc291cmNlLFxuICAgICAgICB0YWdzOiB0aGlzLnRhZ3NcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdzcGFuLmVuZCcsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZ2VuZXJhdGVJZCgpLCAgLy8gc3Bhbi5lbmQgZ2V0cyBpdHMgb3duIHVuaXF1ZSBJRFxuICAgICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0aGlzLnNwYW5JZCwgIC8vIFBhcmVudCBpcyBUSElTIHNwYW4gKHNwYW4uc3RhcnQgcmVjb3JkKSwgY29uc2lzdGVudCB3aXRoIHNwYW4uZXZlbnRcbiAgICAgICAgLy8gTk9URTogZW50aXR5TmFtZS9lbnRpdHlJZCBOT1Qgc2V0IC0gc3BhbnMgYXJlIG9ic2VydmFiaWxpdHkgcHJpbWl0aXZlc1xuICAgICAgICB0aW1lc3RhbXBNczogZW5kVGltZSxcbiAgICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICAgIHN1Y2Nlc3M6IG9wdGlvbnM/LnN1Y2Nlc3MgPz8gIW9wdGlvbnM/LmVycm9yLFxuICAgICAgICBzdGF0dXM6IG9wdGlvbnM/LnN0YXR1cyA/PyAob3B0aW9ucz8uZXJyb3IgPyAnZmFpbGVkJyA6ICdjb21wbGV0ZWQnKSxcbiAgICAgICAgLy8gTWVyZ2Ugc3BhbiBhdHRyaWJ1dGVzIHdpdGggZW5kIGF0dHJpYnV0ZXNcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgIC4uLnRoaXMuYXR0cmlidXRlcyxcbiAgICAgICAgICAuLi4ob3B0aW9ucz8uYXR0cmlidXRlcyB8fCB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgZXJyb3I6IG9wdGlvbnM/LmVycm9yID8gbWFwRXJyb3Iob3B0aW9ucy5lcnJvcikgOiB1bmRlZmluZWQsXG4gICAgICAgIC8vIE1lcmdlIGR1cmF0aW9uIHdpdGggY3VzdG9tIG1ldHJpY3NcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIGR1cmF0aW9uLFxuICAgICAgICAgIC4uLihvcHRpb25zPy5tZXRyaWNzIHx8IHt9KVxuICAgICAgICB9LFxuICAgICAgICAvLyBTdXBwb3J0IGRhdGEgaW4gc3Bhbi5lbmRcbiAgICAgICAgZGF0YTogb3B0aW9ucz8uZGF0YSxcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgLy8gPT09IENoaWxkIHNwYW5zID09PVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGZ1bmN0aW9uIHdpdGhpbiBhIGNoaWxkIHNwYW5cbiAgICovXG4gIGFzeW5jIHdpdGhDaGlsZDxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLndpdGhTcGFuKG9wZXJhdGlvbiwgZm4sIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuc3BhbklkLFxuICAgICAgc291cmNlOiBvcHRpb25zPy5zb3VyY2UgPz8gdGhpcy5zb3VyY2UsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgLi4ub3B0aW9ucz8udGFncyB9LFxuICAgICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yID8/IHRoaXMuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgY2hpbGQgc3BhblxuICAgKi9cbiAgY3JlYXRlQ2hpbGQoXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnPlxuICApOiBJU3Bhbk9ic2VydmVyIHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLnN0YXJ0KG9wZXJhdGlvbiwge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5zcGFuSWQsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSA/PyB0aGlzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCAuLi5vcHRpb25zPy50YWdzIH0sXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IgPz8gdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxufVxuXG4vLyBSZS1leHBvcnQgd2l0aFNwYW4gZm9yIGNvbnZlbmllbmNlXG5leHBvcnQgY29uc3Qgd2l0aFNwYW4gPSBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4uYmluZChTcGFuT2JzZXJ2ZXIpO1xuIl19