"use strict";
/**
 * MetricObserver - For business and technical metrics
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context
 * - Supports counters, gauges, timings, histograms
 * - EMF-compatible for CloudWatch
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Simple counter
 *     MetricObserver.increment('orders.created');
 *
 *     // Gauge value
 *     MetricObserver.gauge('queue.depth', 42);
 *
 *     // Timing
 *     MetricObserver.timing('api.latency', 145);
 *
 *     // Custom with tags
 *     MetricObserver.record('payment.amount', 99.99, {
 *       tags: { currency: 'USD', method: 'card' },
 *       unit: 'dollars',
 *     });
 *   }
 * );
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricObserver = void 0;
const base_1 = require("./base");
const logging_1 = require("../../logging");
const OBSERVER_NAME = 'MetricObserver';
const logger = (0, logging_1.createLogger)(OBSERVER_NAME);
/**
 * Validate a metric value
 * Returns true if valid, logs warning and returns false if invalid
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
     * Record custom metric
     */
    static record(name, value, options) {
        // Validate metric value
        if (!isValidMetricValue(name, value)) {
            return undefined;
        }
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'metric',
            subType: options?.type ?? 'custom',
            level: options?.level ?? 'info',
            operation: name,
            metrics: { [name]: value },
            attributes: {
                unit: options?.unit,
                metricType: options?.type,
                ...options?.attributes,
            },
            entityName: options?.entityName,
            entityId: options?.entityId,
        });
    }
    /**
     * Record multiple metrics at once
     * Invalid values (NaN, Infinity) are filtered out with warnings.
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
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'metric',
            subType: 'batch',
            level: options?.level ?? 'info',
            operation: 'metrics.batch',
            metrics: validMetrics,
            attributes: {
                ...options?.attributes,
                metricCount: Object.keys(validMetrics).length,
            },
        });
    }
    /**
     * Time a function execution and record the duration
     */
    static async time(name, fn, options) {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.timing(name, duration, { ...options, tags: { ...options?.tags, success: 'true' } });
            return result;
        }
        catch (error) {
            const duration = Date.now() - start;
            this.timing(name, duration, { ...options, level: 'warn', tags: { ...options?.tags, success: 'false' } });
            throw error;
        }
    }
    /**
     * Time a sync function execution and record the duration
     */
    static timeSync(name, fn, options) {
        const start = Date.now();
        try {
            const result = fn();
            const duration = Date.now() - start;
            this.timing(name, duration, { ...options, tags: { ...options?.tags, success: 'true' } });
            return result;
        }
        catch (error) {
            const duration = Date.now() - start;
            this.timing(name, duration, { ...options, level: 'warn', tags: { ...options?.tags, success: 'false' } });
            throw error;
        }
    }
}
exports.MetricObserver = MetricObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL21ldHJpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQkc7OztBQUdILGlDQUE4RTtBQUM5RSwyQ0FBNkM7QUFFN0MsTUFBTSxhQUFhLEdBQUcsZ0JBQWdCLENBQUM7QUFDdkMsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGFBQWEsQ0FBQyxDQUFDO0FBRTNDOzs7R0FHRztBQUNILFNBQVMsa0JBQWtCLENBQUMsSUFBWSxFQUFFLEtBQWE7SUFDckQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM5QixNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixJQUFJLGlCQUFpQixDQUFDLENBQUM7UUFDaEUsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxRQUFRLENBQUMsQ0FBQztRQUN2RCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzVCLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLElBQUksYUFBYSxDQUFDLENBQUM7UUFDNUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDO0FBaUJELE1BQWEsY0FBYztJQUV6Qjs7T0FFRztJQUNILE1BQU0sQ0FBQyxTQUFTLENBQ2QsSUFBWSxFQUNaLFFBQWdCLENBQUMsRUFDakIsT0FBdUI7UUFFdkIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFL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LEVBQUUsR0FBRyxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDekcsTUFBTSxLQUFLLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBNUtELHdDQTRLQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTWV0cmljT2JzZXJ2ZXIgLSBGb3IgYnVzaW5lc3MgYW5kIHRlY2huaWNhbCBtZXRyaWNzXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBSZXF1aXJlcyBjb3JyZWxhdGlvbklkIGZyb20gY29udGV4dFxuICogLSBTdXBwb3J0cyBjb3VudGVycywgZ2F1Z2VzLCB0aW1pbmdzLCBoaXN0b2dyYW1zXG4gKiAtIEVNRi1jb21wYXRpYmxlIGZvciBDbG91ZFdhdGNoXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRklSU1Q6IEVzdGFibGlzaCBjb250ZXh0XG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBTaW1wbGUgY291bnRlclxuICogICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnb3JkZXJzLmNyZWF0ZWQnKTtcbiAqICAgICBcbiAqICAgICAvLyBHYXVnZSB2YWx1ZVxuICogICAgIE1ldHJpY09ic2VydmVyLmdhdWdlKCdxdWV1ZS5kZXB0aCcsIDQyKTtcbiAqICAgICBcbiAqICAgICAvLyBUaW1pbmdcbiAqICAgICBNZXRyaWNPYnNlcnZlci50aW1pbmcoJ2FwaS5sYXRlbmN5JywgMTQ1KTtcbiAqICAgICBcbiAqICAgICAvLyBDdXN0b20gd2l0aCB0YWdzXG4gKiAgICAgTWV0cmljT2JzZXJ2ZXIucmVjb3JkKCdwYXltZW50LmFtb3VudCcsIDk5Ljk5LCB7XG4gKiAgICAgICB0YWdzOiB7IGN1cnJlbmN5OiAnVVNEJywgbWV0aG9kOiAnY2FyZCcgfSxcbiAqICAgICAgIHVuaXQ6ICdkb2xsYXJzJyxcbiAqICAgICB9KTtcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGJ1aWxkQ29tbW9uRmllbGRzLCBjYXB0dXJlRXZlbnQsIEJhc2VPYnNlcnZlck9wdGlvbnMgfSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnTWV0cmljT2JzZXJ2ZXInO1xuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKE9CU0VSVkVSX05BTUUpO1xuXG4vKipcbiAqIFZhbGlkYXRlIGEgbWV0cmljIHZhbHVlXG4gKiBSZXR1cm5zIHRydWUgaWYgdmFsaWQsIGxvZ3Mgd2FybmluZyBhbmQgcmV0dXJucyBmYWxzZSBpZiBpbnZhbGlkXG4gKi9cbmZ1bmN0aW9uIGlzVmFsaWRNZXRyaWNWYWx1ZShuYW1lOiBzdHJpbmcsIHZhbHVlOiBudW1iZXIpOiBib29sZWFuIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ251bWJlcicpIHtcbiAgICBsb2dnZXIud2FybihgSW52YWxpZCBtZXRyaWMgdmFsdWUgZm9yICcke25hbWV9Jzogbm90IGEgbnVtYmVyYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChOdW1iZXIuaXNOYU4odmFsdWUpKSB7XG4gICAgbG9nZ2VyLndhcm4oYEludmFsaWQgbWV0cmljIHZhbHVlIGZvciAnJHtuYW1lfSc6IE5hTmApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICBsb2dnZXIud2FybihgSW52YWxpZCBtZXRyaWMgdmFsdWUgZm9yICcke25hbWV9JzogSW5maW5pdHlgKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWV0cmljT3B0aW9ucyBleHRlbmRzIEJhc2VPYnNlcnZlck9wdGlvbnMge1xuICAvKiogTWV0cmljIHR5cGUgKi9cbiAgdHlwZT86ICdjb3VudGVyJyB8ICdnYXVnZScgfCAndGltaW5nJyB8ICdoaXN0b2dyYW0nIHwgJ2N1c3RvbSc7XG4gIC8qKiBVbml0IChlLmcuLCAnbWlsbGlzZWNvbmRzJywgJ2J5dGVzJywgJ2NvdW50JykgKi9cbiAgdW5pdD86IHN0cmluZztcbiAgLyoqIFNldmVyaXR5IGxldmVsIChtZXRyaWNzIHR5cGljYWxseSB0cmFjZS1pbmZvLCByYXJlbHkgd2Fybi9lcnJvcikgKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIGF0dHJpYnV0ZXMgKi9cbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogRW50aXR5IG5hbWUgZm9yIGNvbnRleHQgKi9cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgLyoqIEVudGl0eSBJRCBmb3IgY29udGV4dCAqL1xuICBlbnRpdHlJZD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIE1ldHJpY09ic2VydmVyIHtcblxuICAvKipcbiAgICogSW5jcmVtZW50IGNvdW50ZXJcbiAgICovXG4gIHN0YXRpYyBpbmNyZW1lbnQoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIgPSAxLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIHZhbHVlLCB7IC4uLm9wdGlvbnMsIHR5cGU6ICdjb3VudGVyJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNyZW1lbnQgY291bnRlclxuICAgKi9cbiAgc3RhdGljIGRlY3JlbWVudChcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlciA9IDEsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgLXZhbHVlLCB7IC4uLm9wdGlvbnMsIHR5cGU6ICdjb3VudGVyJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgZ2F1Z2UgdmFsdWVcbiAgICovXG4gIHN0YXRpYyBnYXVnZShcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCB2YWx1ZSwgeyAuLi5vcHRpb25zLCB0eXBlOiAnZ2F1Z2UnIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCB0aW1pbmcgKG1pbGxpc2Vjb25kcylcbiAgICovXG4gIHN0YXRpYyB0aW1pbmcoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGR1cmF0aW9uTXM6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCBkdXJhdGlvbk1zLCB7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgdHlwZTogJ3RpbWluZycsXG4gICAgICB1bml0OiBvcHRpb25zPy51bml0ID8/ICdtaWxsaXNlY29uZHMnLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBoaXN0b2dyYW0gdmFsdWVcbiAgICovXG4gIHN0YXRpYyBoaXN0b2dyYW0oXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2hpc3RvZ3JhbScgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGN1c3RvbSBtZXRyaWNcbiAgICovXG4gIHN0YXRpYyByZWNvcmQoXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBWYWxpZGF0ZSBtZXRyaWMgdmFsdWVcbiAgICBpZiAoIWlzVmFsaWRNZXRyaWNWYWx1ZShuYW1lLCB2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICBzdWJUeXBlOiBvcHRpb25zPy50eXBlID8/ICdjdXN0b20nLFxuICAgICAgbGV2ZWw6IG9wdGlvbnM/LmxldmVsID8/ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogbmFtZSxcbiAgICAgIG1ldHJpY3M6IHsgWyBuYW1lIF06IHZhbHVlIH0sXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIHVuaXQ6IG9wdGlvbnM/LnVuaXQsXG4gICAgICAgIG1ldHJpY1R5cGU6IG9wdGlvbnM/LnR5cGUsXG4gICAgICAgIC4uLm9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICB9LFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucz8uZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zPy5lbnRpdHlJZCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgbXVsdGlwbGUgbWV0cmljcyBhdCBvbmNlXG4gICAqIEludmFsaWQgdmFsdWVzIChOYU4sIEluZmluaXR5KSBhcmUgZmlsdGVyZWQgb3V0IHdpdGggd2FybmluZ3MuXG4gICAqL1xuICBzdGF0aWMgcmVjb3JkQmF0Y2goXG4gICAgbWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIC8vIEZpbHRlciBvdXQgaW52YWxpZCB2YWx1ZXNcbiAgICBjb25zdCB2YWxpZE1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFsgbmFtZSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhtZXRyaWNzKSkge1xuICAgICAgaWYgKGlzVmFsaWRNZXRyaWNWYWx1ZShuYW1lLCB2YWx1ZSkpIHtcbiAgICAgICAgdmFsaWRNZXRyaWNzWyBuYW1lIF0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBEb24ndCBjYXB0dXJlIGlmIG5vIHZhbGlkIG1ldHJpY3NcbiAgICBpZiAoT2JqZWN0LmtleXModmFsaWRNZXRyaWNzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdyZWNvcmRCYXRjaDogbm8gdmFsaWQgbWV0cmljcyB0byByZWNvcmQnKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICBzdWJUeXBlOiAnYmF0Y2gnLFxuICAgICAgbGV2ZWw6IG9wdGlvbnM/LmxldmVsID8/ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ21ldHJpY3MuYmF0Y2gnLFxuICAgICAgbWV0cmljczogdmFsaWRNZXRyaWNzLFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAuLi5vcHRpb25zPy5hdHRyaWJ1dGVzLFxuICAgICAgICBtZXRyaWNDb3VudDogT2JqZWN0LmtleXModmFsaWRNZXRyaWNzKS5sZW5ndGgsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRpbWUgYSBmdW5jdGlvbiBleGVjdXRpb24gYW5kIHJlY29yZCB0aGUgZHVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0aW1lPFQ+KFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBmbjogKCkgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBQcm9taXNlPFQ+IHtcbiAgICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZuKCk7XG4gICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICAgIHRoaXMudGltaW5nKG5hbWUsIGR1cmF0aW9uLCB7IC4uLm9wdGlvbnMsIHRhZ3M6IHsgLi4ub3B0aW9ucz8udGFncywgc3VjY2VzczogJ3RydWUnIH0gfSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICAgIHRoaXMudGltaW5nKG5hbWUsIGR1cmF0aW9uLCB7IC4uLm9wdGlvbnMsIGxldmVsOiAnd2FybicsIHRhZ3M6IHsgLi4ub3B0aW9ucz8udGFncywgc3VjY2VzczogJ2ZhbHNlJyB9IH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRpbWUgYSBzeW5jIGZ1bmN0aW9uIGV4ZWN1dGlvbiBhbmQgcmVjb3JkIHRoZSBkdXJhdGlvblxuICAgKi9cbiAgc3RhdGljIHRpbWVTeW5jPFQ+KFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBmbjogKCkgPT4gVCxcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBUIHtcbiAgICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGZuKCk7XG4gICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICAgIHRoaXMudGltaW5nKG5hbWUsIGR1cmF0aW9uLCB7IC4uLm9wdGlvbnMsIHRhZ3M6IHsgLi4ub3B0aW9ucz8udGFncywgc3VjY2VzczogJ3RydWUnIH0gfSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICAgIHRoaXMudGltaW5nKG5hbWUsIGR1cmF0aW9uLCB7IC4uLm9wdGlvbnMsIGxldmVsOiAnd2FybicsIHRhZ3M6IHsgLi4ub3B0aW9ucz8udGFncywgc3VjY2VzczogJ2ZhbHNlJyB9IH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG4iXX0=