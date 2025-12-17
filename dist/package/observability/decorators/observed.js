"use strict";
/**
 * @Observed Decorator - Unified observability decorator
 *
 * Combines tracing, audit, and metric recording in a single decorator.
 * Use this for high-level methods that need comprehensive observability.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed({
 *     trace: true,
 *     audit: { action: 'order.create' },
 *     metric: { name: 'orders.created', type: 'counter' }
 *   })
 *   async createOrder(order: Order): Promise<Order> {
 *     // Method is traced, audited, and metered
 *   }
 *
 *   @Observed({
 *     trace: { level: 'info' },
 *     audit: { action: 'payment.process', level: 'warn', captureArgs: true }
 *   })
 *   async processPayment(orderId: string, amount: number): Promise<void> {
 *     // Comprehensive observability with custom config
 *   }
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise creates NoOp spans and skips audits/metrics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observed = Observed;
const span_1 = require("../observers/span");
const audit_1 = require("../observers/audit");
const metric_1 = require("../observers/metric");
const source_utils_1 = require("../utils/source-utils");
const payload_1 = require("../utils/payload");
const base_1 = require("../observers/base");
const context_1 = require("../context");
const logging_1 = require("../../logging");
const logger = (0, logging_1.createLogger)('ObservedDecorator');
/**
 * Unified observability decorator that combines tracing, auditing, and metrics
 *
 * @param options - Observability options
 */
function Observed(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const operationName = options.name ?? `${className}.${methodName}`;
        // Determine source
        let source;
        switch (options.sourceType) {
            case 'controller':
                source = (0, source_utils_1.createControllerSource)(className, methodName);
                break;
            case 'service':
                source = (0, source_utils_1.createServiceSource)(className, methodName);
                break;
            case 'queue':
                source = (0, source_utils_1.createQueueSource)(className, methodName);
                break;
            case 'task':
                source = (0, source_utils_1.createTaskSource)(className, methodName);
                break;
            default:
                source = `${className}.${methodName}`;
        }
        const wrappedMethod = function (...args) {
            // Check if observability is enabled (static or dynamic)
            if (options.enabled !== undefined) {
                const isEnabled = typeof options.enabled === 'function'
                    ? options.enabled()
                    : options.enabled;
                if (!isEnabled) {
                    // Observability disabled - execute method without instrumentation
                    return originalMethod.apply(this, args);
                }
            }
            const startTime = Date.now();
            let span = null;
            // Start span if tracing enabled
            if (options.trace) {
                const traceOptions = typeof options.trace === 'boolean' ? {} : options.trace;
                const spanOptions = {
                    level: traceOptions.level,
                    attributes: {
                        'code.function': methodName,
                        'code.namespace': className,
                        ...traceOptions.attributes,
                        ...(options.captureArgs && args.length > 0 && { args: (0, payload_1.safeSerialize)(args) }),
                    },
                    tags: { ...options.tags, ...traceOptions.attributes?.tags },
                    source,
                };
                span = span_1.SpanObserver.start(operationName, spanOptions);
            }
            // Emit pre-execution metric (counter)
            if (options.metric && options.metric.type === 'counter') {
                const metricName = options.metric.name ?? `${operationName}.count`;
                metric_1.MetricObserver.increment(metricName, 1, {
                    tags: { ...options.tags, ...options.metric.tags },
                    source,
                });
            }
            try {
                const result = originalMethod.apply(this, args);
                // Check if result is a Promise/thenable
                if (result && typeof result.then === 'function') {
                    // Handle async method
                    return result
                        .then((value) => {
                        const durationMs = Date.now() - startTime;
                        // End span
                        if (span) {
                            if (options.captureResult && value !== undefined) {
                                span.setAttribute('result', (0, payload_1.safeSerialize)(value));
                            }
                            span.end({ success: true });
                        }
                        // Record audit
                        recordAudit({
                            options,
                            operationName,
                            args,
                            result: value,
                            success: true,
                            durationMs,
                            source,
                        });
                        // Record timing metric
                        recordTimingMetric({
                            options,
                            operationName,
                            durationMs,
                            success: true,
                            source,
                        });
                        return value;
                    })
                        .catch((error) => {
                        const durationMs = Date.now() - startTime;
                        // End span with error
                        if (span) {
                            span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                        }
                        // Record audit with error
                        recordAudit({
                            options,
                            operationName,
                            args,
                            success: false,
                            error: (0, base_1.normalizeError)(error),
                            durationMs,
                            source,
                        });
                        // Record timing metric with error
                        recordTimingMetric({
                            options,
                            operationName,
                            durationMs,
                            success: false,
                            source,
                        });
                        throw error;
                    });
                }
                // Handle sync method
                const durationMs = Date.now() - startTime;
                if (span) {
                    if (options.captureResult && result !== undefined) {
                        span.setAttribute('result', (0, payload_1.safeSerialize)(result));
                    }
                    span.end({ success: true });
                }
                recordAudit({
                    options,
                    operationName,
                    args,
                    result,
                    success: true,
                    durationMs,
                    source,
                });
                recordTimingMetric({
                    options,
                    operationName,
                    durationMs,
                    success: true,
                    source,
                });
                return result;
            }
            catch (error) {
                const durationMs = Date.now() - startTime;
                if (span) {
                    span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                }
                recordAudit({
                    options,
                    operationName,
                    args,
                    success: false,
                    error: (0, base_1.normalizeError)(error),
                    durationMs,
                    source,
                });
                recordTimingMetric({
                    options,
                    operationName,
                    durationMs,
                    success: false,
                    source,
                });
                throw error;
            }
        };
        descriptor.value = wrappedMethod;
        return descriptor;
    };
}
/**
 * Record audit event if configured
 */
