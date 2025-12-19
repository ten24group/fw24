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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL21ldHJpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQkc7OztBQUdILGlDQUFvRztBQUNwRywyQ0FBNkM7QUFFN0MsTUFBTSxhQUFhLEdBQUcsZ0JBQWdCLENBQUM7QUFDdkMsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGFBQWEsQ0FBQyxDQUFDO0FBRTNDOzs7R0FHRztBQUNILFNBQVMsa0JBQWtCLENBQUMsSUFBWSxFQUFFLEtBQWE7SUFDckQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM5QixNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixJQUFJLGlCQUFpQixDQUFDLENBQUM7UUFDaEUsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxRQUFRLENBQUMsQ0FBQztRQUN2RCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzVCLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLElBQUksYUFBYSxDQUFDLENBQUM7UUFDNUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDO0FBZUQsTUFBYSxjQUFjO0lBRXpCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFNBQVMsQ0FDZCxJQUFZLEVBQ1osUUFBZ0IsQ0FBQyxFQUNqQixPQUF1QjtRQUV2QixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUss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QUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7Q0FDRjtBQTFLRCx3Q0EwS0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE1ldHJpY09ic2VydmVyIC0gRm9yIGJ1c2luZXNzIGFuZCB0ZWNobmljYWwgbWV0cmljc1xuICogXG4gKiBERVNJR04gUFJJTkNJUExFUzpcbiAqIC0gUmVxdWlyZXMgY29ycmVsYXRpb25JZCBmcm9tIGNvbnRleHRcbiAqIC0gU3VwcG9ydHMgY291bnRlcnMsIGdhdWdlcywgdGltaW5ncywgaGlzdG9ncmFtc1xuICogLSBFTUYtY29tcGF0aWJsZSBmb3IgQ2xvdWRXYXRjaFxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dFxuICogYXdhaXQgcnVuV2l0aENvbnRleHQoXG4gKiAgIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChyZXF1ZXN0SWQpLFxuICogICBhc3luYyAoKSA9PiB7XG4gKiAgICAgLy8gU2ltcGxlIGNvdW50ZXJcbiAqICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ29yZGVycy5jcmVhdGVkJyk7XG4gKiAgICAgXG4gKiAgICAgLy8gR2F1Z2UgdmFsdWVcbiAqICAgICBNZXRyaWNPYnNlcnZlci5nYXVnZSgncXVldWUuZGVwdGgnLCA0Mik7XG4gKiAgICAgXG4gKiAgICAgLy8gVGltaW5nXG4gKiAgICAgTWV0cmljT2JzZXJ2ZXIudGltaW5nKCdhcGkubGF0ZW5jeScsIDE0NSk7XG4gKiAgICAgXG4gKiAgICAgLy8gQ3VzdG9tIHdpdGggdGFnc1xuICogICAgIE1ldHJpY09ic2VydmVyLnJlY29yZCgncGF5bWVudC5hbW91bnQnLCA5OS45OSwge1xuICogICAgICAgdGFnczogeyBjdXJyZW5jeTogJ1VTRCcsIG1ldGhvZDogJ2NhcmQnIH0sXG4gKiAgICAgICB1bml0OiAnZG9sbGFycycsXG4gKiAgICAgfSk7XG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBidWlsZENvbW1vbkZpZWxkcywgY2FwdHVyZUV2ZW50LCBCYXNlT2JzZXJ2ZXJPcHRpb25zLCBPYnNlcnZhYmlsaXR5UGF5bG9hZCB9IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdNZXRyaWNPYnNlcnZlcic7XG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoT0JTRVJWRVJfTkFNRSk7XG5cbi8qKlxuICogVmFsaWRhdGUgYSBtZXRyaWMgdmFsdWVcbiAqIFJldHVybnMgdHJ1ZSBpZiB2YWxpZCwgbG9ncyB3YXJuaW5nIGFuZCByZXR1cm5zIGZhbHNlIGlmIGludmFsaWRcbiAqL1xuZnVuY3Rpb24gaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWU6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnbnVtYmVyJykge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBub3QgYSBudW1iZXJgKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKE51bWJlci5pc05hTih2YWx1ZSkpIHtcbiAgICBsb2dnZXIud2FybihgSW52YWxpZCBtZXRyaWMgdmFsdWUgZm9yICcke25hbWV9JzogTmFOYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBJbmZpbml0eWApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXRyaWNPcHRpb25zIGV4dGVuZHMgQmFzZU9ic2VydmVyT3B0aW9ucywgT2JzZXJ2YWJpbGl0eVBheWxvYWQge1xuICAvKiogTWV0cmljIHR5cGUgKi9cbiAgdHlwZT86ICdjb3VudGVyJyB8ICdnYXVnZScgfCAndGltaW5nJyB8ICdoaXN0b2dyYW0nIHwgJ2N1c3RvbSc7XG4gIC8qKiBVbml0IChlLmcuLCAnbWlsbGlzZWNvbmRzJywgJ2J5dGVzJywgJ2NvdW50JykgKi9cbiAgdW5pdD86IHN0cmluZztcbiAgLyoqIFNldmVyaXR5IGxldmVsIChtZXRyaWNzIHR5cGljYWxseSB0cmFjZS1pbmZvLCByYXJlbHkgd2Fybi9lcnJvcikgKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIC8qKiBFbnRpdHkgbmFtZSBmb3IgY29udGV4dCAqL1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAvKiogRW50aXR5IElEIGZvciBjb250ZXh0ICovXG4gIGVudGl0eUlkPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTWV0cmljT2JzZXJ2ZXIge1xuXG4gIC8qKlxuICAgKiBJbmNyZW1lbnQgY291bnRlclxuICAgKi9cbiAgc3RhdGljIGluY3JlbWVudChcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlciA9IDEsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2NvdW50ZXInIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERlY3JlbWVudCBjb3VudGVyXG4gICAqL1xuICBzdGF0aWMgZGVjcmVtZW50KFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyID0gMSxcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCAtdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2NvdW50ZXInIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBnYXVnZSB2YWx1ZVxuICAgKi9cbiAgc3RhdGljIGdhdWdlKFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIHZhbHVlLCB7IC4uLm9wdGlvbnMsIHR5cGU6ICdnYXVnZScgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIHRpbWluZyAobWlsbGlzZWNvbmRzKVxuICAgKi9cbiAgc3RhdGljIHRpbWluZyhcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZHVyYXRpb25NczogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIGR1cmF0aW9uTXMsIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICB0eXBlOiAndGltaW5nJyxcbiAgICAgIHVuaXQ6IG9wdGlvbnM/LnVuaXQgPz8gJ21pbGxpc2Vjb25kcycsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGhpc3RvZ3JhbSB2YWx1ZVxuICAgKi9cbiAgc3RhdGljIGhpc3RvZ3JhbShcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCB2YWx1ZSwgeyAuLi5vcHRpb25zLCB0eXBlOiAnaGlzdG9ncmFtJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgY3VzdG9tIG1ldHJpY1xuICAgKi9cbiAgc3RhdGljIHJlY29yZChcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIC8vIFZhbGlkYXRlIG1ldHJpYyB2YWx1ZVxuICAgIGlmICghaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWUsIHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnM/LnR5cGUgPz8gJ2N1c3RvbScsXG4gICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBuYW1lLFxuICAgICAgbWV0cmljczogeyBbIG5hbWUgXTogdmFsdWUgfSxcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgdW5pdDogb3B0aW9ucz8udW5pdCxcbiAgICAgICAgbWV0cmljVHlwZTogb3B0aW9ucz8udHlwZSxcbiAgICAgICAgLi4ub3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgIH0sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBtdWx0aXBsZSBtZXRyaWNzIGF0IG9uY2VcbiAgICogSW52YWxpZCB2YWx1ZXMgKE5hTiwgSW5maW5pdHkpIGFyZSBmaWx0ZXJlZCBvdXQgd2l0aCB3YXJuaW5ncy5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRCYXRjaChcbiAgICBtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gRmlsdGVyIG91dCBpbnZhbGlkIHZhbHVlc1xuICAgIGNvbnN0IHZhbGlkTWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1ldHJpY3MpKSB7XG4gICAgICBpZiAoaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWUsIHZhbHVlKSkge1xuICAgICAgICB2YWxpZE1ldHJpY3NbIG5hbWUgXSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERvbid0IGNhcHR1cmUgaWYgbm8gdmFsaWQgbWV0cmljc1xuICAgIGlmIChPYmplY3Qua2V5cyh2YWxpZE1ldHJpY3MpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ3JlY29yZEJhdGNoOiBubyB2YWxpZCBtZXRyaWNzIHRvIHJlY29yZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgIHN1YlR5cGU6ICdiYXRjaCcsXG4gICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAnbWV0cmljcy5iYXRjaCcsXG4gICAgICBtZXRyaWNzOiB2YWxpZE1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIC4uLm9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICAgIG1ldHJpY0NvdW50OiBPYmplY3Qua2V5cyh2YWxpZE1ldHJpY3MpLmxlbmd0aCxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGltZSBhIGZ1bmN0aW9uIGV4ZWN1dGlvbiBhbmQgcmVjb3JkIHRoZSBkdXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRpbWU8VD4oXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IFByb21pc2U8VD4ge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZm4oKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAndHJ1ZScgfSB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgbGV2ZWw6ICd3YXJuJywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAnZmFsc2UnIH0gfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGltZSBhIHN5bmMgZnVuY3Rpb24gZXhlY3V0aW9uIGFuZCByZWNvcmQgdGhlIGR1cmF0aW9uXG4gICAqL1xuICBzdGF0aWMgdGltZVN5bmM8VD4oXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBULFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IFQge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZm4oKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAndHJ1ZScgfSB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgbGV2ZWw6ICd3YXJuJywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAnZmFsc2UnIH0gfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cbiJdfQ==