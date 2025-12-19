"use strict";
/**
 * @Observed Decorator - Unified observability decorator
 *
 * Smart decorator that combines tracing, audit, and metrics without duplication.
 *
 * DEFAULT: If no options specified, defaults to { trace: true }
 *
 * DESIGN:
 * - trace: Creates span with duration/success/error (for debugging/performance)
 * - audit: Creates business/compliance log (only for entity operations)
 * - metric: Creates aggregatable counters/gauges (NOT timing if trace enabled!)
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   // Default - trace only
 *   @Observed()
 *   async fetchOrders(): Promise<Order[]> { }
 *
 *   // Explicit trace
 *   @Observed({ trace: true })
 *   async getOrder(id: string): Promise<Order> { }
 *
 *   // Business operation - trace + audit
 *   @Observed({
 *     trace: true,
 *     audit: { entityName: 'order' },
 *     metric: { type: 'counter', name: 'orders.created' }
 *   })
 *   async createOrder(order: Order): Promise<Order> { }
 *
 *   // Counter only (no trace)
 *   @Observed({
 *     metric: { type: 'counter', name: 'cache.hit' }
 *   })
 *   getCached(key: string): any { }
 * }
 * ```
 *
 * ANTI-PATTERNS:
 * ❌ DON'T: trace + timing metric (span already has duration!)
 * ❌ DON'T: audit every method (only business events!)
 * ✅ DO: trace for debugging, audit for compliance, counter for stats
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observed = Observed;
const context_1 = require("../context");
const audit_1 = require("../observers/audit");
const base_1 = require("../observers/base");
const metric_1 = require("../observers/metric");
const span_1 = require("../observers/span");
const payload_1 = require("../utils/payload");
const decorator_utils_1 = require("./decorator-utils");
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
        // Default to trace:true if nothing is specified
        if (!options.trace && !options.audit && !options.metric) {
            options.trace = true;
        }
        // Resolve source using shared utility (auto-detects if sourceType not provided)
        const source = (0, decorator_utils_1.resolveSource)(options.sourceType, className, methodName);
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
            let previousParentId = undefined;
            // Start span if tracing enabled
            if (options.trace) {
                const traceOptions = typeof options.trace === 'boolean' ? {} : options.trace;
                const dynamicAttributes = options.getAttributes ? options.getAttributes(this, args) : {};
                const spanOptions = {
                    level: traceOptions.level,
                    attributes: {
                        'code.function': methodName,
                        'code.namespace': className,
                        ...traceOptions.attributes,
                        ...dynamicAttributes,
                        ...(options.captureArgs && args.length > 0 && { args: (0, payload_1.safeSerialize)(args) }),
                    },
                    tags: { ...options.tags, ...traceOptions.attributes?.tags },
                    source,
                };
                // CRITICAL FIX: Snapshot the current parent BEFORE starting the span
                // This prevents sibling operations (e.g., multiple upserts in a loop) from forming a chain
                const ctx = (0, context_1.getCurrentContext)();
                previousParentId = ctx?.parentObservabilityLogId;
                span = span_1.SpanObserver.start(operationName, spanOptions);
                // Update context so child operations can link to this span
                (0, context_1.setParentObservabilityLogId)(span.id);
            }
            // Emit pre-execution metric (counter)
            if (options.metric && options.metric.type === 'counter') {
                const metricName = options.metric.name ?? `${operationName}.count`;
                metric_1.MetricObserver.increment(metricName, 1, {
                    tags: { ...options.tags, ...options.metric.tags },
                    source,
                });
            }
            // Execute method with automatic sync/async handling
            return (0, decorator_utils_1.executeWithHandlers)(originalMethod, this, args, (success, result, error) => {
                finishObservability({
                    span,
                    options,
                    operationName,
                    args,
                    result,
                    success,
                    error: error ? (0, base_1.normalizeError)(error) : undefined,
                    durationMs: Date.now() - startTime,
                    source,
                    previousParentId,
                });
            });
        };
        descriptor.value = wrappedMethod;
        return descriptor;
    };
}
/**
 * Finish all observability recording (span, audit, metrics)
 * Unified handler for both sync and async, success and error paths
 */
function finishObservability(params) {
    const { span, options, operationName, args, result, success, error, durationMs, source, previousParentId } = params;
    // End span (captures duration, success, error - no need for separate timing metric!)
    if (span) {
        if (success) {
            if (options.captureResult && result !== undefined) {
                span.setAttribute('result', (0, payload_1.safeSerialize)(result));
            }
            // Build end options with all extractors
            const endOptions = { success: true };
            // Extract attributes from result
            if (options.getResultAttributes && result !== undefined) {
                endOptions.attributes = options.getResultAttributes(result);
            }
            // Extract metrics from result (published as CloudWatch EMF metrics!)
            if (options.getMetrics && result !== undefined) {
                endOptions.metrics = options.getMetrics(result);
            }
            // Extract data from result (for audit-like structured info)
            if (options.getData && result !== undefined) {
                endOptions.data = options.getData(result);
            }
            span.end(endOptions);
        }
        else {
            // Error is already normalized in the callback
            span.end({ success: false, error: error });
        }
        // CRITICAL FIX: Restore the previous parent ID after span ends
        // This ensures sibling operations see the correct parent, not the just-completed span
        if (previousParentId !== undefined) {
            (0, context_1.setParentObservabilityLogId)(previousParentId);
        }
    }
    // Record audit ONLY if explicitly configured
    // Audit is for business/compliance events, not every traced method
    if (options.audit) {
        recordAudit({
            options,
            operationName,
            args,
            result,
            success,
            error,
            durationMs,
            source,
        });
    }
    // Record timing metric ONLY if:
    // 1. Metric is configured as timing type
    // 2. AND no span exists (span already captures duration)
    // This prevents duplicate duration recording
    if (options.metric?.type === 'timing' && !span) {
        recordTimingMetric({
            options,
            operationName,
            durationMs,
            success,
            source,
        });
    }
}
/**
 * Record audit event
 * NOTE: Caller must check if options.audit is enabled before calling this
 */
