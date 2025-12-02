"use strict";
/**
 * SpanObserver - For distributed tracing
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - No auto-generation of correlationId (must be propagated)
 * - Hierarchical spans via parentSpanId
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
    parentSpanId;
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
        this.parentSpanId = options.parentSpanId ?? context?.parentLogId;
        this.level = options.level ?? 'info';
        this.attributes = options.attributes ?? {};
        this.source = options.source ?? fields.source;
        this.tags = (0, base_1.mergeObserverTags)(fields.tags, options.tags);
        this.actor = options.actor ?? fields.actor;
        this.startTime = Date.now();
        // Emit span.start event using capturer pattern
        (0, base_1.captureEvent)(fields, {
            type: 'span.start',
            level: this.level,
            parentLogId: this.parentSpanId,
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
     * @param options - Span options (correlationId required if no context)
     * @returns SpanObserver instance, or NoOp span if correlationId not available
     */
    static start(operation, options) {
        // Build common fields using base utilities
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options?.correlationId,
            actor: options?.actor,
            source: options?.source,
            tags: options?.tags,
        });
        if (!fields) {
            // Return a no-op span that won't crash but won't record anything
            return new NoOpSpanObserver(operation);
        }
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
            level: this.level,
            parentLogId: this.spanId,
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
            level: options?.error ? 'error' : this.level,
            parentLogId: this.parentSpanId,
            entityName: 'span',
            entityId: this.spanId,
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
            parentSpanId: this.spanId,
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
            parentSpanId: this.spanId,
            source: options?.source ?? this.source,
            tags: { ...this.tags, ...options?.tags },
            actor: options?.actor ?? this.actor,
        });
    }
}
exports.SpanObserver = SpanObserver;
/**
 * No-op span for when correlationId is not available
 * Implements ISpanObserver interface properly (no type casts)
 */
