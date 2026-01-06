"use strict";
/**
 * @Metric Decorator - Lightweight metric tracking
 *
 * Records metrics (counters, timings, gauges) without creating spans.
 * Perfect for:
 * - Tracking method execution counts
 * - Recording timing/duration metrics
 * - Counting errors/successes
 * - Business metrics (items processed, orders completed, etc.)
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Metric({ name: 'orders.processed', type: 'counter' })
 *   async processOrder(order: Order) {
 *     // Increments orders.processed counter on each call
 *   }
 *
 *   @Metric({
 *     name: 'orders.processing_time',
 *     type: 'timing',
 *     extract: {
 *       finish: (ctx) => ({
 *         tags: { orderType: ctx.args[0].type }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Records processing duration with orderType tag
 *   }
 *
 *   @Metric({
 *     extract: {
 *       finish: (ctx) => ({
 *         name: `orders.items.${ctx.result.status}`,
 *         value: ctx.result.items.length,
 *         tags: { status: ctx.result.status }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Dynamic metric name and value based on result
 *   }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Metric = Metric;
const metric_1 = require("../observers/metric");
const decorator_utils_1 = require("./decorator-utils");
// ═══════════════════════════════════════════════════════════════════════════
// Decorator
// ═══════════════════════════════════════════════════════════════════════════
function Metric(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        const methodName = String(propertyKey);
        const className = target.constructor.name;
        const source = (0, decorator_utils_1.resolveSource)(target, methodName, className);
        const operationName = `${className}.${methodName}`;
        const metricType = options.type ?? 'counter';
        const defaultMetricName = options.name ?? operationName.replace(/\./g, '_').toLowerCase();
        const defaultLevel = options.level ?? 'info';
        const recordStart = options.recordStart ?? false;
        const recordFinish = options.recordFinish ?? true;
        const trackSuccessError = options.trackSuccessError ?? false;
        const incrementBy = options.incrementBy ?? 1;
        descriptor.value = function (...args) {
            const startTime = Date.now();
            // Record start metric if configured
            if (recordStart && metricType === 'counter') {
                const startEnrichment = options.extract?.start?.({
                    instance: this,
                    args: args,
                    operationName,
                    source,
                });
                const metricName = startEnrichment?.name ?? `${defaultMetricName}.start`;
                metric_1.MetricObserver.increment(metricName, incrementBy, {
                    tags: { ...options.tags, ...startEnrichment?.tags },
                    level: startEnrichment?.level ?? defaultLevel,
                    unit: startEnrichment?.unit ?? options.unit,
                });
            }
            // Execute method and record finish metric
            const executeAndRecord = (result, error) => {
                const durationMs = Date.now() - startTime;
                const success = !error;
                if (recordFinish) {
                    const finishEnrichment = options.extract?.finish?.({
                        instance: this,
                        args: args,
                        operationName,
                        source,
                        result,
                        error,
                        success,
                        durationMs,
                    });
                    let metricName = finishEnrichment?.name ?? defaultMetricName;
                    // Add success/error suffix if tracking
                    if (trackSuccessError) {
                        metricName = `${metricName}.${success ? 'success' : 'error'}`;
                    }
                    const metricTags = {
                        ...options.tags,
                        ...finishEnrichment?.tags,
                        ...(trackSuccessError ? {} : { success: String(success) }),
                    };
                    const metricLevel = error ? 'error' : (finishEnrichment?.level ?? defaultLevel);
                    const metricUnit = finishEnrichment?.unit ?? options.unit;
                    switch (metricType) {
                        case 'counter':
                            metric_1.MetricObserver.increment(metricName, finishEnrichment?.value ?? incrementBy, {
                                tags: metricTags,
                                level: metricLevel,
                                unit: metricUnit,
                            });
                            break;
                        case 'timing':
                            metric_1.MetricObserver.timing(metricName, durationMs, {
                                tags: metricTags,
                                level: metricLevel,
                                unit: metricUnit ?? 'ms',
                            });
                            break;
                        case 'gauge':
                            const gaugeValue = finishEnrichment?.value ?? durationMs;
                            metric_1.MetricObserver.gauge(metricName, gaugeValue, {
                                tags: metricTags,
                                level: metricLevel,
                                unit: metricUnit,
                            });
                            break;
                    }
                }
                if (error)
                    throw error;
                return result;
            };
            // Handle async/sync
            try {
                const result = originalMethod.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result
                        .then((value) => executeAndRecord(value))
                        .catch((error) => executeAndRecord(undefined, error));
                }
                else {
                    return executeAndRecord(result);
                }
            }
            catch (error) {
                return executeAndRecord(undefined, error);
            }
        };
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0cmljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9tZXRyaWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E2Q0c7O0FBMkhILHdCQWtJQztBQTNQRCxnREFBcUQ7QUFDckQsdURBQWtEO0FBb0hsRCw4RUFBOEU7QUFDOUUsWUFBWTtBQUNaLDhFQUE4RTtBQUU5RSxTQUFnQixNQUFNLENBQ3BCLFVBQW9ELEVBQUU7SUFFdEQsT0FBTyxVQUNMLE1BQWMsRUFDZCxXQUE0QixFQUM1QixVQUFzQztRQUV0QyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBQ3hDLElBQUksT0FBTyxjQUFjLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDekMsT0FBTyxVQUFVLENBQUM7UUFDcEIsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztRQUMxQyxNQUFNLE1BQU0sR0FBRyxJQUFBLCtCQUFhLEVBQUMsTUFBYSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNuRSxNQUFNLGFBQWEsR0FBRyxHQUFHLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUVuRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsSUFBSSxJQUFJLFNBQVMsQ0FBQztRQUM3QyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxJQUFJLElBQUksYUFBYSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDMUYsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUM7UUFDN0MsTUFBTSxXQUFX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SyxDQUFDLENBQUMsQ0FBQztnQkFDakUsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE9BQU8sZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ2xDLENBQUM7WUFDSCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixPQUFPLGdCQUFnQixDQUFDLFNBQVMsRUFBRSxLQUFjLENBQUMsQ0FBQztZQUNyRCxDQUFDO1FBQ0gsQ0FBUSxDQUFDO1FBRVQsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQE1ldHJpYyBEZWNvcmF0b3IgLSBMaWdodHdlaWdodCBtZXRyaWMgdHJhY2tpbmdcbiAqIFxuICogUmVjb3JkcyBtZXRyaWNzIChjb3VudGVycywgdGltaW5ncywgZ2F1Z2VzKSB3aXRob3V0IGNyZWF0aW5nIHNwYW5zLlxuICogUGVyZmVjdCBmb3I6XG4gKiAtIFRyYWNraW5nIG1ldGhvZCBleGVjdXRpb24gY291bnRzXG4gKiAtIFJlY29yZGluZyB0aW1pbmcvZHVyYXRpb24gbWV0cmljc1xuICogLSBDb3VudGluZyBlcnJvcnMvc3VjY2Vzc2VzXG4gKiAtIEJ1c2luZXNzIG1ldHJpY3MgKGl0ZW1zIHByb2Nlc3NlZCwgb3JkZXJzIGNvbXBsZXRlZCwgZXRjLilcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICBATWV0cmljKHsgbmFtZTogJ29yZGVycy5wcm9jZXNzZWQnLCB0eXBlOiAnY291bnRlcicgfSlcbiAqICAgYXN5bmMgcHJvY2Vzc09yZGVyKG9yZGVyOiBPcmRlcikge1xuICogICAgIC8vIEluY3JlbWVudHMgb3JkZXJzLnByb2Nlc3NlZCBjb3VudGVyIG9uIGVhY2ggY2FsbFxuICogICB9XG4gKiAgIFxuICogICBATWV0cmljKHsgXG4gKiAgICAgbmFtZTogJ29yZGVycy5wcm9jZXNzaW5nX3RpbWUnLFxuICogICAgIHR5cGU6ICd0aW1pbmcnLFxuICogICAgIGV4dHJhY3Q6IHtcbiAqICAgICAgIGZpbmlzaDogKGN0eCkgPT4gKHtcbiAqICAgICAgICAgdGFnczogeyBvcmRlclR5cGU6IGN0eC5hcmdzWzBdLnR5cGUgfVxuICogICAgICAgfSlcbiAqICAgICB9XG4gKiAgIH0pXG4gKiAgIGFzeW5jIHByb2Nlc3NPcmRlcihvcmRlcjogT3JkZXIpIHtcbiAqICAgICAvLyBSZWNvcmRzIHByb2Nlc3NpbmcgZHVyYXRpb24gd2l0aCBvcmRlclR5cGUgdGFnXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBNZXRyaWMoe1xuICogICAgIGV4dHJhY3Q6IHtcbiAqICAgICAgIGZpbmlzaDogKGN0eCkgPT4gKHtcbiAqICAgICAgICAgbmFtZTogYG9yZGVycy5pdGVtcy4ke2N0eC5yZXN1bHQuc3RhdHVzfWAsXG4gKiAgICAgICAgIHZhbHVlOiBjdHgucmVzdWx0Lml0ZW1zLmxlbmd0aCxcbiAqICAgICAgICAgdGFnczogeyBzdGF0dXM6IGN0eC5yZXN1bHQuc3RhdHVzIH1cbiAqICAgICAgIH0pXG4gKiAgICAgfVxuICogICB9KVxuICogICBhc3luYyBwcm9jZXNzT3JkZXIob3JkZXI6IE9yZGVyKSB7XG4gKiAgICAgLy8gRHluYW1pYyBtZXRyaWMgbmFtZSBhbmQgdmFsdWUgYmFzZWQgb24gcmVzdWx0XG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IE1ldHJpY09ic2VydmVyIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL21ldHJpYyc7XG5pbXBvcnQgeyByZXNvbHZlU291cmNlIH0gZnJvbSAnLi9kZWNvcmF0b3ItdXRpbHMnO1xuaW1wb3J0IHR5cGUgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gVHlwZXNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgaW50ZXJmYWNlIE1ldHJpY0VucmljaG1lbnQge1xuICAvKiogTWV0cmljIG5hbWUgKG92ZXJyaWRlcyBkZWZhdWx0KSAqL1xuICBuYW1lPzogc3RyaW5nO1xuICAvKiogTWV0cmljIHZhbHVlIChvdmVycmlkZXMgZGVmYXVsdCkgKi9cbiAgdmFsdWU/OiBudW1iZXI7XG4gIC8qKiBNZXRyaWMgdGFncyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIE1ldHJpYyB1bml0IChvdmVycmlkZXMgZGVmYXVsdCkgKi9cbiAgdW5pdD86IHN0cmluZztcbiAgLyoqIE1ldHJpYyBsZXZlbCAob3ZlcnJpZGVzIGRlZmF1bHQpICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1ldHJpY0V4dHJhY3RDb250ZXh0PFRJbnN0YW5jZSwgVEFyZ3MgZXh0ZW5kcyB1bmtub3duW10sIFRSZXN1bHQ+IHtcbiAgaW5zdGFuY2U6IFRJbnN0YW5jZTtcbiAgYXJnczogVEFyZ3M7XG4gIG9wZXJhdGlvbk5hbWU6IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG4gIC8qKiBPbmx5IGF2YWlsYWJsZSBpbiBmaW5pc2goKSAqL1xuICByZXN1bHQ/OiBUUmVzdWx0O1xuICAvKiogT25seSBhdmFpbGFibGUgaW4gZmluaXNoKCkgKi9cbiAgZXJyb3I/OiBFcnJvcjtcbiAgLyoqIE9ubHkgYXZhaWxhYmxlIGluIGZpbmlzaCgpICovXG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuICAvKiogT25seSBhdmFpbGFibGUgaW4gZmluaXNoKCkgKi9cbiAgZHVyYXRpb25Ncz86IG51bWJlcjtcbn1cblxudHlwZSBCaXZhcmlhbnRGbjxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+ID0ge1xuICBiaXZhcmlhbmNlSGFjazogVDtcbn1bICdiaXZhcmlhbmNlSGFjaycgXTtcblxuZXhwb3J0IGludGVyZmFjZSBNZXRyaWNFeHRyYWN0b3I8VEluc3RhbmNlLCBUQXJncyBleHRlbmRzIHVua25vd25bXSwgVFJlc3VsdD4ge1xuICAvKipcbiAgICogRXh0cmFjdCBtZXRyaWMgZGF0YSBiZWZvcmUgbWV0aG9kIGV4ZWN1dGlvbi5cbiAgICovXG4gIHN0YXJ0PzogQml2YXJpYW50Rm48KGN0eDogTWV0cmljRXh0cmFjdENvbnRleHQ8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD4pID0+IE1ldHJpY0VucmljaG1lbnQgfCB2b2lkPjtcblxuICAvKipcbiAgICogRXh0cmFjdCBtZXRyaWMgZGF0YSBhZnRlciBtZXRob2QgZXhlY3V0aW9uLlxuICAgKi9cbiAgZmluaXNoPzogQml2YXJpYW50Rm48KGN0eDogTWV0cmljRXh0cmFjdENvbnRleHQ8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD4pID0+IE1ldHJpY0VucmljaG1lbnQgfCB2b2lkPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXRyaWNPcHRpb25zPFRJbnN0YW5jZSA9IHVua25vd24sIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdID0gdW5rbm93bltdLCBUUmVzdWx0ID0gdW5rbm93bj4ge1xuICAvKipcbiAgICogTWV0cmljIG5hbWUuXG4gICAqIERlZmF1bHQ6IGNsYXNzTmFtZS5tZXRob2ROYW1lXG4gICAqIENhbiB1c2UgcGF0dGVybnM6ICdvcmRlcnMucHJvY2Vzc2VkJywgJ2FwaS5sYXRlbmN5JywgZXRjLlxuICAgKi9cbiAgbmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogTWV0cmljIHR5cGUuXG4gICAqIC0gJ2NvdW50ZXInOiBJbmNyZW1lbnRzIG9uIGVhY2ggY2FsbCAoZGVmYXVsdClcbiAgICogLSAndGltaW5nJzogUmVjb3JkcyBtZXRob2QgZHVyYXRpb24gaW4gbXNcbiAgICogLSAnZ2F1Z2UnOiBSZWNvcmRzIGEgc3BlY2lmaWMgdmFsdWUgKHVzZSBleHRyYWN0LmZpbmlzaCB0byBwcm92aWRlIHZhbHVlKVxuICAgKi9cbiAgdHlwZT86ICdjb3VudGVyJyB8ICd0aW1pbmcnIHwgJ2dhdWdlJztcblxuICAvKipcbiAgICogTWV0cmljIHVuaXQgKGZvciB0aW1pbmcvZ2F1Z2UpLlxuICAgKiBFeGFtcGxlczogJ21zJywgJ2J5dGVzJywgJ2l0ZW1zJywgJ3BlcmNlbnRhZ2UnXG4gICAqL1xuICB1bml0Pzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTdGF0aWMgdGFncy5cbiAgICogRm9yIGR5bmFtaWMgdGFncywgdXNlIGV4dHJhY3QuXG4gICAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcblxuICAvKipcbiAgICogTWV0cmljIGxldmVsLlxuICAgKiBEZWZhdWx0OiAnaW5mbydcbiAgICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuXG4gIC8qKlxuICAgKiBFeHRyYWN0aW9uIEFQSSBmb3IgZHluYW1pYyBtZXRyaWMgZGF0YS5cbiAgICovXG4gIGV4dHJhY3Q/OiBNZXRyaWNFeHRyYWN0b3I8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD47XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcmVjb3JkIG1ldHJpYyBvbiBtZXRob2Qgc3RhcnQuXG4gICAqIERlZmF1bHQ6IGZhbHNlIChvbmx5IG9uIGZpbmlzaClcbiAgICovXG4gIHJlY29yZFN0YXJ0PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogV2hldGhlciB0byByZWNvcmQgbWV0cmljIG9uIG1ldGhvZCBmaW5pc2guXG4gICAqIERlZmF1bHQ6IHRydWVcbiAgICovXG4gIHJlY29yZEZpbmlzaD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcmVjb3JkIHN1Y2Nlc3MvZXJyb3IgbWV0cmljcyBzZXBhcmF0ZWx5LlxuICAgKiBDcmVhdGVzIC5zdWNjZXNzIGFuZCAuZXJyb3Igc3VmZml4ZWQgbWV0cmljcy5cbiAgICogRGVmYXVsdDogZmFsc2VcbiAgICovXG4gIHRyYWNrU3VjY2Vzc0Vycm9yPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogSW5jcmVtZW50IHZhbHVlIGZvciBjb3VudGVyIG1ldHJpY3MuXG4gICAqIERlZmF1bHQ6IDFcbiAgICovXG4gIGluY3JlbWVudEJ5PzogbnVtYmVyO1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIERlY29yYXRvclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBmdW5jdGlvbiBNZXRyaWM8VEluc3RhbmNlID0gdW5rbm93biwgVEFyZ3MgZXh0ZW5kcyB1bmtub3duW10gPSB1bmtub3duW10sIFRSZXN1bHQgPSB1bmtub3duPihcbiAgb3B0aW9uczogTWV0cmljT3B0aW9uczxUSW5zdGFuY2UsIFRBcmdzLCBUUmVzdWx0PiA9IHt9XG4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBzb3VyY2UgPSByZXNvbHZlU291cmNlKHRhcmdldCBhcyBhbnksIG1ldGhvZE5hbWUsIGNsYXNzTmFtZSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICBjb25zdCBtZXRyaWNUeXBlID0gb3B0aW9ucy50eXBlID8/ICdjb3VudGVyJztcbiAgICBjb25zdCBkZWZhdWx0TWV0cmljTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBvcGVyYXRpb25OYW1lLnJlcGxhY2UoL1xcLi9nLCAnXycpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZGVmYXVsdExldmVsID0gb3B0aW9ucy5sZXZlbCA/PyAnaW5mbyc7XG4gICAgY29uc3QgcmVjb3JkU3RhcnQgPSBvcHRpb25zLnJlY29yZFN0YXJ0ID8/IGZhbHNlO1xuICAgIGNvbnN0IHJlY29yZEZpbmlzaCA9IG9wdGlvbnMucmVjb3JkRmluaXNoID8/IHRydWU7XG4gICAgY29uc3QgdHJhY2tTdWNjZXNzRXJyb3IgPSBvcHRpb25zLnRyYWNrU3VjY2Vzc0Vycm9yID8/IGZhbHNlO1xuICAgIGNvbnN0IGluY3JlbWVudEJ5ID0gb3B0aW9ucy5pbmNyZW1lbnRCeSA/PyAxO1xuXG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICh0aGlzOiBhbnksIC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICAvLyBSZWNvcmQgc3RhcnQgbWV0cmljIGlmIGNvbmZpZ3VyZWRcbiAgICAgIGlmIChyZWNvcmRTdGFydCAmJiBtZXRyaWNUeXBlID09PSAnY291bnRlcicpIHtcbiAgICAgICAgY29uc3Qgc3RhcnRFbnJpY2htZW50ID0gb3B0aW9ucy5leHRyYWN0Py5zdGFydD8uKHtcbiAgICAgICAgICBpbnN0YW5jZTogdGhpcyxcbiAgICAgICAgICBhcmdzOiBhcmdzIGFzIGFueSxcbiAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgbWV0cmljTmFtZSA9IHN0YXJ0RW5yaWNobWVudD8ubmFtZSA/PyBgJHtkZWZhdWx0TWV0cmljTmFtZX0uc3RhcnRgO1xuXG4gICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudChtZXRyaWNOYW1lLCBpbmNyZW1lbnRCeSwge1xuICAgICAgICAgIHRhZ3M6IHsgLi4ub3B0aW9ucy50YWdzLCAuLi5zdGFydEVucmljaG1lbnQ/LnRhZ3MgfSxcbiAgICAgICAgICBsZXZlbDogc3RhcnRFbnJpY2htZW50Py5sZXZlbCA/PyBkZWZhdWx0TGV2ZWwsXG4gICAgICAgICAgdW5pdDogc3RhcnRFbnJpY2htZW50Py51bml0ID8/IG9wdGlvbnMudW5pdCxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4ZWN1dGUgbWV0aG9kIGFuZCByZWNvcmQgZmluaXNoIG1ldHJpY1xuICAgICAgY29uc3QgZXhlY3V0ZUFuZFJlY29yZCA9IChyZXN1bHQ6IGFueSwgZXJyb3I/OiBFcnJvcikgPT4ge1xuICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgY29uc3Qgc3VjY2VzcyA9ICFlcnJvcjtcblxuICAgICAgICBpZiAocmVjb3JkRmluaXNoKSB7XG4gICAgICAgICAgY29uc3QgZmluaXNoRW5yaWNobWVudCA9IG9wdGlvbnMuZXh0cmFjdD8uZmluaXNoPy4oe1xuICAgICAgICAgICAgaW5zdGFuY2U6IHRoaXMsXG4gICAgICAgICAgICBhcmdzOiBhcmdzIGFzIGFueSxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgICAgICBzb3VyY2UsXG4gICAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgICBlcnJvcixcbiAgICAgICAgICAgIHN1Y2Nlc3MsXG4gICAgICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgbGV0IG1ldHJpY05hbWUgPSBmaW5pc2hFbnJpY2htZW50Py5uYW1lID8/IGRlZmF1bHRNZXRyaWNOYW1lO1xuXG4gICAgICAgICAgLy8gQWRkIHN1Y2Nlc3MvZXJyb3Igc3VmZml4IGlmIHRyYWNraW5nXG4gICAgICAgICAgaWYgKHRyYWNrU3VjY2Vzc0Vycm9yKSB7XG4gICAgICAgICAgICBtZXRyaWNOYW1lID0gYCR7bWV0cmljTmFtZX0uJHtzdWNjZXNzID8gJ3N1Y2Nlc3MnIDogJ2Vycm9yJ31gO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IG1ldHJpY1RhZ3MgPSB7XG4gICAgICAgICAgICAuLi5vcHRpb25zLnRhZ3MsXG4gICAgICAgICAgICAuLi5maW5pc2hFbnJpY2htZW50Py50YWdzLFxuICAgICAgICAgICAgLi4uKHRyYWNrU3VjY2Vzc0Vycm9yID8ge30gOiB7IHN1Y2Nlc3M6IFN0cmluZyhzdWNjZXNzKSB9KSxcbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgY29uc3QgbWV0cmljTGV2ZWwgPSBlcnJvciA/ICdlcnJvcicgOiAoZmluaXNoRW5yaWNobWVudD8ubGV2ZWwgPz8gZGVmYXVsdExldmVsKTtcbiAgICAgICAgICBjb25zdCBtZXRyaWNVbml0ID0gZmluaXNoRW5yaWNobWVudD8udW5pdCA/PyBvcHRpb25zLnVuaXQ7XG5cbiAgICAgICAgICBzd2l0Y2ggKG1ldHJpY1R5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2NvdW50ZXInOlxuICAgICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQobWV0cmljTmFtZSwgZmluaXNoRW5yaWNobWVudD8udmFsdWUgPz8gaW5jcmVtZW50QnksIHtcbiAgICAgICAgICAgICAgICB0YWdzOiBtZXRyaWNUYWdzLFxuICAgICAgICAgICAgICAgIGxldmVsOiBtZXRyaWNMZXZlbCxcbiAgICAgICAgICAgICAgICB1bml0OiBtZXRyaWNVbml0LFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ3RpbWluZyc6XG4gICAgICAgICAgICAgIE1ldHJpY09ic2VydmVyLnRpbWluZyhtZXRyaWNOYW1lLCBkdXJhdGlvbk1zLCB7XG4gICAgICAgICAgICAgICAgdGFnczogbWV0cmljVGFncyxcbiAgICAgICAgICAgICAgICBsZXZlbDogbWV0cmljTGV2ZWwsXG4gICAgICAgICAgICAgICAgdW5pdDogbWV0cmljVW5pdCA/PyAnbXMnLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgYnJlYWs7XG5cbiAgICAgICAgICAgIGNhc2UgJ2dhdWdlJzpcbiAgICAgICAgICAgICAgY29uc3QgZ2F1Z2VWYWx1ZSA9IGZpbmlzaEVucmljaG1lbnQ/LnZhbHVlID8/IGR1cmF0aW9uTXM7XG4gICAgICAgICAgICAgIE1ldHJpY09ic2VydmVyLmdhdWdlKG1ldHJpY05hbWUsIGdhdWdlVmFsdWUsIHtcbiAgICAgICAgICAgICAgICB0YWdzOiBtZXRyaWNUYWdzLFxuICAgICAgICAgICAgICAgIGxldmVsOiBtZXRyaWNMZXZlbCxcbiAgICAgICAgICAgICAgICB1bml0OiBtZXRyaWNVbml0LFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVycm9yKSB0aHJvdyBlcnJvcjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG5cbiAgICAgIC8vIEhhbmRsZSBhc3luYy9zeW5jXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcblxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgICAgIC50aGVuKCh2YWx1ZTogYW55KSA9PiBleGVjdXRlQW5kUmVjb3JkKHZhbHVlKSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3I6IEVycm9yKSA9PiBleGVjdXRlQW5kUmVjb3JkKHVuZGVmaW5lZCwgZXJyb3IpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gZXhlY3V0ZUFuZFJlY29yZChyZXN1bHQpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gZXhlY3V0ZUFuZFJlY29yZCh1bmRlZmluZWQsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIH1cbiAgICB9IGFzIGFueTtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuIl19