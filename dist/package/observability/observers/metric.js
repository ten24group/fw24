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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL21ldHJpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQkc7OztBQUdILGlDQUE4RTtBQUM5RSwyQ0FBNkM7QUFFN0MsTUFBTSxhQUFhLEdBQUcsZ0JBQWdCLENBQUM7QUFDdkMsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGFBQWEsQ0FBQyxDQUFDO0FBRTNDOzs7R0FHRztBQUNILFNBQVMsa0JBQWtCLENBQUMsSUFBWSxFQUFFLEtBQWE7SUFDckQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUM5QixNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixJQUFJLGlCQUFpQixDQUFDLENBQUM7UUFDaEUsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsTUFBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsSUFBSSxRQUFRLENBQUMsQ0FBQztRQUN2RCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFDRCxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzVCLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLElBQUksYUFBYSxDQUFDLENBQUM7UUFDNUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDO0FBaUJELE1BQWEsY0FBYztJQUV6Qjs7T0FFRztJQUNILE1BQU0sQ0FBQyxTQUFTLENBQ2QsSUFBWSxFQUNaLFFBQWdCLENBQUMsRUFDakIsT0FBdUI7UUFFdkIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxLQUFL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Q0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUExS0Qsd0NBMEtDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBNZXRyaWNPYnNlcnZlciAtIEZvciBidXNpbmVzcyBhbmQgdGVjaG5pY2FsIG1ldHJpY3NcbiAqIFxuICogREVTSUdOIFBSSU5DSVBMRVM6XG4gKiAtIFJlcXVpcmVzIGNvcnJlbGF0aW9uSWQgZnJvbSBjb250ZXh0XG4gKiAtIFN1cHBvcnRzIGNvdW50ZXJzLCBnYXVnZXMsIHRpbWluZ3MsIGhpc3RvZ3JhbXNcbiAqIC0gRU1GLWNvbXBhdGlibGUgZm9yIENsb3VkV2F0Y2hcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBGSVJTVDogRXN0YWJsaXNoIGNvbnRleHRcbiAqIGF3YWl0IHJ1bldpdGhDb250ZXh0KFxuICogICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQocmVxdWVzdElkKSxcbiAqICAgYXN5bmMgKCkgPT4ge1xuICogICAgIC8vIFNpbXBsZSBjb3VudGVyXG4gKiAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdvcmRlcnMuY3JlYXRlZCcpO1xuICogICAgIFxuICogICAgIC8vIEdhdWdlIHZhbHVlXG4gKiAgICAgTWV0cmljT2JzZXJ2ZXIuZ2F1Z2UoJ3F1ZXVlLmRlcHRoJywgNDIpO1xuICogICAgIFxuICogICAgIC8vIFRpbWluZ1xuICogICAgIE1ldHJpY09ic2VydmVyLnRpbWluZygnYXBpLmxhdGVuY3knLCAxNDUpO1xuICogICAgIFxuICogICAgIC8vIEN1c3RvbSB3aXRoIHRhZ3NcbiAqICAgICBNZXRyaWNPYnNlcnZlci5yZWNvcmQoJ3BheW1lbnQuYW1vdW50JywgOTkuOTksIHtcbiAqICAgICAgIHRhZ3M6IHsgY3VycmVuY3k6ICdVU0QnLCBtZXRob2Q6ICdjYXJkJyB9LFxuICogICAgICAgdW5pdDogJ2RvbGxhcnMnLFxuICogICAgIH0pO1xuICogICB9XG4gKiApO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgYnVpbGRDb21tb25GaWVsZHMsIGNhcHR1cmVFdmVudCwgQmFzZU9ic2VydmVyT3B0aW9ucyB9IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdNZXRyaWNPYnNlcnZlcic7XG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoT0JTRVJWRVJfTkFNRSk7XG5cbi8qKlxuICogVmFsaWRhdGUgYSBtZXRyaWMgdmFsdWVcbiAqIFJldHVybnMgdHJ1ZSBpZiB2YWxpZCwgbG9ncyB3YXJuaW5nIGFuZCByZXR1cm5zIGZhbHNlIGlmIGludmFsaWRcbiAqL1xuZnVuY3Rpb24gaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWU6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnbnVtYmVyJykge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBub3QgYSBudW1iZXJgKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKE51bWJlci5pc05hTih2YWx1ZSkpIHtcbiAgICBsb2dnZXIud2FybihgSW52YWxpZCBtZXRyaWMgdmFsdWUgZm9yICcke25hbWV9JzogTmFOYCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIGxvZ2dlci53YXJuKGBJbnZhbGlkIG1ldHJpYyB2YWx1ZSBmb3IgJyR7bmFtZX0nOiBJbmZpbml0eWApO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXRyaWNPcHRpb25zIGV4dGVuZHMgQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIC8qKiBNZXRyaWMgdHlwZSAqL1xuICB0eXBlPzogJ2NvdW50ZXInIHwgJ2dhdWdlJyB8ICd0aW1pbmcnIHwgJ2hpc3RvZ3JhbScgfCAnY3VzdG9tJztcbiAgLyoqIFVuaXQgKGUuZy4sICdtaWxsaXNlY29uZHMnLCAnYnl0ZXMnLCAnY291bnQnKSAqL1xuICB1bml0Pzogc3RyaW5nO1xuICAvKiogU2V2ZXJpdHkgbGV2ZWwgKG1ldHJpY3MgdHlwaWNhbGx5IHRyYWNlLWluZm8sIHJhcmVseSB3YXJuL2Vycm9yKSAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgYXR0cmlidXRlcyAqL1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBFbnRpdHkgbmFtZSBmb3IgY29udGV4dCAqL1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAvKiogRW50aXR5IElEIGZvciBjb250ZXh0ICovXG4gIGVudGl0eUlkPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTWV0cmljT2JzZXJ2ZXIge1xuXG4gIC8qKlxuICAgKiBJbmNyZW1lbnQgY291bnRlclxuICAgKi9cbiAgc3RhdGljIGluY3JlbWVudChcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlciA9IDEsXG4gICAgb3B0aW9ucz86IE1ldHJpY09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5yZWNvcmQobmFtZSwgdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2NvdW50ZXInIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERlY3JlbWVudCBjb3VudGVyXG4gICAqL1xuICBzdGF0aWMgZGVjcmVtZW50KFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyID0gMSxcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCAtdmFsdWUsIHsgLi4ub3B0aW9ucywgdHlwZTogJ2NvdW50ZXInIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBnYXVnZSB2YWx1ZVxuICAgKi9cbiAgc3RhdGljIGdhdWdlKFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIHZhbHVlLCB7IC4uLm9wdGlvbnMsIHR5cGU6ICdnYXVnZScgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIHRpbWluZyAobWlsbGlzZWNvbmRzKVxuICAgKi9cbiAgc3RhdGljIHRpbWluZyhcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZHVyYXRpb25NczogbnVtYmVyLFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVjb3JkKG5hbWUsIGR1cmF0aW9uTXMsIHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICB0eXBlOiAndGltaW5nJyxcbiAgICAgIHVuaXQ6IG9wdGlvbnM/LnVuaXQgPz8gJ21pbGxpc2Vjb25kcycsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGhpc3RvZ3JhbSB2YWx1ZVxuICAgKi9cbiAgc3RhdGljIGhpc3RvZ3JhbShcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlY29yZChuYW1lLCB2YWx1ZSwgeyAuLi5vcHRpb25zLCB0eXBlOiAnaGlzdG9ncmFtJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgY3VzdG9tIG1ldHJpY1xuICAgKi9cbiAgc3RhdGljIHJlY29yZChcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgdmFsdWU6IG51bWJlcixcbiAgICBvcHRpb25zPzogTWV0cmljT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIC8vIFZhbGlkYXRlIG1ldHJpYyB2YWx1ZVxuICAgIGlmICghaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWUsIHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgIHN1YlR5cGU6IG9wdGlvbnM/LnR5cGUgPz8gJ2N1c3RvbScsXG4gICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiBuYW1lLFxuICAgICAgbWV0cmljczogeyBbIG5hbWUgXTogdmFsdWUgfSxcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgdW5pdDogb3B0aW9ucz8udW5pdCxcbiAgICAgICAgbWV0cmljVHlwZTogb3B0aW9ucz8udHlwZSxcbiAgICAgICAgLi4ub3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgIH0sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBtdWx0aXBsZSBtZXRyaWNzIGF0IG9uY2VcbiAgICogSW52YWxpZCB2YWx1ZXMgKE5hTiwgSW5maW5pdHkpIGFyZSBmaWx0ZXJlZCBvdXQgd2l0aCB3YXJuaW5ncy5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRCYXRjaChcbiAgICBtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gRmlsdGVyIG91dCBpbnZhbGlkIHZhbHVlc1xuICAgIGNvbnN0IHZhbGlkTWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKG1ldHJpY3MpKSB7XG4gICAgICBpZiAoaXNWYWxpZE1ldHJpY1ZhbHVlKG5hbWUsIHZhbHVlKSkge1xuICAgICAgICB2YWxpZE1ldHJpY3NbIG5hbWUgXSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERvbid0IGNhcHR1cmUgaWYgbm8gdmFsaWQgbWV0cmljc1xuICAgIGlmIChPYmplY3Qua2V5cyh2YWxpZE1ldHJpY3MpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ3JlY29yZEJhdGNoOiBubyB2YWxpZCBtZXRyaWNzIHRvIHJlY29yZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgIHN1YlR5cGU6ICdiYXRjaCcsXG4gICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAnbWV0cmljcy5iYXRjaCcsXG4gICAgICBtZXRyaWNzOiB2YWxpZE1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIC4uLm9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICAgIG1ldHJpY0NvdW50OiBPYmplY3Qua2V5cyh2YWxpZE1ldHJpY3MpLmxlbmd0aCxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGltZSBhIGZ1bmN0aW9uIGV4ZWN1dGlvbiBhbmQgcmVjb3JkIHRoZSBkdXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRpbWU8VD4oXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IFByb21pc2U8VD4ge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZm4oKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAndHJ1ZScgfSB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgbGV2ZWw6ICd3YXJuJywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAnZmFsc2UnIH0gfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGltZSBhIHN5bmMgZnVuY3Rpb24gZXhlY3V0aW9uIGFuZCByZWNvcmQgdGhlIGR1cmF0aW9uXG4gICAqL1xuICBzdGF0aWMgdGltZVN5bmM8VD4oXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBULFxuICAgIG9wdGlvbnM/OiBNZXRyaWNPcHRpb25zXG4gICk6IFQge1xuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZm4oKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAndHJ1ZScgfSB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgdGhpcy50aW1pbmcobmFtZSwgZHVyYXRpb24sIHsgLi4ub3B0aW9ucywgbGV2ZWw6ICd3YXJuJywgdGFnczogeyAuLi5vcHRpb25zPy50YWdzLCBzdWNjZXNzOiAnZmFsc2UnIH0gfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cbiJdfQ==