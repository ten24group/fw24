"use strict";
/**
 * MetricObserver - Business and technical metrics
 *
 * Supports counters, gauges, timings, histograms.
 * EMF-compatible for CloudWatch.
 *
 * CONSOLIDATION: When an active span exists, metrics are added to the span
 * instead of creating separate records. This reduces DynamoDB entries while
 * still publishing metrics to CloudWatch (which extracts from any event).
 *
 * Usage:
 * ```typescript
 * // Context is auto-established in controllers
 *
 * // Simple counter
 * MetricObserver.increment('orders.created');
 *
 * // Gauge value
 * MetricObserver.gauge('queue.depth', 42);
 *
 * // Timing
 * MetricObserver.timing('api.latency', 145);
 *
 * // Custom with tags
 * MetricObserver.record('payment.amount', 99.99, {
 *   tags: { currency: 'USD', method: 'card' },
 *   unit: 'dollars',
 * });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricObserver = void 0;
const base_1 = require("./base");
const logging_1 = require("../../logging");
const span_1 = require("./span");
const OBSERVER_NAME = 'MetricObserver';
const logger = (0, logging_1.createLogger)(OBSERVER_NAME);
// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Validate a metric value
 */
function isValidMetricValue(name, value) {
    if (typeof value !== 'number') {
        logger.warn(`Invalid metric value for '${name}': not a number`);
        return false;
    }
    if (Number.isNaN(value)) {
        logger.warn(`Invalid metric value for '${name}': NaN`);
        return false;
    }
    if (!Number.isFinite(value)) {
        logger.warn(`Invalid metric value for '${name}': Infinity`);
        return false;
    }
    return true;
}
// ═══════════════════════════════════════════════════════════════════════════
// MetricObserver
// ═══════════════════════════════════════════════════════════════════════════
class MetricObserver {
    /**
     * Increment counter
     */
    static increment(name, value = 1, options) {
        return this.record(name, value, { ...options, type: 'counter' });
    }
    /**
     * Decrement counter
     */
    static decrement(name, value = 1, options) {
        return this.record(name, -value, { ...options, type: 'counter' });
    }
    /**
     * Set gauge value
     */
    static gauge(name, value, options) {
        return this.record(name, value, { ...options, type: 'gauge' });
    }
    /**
     * Record timing (milliseconds)
     */
    static timing(name, durationMs, options) {
        return this.record(name, durationMs, {
            ...options,
            type: 'timing',
            unit: options?.unit ?? 'milliseconds',
        });
    }
    /**
     * Record histogram value
     */
    static histogram(name, value, options) {
        return this.record(name, value, { ...options, type: 'histogram' });
    }
    /**
     * Record custom metric.
     *
     * When an active span exists, the metric is consolidated into the span
     * (added as a span event) instead of creating a separate record.
     * Use `standalone: true` to force a separate record.
     */
    static record(name, value, options) {
        // Validate metric value
        if (!isValidMetricValue(name, value)) {
            return undefined;
        }
        const { type, unit, level, entityName, entityId, attributes, standalone, tags, ...overrides } = options ?? {};
        // Consolidate into current span if one exists (unless standalone is requested)
        const currentSpan = standalone ? undefined : span_1.SpanObserver.getCurrentSpan();
        if (currentSpan) {
            // Use clean API - metric goes to metrics, context to tags
            currentSpan.metric(name, value);
            if (unit)
                currentSpan.tag(`${name}.unit`, unit);
            if (type)
                currentSpan.tag(`${name}.type`, type);
            if (entityName)
                currentSpan.tag('entityName', entityName);
            if (entityId)
                currentSpan.tag('entityId', entityId);
            currentSpan.checkpoint(`metric.${name}`);
            return currentSpan.id;
        }
        // No active span - create standalone metric record
        return (0, base_1.captureRecord)(OBSERVER_NAME, {
            type: 'metric',
            subType: type ?? 'custom',
            level: level ?? 'info',
            operation: name,
            metrics: { [name]: value },
            attributes: {
                unit,
                metricType: type,
                ...attributes,
            },
            entityName,
            entityId,
            tags,
            ...overrides,
        });
    }
    /**
     * Record multiple metrics at once.
     * Invalid values (NaN, Infinity) are filtered out with warnings.
     *
     * When an active span exists, metrics are consolidated into the span.
     * Use `standalone: true` to force a separate record.
     */
    static recordBatch(metrics, options) {
        // Filter out invalid values
        const validMetrics = {};
        for (const [name, value] of Object.entries(metrics)) {
            if (isValidMetricValue(name, value)) {
                validMetrics[name] = value;
            }
        }
        // Don't capture if no valid metrics
        if (Object.keys(validMetrics).length === 0) {
            logger.warn('recordBatch: no valid metrics to record');
            return undefined;
        }
        const { type, unit, level, entityName, entityId, attributes, standalone, tags, ...overrides } = options ?? {};
        // Consolidate into current span if one exists
        const currentSpan = standalone ? undefined : span_1.SpanObserver.getCurrentSpan();
        if (currentSpan) {
            // Use clean API
            currentSpan.metrics(validMetrics);
            currentSpan.metric('metricCount', Object.keys(validMetrics).length);
            if (entityName)
                currentSpan.tag('entityName', entityName);
            if (entityId)
                currentSpan.tag('entityId', entityId);
            currentSpan.checkpoint('metrics.batch');
            return currentSpan.id;
        }
        // No active span - create standalone metric record
        return (0, base_1.captureRecord)(OBSERVER_NAME, {
            type: 'metric',
            subType: 'batch',
            level: level ?? 'info',
            operation: 'metrics.batch',
            metrics: validMetrics,
            attributes: {
                ...attributes,
                metricCount: Object.keys(validMetrics).length,
            },
            entityName,
            entityId,
            tags,
            ...overrides,
        });
    }
    /**
     * Time a function execution and record the duration.
     * Handles both sync and async functions automatically.
     */
    static time(name, fn, options) {
        const start = Date.now();
        const recordTiming = (success) => {
            this.timing(name, Date.now() - start, {
                ...options,
                level: success ? options?.level : 'warn',
                tags: { ...options?.tags, success: String(success) },
            });
        };
        try {
            const result = fn();
            if (result instanceof Promise) {
                return result
                    .then((value) => { recordTiming(true); return value; })
                    .catch((error) => { recordTiming(false); throw error; });
            }
            recordTiming(true);
            return result;
        }
        catch (error) {
            recordTiming(false);
            throw error;
        }
    }
}
exports.MetricObserver = MetricObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL21ldHJpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHOzs7QUFHSCxpQ0FBdUM7QUFDdkMsMkNBQTZDO0FBQzdDLGlDQUFzQztBQUV0QyxNQUFNLGFBQWEsR0FBRyxnQkFBZ0IsQ0FBQztBQUN2QyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsYUFBYSxDQUFDLENBQUM7QUEyQjNDLDhFQUE4RTtBQUM5RSxtQkFBbUI7QUFDbkIsOEVBQThFO0FBRTlFOztHQUVHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxJQUFZLEVBQUUsS0FBYTtJQUNyRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzlCLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLElBQUksaUJBQWlCLENBQUMsQ0FBQztRQUNoRSxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN4QixNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixJQUFJLFFBQVEsQ0FBQyxDQUFDO1FBQ3ZELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUNELElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDNUIsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxhQUFhLENBQUMsQ0FBQztRQUM1RCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsaUJBQWlCO0FBQ2pCLDhFQUE4RTtBQUU5RSxNQUFhLGNBQWM7SUFFekI7O09BRUc7SUFDSCxNQUFNLENBQUMs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c2luZXNzIGFuZCB0ZWNobmljYWwgbWV0cmljc1xuICogXG4gKiBTdXBwb3J0cyBjb3VudGVycywgZ2F1Z2VzLCB0aW1pbmdzLCBoaXN0b2dyYW1zLlxuICogRU1GLWNvbXBhdGlibGUgZm9yIENsb3VkV2F0Y2guXG4gKiBcbiAqIENPTlNPTElEQVRJT046IFdoZW4gYW4gYWN0aXZlIHNwYW4gZXhpc3RzLCBtZXRyaWNzIGFyZSBhZGRlZCB0byB0aGUgc3BhblxuICogaW5zdGVhZCBvZiBjcmVhdGluZyBzZXBhcmF0ZSByZWNvcmRzLiBUaGlzIHJlZHVjZXMgRHluYW1vREIgZW50cmllcyB3aGlsZVxuICogc3RpbGwgcHVibGlzaGluZyBtZXRyaWNzIHRvIENsb3VkV2F0Y2ggKHdoaWNoIGV4dHJhY3RzIGZyb20gYW55IGV2ZW50KS5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBDb250ZXh0IGlzIGF1dG8tZXN0YWJsaXNoZWQgaW4gY29udHJvbGxlcnNcbiAqIFxuICogLy8gU2ltcGxlIGNvdW50ZXJcbiAqIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnb3JkZXJzLmNyZWF0ZWQnKTtcbiAqIFxuICogLy8gR2F1Z2UgdmFsdWVcbiAqIE1ldHJpY09ic2VydmVyLmdhdWdlKCdxdWV1ZS5kZXB0aCcsIDQyKTtcbiAqIFxuICogLy8gVGltaW5nXG4gKiBNZXRyaWNPYnNlcnZlci50aW1pbmcoJ2FwaS5sYXRlbmN5JywgMTQ1KTtcbiAqIFxuICogLy8gQ3VzdG9tIHdpdGggdGFnc1xuICogTWV0cmljT2JzZXJ2ZXIucmVjb3JkKCdwYXltZW50LmFtb3VudCcsIDk5Ljk5LCB7XG4gKiAgIHRhZ3M6IHsgY3VycmVuY3k6ICdVU0QnLCBtZXRob2Q6ICdjYXJkJyB9LFxuICogICB1bml0OiAnZG9sbGFycycsXG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBSZWNvcmRPdmVycmlkZXMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBjYXB0dXJlUmVjb3JkIH0gZnJvbSAnLi9iYXNlJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyIH0gZnJvbSAnLi9zcGFuJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdNZXRyaWNPYnNlcnZlcic7XG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoT0JTRVJWRVJfTkFNRSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gVHlwZXNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIG1ldHJpYyBvcGVyYXRpb25zLlxuICogRXh0ZW5kcyBSZWNvcmRPdmVycmlkZXMgZm9yIGFsbCBjb250ZXh0IG92ZXJyaWRlIGNhcGFiaWxpdGllcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBNZXRyaWNPcHRpb25zIGV4dGVuZHMgUmVjb3JkT3ZlcnJpZGVzIHtcbiAgLyoqIE1ldHJpYyB0eXBlICovXG4gIHR5cGU/OiAnY291bnRlcicgfCAnZ2F1Z2UnIHwgJ3RpbWluZycgfCAnaGlzdG9ncmFtJyB8ICdjdXN0b20nO1xuICAvKiogVW5pdCAoZS5nLiwgJ21pbGxpc2Vjb25kcycsICdieXRlcycsICdjb3VudCcpICovXG4gIHVuaXQ/OiBzdHJpbmc7XG4gIC8qKiBTZXZlcml0eSBsZXZlbCAobWV0cmljcyB0eXBpY2FsbHkgdHJhY2UtaW5mbywgcmFyZWx5IHdhcm4vZXJyb3IpICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICAvKiogRW50aXR5IG5hbWUgZm9yIGNvbnRleHQgKi9cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgLyoqIEVudGl0eSBJRCBmb3IgY29udGV4dCAqL1xuICBlbnRpdHlJZD86IHN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgYXR0cmlidXRlcyAqL1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBGb3JjZSBzdGFuZGFsb25lIHJlY29yZCBldmVuIHdoZW4gc3BhbiBpcyBhY3RpdmUgKi9cbiAgc3RhbmRhbG9uZT86IGJvb2xlYW47XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSW50ZXJuYWwgSGVscGVyc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogVmFsaWRhdGUgYSBtZXRyaWMgdmFsdWVcbiAqL1xuZnVuY3Rpb24gaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWU6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnbnVtYmVyJykge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBub3QgYSBudW1iZXJgKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKE51bWJlci5pc05hTih2YWx1ZSkpIHtcbiAgICBsb2dnZXIud2FybihgSW52YWxpZCBtZXRyaWMgdmFsdWUgZm9yICcke25hbWV9JzogTmFOYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBJbmZpbml0eWApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBNZXRyaWNPYnNlcnZlclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBNZXRyaWNPYnNlcnZlciB7XG5cbiAgLyoqXG4gICAqIEluY3JlbWVudCBjb3VudGVyXG4gICAqL1xuICBzdGF0aWMgaW5jcmVtZW50KFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyID0gMSxcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCB2YWx1ZSwgeyAuLi5vcHRpb25zLCB0eXBlOiAnY291bnRlcicgfSk7XG4gIH1cblxuICAvKipcbiAgICogRGVjcmVtZW50IGNvdW50ZXJcbiAgICovXG4gIHN0YXRpYyBkZWNyZW1lbnQoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIgPSAxLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIC12YWx1ZSwgeyAuLi5vcHRpb25zLCB0eXBlOiAnY291bnRlcicgfSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGdhdWdlIHZhbHVlXG4gICAqL1xuICBzdGF0aWMgZ2F1Z2UoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2dhdWdlJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgdGltaW5nIChtaWxsaXNlY29uZHMpXG4gICAqL1xuICBzdGF0aWMgdGltaW5nKFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkdXJhdGlvbk1zOiBudW1iZXIsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgZHVyYXRpb25Ncywge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIHR5cGU6ICd0aW1pbmcnLFxuICAgICAgdW5pdDogb3B0aW9ucz8udW5pdCA/PyAnbWlsbGlzZWNvbmRzJyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgaGlzdG9ncmFtIHZhbHVlXG4gICAqL1xuICBzdGF0aWMgaGlzdG9ncmFtKFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIHZhbHVlLCB7IC4uLm9wdGlvbnMsIHR5cGU6ICdoaXN0b2dyYW0nIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBjdXN0b20gbWV0cmljLlxuICAgKiBcbiAgICogV2hlbiBhbiBhY3RpdmUgc3BhbiBleGlzdHMsIHRoZSBtZXRyaWMgaXMgY29uc29saWRhdGVkIGludG8gdGhlIHNwYW5cbiAgICogKGFkZGVkIGFzIGEgc3BhbiBldmVudCkgaW5zdGVhZCBvZiBjcmVhdGluZyBhIHNlcGFyYXRlIHJlY29yZC5cbiAgICogVXNlIGBzdGFuZGFsb25lOiB0cnVlYCB0byBmb3JjZSBhIHNlcGFyYXRlIHJlY29yZC5cbiAgICovXG4gIHN0YXRpYyByZWNvcmQoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBWYWxpZGF0ZSBtZXRyaWMgdmFsdWVcbiAgICBpZiAoIWlzVmFsaWRNZXRyaWNWYWx1ZShuYW1lLCB2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3Qge1xuICAgICAgdHlwZSxcbiAgICAgIHVuaXQsXG4gICAgICBsZXZlbCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICBzdGFuZGFsb25lLFxuICAgICAgdGFncyxcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH0gPSBvcHRpb25zID8/IHt9O1xuXG4gICAgLy8gQ29uc29saWRhdGUgaW50byBjdXJyZW50IHNwYW4gaWYgb25lIGV4aXN0cyAodW5sZXNzIHN0YW5kYWxvbmUgaXMgcmVxdWVzdGVkKVxuICAgIGNvbnN0IGN1cnJlbnRTcGFuID0gc3RhbmRhbG9uZSA/IHVuZGVmaW5lZCA6IFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpO1xuICAgIGlmIChjdXJyZW50U3Bhbikge1xuICAgICAgLy8gVXNlIGNsZWFuIEFQSSAtIG1ldHJpYyBnb2VzIHRvIG1ldHJpY3MsIGNvbnRleHQgdG8gdGFnc1xuICAgICAgY3VycmVudFNwYW4ubWV0cmljKG5hbWUsIHZhbHVlKTtcbiAgICAgIGlmICh1bml0KSBjdXJyZW50U3Bhbi50YWcoYCR7bmFtZX0udW5pdGAsIHVuaXQpO1xuICAgICAgaWYgKHR5cGUpIGN1cnJlbnRTcGFuLnRhZyhgJHtuYW1lfS50eXBlYCwgdHlwZSk7XG4gICAgICBpZiAoZW50aXR5TmFtZSkgY3VycmVudFNwYW4udGFnKCdlbnRpdHlOYW1lJywgZW50aXR5TmFtZSk7XG4gICAgICBpZiAoZW50aXR5SWQpIGN1cnJlbnRTcGFuLnRhZygnZW50aXR5SWQnLCBlbnRpdHlJZCk7XG4gICAgICBjdXJyZW50U3Bhbi5jaGVja3BvaW50KGBtZXRyaWMuJHtuYW1lfWApO1xuICAgICAgcmV0dXJuIGN1cnJlbnRTcGFuLmlkO1xuICAgIH1cblxuICAgIC8vIE5vIGFjdGl2ZSBzcGFuIC0gY3JlYXRlIHN0YW5kYWxvbmUgbWV0cmljIHJlY29yZFxuICAgIHJldHVybiBjYXB0dXJlUmVjb3JkKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgc3ViVHlwZTogdHlwZSA/PyAnY3VzdG9tJyxcbiAgICAgIGxldmVsOiBsZXZlbCA/PyAnaW5mbycsXG4gICAgICBvcGVyYXRpb246IG5hbWUsXG4gICAgICBtZXRyaWNzOiB7IFsgbmFtZSBdOiB2YWx1ZSB9LFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICB1bml0LFxuICAgICAgICBtZXRyaWNUeXBlOiB0eXBlLFxuICAgICAgICAuLi5hdHRyaWJ1dGVzLFxuICAgICAgfSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIHRhZ3MsXG4gICAgICAuLi5vdmVycmlkZXMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIG11bHRpcGxlIG1ldHJpY3MgYXQgb25jZS5cbiAgICogSW52YWxpZCB2YWx1ZXMgKE5hTiwgSW5maW5pdHkpIGFyZSBmaWx0ZXJlZCBvdXQgd2l0aCB3YXJuaW5ncy5cbiAgICogXG4gICAqIFdoZW4gYW4gYWN0aXZlIHNwYW4gZXhpc3RzLCBtZXRyaWNzIGFyZSBjb25zb2xpZGF0ZWQgaW50byB0aGUgc3Bhbi5cbiAgICogVXNlIGBzdGFuZGFsb25lOiB0cnVlYCB0byBmb3JjZSBhIHNlcGFyYXRlIHJlY29yZC5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRCYXRjaChcbiAgICBtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gRmlsdGVyIG91dCBpbnZhbGlkIHZhbHVlc1xuICAgIGNvbnN0IHZhbGlkTWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1ldHJpY3MpKSB7XG4gICAgICBpZiAoaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWUsIHZhbHVlKSkge1xuICAgICAgICB2YWxpZE1ldHJpY3NbIG5hbWUgXSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERvbid0IGNhcHR1cmUgaWYgbm8gdmFsaWQgbWV0cmljc1xuICAgIGlmIChPYmplY3Qua2V5cyh2YWxpZE1ldHJpY3MpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ3JlY29yZEJhdGNoOiBubyB2YWxpZCBtZXRyaWNzIHRvIHJlY29yZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICB0eXBlLFxuICAgICAgdW5pdCxcbiAgICAgIGxldmVsLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgYXR0cmlidXRlcyxcbiAgICAgIHN0YW5kYWxvbmUsXG4gICAgICB0YWdzLFxuICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgfSA9IG9wdGlvbnMgPz8ge307XG5cbiAgICAvLyBDb25zb2xpZGF0ZSBpbnRvIGN1cnJlbnQgc3BhbiBpZiBvbmUgZXhpc3RzXG4gICAgY29uc3QgY3VycmVudFNwYW4gPSBzdGFuZGFsb25lID8gdW5kZWZpbmVkIDogU3Bhbk9ic2VydmVyLmdldEN1cnJlbnRTcGFuKCk7XG4gICAgaWYgKGN1cnJlbnRTcGFuKSB7XG4gICAgICAvLyBVc2UgY2xlYW4gQVBJXG4gICAgICBjdXJyZW50U3Bhbi5tZXRyaWNzKHZhbGlkTWV0cmljcyk7XG4gICAgICBjdXJyZW50U3Bhbi5tZXRyaWMoJ21ldHJpY0NvdW50JywgT2JqZWN0LmtleXModmFsaWRNZXRyaWNzKS5sZW5ndGgpO1xuICAgICAgaWYgKGVudGl0eU5hbWUpIGN1cnJlbnRTcGFuLnRhZygnZW50aXR5TmFtZScsIGVudGl0eU5hbWUpO1xuICAgICAgaWYgKGVudGl0eUlkKSBjdXJyZW50U3Bhbi50YWcoJ2VudGl0eUlkJywgZW50aXR5SWQpO1xuICAgICAgY3VycmVudFNwYW4uY2hlY2twb2ludCgnbWV0cmljcy5iYXRjaCcpO1xuICAgICAgcmV0dXJuIGN1cnJlbnRTcGFuLmlkO1xuICAgIH1cblxuICAgIC8vIE5vIGFjdGl2ZSBzcGFuIC0gY3JlYXRlIHN0YW5kYWxvbmUgbWV0cmljIHJlY29yZFxuICAgIHJldHVybiBjYXB0dXJlUmVjb3JkKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgc3ViVHlwZTogJ2JhdGNoJyxcbiAgICAgIGxldmVsOiBsZXZlbCA/PyAnaW5mbycsXG4gICAgICBvcGVyYXRpb246ICdtZXRyaWNzLmJhdGNoJyxcbiAgICAgIG1ldHJpY3M6IHZhbGlkTWV0cmljcyxcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgLi4uYXR0cmlidXRlcyxcbiAgICAgICAgbWV0cmljQ291bnQ6IE9iamVjdC5rZXlzKHZhbGlkTWV0cmljcykubGVuZ3RoLFxuICAgICAgfSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIHRhZ3MsXG4gICAgICAuLi5vdmVycmlkZXMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGltZSBhIGZ1bmN0aW9uIGV4ZWN1dGlvbiBhbmQgcmVjb3JkIHRoZSBkdXJhdGlvbi5cbiAgICogSGFuZGxlcyBib3RoIHN5bmMgYW5kIGFzeW5jIGZ1bmN0aW9ucyBhdXRvbWF0aWNhbGx5LlxuICAgKi9cbiAgc3RhdGljIHRpbWU8VD4obmFtZTogc3RyaW5nLCBmbjogKCkgPT4gVCwgb3B0aW9ucz86IE1ldHJpY09wdGlvbnMpOiBUIHtcbiAgICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gICAgY29uc3QgcmVjb3JkVGltaW5nID0gKHN1Y2Nlc3M6IGJvb2xlYW4pID0+IHtcbiAgICAgIHRoaXMudGltaW5nKG5hbWUsIERhdGUubm93KCkgLSBzdGFydCwge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICBsZXZlbDogc3VjY2VzcyA/IG9wdGlvbnM/LmxldmVsIDogJ3dhcm4nLFxuICAgICAgICB0YWdzOiB7IC4uLm9wdGlvbnM/LnRhZ3MsIHN1Y2Nlc3M6IFN0cmluZyhzdWNjZXNzKSB9LFxuICAgICAgfSk7XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBmbigpO1xuXG4gICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7IHJlY29yZFRpbWluZyh0cnVlKTsgcmV0dXJuIHZhbHVlOyB9KVxuICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHsgcmVjb3JkVGltaW5nKGZhbHNlKTsgdGhyb3cgZXJyb3I7IH0pIGFzIFQ7XG4gICAgICB9XG5cbiAgICAgIHJlY29yZFRpbWluZyh0cnVlKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlY29yZFRpbWluZyhmYWxzZSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cbiJdfQ==