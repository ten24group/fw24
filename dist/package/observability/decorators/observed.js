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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL29ic2VydmVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7QUEwREgsNEJBd01DO0FBaFFELDRDQUE4RDtBQUM5RCw4Q0FBbUQ7QUFDbkQsZ0RBQW9FO0FBQ3BFLHdEQUF5SDtBQUN6SCw4Q0FBaUQ7QUFDakQsNENBQW1EO0FBQ25ELHdDQUF5RTtBQUN6RSwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLG1CQUFtQixDQUFDLENBQUM7QUEwQ2pEOzs7O0dBSUc7QUFDSCxTQUFnQixRQUFRLENBQUMsVUFBMkIsRUFBRTtJQUNwRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFFeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxJQUFJLElBQUksR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7UUFFbkUsbUJBQW1CO1FBQ25CLElBQUksTUFBYyxDQUFDO1FBQ25CLFFBQVEsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzNCLEtBQUssWUFBWTtnQkFDZixNQUFNLEdBQUcsSUFBQSxxQ0FBc0IsRUFBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBQ3ZELE1BQU07WUFDUixLQUFLLFNBQVM7Z0JB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QyxNQUFNLENBQUMsSUFBSSxJQUFJLEdBQUcsYUFBYSxXQUFXLENBQUM7SUFFdEUsdUJBQWMsQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRTtRQUM1QyxJQUFJLEVBQUU7WUFDSixHQUFHLE9BQU8sQ0FBQyxJQUFJO1lBQ2YsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUk7WUFDdEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUM7U0FDekI7UUFDRCxJQUFJLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksY0FBYztRQUMzQyxNQUFNO0tBQ1AsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQE9ic2VydmVkIERlY29yYXRvciAtIFVuaWZpZWQgb2JzZXJ2YWJpbGl0eSBkZWNvcmF0b3JcbiAqIFxuICogQ29tYmluZXMgdHJhY2luZywgYXVkaXQsIGFuZCBtZXRyaWMgcmVjb3JkaW5nIGluIGEgc2luZ2xlIGRlY29yYXRvci5cbiAqIFVzZSB0aGlzIGZvciBoaWdoLWxldmVsIG1ldGhvZHMgdGhhdCBuZWVkIGNvbXByZWhlbnNpdmUgb2JzZXJ2YWJpbGl0eS5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICBAT2JzZXJ2ZWQoeyBcbiAqICAgICB0cmFjZTogdHJ1ZSxcbiAqICAgICBhdWRpdDogeyBhY3Rpb246ICdvcmRlci5jcmVhdGUnIH0sXG4gKiAgICAgbWV0cmljOiB7IG5hbWU6ICdvcmRlcnMuY3JlYXRlZCcsIHR5cGU6ICdjb3VudGVyJyB9XG4gKiAgIH0pXG4gKiAgIGFzeW5jIGNyZWF0ZU9yZGVyKG9yZGVyOiBPcmRlcik6IFByb21pc2U8T3JkZXI+IHtcbiAqICAgICAvLyBNZXRob2QgaXMgdHJhY2VkLCBhdWRpdGVkLCBhbmQgbWV0ZXJlZFxuICogICB9XG4gKiAgIFxuICogICBAT2JzZXJ2ZWQoeyBcbiAqICAgICB0cmFjZTogeyBsZXZlbDogJ2luZm8nIH0sXG4gKiAgICAgYXVkaXQ6IHsgYWN0aW9uOiAncGF5bWVudC5wcm9jZXNzJywgbGV2ZWw6ICd3YXJuJywgY2FwdHVyZUFyZ3M6IHRydWUgfVxuICogICB9KVxuICogICBhc3luYyBwcm9jZXNzUGF5bWVudChvcmRlcklkOiBzdHJpbmcsIGFtb3VudDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gKiAgICAgLy8gQ29tcHJlaGVuc2l2ZSBvYnNlcnZhYmlsaXR5IHdpdGggY3VzdG9tIGNvbmZpZ1xuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE90aGVyd2lzZSBjcmVhdGVzIE5vT3Agc3BhbnMgYW5kIHNraXBzIGF1ZGl0cy9tZXRyaWNzXG4gKi9cblxuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBTcGFuT3B0aW9ucyB9IGZyb20gJy4uL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuLi9vYnNlcnZlcnMvYXVkaXQnO1xuaW1wb3J0IHsgTWV0cmljT2JzZXJ2ZXIsIE1ldHJpY09wdGlvbnMgfSBmcm9tICcuLi9vYnNlcnZlcnMvbWV0cmljJztcbmltcG9ydCB7IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsIGNyZWF0ZVNlcnZpY2VTb3VyY2UsIGNyZWF0ZVF1ZXVlU291cmNlLCBjcmVhdGVUYXNrU291cmNlIH0gZnJvbSAnLi4vdXRpbHMvc291cmNlLXV0aWxzJztcbmltcG9ydCB7IHNhZmVTZXJpYWxpemUgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcbmltcG9ydCB7IG5vcm1hbGl6ZUVycm9yIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2ZWREZWNvcmF0b3InKTtcblxuZXhwb3J0IGludGVyZmFjZSBPYnNlcnZlZE9wdGlvbnMge1xuICAvKiogTWV0aG9kIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuICBcbiAgLyoqIENyZWF0ZSBzcGFuIGZvciB0cmFjaW5nICovXG4gIHRyYWNlPzogYm9vbGVhbiB8IHtcbiAgICBsZXZlbD86IFNwYW5PcHRpb25zWydsZXZlbCddO1xuICAgIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfTtcbiAgXG4gIC8qKiBDcmVhdGUgYXVkaXQgcmVjb3JkICovXG4gIGF1ZGl0PzogYm9vbGVhbiB8IHtcbiAgICBhY3Rpb24/OiBzdHJpbmc7XG4gICAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gICAgY2FwdHVyZUFyZ3M/OiBib29sZWFuO1xuICAgIGNhcHR1cmVSZXN1bHQ/OiBib29sZWFuO1xuICB9O1xuICBcbiAgLyoqIFJlY29yZCBtZXRyaWMgKi9cbiAgbWV0cmljPzoge1xuICAgIG5hbWU/OiBzdHJpbmc7XG4gICAgdHlwZT86ICdjb3VudGVyJyB8ICdnYXVnZScgfCAndGltaW5nJztcbiAgICB1bml0Pzogc3RyaW5nO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB9O1xuICBcbiAgLyoqIFNvdXJjZSB0eXBlIGZvciB0aGUgb3BlcmF0aW9uICovXG4gIHNvdXJjZVR5cGU/OiAnY29udHJvbGxlcicgfCAnc2VydmljZScgfCAnaGFuZGxlcicgfCAncXVldWUnIHwgJ3Rhc2snO1xuICBcbiAgLyoqIFRhZ3MgYXBwbGllZCB0byBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIFxuICAvKiogQ2FwdHVyZSBtZXRob2QgYXJndW1lbnRzICovXG4gIGNhcHR1cmVBcmdzPzogYm9vbGVhbjtcbiAgXG4gIC8qKiBDYXB0dXJlIHJldHVybiB2YWx1ZSAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBVbmlmaWVkIG9ic2VydmFiaWxpdHkgZGVjb3JhdG9yIHRoYXQgY29tYmluZXMgdHJhY2luZywgYXVkaXRpbmcsIGFuZCBtZXRyaWNzXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gT2JzZXJ2YWJpbGl0eSBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBPYnNlcnZlZChvcHRpb25zOiBPYnNlcnZlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG5cbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBvcGVyYXRpb25OYW1lID0gb3B0aW9ucy5uYW1lID8/IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICAvLyBEZXRlcm1pbmUgc291cmNlXG4gICAgbGV0IHNvdXJjZTogc3RyaW5nO1xuICAgIHN3aXRjaCAob3B0aW9ucy5zb3VyY2VUeXBlKSB7XG4gICAgICBjYXNlICdjb250cm9sbGVyJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlQ29udHJvbGxlclNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3NlcnZpY2UnOlxuICAgICAgICBzb3VyY2UgPSBjcmVhdGVTZXJ2aWNlU291cmNlKGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncXVldWUnOlxuICAgICAgICBzb3VyY2UgPSBjcmVhdGVRdWV1ZVNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Rhc2snOlxuICAgICAgICBzb3VyY2UgPSBjcmVhdGVUYXNrU291cmNlKGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgc291cmNlID0gYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcbiAgICB9XG5cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgIGxldCBzcGFuOiBSZXR1cm5UeXBlPHR5cGVvZiBTcGFuT2JzZXJ2ZXIuc3RhcnQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgICAgIC8vIFN0YXJ0IHNwYW4gaWYgdHJhY2luZyBlbmFibGVkXG4gICAgICBpZiAob3B0aW9ucy50cmFjZSkge1xuICAgICAgICBjb25zdCB0cmFjZU9wdGlvbnMgPSB0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ2Jvb2xlYW4nID8ge30gOiBvcHRpb25zLnRyYWNlO1xuICAgICAgICBcbiAgICAgICAgY29uc3Qgc3Bhbk9wdGlvbnM6IFNwYW5PcHRpb25zID0ge1xuICAgICAgICAgIGxldmVsOiB0cmFjZU9wdGlvbnMubGV2ZWwsXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgJ2NvZGUuZnVuY3Rpb24nOiBtZXRob2ROYW1lLFxuICAgICAgICAgICAgJ2NvZGUubmFtZXNwYWNlJzogY2xhc3NOYW1lLFxuICAgICAgICAgICAgLi4udHJhY2VPcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAuLi4ob3B0aW9ucy5jYXB0dXJlQXJncyAmJiBhcmdzLmxlbmd0aCA+IDAgJiYgeyBhcmdzOiBzYWZlU2VyaWFsaXplKGFyZ3MpIH0pLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdGFnczogeyAuLi5vcHRpb25zLnRhZ3MsIC4uLnRyYWNlT3B0aW9ucy5hdHRyaWJ1dGVzPy50YWdzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQgfSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH07XG5cbiAgICAgICAgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChvcGVyYXRpb25OYW1lLCBzcGFuT3B0aW9ucyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVtaXQgcHJlLWV4ZWN1dGlvbiBtZXRyaWMgKGNvdW50ZXIpXG4gICAgICBpZiAob3B0aW9ucy5tZXRyaWMgJiYgb3B0aW9ucy5tZXRyaWMudHlwZSA9PT0gJ2NvdW50ZXInKSB7XG4gICAgICAgIGNvbnN0IG1ldHJpY05hbWUgPSBvcHRpb25zLm1ldHJpYy5uYW1lID8/IGAke29wZXJhdGlvbk5hbWV9LmNvdW50YDtcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KG1ldHJpY05hbWUsIDEsIHtcbiAgICAgICAgICB0YWdzOiB7IC4uLm9wdGlvbnMudGFncywgLi4ub3B0aW9ucy5tZXRyaWMudGFncyB9LFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IChvcmlnaW5hbE1ldGhvZCBhcyAoLi4uYTogdW5rbm93bltdKSA9PiB1bmtub3duKS5hcHBseSh0aGlzLCBhcmdzKTtcblxuICAgICAgICAvLyBDaGVjayBpZiByZXN1bHQgaXMgYSBQcm9taXNlL3RoZW5hYmxlXG4gICAgICAgIGlmIChyZXN1bHQgJiYgdHlwZW9mIChyZXN1bHQgYXMgeyB0aGVuPzogdW5rbm93biB9KS50aGVuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGFzeW5jIG1ldGhvZFxuICAgICAgICAgIHJldHVybiAocmVzdWx0IGFzIFByb21pc2U8dW5rbm93bj4pXG4gICAgICAgICAgICAudGhlbigodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgICAgICAgLy8gRW5kIHNwYW5cbiAgICAgICAgICAgICAgaWYgKHNwYW4pIHtcbiAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5jYXB0dXJlUmVzdWx0ICYmIHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdyZXN1bHQnLCBzYWZlU2VyaWFsaXplKHZhbHVlKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIFJlY29yZCBhdWRpdFxuICAgICAgICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICAgICAgcmVzdWx0OiB2YWx1ZSxcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAvLyBSZWNvcmQgdGltaW5nIG1ldHJpY1xuICAgICAgICAgICAgICByZWNvcmRUaW1pbmdNZXRyaWMoe1xuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcblxuICAgICAgICAgICAgICAvLyBFbmQgc3BhbiB3aXRoIGVycm9yXG4gICAgICAgICAgICAgIGlmIChzcGFuKSB7XG4gICAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIFJlY29yZCBhdWRpdCB3aXRoIGVycm9yXG4gICAgICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgICAgICAgYXJncyxcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAvLyBSZWNvcmQgdGltaW5nIG1ldHJpYyB3aXRoIGVycm9yXG4gICAgICAgICAgICAgIHJlY29yZFRpbWluZ01ldHJpYyh7XG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIHN5bmMgbWV0aG9kXG4gICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuXG4gICAgICAgIGlmIChzcGFuKSB7XG4gICAgICAgICAgaWYgKG9wdGlvbnMuY2FwdHVyZVJlc3VsdCAmJiByZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ3Jlc3VsdCcsIHNhZmVTZXJpYWxpemUocmVzdWx0KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVjb3JkVGltaW5nTWV0cmljKHtcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuXG4gICAgICAgIGlmIChzcGFuKSB7XG4gICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpLFxuICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgc291cmNlLFxuICAgICAgICB9KTtcblxuICAgICAgICByZWNvcmRUaW1pbmdNZXRyaWMoe1xuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gd3JhcHBlZE1ldGhvZCBhcyBUO1xuXG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbi8qKlxuICogUmVjb3JkIGF1ZGl0IGV2ZW50IGlmIGNvbmZpZ3VyZWRcbiAqL1xuZnVuY3Rpb24gcmVjb3JkQXVkaXQocGFyYW1zOiB7XG4gIG9wdGlvbnM6IE9ic2VydmVkT3B0aW9ucztcbiAgb3BlcmF0aW9uTmFtZTogc3RyaW5nO1xuICBhcmdzOiB1bmtub3duW107XG4gIHJlc3VsdD86IHVua25vd247XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIGVycm9yPzogRXJyb3I7XG4gIGR1cmF0aW9uTXM6IG51bWJlcjtcbiAgc291cmNlOiBzdHJpbmc7XG59KTogdm9pZCB7XG4gIGNvbnN0IHsgb3B0aW9ucywgb3BlcmF0aW9uTmFtZSwgYXJncywgcmVzdWx0LCBzdWNjZXNzLCBlcnJvciwgZHVyYXRpb25Ncywgc291cmNlIH0gPSBwYXJhbXM7XG5cbiAgaWYgKCFvcHRpb25zLmF1ZGl0KSByZXR1cm47XG5cbiAgY29uc3QgYXVkaXRPcHRpb25zID0gdHlwZW9mIG9wdGlvbnMuYXVkaXQgPT09ICdib29sZWFuJyA/IHt9IDogb3B0aW9ucy5hdWRpdDtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgLy8gQnVpbGQgYXVkaXQgZGF0YVxuICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgc3VjY2VzcyxcbiAgICBkdXJhdGlvbk1zLFxuICB9O1xuXG4gIC8vIENhcHR1cmUgYXJncyBpZiByZXF1ZXN0ZWRcbiAgY29uc3Qgc2hvdWxkQ2FwdHVyZUFyZ3MgPSBhdWRpdE9wdGlvbnMuY2FwdHVyZUFyZ3MgPz8gb3B0aW9ucy5jYXB0dXJlQXJncyA/PyBmYWxzZTtcbiAgaWYgKHNob3VsZENhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCkge1xuICAgIGRhdGEuYXJncyA9IHNhZmVTZXJpYWxpemUoYXJncyk7XG4gIH1cblxuICAvLyBDYXB0dXJlIHJlc3VsdCBpZiByZXF1ZXN0ZWRcbiAgY29uc3Qgc2hvdWxkQ2FwdHVyZVJlc3VsdCA9IGF1ZGl0T3B0aW9ucy5jYXB0dXJlUmVzdWx0ID8/IG9wdGlvbnMuY2FwdHVyZVJlc3VsdCA/PyBmYWxzZTtcbiAgaWYgKHNob3VsZENhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICBkYXRhLnJlc3VsdCA9IHNhZmVTZXJpYWxpemUocmVzdWx0KTtcbiAgfVxuXG4gIC8vIEFkZCBlcnJvciBpbmZvIGlmIGZhaWxlZFxuICBpZiAoZXJyb3IpIHtcbiAgICBkYXRhLmVycm9yID0ge1xuICAgICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgfTtcbiAgfVxuXG4gIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICBvcGVyYXRpb246IGF1ZGl0T3B0aW9ucy5hY3Rpb24gPz8gb3BlcmF0aW9uTmFtZSxcbiAgICBlbnRpdHlOYW1lOiBhdWRpdE9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICBkYXRhLFxuICAgIGxldmVsOiBlcnJvciA/ICdlcnJvcicgOiAoYXVkaXRPcHRpb25zLmxldmVsID8/ICdpbmZvJyksXG4gICAgc291cmNlLFxuICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gIH0pO1xufVxuXG4vKipcbiAqIFJlY29yZCB0aW1pbmcgbWV0cmljIGlmIGNvbmZpZ3VyZWRcbiAqL1xuZnVuY3Rpb24gcmVjb3JkVGltaW5nTWV0cmljKHBhcmFtczoge1xuICBvcHRpb25zOiBPYnNlcnZlZE9wdGlvbnM7XG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZztcbiAgZHVyYXRpb25NczogbnVtYmVyO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBzb3VyY2U6IHN0cmluZztcbn0pOiB2b2lkIHtcbiAgY29uc3QgeyBvcHRpb25zLCBvcGVyYXRpb25OYW1lLCBkdXJhdGlvbk1zLCBzdWNjZXNzLCBzb3VyY2UgfSA9IHBhcmFtcztcblxuICBpZiAoIW9wdGlvbnMubWV0cmljIHx8IG9wdGlvbnMubWV0cmljLnR5cGUgIT09ICd0aW1pbmcnKSByZXR1cm47XG5cbiAgY29uc3QgbWV0cmljTmFtZSA9IG9wdGlvbnMubWV0cmljLm5hbWUgPz8gYCR7b3BlcmF0aW9uTmFtZX0uZHVyYXRpb25gO1xuICBcbiAgTWV0cmljT2JzZXJ2ZXIudGltaW5nKG1ldHJpY05hbWUsIGR1cmF0aW9uTXMsIHtcbiAgICB0YWdzOiB7IFxuICAgICAgLi4ub3B0aW9ucy50YWdzLCBcbiAgICAgIC4uLm9wdGlvbnMubWV0cmljLnRhZ3MsXG4gICAgICBzdWNjZXNzOiBTdHJpbmcoc3VjY2VzcyksXG4gICAgfSxcbiAgICB1bml0OiBvcHRpb25zLm1ldHJpYy51bml0ID8/ICdtaWxsaXNlY29uZHMnLFxuICAgIHNvdXJjZSxcbiAgfSk7XG59XG5cbiJdfQ==