function recordAudit(params) {
    const { options, operationName, args, result, success, error, durationMs, source } = params;
    // options.audit is guaranteed to exist (caller checks), extract config
    const auditOptions = typeof options.audit === 'boolean' ? {} : (options.audit ?? {});
    // Build audit data
    let data = {
        success,
        durationMs,
    };
    // Capture args if requested
    const shouldCaptureArgs = auditOptions?.captureArgs ?? options.captureArgs ?? false;
    if (shouldCaptureArgs && args.length > 0) {
        data.args = (0, payload_1.safeSerialize)(args);
    }
    // Capture result if requested
    const shouldCaptureResult = auditOptions?.captureResult ?? options.captureResult ?? false;
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
        operation: auditOptions?.action ?? operationName,
        entityName: auditOptions?.entityName,
        data,
        level: error ? 'error' : (auditOptions?.level ?? 'info'),
        source,
        tags: options.tags,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL29ic2VydmVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTJDRzs7QUF1SEgsNEJBd0dDO0FBN05ELHdDQUE0RTtBQUM1RSw4Q0FBbUQ7QUFDbkQsNENBQW1EO0FBQ25ELGdEQUFxRDtBQUNyRCw0Q0FBOEU7QUFDOUUsOENBQWlEO0FBQ2pELHVEQUFtRjtBQTBHbkY7Ozs7R0FJRztBQUNILFNBQWdCLFFBQVEsQ0FBQyxVQUEyQixFQUFFO0lBQ3BELE9BQU8sVUFDTCxNQUFjLEVBQ2QsV0FBNEIsRUFDNUIsVUFBc0M7UUFFdEMsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUV4QyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pDLE9BQU8sVUFBVSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztRQUMxQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDdkMsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLElBQUksSUFBSSxHQUFHLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUVuRSxnREFBZ0Q7UUFDaEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3hELE9BQU8sQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDO1FBQ3ZCLENBQUM7UUFFRCxnRkFBZ0Y7UUFDaEYsTUFBTSxNQUFNLEdBQUcsSUFBQSwrQkFBYSxFQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFF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QU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLGNBQWM7UUFDM0MsTUFBTTtLQUNQLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBPYnNlcnZlZCBEZWNvcmF0b3IgLSBVbmlmaWVkIG9ic2VydmFiaWxpdHkgZGVjb3JhdG9yXG4gKiBcbiAqIFNtYXJ0IGRlY29yYXRvciB0aGF0IGNvbWJpbmVzIHRyYWNpbmcsIGF1ZGl0LCBhbmQgbWV0cmljcyB3aXRob3V0IGR1cGxpY2F0aW9uLlxuICogXG4gKiBERUZBVUxUOiBJZiBubyBvcHRpb25zIHNwZWNpZmllZCwgZGVmYXVsdHMgdG8geyB0cmFjZTogdHJ1ZSB9XG4gKiBcbiAqIERFU0lHTjpcbiAqIC0gdHJhY2U6IENyZWF0ZXMgc3BhbiB3aXRoIGR1cmF0aW9uL3N1Y2Nlc3MvZXJyb3IgKGZvciBkZWJ1Z2dpbmcvcGVyZm9ybWFuY2UpXG4gKiAtIGF1ZGl0OiBDcmVhdGVzIGJ1c2luZXNzL2NvbXBsaWFuY2UgbG9nIChvbmx5IGZvciBlbnRpdHkgb3BlcmF0aW9ucylcbiAqIC0gbWV0cmljOiBDcmVhdGVzIGFnZ3JlZ2F0YWJsZSBjb3VudGVycy9nYXVnZXMgKE5PVCB0aW1pbmcgaWYgdHJhY2UgZW5hYmxlZCEpXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgT3JkZXJTZXJ2aWNlIHtcbiAqICAgLy8gRGVmYXVsdCAtIHRyYWNlIG9ubHlcbiAqICAgQE9ic2VydmVkKClcbiAqICAgYXN5bmMgZmV0Y2hPcmRlcnMoKTogUHJvbWlzZTxPcmRlcltdPiB7IH1cbiAqICAgXG4gKiAgIC8vIEV4cGxpY2l0IHRyYWNlXG4gKiAgIEBPYnNlcnZlZCh7IHRyYWNlOiB0cnVlIH0pXG4gKiAgIGFzeW5jIGdldE9yZGVyKGlkOiBzdHJpbmcpOiBQcm9taXNlPE9yZGVyPiB7IH1cbiAqICAgXG4gKiAgIC8vIEJ1c2luZXNzIG9wZXJhdGlvbiAtIHRyYWNlICsgYXVkaXRcbiAqICAgQE9ic2VydmVkKHsgXG4gKiAgICAgdHJhY2U6IHRydWUsXG4gKiAgICAgYXVkaXQ6IHsgZW50aXR5TmFtZTogJ29yZGVyJyB9LFxuICogICAgIG1ldHJpYzogeyB0eXBlOiAnY291bnRlcicsIG5hbWU6ICdvcmRlcnMuY3JlYXRlZCcgfVxuICogICB9KVxuICogICBhc3luYyBjcmVhdGVPcmRlcihvcmRlcjogT3JkZXIpOiBQcm9taXNlPE9yZGVyPiB7IH1cbiAqICAgXG4gKiAgIC8vIENvdW50ZXIgb25seSAobm8gdHJhY2UpXG4gKiAgIEBPYnNlcnZlZCh7IFxuICogICAgIG1ldHJpYzogeyB0eXBlOiAnY291bnRlcicsIG5hbWU6ICdjYWNoZS5oaXQnIH1cbiAqICAgfSlcbiAqICAgZ2V0Q2FjaGVkKGtleTogc3RyaW5nKTogYW55IHsgfVxuICogfVxuICogYGBgXG4gKiBcbiAqIEFOVEktUEFUVEVSTlM6XG4gKiDinYwgRE9OJ1Q6IHRyYWNlICsgdGltaW5nIG1ldHJpYyAoc3BhbiBhbHJlYWR5IGhhcyBkdXJhdGlvbiEpXG4gKiDinYwgRE9OJ1Q6IGF1ZGl0IGV2ZXJ5IG1ldGhvZCAob25seSBidXNpbmVzcyBldmVudHMhKVxuICog4pyFIERPOiB0cmFjZSBmb3IgZGVidWdnaW5nLCBhdWRpdCBmb3IgY29tcGxpYW5jZSwgY291bnRlciBmb3Igc3RhdHNcbiAqL1xuXG5pbXBvcnQgeyBzZXRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsIGdldEN1cnJlbnRDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dCc7XG5pbXBvcnQgeyBBdWRpdE9ic2VydmVyIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2F1ZGl0JztcbmltcG9ydCB7IG5vcm1hbGl6ZUVycm9yIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgTWV0cmljT2JzZXJ2ZXIgfSBmcm9tICcuLi9vYnNlcnZlcnMvbWV0cmljJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgU3Bhbk9wdGlvbnMsIFNwYW5FbmRPcHRpb25zIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHsgc2FmZVNlcmlhbGl6ZSB9IGZyb20gJy4uL3V0aWxzL3BheWxvYWQnO1xuaW1wb3J0IHsgZXhlY3V0ZVdpdGhIYW5kbGVycywgU291cmNlVHlwZSwgcmVzb2x2ZVNvdXJjZSB9IGZyb20gJy4vZGVjb3JhdG9yLXV0aWxzJztcblxuZXhwb3J0IGludGVyZmFjZSBPYnNlcnZlZE9wdGlvbnMge1xuICAvKiogTWV0aG9kIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDcmVhdGUgc3BhbiBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICAgKiBTcGFucyBjYXB0dXJlIGR1cmF0aW9uLCBzdWNjZXNzLCBlcnJvciBhdXRvbWF0aWNhbGx5LlxuICAgKiBVc2UgZm9yOiBkZWJ1Z2dpbmcsIHBlcmZvcm1hbmNlIGFuYWx5c2lzLCBkaXN0cmlidXRlZCB0cmFjaW5nXG4gICAqIFxuICAgKiBERUZBVUxUOiB0cnVlIGlmIG5vIG9wdGlvbnMgYXJlIHNwZWNpZmllZCAodHJhY2UsIGF1ZGl0LCBtZXRyaWMgYWxsIHVuZGVmaW5lZClcbiAgICovXG4gIHRyYWNlPzogYm9vbGVhbiB8IHtcbiAgICBsZXZlbD86IFNwYW5PcHRpb25zWyAnbGV2ZWwnIF07XG4gICAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9O1xuXG4gIC8qKlxuICAgKiBDcmVhdGUgYXVkaXQgcmVjb3JkIGZvciBidXNpbmVzcy9jb21wbGlhbmNlIHRyYWNraW5nXG4gICAqIFVzZSBmb3I6IGVudGl0eSBvcGVyYXRpb25zLCBzZWN1cml0eSBldmVudHMsIGNvbXBsaWFuY2UgcmVxdWlyZW1lbnRzXG4gICAqIE5vdGU6IE9ubHkgdXNlIGZvciBhY3R1YWwgYnVzaW5lc3MgZXZlbnRzLCBub3QgZXZlcnkgdHJhY2VkIG1ldGhvZFxuICAgKiBcbiAgICogREVGQVVMVDogZmFsc2VcbiAgICovXG4gIGF1ZGl0PzogYm9vbGVhbiB8IHtcbiAgICBhY3Rpb24/OiBzdHJpbmc7XG4gICAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gICAgY2FwdHVyZUFyZ3M/OiBib29sZWFuO1xuICAgIGNhcHR1cmVSZXN1bHQ/OiBib29sZWFuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBSZWNvcmQgbWV0cmljIGZvciBhZ2dyZWdhdGlvbi9kYXNoYm9hcmRzXG4gICAqIC0gY291bnRlcjogQ291bnQgbWV0aG9kIGludm9jYXRpb25zICh1c2VmdWwhKVxuICAgKiAtIGdhdWdlOiBTZXQgYSBzcGVjaWZpYyB2YWx1ZSAodXNlZnVsISlcbiAgICogLSB0aW1pbmc6IER1cmF0aW9uIGluIG1zIChET04nVCBVU0UgaWYgdHJhY2U6dHJ1ZSAtIHNwYW4gYWxyZWFkeSBjYXB0dXJlcyBkdXJhdGlvbiEpXG4gICAqIFxuICAgKiBERUZBVUxUOiB1bmRlZmluZWQgKG5vIG1ldHJpY3MpXG4gICAqL1xuICBtZXRyaWM/OiB7XG4gICAgbmFtZT86IHN0cmluZztcbiAgICB0eXBlPzogJ2NvdW50ZXInIHwgJ2dhdWdlJyB8ICd0aW1pbmcnO1xuICAgIHVuaXQ/OiBzdHJpbmc7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH07XG5cbiAgLyoqIFxuICAgKiBTb3VyY2UgdHlwZSAoYXV0by1kZXRlY3RlZCBpZiBub3QgcHJvdmlkZWQpXG4gICAqIEF1dG8tZGV0ZWN0aW9uIHJ1bGVzOlxuICAgKiAtICpDb250cm9sbGVyIOKGkiAnY29udHJvbGxlcicg4oaSIFwiYXBpOkNvbnRyb2xsZXJOYW1lLm1ldGhvZFwiXG4gICAqIC0gKlNlcnZpY2Ug4oaSICdzZXJ2aWNlJyDihpIgXCJzZXJ2aWNlOlNlcnZpY2VOYW1lLm1ldGhvZFwiXG4gICAqIC0gKlF1ZXVlLCAqUXVldWVIYW5kbGVyIOKGkiAncXVldWUnIOKGkiBcInF1ZXVlOlF1ZXVlTmFtZS5tZXRob2RcIlxuICAgKiAtICpUYXNrLCAqVGFza0hhbmRsZXIg4oaSICd0YXNrJyDihpIgXCJ0YXNrOlRhc2tOYW1lLm1ldGhvZFwiXG4gICAqIC0gRGVmYXVsdCDihpIgJ2hhbmRsZXInIOKGkiBcIkNsYXNzTmFtZS5tZXRob2RcIlxuICAgKi9cbiAgc291cmNlVHlwZT86IFNvdXJjZVR5cGU7XG5cbiAgLyoqIFRhZ3MgYXBwbGllZCB0byBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgLyoqIENhcHR1cmUgbWV0aG9kIGFyZ3VtZW50cyAqL1xuICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG5cbiAgLyoqIENhcHR1cmUgcmV0dXJuIHZhbHVlICovXG4gIGNhcHR1cmVSZXN1bHQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBDb25kaXRpb25hbGx5IGVuYWJsZS9kaXNhYmxlIG9ic2VydmFiaWxpdHkuXG4gICAqIC0gU3RhdGljIGJvb2xlYW46IGBlbmFibGVkOiBmYWxzZWAgdG8gZGlzYWJsZVxuICAgKiAtIER5bmFtaWMgZnVuY3Rpb246IGBlbmFibGVkOiAoKSA9PiBzb21lQ29uZGl0aW9uKClgXG4gICAqIEZ1bmN0aW9uIHJlY2VpdmVzIG5vIGFyZ3VtZW50cyBidXQgY2FuIGFjY2VzcyBnZXRDdXJyZW50Q29udGV4dCgpIGludGVybmFsbHkuXG4gICAqIERlZmF1bHQ6IHRydWUgKGVuYWJsZWQpXG4gICAqL1xuICBlbmFibGVkPzogYm9vbGVhbiB8ICgoKSA9PiBib29sZWFuKTtcblxuICAvKipcbiAgICogQ2FsbGJhY2sgdG8gZXh0cmFjdCBjb250ZXh0LXNwZWNpZmljIGF0dHJpYnV0ZXMgYXQgcnVudGltZS5cbiAgICogQ2FsbGVkIHdpdGggdGhlIGluc3RhbmNlIChgdGhpc2ApIGFuZCBtZXRob2QgYXJndW1lbnRzLlxuICAgKiBSZXR1cm5zIGF0dHJpYnV0ZXMgdG8gYWRkIHRvIHRoZSBzcGFuLlxuICAgKi9cbiAgZ2V0QXR0cmlidXRlcz86IChpbnN0YW5jZTogYW55LCBhcmdzOiBhbnlbXSkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIHRvIGV4dHJhY3QgYXR0cmlidXRlcyBmcm9tIHRoZSByZXN1bHQgYWZ0ZXIgZXhlY3V0aW9uLlxuICAgKiBDYWxsZWQgd2l0aCB0aGUgbWV0aG9kJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBSZXR1cm5zIGF0dHJpYnV0ZXMgdG8gYWRkIHRvIHRoZSBzcGFuIGJlZm9yZSBpdCBlbmRzLlxuICAgKi9cbiAgZ2V0UmVzdWx0QXR0cmlidXRlcz86IChyZXN1bHQ6IGFueSkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIHRvIGV4dHJhY3QgbWV0cmljcyBmcm9tIHRoZSByZXN1bHQgYWZ0ZXIgZXhlY3V0aW9uLlxuICAgKiBDYWxsZWQgd2l0aCB0aGUgbWV0aG9kJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBSZXR1cm5zIG1ldHJpY3MgdG8gZW1iZWQgaW4gdGhlIHNwYW4gKHB1Ymxpc2hlZCBhcyBDbG91ZFdhdGNoIEVNRiBtZXRyaWNzKS5cbiAgICovXG4gIGdldE1ldHJpY3M/OiAocmVzdWx0OiBhbnkpID0+IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIHRvIGV4dHJhY3QgZGF0YSBmcm9tIHRoZSByZXN1bHQgYWZ0ZXIgZXhlY3V0aW9uLlxuICAgKiBDYWxsZWQgd2l0aCB0aGUgbWV0aG9kJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBSZXR1cm5zIGRhdGEgdG8gZW1iZWQgaW4gdGhlIHNwYW4gKGZvciBhdWRpdC1saWtlIHN0cnVjdHVyZWQgaW5mb3JtYXRpb24pLlxuICAgKi9cbiAgZ2V0RGF0YT86IChyZXN1bHQ6IGFueSkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogVW5pZmllZCBvYnNlcnZhYmlsaXR5IGRlY29yYXRvciB0aGF0IGNvbWJpbmVzIHRyYWNpbmcsIGF1ZGl0aW5nLCBhbmQgbWV0cmljc1xuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIE9ic2VydmFiaWxpdHkgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gT2JzZXJ2ZWQob3B0aW9uczogT2JzZXJ2ZWRPcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcblxuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRhcmdldC5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBTdHJpbmcocHJvcGVydHlLZXkpO1xuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWUgPSBvcHRpb25zLm5hbWUgPz8gYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcblxuICAgIC8vIERlZmF1bHQgdG8gdHJhY2U6dHJ1ZSBpZiBub3RoaW5nIGlzIHNwZWNpZmllZFxuICAgIGlmICghb3B0aW9ucy50cmFjZSAmJiAhb3B0aW9ucy5hdWRpdCAmJiAhb3B0aW9ucy5tZXRyaWMpIHtcbiAgICAgIG9wdGlvbnMudHJhY2UgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgc291cmNlIHVzaW5nIHNoYXJlZCB1dGlsaXR5IChhdXRvLWRldGVjdHMgaWYgc291cmNlVHlwZSBub3QgcHJvdmlkZWQpXG4gICAgY29uc3Qgc291cmNlID0gcmVzb2x2ZVNvdXJjZShvcHRpb25zLnNvdXJjZVR5cGUsIGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG5cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgLy8gQ2hlY2sgaWYgb2JzZXJ2YWJpbGl0eSBpcyBlbmFibGVkIChzdGF0aWMgb3IgZHluYW1pYylcbiAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBpc0VuYWJsZWQgPSB0eXBlb2Ygb3B0aW9ucy5lbmFibGVkID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgPyBvcHRpb25zLmVuYWJsZWQoKVxuICAgICAgICAgIDogb3B0aW9ucy5lbmFibGVkO1xuXG4gICAgICAgIGlmICghaXNFbmFibGVkKSB7XG4gICAgICAgICAgLy8gT2JzZXJ2YWJpbGl0eSBkaXNhYmxlZCAtIGV4ZWN1dGUgbWV0aG9kIHdpdGhvdXQgaW5zdHJ1bWVudGF0aW9uXG4gICAgICAgICAgcmV0dXJuIChvcmlnaW5hbE1ldGhvZCBhcyAoLi4uYTogdW5rbm93bltdKSA9PiB1bmtub3duKS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgbGV0IHNwYW46IFJldHVyblR5cGU8dHlwZW9mIFNwYW5PYnNlcnZlci5zdGFydD4gfCBudWxsID0gbnVsbDtcbiAgICAgIGxldCBwcmV2aW91c1BhcmVudElkOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIFN0YXJ0IHNwYW4gaWYgdHJhY2luZyBlbmFibGVkXG4gICAgICBpZiAob3B0aW9ucy50cmFjZSkge1xuICAgICAgICBjb25zdCB0cmFjZU9wdGlvbnMgPSB0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ2Jvb2xlYW4nID8ge30gOiBvcHRpb25zLnRyYWNlO1xuXG4gICAgICAgIGNvbnN0IGR5bmFtaWNBdHRyaWJ1dGVzID0gb3B0aW9ucy5nZXRBdHRyaWJ1dGVzID8gb3B0aW9ucy5nZXRBdHRyaWJ1dGVzKHRoaXMsIGFyZ3MpIDoge307XG5cbiAgICAgICAgY29uc3Qgc3Bhbk9wdGlvbnM6IFNwYW5PcHRpb25zID0ge1xuICAgICAgICAgIGxldmVsOiB0cmFjZU9wdGlvbnMubGV2ZWwsXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgJ2NvZGUuZnVuY3Rpb24nOiBtZXRob2ROYW1lLFxuICAgICAgICAgICAgJ2NvZGUubmFtZXNwYWNlJzogY2xhc3NOYW1lLFxuICAgICAgICAgICAgLi4udHJhY2VPcHRpb25zLmF0dHJpYnV0ZXMsXG4gICAgICAgICAgICAuLi5keW5hbWljQXR0cmlidXRlcyxcbiAgICAgICAgICAgIC4uLihvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCAmJiB7IGFyZ3M6IHNhZmVTZXJpYWxpemUoYXJncykgfSksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB0YWdzOiB7IC4uLm9wdGlvbnMudGFncywgLi4udHJhY2VPcHRpb25zLmF0dHJpYnV0ZXM/LnRhZ3MgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCB9LFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDUklUSUNBTCBGSVg6IFNuYXBzaG90IHRoZSBjdXJyZW50IHBhcmVudCBCRUZPUkUgc3RhcnRpbmcgdGhlIHNwYW5cbiAgICAgICAgLy8gVGhpcyBwcmV2ZW50cyBzaWJsaW5nIG9wZXJhdGlvbnMgKGUuZy4sIG11bHRpcGxlIHVwc2VydHMgaW4gYSBsb29wKSBmcm9tIGZvcm1pbmcgYSBjaGFpblxuICAgICAgICBjb25zdCBjdHggPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgICBwcmV2aW91c1BhcmVudElkID0gY3R4Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG5cbiAgICAgICAgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChvcGVyYXRpb25OYW1lLCBzcGFuT3B0aW9ucyk7XG4gICAgICAgIC8vIFVwZGF0ZSBjb250ZXh0IHNvIGNoaWxkIG9wZXJhdGlvbnMgY2FuIGxpbmsgdG8gdGhpcyBzcGFuXG4gICAgICAgIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZChzcGFuLmlkKTtcbiAgICAgIH1cblxuICAgICAgLy8gRW1pdCBwcmUtZXhlY3V0aW9uIG1ldHJpYyAoY291bnRlcilcbiAgICAgIGlmIChvcHRpb25zLm1ldHJpYyAmJiBvcHRpb25zLm1ldHJpYy50eXBlID09PSAnY291bnRlcicpIHtcbiAgICAgICAgY29uc3QgbWV0cmljTmFtZSA9IG9wdGlvbnMubWV0cmljLm5hbWUgPz8gYCR7b3BlcmF0aW9uTmFtZX0uY291bnRgO1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQobWV0cmljTmFtZSwgMSwge1xuICAgICAgICAgIHRhZ3M6IHsgLi4ub3B0aW9ucy50YWdzLCAuLi5vcHRpb25zLm1ldHJpYy50YWdzIH0sXG4gICAgICAgICAgc291cmNlLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRXhlY3V0ZSBtZXRob2Qgd2l0aCBhdXRvbWF0aWMgc3luYy9hc3luYyBoYW5kbGluZ1xuICAgICAgcmV0dXJuIGV4ZWN1dGVXaXRoSGFuZGxlcnMoXG4gICAgICAgIG9yaWdpbmFsTWV0aG9kIGFzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24sXG4gICAgICAgIHRoaXMsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIChzdWNjZXNzLCByZXN1bHQsIGVycm9yKSA9PiB7XG4gICAgICAgICAgZmluaXNoT2JzZXJ2YWJpbGl0eSh7XG4gICAgICAgICAgICBzcGFuLFxuICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgcmVzdWx0LFxuICAgICAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IG5vcm1hbGl6ZUVycm9yKGVycm9yKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgICBzb3VyY2UsXG4gICAgICAgICAgICBwcmV2aW91c1BhcmVudElkLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICApO1xuICAgIH07XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IHdyYXBwZWRNZXRob2QgYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4vKipcbiAqIEZpbmlzaCBhbGwgb2JzZXJ2YWJpbGl0eSByZWNvcmRpbmcgKHNwYW4sIGF1ZGl0LCBtZXRyaWNzKVxuICogVW5pZmllZCBoYW5kbGVyIGZvciBib3RoIHN5bmMgYW5kIGFzeW5jLCBzdWNjZXNzIGFuZCBlcnJvciBwYXRoc1xuICovXG5mdW5jdGlvbiBmaW5pc2hPYnNlcnZhYmlsaXR5KHBhcmFtczoge1xuICBzcGFuOiBSZXR1cm5UeXBlPHR5cGVvZiBTcGFuT2JzZXJ2ZXIuc3RhcnQ+IHwgbnVsbDtcbiAgb3B0aW9uczogT2JzZXJ2ZWRPcHRpb25zO1xuICBvcGVyYXRpb25OYW1lOiBzdHJpbmc7XG4gIGFyZ3M6IHVua25vd25bXTtcbiAgcmVzdWx0PzogdW5rbm93bjtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgZXJyb3I/OiBFcnJvcjtcbiAgZHVyYXRpb25NczogbnVtYmVyO1xuICBzb3VyY2U6IHN0cmluZztcbiAgcHJldmlvdXNQYXJlbnRJZD86IHN0cmluZztcbn0pOiB2b2lkIHtcbiAgY29uc3QgeyBzcGFuLCBvcHRpb25zLCBvcGVyYXRpb25OYW1lLCBhcmdzLCByZXN1bHQsIHN1Y2Nlc3MsIGVycm9yLCBkdXJhdGlvbk1zLCBzb3VyY2UsIHByZXZpb3VzUGFyZW50SWQgfSA9IHBhcmFtcztcblxuICAvLyBFbmQgc3BhbiAoY2FwdHVyZXMgZHVyYXRpb24sIHN1Y2Nlc3MsIGVycm9yIC0gbm8gbmVlZCBmb3Igc2VwYXJhdGUgdGltaW5nIG1ldHJpYyEpXG4gIGlmIChzcGFuKSB7XG4gICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ3Jlc3VsdCcsIHNhZmVTZXJpYWxpemUocmVzdWx0KSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEJ1aWxkIGVuZCBvcHRpb25zIHdpdGggYWxsIGV4dHJhY3RvcnNcbiAgICAgIGNvbnN0IGVuZE9wdGlvbnM6IFNwYW5FbmRPcHRpb25zID0geyBzdWNjZXNzOiB0cnVlIH07XG5cbiAgICAgIC8vIEV4dHJhY3QgYXR0cmlidXRlcyBmcm9tIHJlc3VsdFxuICAgICAgaWYgKG9wdGlvbnMuZ2V0UmVzdWx0QXR0cmlidXRlcyAmJiByZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBlbmRPcHRpb25zLmF0dHJpYnV0ZXMgPSBvcHRpb25zLmdldFJlc3VsdEF0dHJpYnV0ZXMocmVzdWx0KTtcbiAgICAgIH1cblxuICAgICAgLy8gRXh0cmFjdCBtZXRyaWNzIGZyb20gcmVzdWx0IChwdWJsaXNoZWQgYXMgQ2xvdWRXYXRjaCBFTUYgbWV0cmljcyEpXG4gICAgICBpZiAob3B0aW9ucy5nZXRNZXRyaWNzICYmIHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGVuZE9wdGlvbnMubWV0cmljcyA9IG9wdGlvbnMuZ2V0TWV0cmljcyhyZXN1bHQpO1xuICAgICAgfVxuXG4gICAgICAvLyBFeHRyYWN0IGRhdGEgZnJvbSByZXN1bHQgKGZvciBhdWRpdC1saWtlIHN0cnVjdHVyZWQgaW5mbylcbiAgICAgIGlmIChvcHRpb25zLmdldERhdGEgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZW5kT3B0aW9ucy5kYXRhID0gb3B0aW9ucy5nZXREYXRhKHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIHNwYW4uZW5kKGVuZE9wdGlvbnMpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBFcnJvciBpcyBhbHJlYWR5IG5vcm1hbGl6ZWQgaW4gdGhlIGNhbGxiYWNrXG4gICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyb3IgYXMgRXJyb3IgfSk7XG4gICAgfVxuXG4gICAgLy8gQ1JJVElDQUwgRklYOiBSZXN0b3JlIHRoZSBwcmV2aW91cyBwYXJlbnQgSUQgYWZ0ZXIgc3BhbiBlbmRzXG4gICAgLy8gVGhpcyBlbnN1cmVzIHNpYmxpbmcgb3BlcmF0aW9ucyBzZWUgdGhlIGNvcnJlY3QgcGFyZW50LCBub3QgdGhlIGp1c3QtY29tcGxldGVkIHNwYW5cbiAgICBpZiAocHJldmlvdXNQYXJlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBzZXRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQocHJldmlvdXNQYXJlbnRJZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVjb3JkIGF1ZGl0IE9OTFkgaWYgZXhwbGljaXRseSBjb25maWd1cmVkXG4gIC8vIEF1ZGl0IGlzIGZvciBidXNpbmVzcy9jb21wbGlhbmNlIGV2ZW50cywgbm90IGV2ZXJ5IHRyYWNlZCBtZXRob2RcbiAgaWYgKG9wdGlvbnMuYXVkaXQpIHtcbiAgICByZWNvcmRBdWRpdCh7XG4gICAgICBvcHRpb25zLFxuICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgIGFyZ3MsXG4gICAgICByZXN1bHQsXG4gICAgICBzdWNjZXNzLFxuICAgICAgZXJyb3IsXG4gICAgICBkdXJhdGlvbk1zLFxuICAgICAgc291cmNlLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmVjb3JkIHRpbWluZyBtZXRyaWMgT05MWSBpZjpcbiAgLy8gMS4gTWV0cmljIGlzIGNvbmZpZ3VyZWQgYXMgdGltaW5nIHR5cGVcbiAgLy8gMi4gQU5EIG5vIHNwYW4gZXhpc3RzIChzcGFuIGFscmVhZHkgY2FwdHVyZXMgZHVyYXRpb24pXG4gIC8vIFRoaXMgcHJldmVudHMgZHVwbGljYXRlIGR1cmF0aW9uIHJlY29yZGluZ1xuICBpZiAob3B0aW9ucy5tZXRyaWM/LnR5cGUgPT09ICd0aW1pbmcnICYmICFzcGFuKSB7XG4gICAgcmVjb3JkVGltaW5nTWV0cmljKHtcbiAgICAgIG9wdGlvbnMsXG4gICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgZHVyYXRpb25NcyxcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICBzb3VyY2UsXG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZWNvcmQgYXVkaXQgZXZlbnRcbiAqIE5PVEU6IENhbGxlciBtdXN0IGNoZWNrIGlmIG9wdGlvbnMuYXVkaXQgaXMgZW5hYmxlZCBiZWZvcmUgY2FsbGluZyB0aGlzXG4gKi9cbmZ1bmN0aW9uIHJlY29yZEF1ZGl0KHBhcmFtczoge1xuICBvcHRpb25zOiBPYnNlcnZlZE9wdGlvbnM7XG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZztcbiAgYXJnczogdW5rbm93bltdO1xuICByZXN1bHQ/OiB1bmtub3duO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBlcnJvcj86IEVycm9yO1xuICBkdXJhdGlvbk1zOiBudW1iZXI7XG4gIHNvdXJjZTogc3RyaW5nO1xufSk6IHZvaWQge1xuICBjb25zdCB7IG9wdGlvbnMsIG9wZXJhdGlvbk5hbWUsIGFyZ3MsIHJlc3VsdCwgc3VjY2VzcywgZXJyb3IsIGR1cmF0aW9uTXMsIHNvdXJjZSB9ID0gcGFyYW1zO1xuXG4gIC8vIG9wdGlvbnMuYXVkaXQgaXMgZ3VhcmFudGVlZCB0byBleGlzdCAoY2FsbGVyIGNoZWNrcyksIGV4dHJhY3QgY29uZmlnXG4gIGNvbnN0IGF1ZGl0T3B0aW9ucyA9IHR5cGVvZiBvcHRpb25zLmF1ZGl0ID09PSAnYm9vbGVhbicgPyB7fSA6IChvcHRpb25zLmF1ZGl0ID8/IHt9KTtcblxuICAvLyBCdWlsZCBhdWRpdCBkYXRhXG4gIGxldCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICBzdWNjZXNzLFxuICAgIGR1cmF0aW9uTXMsXG4gIH07XG5cbiAgLy8gQ2FwdHVyZSBhcmdzIGlmIHJlcXVlc3RlZFxuICBjb25zdCBzaG91bGRDYXB0dXJlQXJncyA9IGF1ZGl0T3B0aW9ucz8uY2FwdHVyZUFyZ3MgPz8gb3B0aW9ucy5jYXB0dXJlQXJncyA/PyBmYWxzZTtcbiAgaWYgKHNob3VsZENhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCkge1xuICAgIGRhdGEuYXJncyA9IHNhZmVTZXJpYWxpemUoYXJncyk7XG4gIH1cblxuICAvLyBDYXB0dXJlIHJlc3VsdCBpZiByZXF1ZXN0ZWRcbiAgY29uc3Qgc2hvdWxkQ2FwdHVyZVJlc3VsdCA9IGF1ZGl0T3B0aW9ucz8uY2FwdHVyZVJlc3VsdCA/PyBvcHRpb25zLmNhcHR1cmVSZXN1bHQgPz8gZmFsc2U7XG4gIGlmIChzaG91bGRDYXB0dXJlUmVzdWx0ICYmIHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZGF0YS5yZXN1bHQgPSBzYWZlU2VyaWFsaXplKHJlc3VsdCk7XG4gIH1cblxuICAvLyBBZGQgZXJyb3IgaW5mbyBpZiBmYWlsZWRcbiAgaWYgKGVycm9yKSB7XG4gICAgZGF0YS5lcnJvciA9IHtcbiAgICAgIHR5cGU6IGVycm9yLm5hbWUsXG4gICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIH07XG4gIH1cblxuICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgb3BlcmF0aW9uOiBhdWRpdE9wdGlvbnM/LmFjdGlvbiA/PyBvcGVyYXRpb25OYW1lLFxuICAgIGVudGl0eU5hbWU6IGF1ZGl0T3B0aW9ucz8uZW50aXR5TmFtZSxcbiAgICBkYXRhLFxuICAgIGxldmVsOiBlcnJvciA/ICdlcnJvcicgOiAoYXVkaXRPcHRpb25zPy5sZXZlbCA/PyAnaW5mbycpLFxuICAgIHNvdXJjZSxcbiAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gIH0pO1xufVxuXG4vKipcbiAqIFJlY29yZCB0aW1pbmcgbWV0cmljIGlmIGNvbmZpZ3VyZWRcbiAqL1xuZnVuY3Rpb24gcmVjb3JkVGltaW5nTWV0cmljKHBhcmFtczoge1xuICBvcHRpb25zOiBPYnNlcnZlZE9wdGlvbnM7XG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZztcbiAgZHVyYXRpb25NczogbnVtYmVyO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBzb3VyY2U6IHN0cmluZztcbn0pOiB2b2lkIHtcbiAgY29uc3QgeyBvcHRpb25zLCBvcGVyYXRpb25OYW1lLCBkdXJhdGlvbk1zLCBzdWNjZXNzLCBzb3VyY2UgfSA9IHBhcmFtcztcblxuICBpZiAoIW9wdGlvbnMubWV0cmljIHx8IG9wdGlvbnMubWV0cmljLnR5cGUgIT09ICd0aW1pbmcnKSByZXR1cm47XG5cbiAgY29uc3QgbWV0cmljTmFtZSA9IG9wdGlvbnMubWV0cmljLm5hbWUgPz8gYCR7b3BlcmF0aW9uTmFtZX0uZHVyYXRpb25gO1xuXG4gIE1ldHJpY09ic2VydmVyLnRpbWluZyhtZXRyaWNOYW1lLCBkdXJhdGlvbk1zLCB7XG4gICAgdGFnczoge1xuICAgICAgLi4ub3B0aW9ucy50YWdzLFxuICAgICAgLi4ub3B0aW9ucy5tZXRyaWMudGFncyxcbiAgICAgIHN1Y2Nlc3M6IFN0cmluZyhzdWNjZXNzKSxcbiAgICB9LFxuICAgIHVuaXQ6IG9wdGlvbnMubWV0cmljLnVuaXQgPz8gJ21pbGxpc2Vjb25kcycsXG4gICAgc291cmNlLFxuICB9KTtcbn1cblxuIl19