function recordAudit(params) {
    const { options, operationName, args, result, success, error, durationMs, source } = params;
    if (!options.audit)
        return;
    const auditOptions = typeof options.audit === 'boolean' ? {} : options.audit;
    const context = (0, context_1.getCurrentContext)();
    // Build audit data
    let data = {
        success,
        durationMs,
    };
    // Capture args if requested
    const shouldCaptureArgs = auditOptions.captureArgs ?? options.captureArgs ?? false;
    if (shouldCaptureArgs && args.length > 0) {
        data.args = (0, payload_1.safeSerialize)(args);
    }
    // Capture result if requested
    const shouldCaptureResult = auditOptions.captureResult ?? options.captureResult ?? false;
    if (shouldCaptureResult && result !== undefined) {
        data.result = (0, payload_1.safeSerialize)(result);
    }
    // Add error info if failed
    if (error) {
        data.error = {
            type: error.name,
            message: error.message,
        };
    }
    audit_1.AuditObserver.record({
        operation: auditOptions.action ?? operationName,
        entityName: auditOptions.entityName,
        data,
        level: error ? 'error' : (auditOptions.level ?? 'info'),
        source,
        tags: options.tags,
        actor: context?.actor,
    });
}
/**
 * Record timing metric if configured
 */
function recordTimingMetric(params) {
    const { options, operationName, durationMs, success, source } = params;
    if (!options.metric || options.metric.type !== 'timing')
        return;
    const metricName = options.metric.name ?? `${operationName}.duration`;
    metric_1.MetricObserver.timing(metricName, durationMs, {
        tags: {
            ...options.tags,
            ...options.metric.tags,
            success: String(success),
        },
        unit: options.metric.unit ?? 'milliseconds',
        source,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL29ic2VydmVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7QUFtRUgsNEJBb05DO0FBclJELDRDQUE4RDtBQUM5RCw4Q0FBbUQ7QUFDbkQsZ0RBQW9FO0FBQ3BFLHdEQUF5SDtBQUN6SCw4Q0FBaUQ7QUFDakQsNENBQW1EO0FBQ25ELHdDQUF5RTtBQUN6RSwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLG1CQUFtQixDQUFDLENBQUM7QUFtRGpEOzs7O0dBSUc7QUFDSCxTQUFnQixRQUFRLENBQUMsVUFBMkIsRUFBRTtJQUNwRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFFeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxJQUFJLElBQUksR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7UUFFbkUsbUJBQW1CO1FBQ25CLElBQUksTUFBYyxDQUFDO1FBQ25CLFFBQVEsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzNCLEtBQUssWUFBWTtnQkFDZixNQUFNLEdBQUcsSUFBQSxxQ0FBc0IsRUFBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBQ3ZELE1BQU07WUFDUixLQUFLLFNBQVM7Z0JB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QUksRUFBRSxPQUFPLENBQUMsSUFBSTtRQUNsQixLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUs7S0FDdEIsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxNQU0zQjtJQUNDLE1BQU0sRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDO0lBRXZFLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLFFBQVE7UUFBRSxPQUFPO0lBRWhFLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLEdBQUcsYUFBYSxXQUFXLENBQUM7SUFFdEUsdUJBQWMsQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRTtRQUM1QyxJQUFJLEVBQUU7WUFDSixHQUFHLE9BQU8sQ0FBQyxJQUFJO1lBQ2YsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUk7WUFDdEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUM7U0FDekI7UUFDRCxJQUFJLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksY0FBYztRQUMzQyxNQUFNO0tBQ1AsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQE9ic2VydmVkIERlY29yYXRvciAtIFVuaWZpZWQgb2JzZXJ2YWJpbGl0eSBkZWNvcmF0b3JcbiAqIFxuICogQ29tYmluZXMgdHJhY2luZywgYXVkaXQsIGFuZCBtZXRyaWMgcmVjb3JkaW5nIGluIGEgc2luZ2xlIGRlY29yYXRvci5cbiAqIFVzZSB0aGlzIGZvciBoaWdoLWxldmVsIG1ldGhvZHMgdGhhdCBuZWVkIGNvbXByZWhlbnNpdmUgb2JzZXJ2YWJpbGl0eS5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICBAT2JzZXJ2ZWQoeyBcbiAqICAgICB0cmFjZTogdHJ1ZSxcbiAqICAgICBhdWRpdDogeyBhY3Rpb246ICdvcmRlci5jcmVhdGUnIH0sXG4gKiAgICAgbWV0cmljOiB7IG5hbWU6ICdvcmRlcnMuY3JlYXRlZCcsIHR5cGU6ICdjb3VudGVyJyB9XG4gKiAgIH0pXG4gKiAgIGFzeW5jIGNyZWF0ZU9yZGVyKG9yZGVyOiBPcmRlcik6IFByb21pc2U8T3JkZXI+IHtcbiAqICAgICAvLyBNZXRob2QgaXMgdHJhY2VkLCBhdWRpdGVkLCBhbmQgbWV0ZXJlZFxuICogICB9XG4gKiAgIFxuICogICBAT2JzZXJ2ZWQoeyBcbiAqICAgICB0cmFjZTogeyBsZXZlbDogJ2luZm8nIH0sXG4gKiAgICAgYXVkaXQ6IHsgYWN0aW9uOiAncGF5bWVudC5wcm9jZXNzJywgbGV2ZWw6ICd3YXJuJywgY2FwdHVyZUFyZ3M6IHRydWUgfVxuICogICB9KVxuICogICBhc3luYyBwcm9jZXNzUGF5bWVudChvcmRlcklkOiBzdHJpbmcsIGFtb3VudDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gKiAgICAgLy8gQ29tcHJlaGVuc2l2ZSBvYnNlcnZhYmlsaXR5IHdpdGggY3VzdG9tIGNvbmZpZ1xuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE90aGVyd2lzZSBjcmVhdGVzIE5vT3Agc3BhbnMgYW5kIHNraXBzIGF1ZGl0cy9tZXRyaWNzXG4gKi9cblxuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBTcGFuT3B0aW9ucyB9IGZyb20gJy4uL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuLi9vYnNlcnZlcnMvYXVkaXQnO1xuaW1wb3J0IHsgTWV0cmljT2JzZXJ2ZXIsIE1ldHJpY09wdGlvbnMgfSBmcm9tICcuLi9vYnNlcnZlcnMvbWV0cmljJztcbmltcG9ydCB7IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsIGNyZWF0ZVNlcnZpY2VTb3VyY2UsIGNyZWF0ZVF1ZXVlU291cmNlLCBjcmVhdGVUYXNrU291cmNlIH0gZnJvbSAnLi4vdXRpbHMvc291cmNlLXV0aWxzJztcbmltcG9ydCB7IHNhZmVTZXJpYWxpemUgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcbmltcG9ydCB7IG5vcm1hbGl6ZUVycm9yIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2ZWREZWNvcmF0b3InKTtcblxuZXhwb3J0IGludGVyZmFjZSBPYnNlcnZlZE9wdGlvbnMge1xuICAvKiogTWV0aG9kIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuXG4gIC8qKiBDcmVhdGUgc3BhbiBmb3IgdHJhY2luZyAqL1xuICB0cmFjZT86IGJvb2xlYW4gfCB7XG4gICAgbGV2ZWw/OiBTcGFuT3B0aW9uc1sgJ2xldmVsJyBdO1xuICAgIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfTtcblxuICAvKiogQ3JlYXRlIGF1ZGl0IHJlY29yZCAqL1xuICBhdWRpdD86IGJvb2xlYW4gfCB7XG4gICAgYWN0aW9uPzogc3RyaW5nO1xuICAgIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gICAgbGV2ZWw/OiAnaW5mbycgfCAnd2FybicgfCAnZXJyb3InO1xuICAgIGNhcHR1cmVBcmdzPzogYm9vbGVhbjtcbiAgICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbiAgfTtcblxuICAvKiogUmVjb3JkIG1ldHJpYyAqL1xuICBtZXRyaWM/OiB7XG4gICAgbmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogJ2NvdW50ZXInIHwgJ2dhdWdlJyB8ICd0aW1pbmcnO1xuICAgIHVuaXQ/OiBzdHJpbmc7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH07XG5cbiAgLyoqIFNvdXJjZSB0eXBlIGZvciB0aGUgb3BlcmF0aW9uICovXG4gIHNvdXJjZVR5cGU/OiAnY29udHJvbGxlcicgfCAnc2VydmljZScgfCAnaGFuZGxlcicgfCAncXVldWUnIHwgJ3Rhc2snO1xuXG4gIC8qKiBUYWdzIGFwcGxpZWQgdG8gYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzICovXG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gIC8qKiBDYXB0dXJlIG1ldGhvZCBhcmd1bWVudHMgKi9cbiAgY2FwdHVyZUFyZ3M/OiBib29sZWFuO1xuXG4gIC8qKiBDYXB0dXJlIHJldHVybiB2YWx1ZSAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogQ29uZGl0aW9uYWxseSBlbmFibGUvZGlzYWJsZSBvYnNlcnZhYmlsaXR5LlxuICAgKiAtIFN0YXRpYyBib29sZWFuOiBgZW5hYmxlZDogZmFsc2VgIHRvIGRpc2FibGVcbiAgICogLSBEeW5hbWljIGZ1bmN0aW9uOiBgZW5hYmxlZDogKCkgPT4gc29tZUNvbmRpdGlvbigpYFxuICAgKiBGdW5jdGlvbiByZWNlaXZlcyBubyBhcmd1bWVudHMgYnV0IGNhbiBhY2Nlc3MgZ2V0Q3VycmVudENvbnRleHQoKSBpbnRlcm5hbGx5LlxuICAgKiBEZWZhdWx0OiB0cnVlIChlbmFibGVkKVxuICAgKi9cbiAgZW5hYmxlZD86IGJvb2xlYW4gfCAoKCkgPT4gYm9vbGVhbik7XG59XG5cbi8qKlxuICogVW5pZmllZCBvYnNlcnZhYmlsaXR5IGRlY29yYXRvciB0aGF0IGNvbWJpbmVzIHRyYWNpbmcsIGF1ZGl0aW5nLCBhbmQgbWV0cmljc1xuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIE9ic2VydmFiaWxpdHkgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gT2JzZXJ2ZWQob3B0aW9uczogT2JzZXJ2ZWRPcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bj4oXG4gICAgdGFyZ2V0OiBvYmplY3QsXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPlxuICApOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPiB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuXG4gICAgaWYgKHR5cGVvZiBvcmlnaW5hbE1ldGhvZCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gICAgfVxuXG4gICAgY29uc3QgY2xhc3NOYW1lID0gdGFyZ2V0LmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IFN0cmluZyhwcm9wZXJ0eUtleSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHNvdXJjZVxuICAgIGxldCBzb3VyY2U6IHN0cmluZztcbiAgICBzd2l0Y2ggKG9wdGlvbnMuc291cmNlVHlwZSkge1xuICAgICAgY2FzZSAnY29udHJvbGxlcic6XG4gICAgICAgIHNvdXJjZSA9IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzZXJ2aWNlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlU2VydmljZVNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3F1ZXVlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlUXVldWVTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0YXNrJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlVGFza1NvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHNvdXJjZSA9IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG4gICAgfVxuXG4gICAgY29uc3Qgd3JhcHBlZE1ldGhvZCA9IGZ1bmN0aW9uICh0aGlzOiB1bmtub3duLCAuLi5hcmdzOiB1bmtub3duW10pOiB1bmtub3duIHtcbiAgICAgIC8vIENoZWNrIGlmIG9ic2VydmFiaWxpdHkgaXMgZW5hYmxlZCAoc3RhdGljIG9yIGR5bmFtaWMpXG4gICAgICBpZiAob3B0aW9ucy5lbmFibGVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3QgaXNFbmFibGVkID0gdHlwZW9mIG9wdGlvbnMuZW5hYmxlZCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICAgID8gb3B0aW9ucy5lbmFibGVkKClcbiAgICAgICAgICA6IG9wdGlvbnMuZW5hYmxlZDtcblxuICAgICAgICBpZiAoIWlzRW5hYmxlZCkge1xuICAgICAgICAgIC8vIE9ic2VydmFiaWxpdHkgZGlzYWJsZWQgLSBleGVjdXRlIG1ldGhvZCB3aXRob3V0IGluc3RydW1lbnRhdGlvblxuICAgICAgICAgIHJldHVybiAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgIGxldCBzcGFuOiBSZXR1cm5UeXBlPHR5cGVvZiBTcGFuT2JzZXJ2ZXIuc3RhcnQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgICAgIC8vIFN0YXJ0IHNwYW4gaWYgdHJhY2luZyBlbmFibGVkXG4gICAgICBpZiAob3B0aW9ucy50cmFjZSkge1xuICAgICAgICBjb25zdCB0cmFjZU9wdGlvbnMgPSB0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ2Jvb2xlYW4nID8ge30gOiBvcHRpb25zLnRyYWNlO1xuXG4gICAgICAgIGNvbnN0IHNwYW5PcHRpb25zOiBTcGFuT3B0aW9ucyA9IHtcbiAgICAgICAgICBsZXZlbDogdHJhY2VPcHRpb25zLmxldmVsLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICdjb2RlLmZ1bmN0aW9uJzogbWV0aG9kTmFtZSxcbiAgICAgICAgICAgICdjb2RlLm5hbWVzcGFjZSc6IGNsYXNzTmFtZSxcbiAgICAgICAgICAgIC4uLnRyYWNlT3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgLi4uKG9wdGlvbnMuY2FwdHVyZUFyZ3MgJiYgYXJncy5sZW5ndGggPiAwICYmIHsgYXJnczogc2FmZVNlcmlhbGl6ZShhcmdzKSB9KSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHRhZ3M6IHsgLi4ub3B0aW9ucy50YWdzLCAuLi50cmFjZU9wdGlvbnMuYXR0cmlidXRlcz8udGFncyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIH0sXG4gICAgICAgICAgc291cmNlLFxuICAgICAgICB9O1xuXG4gICAgICAgIHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQob3BlcmF0aW9uTmFtZSwgc3Bhbk9wdGlvbnMpO1xuICAgICAgfVxuXG4gICAgICAvLyBFbWl0IHByZS1leGVjdXRpb24gbWV0cmljIChjb3VudGVyKVxuICAgICAgaWYgKG9wdGlvbnMubWV0cmljICYmIG9wdGlvbnMubWV0cmljLnR5cGUgPT09ICdjb3VudGVyJykge1xuICAgICAgICBjb25zdCBtZXRyaWNOYW1lID0gb3B0aW9ucy5tZXRyaWMubmFtZSA/PyBgJHtvcGVyYXRpb25OYW1lfS5jb3VudGA7XG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChtZXRyaWNOYW1lLCAxLCB7XG4gICAgICAgICAgdGFnczogeyAuLi5vcHRpb25zLnRhZ3MsIC4uLm9wdGlvbnMubWV0cmljLnRhZ3MgfSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiAocmVzdWx0IGFzIHsgdGhlbj86IHVua25vd24gfSkudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEhhbmRsZSBhc3luYyBtZXRob2RcbiAgICAgICAgICByZXR1cm4gKHJlc3VsdCBhcyBQcm9taXNlPHVua25vd24+KVxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuXG4gICAgICAgICAgICAgIC8vIEVuZCBzcGFuXG4gICAgICAgICAgICAgIGlmIChzcGFuKSB7XG4gICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMuY2FwdHVyZVJlc3VsdCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgncmVzdWx0Jywgc2FmZVNlcmlhbGl6ZSh2YWx1ZSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBSZWNvcmQgYXVkaXRcbiAgICAgICAgICAgICAgcmVjb3JkQXVkaXQoe1xuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgICAgIHJlc3VsdDogdmFsdWUsXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgLy8gUmVjb3JkIHRpbWluZyBtZXRyaWNcbiAgICAgICAgICAgICAgcmVjb3JkVGltaW5nTWV0cmljKHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgICAgICAgLy8gRW5kIHNwYW4gd2l0aCBlcnJvclxuICAgICAgICAgICAgICBpZiAoc3Bhbikge1xuICAgICAgICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBSZWNvcmQgYXVkaXQgd2l0aCBlcnJvclxuICAgICAgICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICAgICAgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgLy8gUmVjb3JkIHRpbWluZyBtZXRyaWMgd2l0aCBlcnJvclxuICAgICAgICAgICAgICByZWNvcmRUaW1pbmdNZXRyaWMoe1xuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBzeW5jIG1ldGhvZFxuICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcblxuICAgICAgICBpZiAoc3Bhbikge1xuICAgICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdyZXN1bHQnLCBzYWZlU2VyaWFsaXplKHJlc3VsdCkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgcmVzdWx0LFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJlY29yZFRpbWluZ01ldHJpYyh7XG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcblxuICAgICAgICBpZiAoc3Bhbikge1xuICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSxcbiAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVjb3JkVGltaW5nTWV0cmljKHtcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH07XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IHdyYXBwZWRNZXRob2QgYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4vKipcbiAqIFJlY29yZCBhdWRpdCBldmVudCBpZiBjb25maWd1cmVkXG4gKi9cbmZ1bmN0aW9uIHJlY29yZEF1ZGl0KHBhcmFtczoge1xuICBvcHRpb25zOiBPYnNlcnZlZE9wdGlvbnM7XG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZztcbiAgYXJnczogdW5rbm93bltdO1xuICByZXN1bHQ/OiB1bmtub3duO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBlcnJvcj86IEVycm9yO1xuICBkdXJhdGlvbk1zOiBudW1iZXI7XG4gIHNvdXJjZTogc3RyaW5nO1xufSk6IHZvaWQge1xuICBjb25zdCB7IG9wdGlvbnMsIG9wZXJhdGlvbk5hbWUsIGFyZ3MsIHJlc3VsdCwgc3VjY2VzcywgZXJyb3IsIGR1cmF0aW9uTXMsIHNvdXJjZSB9ID0gcGFyYW1zO1xuXG4gIGlmICghb3B0aW9ucy5hdWRpdCkgcmV0dXJuO1xuXG4gIGNvbnN0IGF1ZGl0T3B0aW9ucyA9IHR5cGVvZiBvcHRpb25zLmF1ZGl0ID09PSAnYm9vbGVhbicgPyB7fSA6IG9wdGlvbnMuYXVkaXQ7XG4gIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gIC8vIEJ1aWxkIGF1ZGl0IGRhdGFcbiAgbGV0IGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgIHN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NcyxcbiAgfTtcblxuICAvLyBDYXB0dXJlIGFyZ3MgaWYgcmVxdWVzdGVkXG4gIGNvbnN0IHNob3VsZENhcHR1cmVBcmdzID0gYXVkaXRPcHRpb25zLmNhcHR1cmVBcmdzID8/IG9wdGlvbnMuY2FwdHVyZUFyZ3MgPz8gZmFsc2U7XG4gIGlmIChzaG91bGRDYXB0dXJlQXJncyAmJiBhcmdzLmxlbmd0aCA+IDApIHtcbiAgICBkYXRhLmFyZ3MgPSBzYWZlU2VyaWFsaXplKGFyZ3MpO1xuICB9XG5cbiAgLy8gQ2FwdHVyZSByZXN1bHQgaWYgcmVxdWVzdGVkXG4gIGNvbnN0IHNob3VsZENhcHR1cmVSZXN1bHQgPSBhdWRpdE9wdGlvbnMuY2FwdHVyZVJlc3VsdCA/PyBvcHRpb25zLmNhcHR1cmVSZXN1bHQgPz8gZmFsc2U7XG4gIGlmIChzaG91bGRDYXB0dXJlUmVzdWx0ICYmIHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZGF0YS5yZXN1bHQgPSBzYWZlU2VyaWFsaXplKHJlc3VsdCk7XG4gIH1cblxuICAvLyBBZGQgZXJyb3IgaW5mbyBpZiBmYWlsZWRcbiAgaWYgKGVycm9yKSB7XG4gICAgZGF0YS5lcnJvciA9IHtcbiAgICAgIHR5cGU6IGVycm9yLm5hbWUsXG4gICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIH07XG4gIH1cblxuICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgb3BlcmF0aW9uOiBhdWRpdE9wdGlvbnMuYWN0aW9uID8/IG9wZXJhdGlvbk5hbWUsXG4gICAgZW50aXR5TmFtZTogYXVkaXRPcHRpb25zLmVudGl0eU5hbWUsXG4gICAgZGF0YSxcbiAgICBsZXZlbDogZXJyb3IgPyAnZXJyb3InIDogKGF1ZGl0T3B0aW9ucy5sZXZlbCA/PyAnaW5mbycpLFxuICAgIHNvdXJjZSxcbiAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgYWN0b3I6IGNvbnRleHQ/LmFjdG9yLFxuICB9KTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgdGltaW5nIG1ldHJpYyBpZiBjb25maWd1cmVkXG4gKi9cbmZ1bmN0aW9uIHJlY29yZFRpbWluZ01ldHJpYyhwYXJhbXM6IHtcbiAgb3B0aW9uczogT2JzZXJ2ZWRPcHRpb25zO1xuICBvcGVyYXRpb25OYW1lOiBzdHJpbmc7XG4gIGR1cmF0aW9uTXM6IG51bWJlcjtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgc291cmNlOiBzdHJpbmc7XG59KTogdm9pZCB7XG4gIGNvbnN0IHsgb3B0aW9ucywgb3BlcmF0aW9uTmFtZSwgZHVyYXRpb25Ncywgc3VjY2Vzcywgc291cmNlIH0gPSBwYXJhbXM7XG5cbiAgaWYgKCFvcHRpb25zLm1ldHJpYyB8fCBvcHRpb25zLm1ldHJpYy50eXBlICE9PSAndGltaW5nJykgcmV0dXJuO1xuXG4gIGNvbnN0IG1ldHJpY05hbWUgPSBvcHRpb25zLm1ldHJpYy5uYW1lID8/IGAke29wZXJhdGlvbk5hbWV9LmR1cmF0aW9uYDtcblxuICBNZXRyaWNPYnNlcnZlci50aW1pbmcobWV0cmljTmFtZSwgZHVyYXRpb25Ncywge1xuICAgIHRhZ3M6IHtcbiAgICAgIC4uLm9wdGlvbnMudGFncyxcbiAgICAgIC4uLm9wdGlvbnMubWV0cmljLnRhZ3MsXG4gICAgICBzdWNjZXNzOiBTdHJpbmcoc3VjY2VzcyksXG4gICAgfSxcbiAgICB1bml0OiBvcHRpb25zLm1ldHJpYy51bml0ID8/ICdtaWxsaXNlY29uZHMnLFxuICAgIHNvdXJjZSxcbiAgfSk7XG59XG5cbiJdfQ==