class NoOpSpanObserver {
    operation;
    constructor(operation) {
        this.operation = operation;
        logger.warn(`NoOp span created for operation: ${operation}`);
    }
    get id() {
        return 'noop';
    }
    get traceId() {
        return 'noop';
    }
    setAttribute(_key, _value) {
        return this;
    }
    setAttributes(_attrs) {
        return this;
    }
    addEvent(_name, _eventAttributes) {
        return this;
    }
    end(_options) {
        // No-op
    }
    async withChild(_operation, fn, _options) {
        return fn(this);
    }
    createChild(operation, _options) {
        return new NoOpSpanObserver(operation);
    }
}
// Re-export withSpan for convenience
exports.withSpan = SpanObserver.withSpan.bind(SpanObserver);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7O0FBR0gsd0NBQStDO0FBRS9DLGlDQVNnQjtBQUNoQiwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQzVDLE1BQU0sYUFBYSxHQUFHLGNBQWMsQ0FBQztBQXdDckMsTUFBYSxZQUFZO0lBQ04sTUFBTSxDQUFTO0lBQ2YsYUFBYSxDQUFTO0lBQ3RCLFlBQVksQ0FBVTtJQUN0QixLQUFLLENBQTJCO0lBQ2hDLFNBQVMsQ0FBUztJQUNsQixNQUFNLENBQVU7SUFDaEIsSUFBSSxDQUEwQjtJQUM5QixLQUFLLENBQVM7SUFDdkIsVUFBVSxDQUEwQjtJQUMzQixTQUFTLENBQVM7SUFDM0IsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUV0QixZQUFvQixTQUFpQixFQUFFLE1BQW9CLEVBQUUsVUFBdUIsRUFBRTtRQUNwRixNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7UUFFcEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDM0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLGlCQUFVLEdBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsYUFBYSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUM7UUFDMUMsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsWUFBWSxJQUFJLE9BQU8sRUFBRSxXQUFXLENBQUM7UUFDakUsSUFBSSxDQUFDLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQztRQUNyQyxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDO1FBQzlDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN6RCxJQUFJLENBQUMsS0FBSyxHQUFHLE9BQU8sQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQztRQUMzQyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUU1QiwrQ0FBK0M7UUFDL0MsSUFBQSxtQkFBWSxFQUFDLE1BQU0sRUFBRTtZQUNuQixJQUFJLEVBQUUsWUFBWTtZQUNsQixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsV0FBVyxFQUFFLElBQUksQ0FBQyxZQUFZO1lBQzlCLFVBQVUsRUFBRSxNQUFNO1lBQ2xCLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNyQixXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDM0IsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUMzQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1NBQ2xCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFNBQWlCLEVBQUUsT0FBcUI7UUFDbkQsMkNBQTJDO1FBQzNDLE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVBQUMsYUFBYSxFQUFFO1lBQzlDLGFBQWEsRUFBRSxPQUFPLEVBQUUsYUFBYTtZQUNyQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUs7WUFDckIsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNO1lBQ3ZCLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSTtTQUNwQixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixpRUFBaUU7WUFDakUsT0FBTyxJQUFJLGdCQUFnQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3pDLENBQUM7UUFFRCxPQUFPLElBQUksWUFBWSxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQ25CLFNBQWlCLEVBQ2pCLEVBQXVDLEVBQ3ZDLE9BQXFCO1FBRXJCLE1BQU0sSUFBSSxHQUFHLFlBQVksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3BELElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzlCLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUM1QixPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFBLHFCQUFjLEVBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQzNELE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFRCxrQkFBa0I7SUFDbEIsSUFBSSxFQUFFO1FBQ0osT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQ3JCLENBQUM7SUFFRCxJQUFJLE9BQU87UUFDVCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUM7SUFDNUIsQ0FBQztJQUVELCtCQUErQjtJQUMvQixZQUFZLENBQUMsR0FBVyxFQUFFLEtBQWM7UUFDdEMsSUFBSSxDQUFDLFVBQVUsQ0FBRSxHQUFHLENBQUUsR0FBRyxLQUFLLENBQUM7UUFDL0IsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsYUFBYSxDQUFDLEtBQThCO1FBQzFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxpQkFBaUI7SUFDakIsUUFBUSxDQUFDLElBQVksRUFBRSxlQUF5QztRQUM5RCxJQUFBLG1CQUFZLEVBQ1Y7WUFDRSxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1lBQ2pDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7U0FDaEIsRUFDRDtZQUNFLElBQUksRUFBRSxZQUFZO1lBQ2xCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixXQUFXLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDeEIsVUFBVSxFQUFFLE1BQU07WUFDbEIsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ3JCLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3ZCLFNBQVMsRUFBRSxJQUFJO1lBQ2YsVUFBVSxFQUFFLGVBQWU7U0FDNUIsQ0FDRixDQUFDO1FBQ0YsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsbUJBQW1CO0lBQ25CLEdBQUcsQ0FBQyxPQUErRDtRQUNqRSxJQUFJLElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTztRQUN2QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQztRQUVsQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDM0IsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFFMUMsSUFBQSxtQkFBWSxFQUNWLEVBQUUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFDOUY7WUFDRSxJQUFJLEVBQUUsVUFBVTtZQUNoQixLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSztZQUM1QyxXQUFXLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDOUIsVUFBVSxFQUFFLE1BQU07WUFDbEIsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ3JCLFdBQVcsRUFBRSxPQUFPO1lBQ3BCLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixPQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSSxDQUFDLE9BQU8sRUFBRSxLQUFLO1lBQzVDLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7WUFDcEUsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQzNCLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFBLGVBQVEsRUFBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDM0QsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFO1NBQ3RCLENBQ0YsQ0FBQztJQUNKLENBQUM7SUFFRCxzQkFBc0I7SUFFdEI7O09BRUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUNiLFNBQWlCLEVBQ2pCLEVBQXVDLEVBQ3ZDLE9BQTZEO1FBRTdELE9BQU8sWUFBWSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFO1lBQzFDLEdBQUcsT0FBTztZQUNWLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxZQUFZLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDekIsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU07WUFDdEMsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBRTtZQUN4QyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxXQUFXLENBQ1QsU0FBaUIsRUFDakIsT0FBNkQ7UUFFN0QsT0FBTyxZQUFZLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtZQUNuQyxHQUFHLE9BQU87WUFDVixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsWUFBWSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ3pCLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNO1lBQ3RDLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxHQUFHLE9BQU8sRUFBRSxJQUFJLEVBQUU7WUFDeEMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksSUFBSSxDQUFDLEtBQUs7U0FDcEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBak1ELG9DQWlNQztBQUVEOzs7R0FHRztBQUNILE1BQU0sZ0JBQWdCO0lBQ0gsU0FBUyxDQUFTO0lBRW5DLFlBQVksU0FBaUI7UUFDM0IsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDM0IsTUFBTSxDQUFDLElBQUksQ0FBQyxvQ0FBb0MsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRUQsSUFBSSxFQUFFO1FBQ0osT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVELElBQUksT0FBTztRQUNULE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxZQUFZLENBQUMsSUFBWSxFQUFFLE1BQWU7UUFDeEMsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsYUFBYSxDQUFDLE1BQStCO1FBQzNDLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELFFBQVEsQ0FBQyxLQUFhLEVBQUUsZ0JBQTBDO1FBQ2hFLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELEdBQUcsQ0FBQyxRQUFnRTtRQUNsRSxRQUFRO0lBQ1YsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTLENBQ2IsVUFBa0IsRUFDbEIsRUFBdUMsRUFDdkMsUUFBOEQ7UUFFOUQsT0FBTyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbEIsQ0FBQztJQUVELFdBQVcsQ0FDVCxTQUFpQixFQUNqQixRQUE4RDtRQUU5RCxPQUFPLElBQUksZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNGO0FBRUQscUNBQXFDO0FBQ3hCLFFBQUEsUUFBUSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTcGFuT2JzZXJ2ZXIgLSBGb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHQgb3IgZXhwbGljaXQgb3B0aW9uXG4gKiAtIE5vIGF1dG8tZ2VuZXJhdGlvbiBvZiBjb3JyZWxhdGlvbklkIChtdXN0IGJlIHByb3BhZ2F0ZWQpXG4gKiAtIEhpZXJhcmNoaWNhbCBzcGFucyB2aWEgcGFyZW50U3BhbklkXG4gKiAtIEZpcmUtYW5kLWZvcmdldCBjYXB0dXJlIHZpYSBjYXB0dXJlciBwYXR0ZXJuICh0ZXN0YWJsZSlcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBGSVJTVDogRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBjb3JyZWxhdGlvbklkXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBUaGVuIGNyZWF0ZSBzcGFuc1xuICogICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogICAgIHRyeSB7XG4gKiAgICAgICAvLyAuLi4gd29ya1xuICogICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICogICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gKiAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9KTtcbiAqICAgICB9XG4gKiAgIH1cbiAqICk7XG4gKiBcbiAqIC8vIE9yIHVzZSB3aXRoU3BhbiBoZWxwZXJcbiAqIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAqICAgc3Bhbi5hZGRFdmVudCgndmFsaWRhdGlvbl9jb21wbGV0ZScpO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIHJlc29sdmVDb3JyZWxhdGlvbklkLFxuICBnZW5lcmF0ZUlkLFxuICBjYXB0dXJlRXZlbnQsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG4gIG1lcmdlT2JzZXJ2ZXJUYWdzLFxuICBDb21tb25GaWVsZHMsXG59IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdTcGFuT2JzZXJ2ZXInKTtcbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnU3Bhbk9ic2VydmVyJztcblxuZXhwb3J0IGludGVyZmFjZSBTcGFuT3B0aW9ucyB7XG4gIC8qKiBDb3JyZWxhdGlvbiBJRCAtIGlmIG5vdCBwcm92aWRlZCwgbXVzdCBjb21lIGZyb20gY29udGV4dCAqL1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAvKiogUGFyZW50IHNwYW4gSUQgZm9yIG5lc3RlZCBzcGFucyAqL1xuICBwYXJlbnRTcGFuSWQ/OiBzdHJpbmc7XG4gIC8qKiBTZXZlcml0eSBsZXZlbCBmb3IgdGhlIHNwYW4gKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIGF0dHJpYnV0ZXMgKi9cbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogU291cmNlIGlkZW50aWZpZXIgKi9cbiAgc291cmNlPzogc3RyaW5nO1xuICAvKiogVGFncyBmb3IgZmlsdGVyaW5nICovXG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogQWN0b3IgcGVyZm9ybWluZyB0aGUgb3BlcmF0aW9uICovXG4gIGFjdG9yPzogQWN0b3I7XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIGZvciBzcGFuIG9wZXJhdGlvbnMgKGFsbG93cyBOb09wIGltcGxlbWVudGF0aW9uKVxuICovXG5leHBvcnQgaW50ZXJmYWNlIElTcGFuT2JzZXJ2ZXIge1xuICByZWFkb25seSBpZDogc3RyaW5nO1xuICByZWFkb25seSB0cmFjZUlkOiBzdHJpbmc7XG4gIHNldEF0dHJpYnV0ZShrZXk6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiB0aGlzO1xuICBzZXRBdHRyaWJ1dGVzKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXM7XG4gIGFkZEV2ZW50KG5hbWU6IHN0cmluZywgZXZlbnRBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzO1xuICBlbmQob3B0aW9ucz86IHsgc3VjY2Vzcz86IGJvb2xlYW47IGVycm9yPzogRXJyb3I7IHN0YXR1cz86IHN0cmluZyB9KTogdm9pZDtcbiAgd2l0aENoaWxkPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogSVNwYW5PYnNlcnZlcikgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zPzogT21pdDxTcGFuT3B0aW9ucywgJ2NvcnJlbGF0aW9uSWQnIHwgJ3BhcmVudFNwYW5JZCc+XG4gICk6IFByb21pc2U8VD47XG4gIGNyZWF0ZUNoaWxkKFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiBPbWl0PFNwYW5PcHRpb25zLCAnY29ycmVsYXRpb25JZCcgfCAncGFyZW50U3BhbklkJz5cbiAgKTogSVNwYW5PYnNlcnZlcjtcbn1cblxuZXhwb3J0IGNsYXNzIFNwYW5PYnNlcnZlciBpbXBsZW1lbnRzIElTcGFuT2JzZXJ2ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHNwYW5JZDogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvcnJlbGF0aW9uSWQ6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBwYXJlbnRTcGFuSWQ/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgbGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFydFRpbWU6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBzb3VyY2U/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHByaXZhdGUgcmVhZG9ubHkgYWN0b3I/OiBBY3RvcjtcbiAgcHJpdmF0ZSBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgcHJpdmF0ZSByZWFkb25seSBvcGVyYXRpb246IHN0cmluZztcbiAgcHJpdmF0ZSBlbmRlZCA9IGZhbHNlO1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3Iob3BlcmF0aW9uOiBzdHJpbmcsIGZpZWxkczogQ29tbW9uRmllbGRzLCBvcHRpb25zOiBTcGFuT3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgICB0aGlzLm9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICB0aGlzLnNwYW5JZCA9IGdlbmVyYXRlSWQoKTtcbiAgICB0aGlzLmNvcnJlbGF0aW9uSWQgPSBmaWVsZHMuY29ycmVsYXRpb25JZDtcbiAgICB0aGlzLnBhcmVudFNwYW5JZCA9IG9wdGlvbnMucGFyZW50U3BhbklkID8/IGNvbnRleHQ/LnBhcmVudExvZ0lkO1xuICAgIHRoaXMubGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgICB0aGlzLmF0dHJpYnV0ZXMgPSBvcHRpb25zLmF0dHJpYnV0ZXMgPz8ge307XG4gICAgdGhpcy5zb3VyY2UgPSBvcHRpb25zLnNvdXJjZSA/PyBmaWVsZHMuc291cmNlO1xuICAgIHRoaXMudGFncyA9IG1lcmdlT2JzZXJ2ZXJUYWdzKGZpZWxkcy50YWdzLCBvcHRpb25zLnRhZ3MpO1xuICAgIHRoaXMuYWN0b3IgPSBvcHRpb25zLmFjdG9yID8/IGZpZWxkcy5hY3RvcjtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAvLyBFbWl0IHNwYW4uc3RhcnQgZXZlbnQgdXNpbmcgY2FwdHVyZXIgcGF0dGVyblxuICAgIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdzcGFuLnN0YXJ0JyxcbiAgICAgIGxldmVsOiB0aGlzLmxldmVsLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMucGFyZW50U3BhbklkLFxuICAgICAgZW50aXR5TmFtZTogJ3NwYW4nLFxuICAgICAgZW50aXR5SWQ6IHRoaXMuc3BhbklkLFxuICAgICAgdGltZXN0YW1wTXM6IHRoaXMuc3RhcnRUaW1lLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLm9wZXJhdGlvbixcbiAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuYXR0cmlidXRlcyxcbiAgICAgIHNvdXJjZTogdGhpcy5zb3VyY2UsXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgICBhY3RvcjogdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydCBhIG5ldyBzcGFuXG4gICAqIFxuICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gTmFtZSBvZiB0aGUgb3BlcmF0aW9uIGJlaW5nIHRyYWNlZFxuICAgKiBAcGFyYW0gb3B0aW9ucyAtIFNwYW4gb3B0aW9ucyAoY29ycmVsYXRpb25JZCByZXF1aXJlZCBpZiBubyBjb250ZXh0KVxuICAgKiBAcmV0dXJucyBTcGFuT2JzZXJ2ZXIgaW5zdGFuY2UsIG9yIE5vT3Agc3BhbiBpZiBjb3JyZWxhdGlvbklkIG5vdCBhdmFpbGFibGVcbiAgICovXG4gIHN0YXRpYyBzdGFydChvcGVyYXRpb246IHN0cmluZywgb3B0aW9ucz86IFNwYW5PcHRpb25zKTogSVNwYW5PYnNlcnZlciB7XG4gICAgLy8gQnVpbGQgY29tbW9uIGZpZWxkcyB1c2luZyBiYXNlIHV0aWxpdGllc1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSxcbiAgICAgIHRhZ3M6IG9wdGlvbnM/LnRhZ3MsXG4gICAgfSk7XG5cbiAgICBpZiAoIWZpZWxkcykge1xuICAgICAgLy8gUmV0dXJuIGEgbm8tb3Agc3BhbiB0aGF0IHdvbid0IGNyYXNoIGJ1dCB3b24ndCByZWNvcmQgYW55dGhpbmdcbiAgICAgIHJldHVybiBuZXcgTm9PcFNwYW5PYnNlcnZlcihvcGVyYXRpb24pO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgU3Bhbk9ic2VydmVyKG9wZXJhdGlvbiwgZmllbGRzLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGZ1bmN0aW9uIHdpdGhpbiBhIHNwYW5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoU3BhbjxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IFNwYW5PcHRpb25zXG4gICk6IFByb21pc2U8VD4ge1xuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQob3BlcmF0aW9uLCBvcHRpb25zKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZm4oc3Bhbik7XG4gICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IEdldHRlcnMgPT09XG4gIGdldCBpZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnNwYW5JZDtcbiAgfVxuXG4gIGdldCB0cmFjZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuY29ycmVsYXRpb25JZDtcbiAgfVxuXG4gIC8vID09PSBBdHRyaWJ1dGUgbWFuYWdlbWVudCA9PT1cbiAgc2V0QXR0cmlidXRlKGtleTogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IHRoaXMge1xuICAgIHRoaXMuYXR0cmlidXRlc1sga2V5IF0gPSB2YWx1ZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHNldEF0dHJpYnV0ZXMoYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcyB7XG4gICAgT2JqZWN0LmFzc2lnbih0aGlzLmF0dHJpYnV0ZXMsIGF0dHJzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vID09PSBFdmVudHMgPT09XG4gIGFkZEV2ZW50KG5hbWU6IHN0cmluZywgZXZlbnRBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICBjYXB0dXJlRXZlbnQoXG4gICAgICB7XG4gICAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIHNvdXJjZTogdGhpcy5zb3VyY2UsXG4gICAgICAgIHRhZ3M6IHRoaXMudGFnc1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ3NwYW4uZXZlbnQnLFxuICAgICAgICBsZXZlbDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHRoaXMuc3BhbklkLFxuICAgICAgICBlbnRpdHlOYW1lOiAnc3BhbicsXG4gICAgICAgIGVudGl0eUlkOiB0aGlzLnNwYW5JZCxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIG9wZXJhdGlvbjogbmFtZSxcbiAgICAgICAgYXR0cmlidXRlczogZXZlbnRBdHRyaWJ1dGVzLFxuICAgICAgfVxuICAgICk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyA9PT0gRW5kIHNwYW4gPT09XG4gIGVuZChvcHRpb25zPzogeyBzdWNjZXNzPzogYm9vbGVhbjsgZXJyb3I/OiBFcnJvcjsgc3RhdHVzPzogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICBpZiAodGhpcy5lbmRlZCkgcmV0dXJuO1xuICAgIHRoaXMuZW5kZWQgPSB0cnVlO1xuXG4gICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3QgZHVyYXRpb24gPSBlbmRUaW1lIC0gdGhpcy5zdGFydFRpbWU7XG5cbiAgICBjYXB0dXJlRXZlbnQoXG4gICAgICB7IGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCwgYWN0b3I6IHRoaXMuYWN0b3IsIHNvdXJjZTogdGhpcy5zb3VyY2UsIHRhZ3M6IHRoaXMudGFncyB9LFxuICAgICAge1xuICAgICAgICB0eXBlOiAnc3Bhbi5lbmQnLFxuICAgICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHRoaXMucGFyZW50U3BhbklkLFxuICAgICAgICBlbnRpdHlOYW1lOiAnc3BhbicsXG4gICAgICAgIGVudGl0eUlkOiB0aGlzLnNwYW5JZCxcbiAgICAgICAgdGltZXN0YW1wTXM6IGVuZFRpbWUsXG4gICAgICAgIGR1cmF0aW9uTXM6IGR1cmF0aW9uLFxuICAgICAgICBvcGVyYXRpb246IHRoaXMub3BlcmF0aW9uLFxuICAgICAgICBzdWNjZXNzOiBvcHRpb25zPy5zdWNjZXNzID8/ICFvcHRpb25zPy5lcnJvcixcbiAgICAgICAgc3RhdHVzOiBvcHRpb25zPy5zdGF0dXMgPz8gKG9wdGlvbnM/LmVycm9yID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJyksXG4gICAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuYXR0cmlidXRlcyxcbiAgICAgICAgZXJyb3I6IG9wdGlvbnM/LmVycm9yID8gbWFwRXJyb3Iob3B0aW9ucy5lcnJvcikgOiB1bmRlZmluZWQsXG4gICAgICAgIG1ldHJpY3M6IHsgZHVyYXRpb24gfSxcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgLy8gPT09IENoaWxkIHNwYW5zID09PVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGZ1bmN0aW9uIHdpdGhpbiBhIGNoaWxkIHNwYW5cbiAgICovXG4gIGFzeW5jIHdpdGhDaGlsZDxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRTcGFuSWQnPlxuICApOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLndpdGhTcGFuKG9wZXJhdGlvbiwgZm4sIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBwYXJlbnRTcGFuSWQ6IHRoaXMuc3BhbklkLFxuICAgICAgc291cmNlOiBvcHRpb25zPy5zb3VyY2UgPz8gdGhpcy5zb3VyY2UsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgLi4ub3B0aW9ucz8udGFncyB9LFxuICAgICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yID8/IHRoaXMuYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgY2hpbGQgc3BhblxuICAgKi9cbiAgY3JlYXRlQ2hpbGQoXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IE9taXQ8U3Bhbk9wdGlvbnMsICdjb3JyZWxhdGlvbklkJyB8ICdwYXJlbnRTcGFuSWQnPlxuICApOiBJU3Bhbk9ic2VydmVyIHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLnN0YXJ0KG9wZXJhdGlvbiwge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudFNwYW5JZDogdGhpcy5zcGFuSWQsXG4gICAgICBzb3VyY2U6IG9wdGlvbnM/LnNvdXJjZSA/PyB0aGlzLnNvdXJjZSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCAuLi5vcHRpb25zPy50YWdzIH0sXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IgPz8gdGhpcy5hY3RvcixcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIE5vLW9wIHNwYW4gZm9yIHdoZW4gY29ycmVsYXRpb25JZCBpcyBub3QgYXZhaWxhYmxlXG4gKiBJbXBsZW1lbnRzIElTcGFuT2JzZXJ2ZXIgaW50ZXJmYWNlIHByb3Blcmx5IChubyB0eXBlIGNhc3RzKVxuICovXG5jbGFzcyBOb09wU3Bhbk9ic2VydmVyIGltcGxlbWVudHMgSVNwYW5PYnNlcnZlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3BlcmF0aW9uOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Iob3BlcmF0aW9uOiBzdHJpbmcpIHtcbiAgICB0aGlzLm9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICBsb2dnZXIud2FybihgTm9PcCBzcGFuIGNyZWF0ZWQgZm9yIG9wZXJhdGlvbjogJHtvcGVyYXRpb259YCk7XG4gIH1cblxuICBnZXQgaWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gJ25vb3AnO1xuICB9XG5cbiAgZ2V0IHRyYWNlSWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gJ25vb3AnO1xuICB9XG5cbiAgc2V0QXR0cmlidXRlKF9rZXk6IHN0cmluZywgX3ZhbHVlOiB1bmtub3duKTogdGhpcyB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBzZXRBdHRyaWJ1dGVzKF9hdHRyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGFkZEV2ZW50KF9uYW1lOiBzdHJpbmcsIF9ldmVudEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXMge1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZW5kKF9vcHRpb25zPzogeyBzdWNjZXNzPzogYm9vbGVhbjsgZXJyb3I/OiBFcnJvcjsgc3RhdHVzPzogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICAvLyBOby1vcFxuICB9XG5cbiAgYXN5bmMgd2l0aENoaWxkPFQ+KFxuICAgIF9vcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IElTcGFuT2JzZXJ2ZXIpID0+IFByb21pc2U8VD4sXG4gICAgX29wdGlvbnM/OiBPbWl0PFNwYW5PcHRpb25zLCAnY29ycmVsYXRpb25JZCcgfCAncGFyZW50U3BhbklkJz5cbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgcmV0dXJuIGZuKHRoaXMpO1xuICB9XG5cbiAgY3JlYXRlQ2hpbGQoXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgX29wdGlvbnM/OiBPbWl0PFNwYW5PcHRpb25zLCAnY29ycmVsYXRpb25JZCcgfCAncGFyZW50U3BhbklkJz5cbiAgKTogSVNwYW5PYnNlcnZlciB7XG4gICAgcmV0dXJuIG5ldyBOb09wU3Bhbk9ic2VydmVyKG9wZXJhdGlvbik7XG4gIH1cbn1cblxuLy8gUmUtZXhwb3J0IHdpdGhTcGFuIGZvciBjb252ZW5pZW5jZVxuZXhwb3J0IGNvbnN0IHdpdGhTcGFuID0gU3Bhbk9ic2VydmVyLndpdGhTcGFuLmJpbmQoU3Bhbk9ic2VydmVyKTtcbiJdfQ==