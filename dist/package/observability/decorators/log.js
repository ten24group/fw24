"use strict";
/**
 * @Log Decorator - Lightweight logging without creating spans
 *
 * Creates standalone log events instead of spans. Perfect for:
 * - Informational messages
 * - Warnings/errors that don't need span context
 * - Debug statements
 * - Events that should be searchable but don't need timeline tracking
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Log({ level: 'warn', message: 'Suspicious order detected' })
 *   private checkFraud(order: Order) {
 *     // Log is emitted on method entry/exit
 *   }
 *
 *   @Log({
 *     level: 'info',
 *     extract: {
 *       finish: (ctx) => ({
 *         message: `Order processed: ${ctx.result.orderId}`,
 *         tags: { orderId: ctx.result.orderId },
 *         metrics: { itemCount: ctx.result.items.length }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Log emitted after method completes with dynamic data
 *   }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Log = Log;
const base_1 = require("../observers/base");
const decorator_utils_1 = require("./decorator-utils");
// ═══════════════════════════════════════════════════════════════════════════
// Decorator
// ═══════════════════════════════════════════════════════════════════════════
function Log(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        const methodName = String(propertyKey);
        const className = target.constructor.name;
        const source = (0, decorator_utils_1.resolveSource)(target, methodName, className);
        const operationName = `${className}.${methodName}`;
        const defaultLevel = options.level ?? 'info';
        const logStart = options.logStart ?? false;
        const logFinish = options.logFinish ?? true;
        const onErrorOnly = options.onErrorOnly ?? false;
        descriptor.value = function (...args) {
            const startTime = Date.now();
            // Emit start log if configured
            if (logStart && !onErrorOnly) {
                const startEnrichment = options.extract?.start?.({
                    instance: this,
                    args: args,
                    operationName,
                    source,
                });
                const logMessage = startEnrichment?.message ?? options.message ?? `${operationName} started`;
                (0, base_1.captureRecord)('LogDecorator', {
                    type: 'log',
                    level: startEnrichment?.level ?? defaultLevel,
                    operation: logMessage, // Message in operation field (like LogObserver)
                    source,
                    tags: {
                        ...options.tags,
                        ...startEnrichment?.tags,
                    },
                    metrics: startEnrichment?.metrics,
                    data: startEnrichment?.data,
                });
            }
            // Execute method and emit finish log
            const executeAndLog = (result, error) => {
                const durationMs = Date.now() - startTime;
                const success = !error;
                // Skip finish log if onErrorOnly and no error
                if (onErrorOnly && !error) {
                    if (error)
                        throw error;
                    return result;
                }
                if (logFinish) {
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
                    const logLevel = error
                        ? 'error'
                        : (finishEnrichment?.level ?? defaultLevel);
                    const logMessage = error
                        ? `${operationName} failed: ${error.message}`
                        : (finishEnrichment?.message ?? options.message ?? `${operationName} completed`);
                    (0, base_1.captureRecord)('LogDecorator', {
                        type: 'log',
                        level: logLevel,
                        operation: logMessage, // Message in operation field (like LogObserver)
                        source,
                        success,
                        error: error ? { type: error.name, message: error.message, stack: error.stack } : undefined,
                        tags: {
                            ...options.tags,
                            ...finishEnrichment?.tags,
                            'log.method_success': String(success),
                        },
                        metrics: {
                            'log.duration_ms': durationMs,
                            ...finishEnrichment?.metrics
                        },
                        data: finishEnrichment?.data,
                    });
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
                        .then((value) => executeAndLog(value))
                        .catch((error) => executeAndLog(undefined, error));
                }
                else {
                    return executeAndLog(result);
                }
            }
            catch (error) {
                return executeAndLog(undefined, error);
            }
        };
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy9sb2cudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWdDRzs7QUFxR0gsa0JBNEhDO0FBL05ELDRDQUFrRDtBQUNsRCx1REFBa0Q7QUE4RmxELDhFQUE4RTtBQUM5RSxZQUFZO0FBQ1osOEVBQThFO0FBRTlFLFNBQWdCLEdBQUcsQ0FDakIsVUFBaUQsRUFBRTtJQUVuRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sTUFBTSxHQUFHLElBQUEsK0JBQWEsRUFBQyxNQUFhLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ25FLE1BQU0sYUFBYSxHQUFHLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRW5ELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDO1FBQzdDLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDO1FBQzNDLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDO1FBQzVDLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLElBQUksS0FBSyxDQUFDO1FBRWpELFVBQVUsQ0FBQyxLQUFLLEdBQUcsVUFBcUIsR0FB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dEM7d0JBQ0QsT0FBTyxFQUFFOzRCQUNQLGlCQUFpQixFQUFFLFVBQVU7NEJBQzdCLEdBQUcsZ0JBQWdCLEVBQUUsT0FBTzt5QkFDN0I7d0JBQ0QsSUFBSSxFQUFFLGdCQUFnQixFQUFFLElBQUk7cUJBQzdCLENBQUMsQ0FBQztnQkFDTCxDQUFDO2dCQUVELElBQUksS0FBSztvQkFBRSxNQUFNLEtBQUssQ0FBQztnQkFDdkIsT0FBTyxNQUFNLENBQUM7WUFDaEIsQ0FBQyxDQUFDO1lBRUYsb0JBQW9CO1lBQ3BCLElBQUksQ0FBQztnQkFDSCxNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFFaEQsSUFBSSxNQUFNLElBQUksT0FBTyxNQUFNLENBQUMsSUFBSSxLQUFLLFVBQVUsRUFBRSxDQUFDO29CQUNoRCxPQUFPLE1BQU07eUJBQ1YsSUFBSSxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7eUJBQzFDLEtBQUssQ0FBQyxDQUFDLEtBQVksRUFBRSxFQUFFLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO2dCQUM5RCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sT0FBTyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQy9CLENBQUM7WUFDSCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixPQUFPLGFBQWEsQ0FBQyxTQUFTLEVBQUUsS0FBYyxDQUFDLENBQUM7WUFDbEQsQ0FBQztRQUNILENBQVEsQ0FBQztRQUVULE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBMb2cgRGVjb3JhdG9yIC0gTGlnaHR3ZWlnaHQgbG9nZ2luZyB3aXRob3V0IGNyZWF0aW5nIHNwYW5zXG4gKiBcbiAqIENyZWF0ZXMgc3RhbmRhbG9uZSBsb2cgZXZlbnRzIGluc3RlYWQgb2Ygc3BhbnMuIFBlcmZlY3QgZm9yOlxuICogLSBJbmZvcm1hdGlvbmFsIG1lc3NhZ2VzXG4gKiAtIFdhcm5pbmdzL2Vycm9ycyB0aGF0IGRvbid0IG5lZWQgc3BhbiBjb250ZXh0XG4gKiAtIERlYnVnIHN0YXRlbWVudHNcbiAqIC0gRXZlbnRzIHRoYXQgc2hvdWxkIGJlIHNlYXJjaGFibGUgYnV0IGRvbid0IG5lZWQgdGltZWxpbmUgdHJhY2tpbmdcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICBATG9nKHsgbGV2ZWw6ICd3YXJuJywgbWVzc2FnZTogJ1N1c3BpY2lvdXMgb3JkZXIgZGV0ZWN0ZWQnIH0pXG4gKiAgIHByaXZhdGUgY2hlY2tGcmF1ZChvcmRlcjogT3JkZXIpIHtcbiAqICAgICAvLyBMb2cgaXMgZW1pdHRlZCBvbiBtZXRob2QgZW50cnkvZXhpdFxuICogICB9XG4gKiAgIFxuICogICBATG9nKHtcbiAqICAgICBsZXZlbDogJ2luZm8nLFxuICogICAgIGV4dHJhY3Q6IHtcbiAqICAgICAgIGZpbmlzaDogKGN0eCkgPT4gKHtcbiAqICAgICAgICAgbWVzc2FnZTogYE9yZGVyIHByb2Nlc3NlZDogJHtjdHgucmVzdWx0Lm9yZGVySWR9YCxcbiAqICAgICAgICAgdGFnczogeyBvcmRlcklkOiBjdHgucmVzdWx0Lm9yZGVySWQgfSxcbiAqICAgICAgICAgbWV0cmljczogeyBpdGVtQ291bnQ6IGN0eC5yZXN1bHQuaXRlbXMubGVuZ3RoIH1cbiAqICAgICAgIH0pXG4gKiAgICAgfVxuICogICB9KVxuICogICBhc3luYyBwcm9jZXNzT3JkZXIob3JkZXI6IE9yZGVyKSB7XG4gKiAgICAgLy8gTG9nIGVtaXR0ZWQgYWZ0ZXIgbWV0aG9kIGNvbXBsZXRlcyB3aXRoIGR5bmFtaWMgZGF0YVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBjYXB0dXJlUmVjb3JkIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgcmVzb2x2ZVNvdXJjZSB9IGZyb20gJy4vZGVjb3JhdG9yLXV0aWxzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFR5cGVzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGludGVyZmFjZSBMb2dFbnJpY2htZW50IHtcbiAgLyoqIExvZyBtZXNzYWdlIChvdmVycmlkZXMgZGVmYXVsdCkgKi9cbiAgbWVzc2FnZT86IHN0cmluZztcbiAgLyoqIExvZyB0YWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBMb2cgbWV0cmljcyAqL1xuICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgLyoqIExvZyBkYXRhIHBheWxvYWQgKi9cbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogTG9nIGxldmVsIChvdmVycmlkZXMgZGVmYXVsdCkgKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nRXh0cmFjdENvbnRleHQ8VEluc3RhbmNlLCBUQXJncyBleHRlbmRzIHVua25vd25bXSwgVFJlc3VsdD4ge1xuICBpbnN0YW5jZTogVEluc3RhbmNlO1xuICBhcmdzOiBUQXJncztcbiAgb3BlcmF0aW9uTmFtZTogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbiAgLyoqIE9ubHkgYXZhaWxhYmxlIGluIGZpbmlzaCgpICovXG4gIHJlc3VsdD86IFRSZXN1bHQ7XG4gIC8qKiBPbmx5IGF2YWlsYWJsZSBpbiBmaW5pc2goKSAqL1xuICBlcnJvcj86IEVycm9yO1xuICAvKiogT25seSBhdmFpbGFibGUgaW4gZmluaXNoKCkgKi9cbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIC8qKiBPbmx5IGF2YWlsYWJsZSBpbiBmaW5pc2goKSAqL1xuICBkdXJhdGlvbk1zPzogbnVtYmVyO1xufVxuXG50eXBlIEJpdmFyaWFudEZuPFQgZXh0ZW5kcyAoLi4uYXJnczogYW55W10pID0+IGFueT4gPSB7XG4gIGJpdmFyaWFuY2VIYWNrOiBUO1xufVsgJ2JpdmFyaWFuY2VIYWNrJyBdO1xuXG5leHBvcnQgaW50ZXJmYWNlIExvZ0V4dHJhY3RvcjxUSW5zdGFuY2UsIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdLCBUUmVzdWx0PiB7XG4gIC8qKlxuICAgKiBFeHRyYWN0IGxvZyBkYXRhIGJlZm9yZSBtZXRob2QgZXhlY3V0aW9uLlxuICAgKi9cbiAgc3RhcnQ/OiBCaXZhcmlhbnRGbjwoY3R4OiBMb2dFeHRyYWN0Q29udGV4dDxUSW5zdGFuY2UsIFRBcmdzLCBUUmVzdWx0PikgPT4gTG9nRW5yaWNobWVudCB8IHZvaWQ+O1xuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGxvZyBkYXRhIGFmdGVyIG1ldGhvZCBleGVjdXRpb24uXG4gICAqL1xuICBmaW5pc2g/OiBCaXZhcmlhbnRGbjwoY3R4OiBMb2dFeHRyYWN0Q29udGV4dDxUSW5zdGFuY2UsIFRBcmdzLCBUUmVzdWx0PikgPT4gTG9nRW5yaWNobWVudCB8IHZvaWQ+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ09wdGlvbnM8VEluc3RhbmNlID0gdW5rbm93biwgVEFyZ3MgZXh0ZW5kcyB1bmtub3duW10gPSB1bmtub3duW10sIFRSZXN1bHQgPSB1bmtub3duPiB7XG4gIC8qKlxuICAgKiBMb2cgbGV2ZWwuXG4gICAqIERlZmF1bHQ6ICdpbmZvJ1xuICAgKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG5cbiAgLyoqXG4gICAqIFN0YXRpYyBsb2cgbWVzc2FnZS5cbiAgICogRm9yIGR5bmFtaWMgbWVzc2FnZXMsIHVzZSBleHRyYWN0LnN0YXJ0IG9yIGV4dHJhY3QuZmluaXNoLlxuICAgKi9cbiAgbWVzc2FnZT86IHN0cmluZztcblxuICAvKipcbiAgICogU3RhdGljIHRhZ3MuXG4gICAqIEZvciBkeW5hbWljIHRhZ3MsIHVzZSBleHRyYWN0LlxuICAgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgLyoqXG4gICAqIEV4dHJhY3Rpb24gQVBJIGZvciBkeW5hbWljIGxvZyBkYXRhLlxuICAgKi9cbiAgZXh0cmFjdD86IExvZ0V4dHJhY3RvcjxUSW5zdGFuY2UsIFRBcmdzLCBUUmVzdWx0PjtcblxuICAvKipcbiAgICogV2hldGhlciB0byBsb2cgb24gbWV0aG9kIHN0YXJ0LlxuICAgKiBEZWZhdWx0OiBmYWxzZVxuICAgKi9cbiAgbG9nU3RhcnQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGxvZyBvbiBtZXRob2QgZmluaXNoLlxuICAgKiBEZWZhdWx0OiB0cnVlXG4gICAqL1xuICBsb2dGaW5pc2g/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGxvZyBvbiBlcnJvcnMgb25seS5cbiAgICogRGVmYXVsdDogZmFsc2VcbiAgICovXG4gIG9uRXJyb3JPbmx5PzogYm9vbGVhbjtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBEZWNvcmF0b3Jcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgZnVuY3Rpb24gTG9nPFRJbnN0YW5jZSA9IHVua25vd24sIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdID0gdW5rbm93bltdLCBUUmVzdWx0ID0gdW5rbm93bj4oXG4gIG9wdGlvbnM6IExvZ09wdGlvbnM8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD4gPSB7fVxuKSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzICguLi5hcmdzOiBhbnlbXSkgPT4gYW55PihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG4gICAgaWYgKHR5cGVvZiBvcmlnaW5hbE1ldGhvZCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IFN0cmluZyhwcm9wZXJ0eUtleSk7XG4gICAgY29uc3QgY2xhc3NOYW1lID0gdGFyZ2V0LmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3Qgc291cmNlID0gcmVzb2x2ZVNvdXJjZSh0YXJnZXQgYXMgYW55LCBtZXRob2ROYW1lLCBjbGFzc05hbWUpO1xuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWUgPSBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgY29uc3QgZGVmYXVsdExldmVsID0gb3B0aW9ucy5sZXZlbCA/PyAnaW5mbyc7XG4gICAgY29uc3QgbG9nU3RhcnQgPSBvcHRpb25zLmxvZ1N0YXJ0ID8/IGZhbHNlO1xuICAgIGNvbnN0IGxvZ0ZpbmlzaCA9IG9wdGlvbnMubG9nRmluaXNoID8/IHRydWU7XG4gICAgY29uc3Qgb25FcnJvck9ubHkgPSBvcHRpb25zLm9uRXJyb3JPbmx5ID8/IGZhbHNlO1xuXG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICh0aGlzOiBhbnksIC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICAvLyBFbWl0IHN0YXJ0IGxvZyBpZiBjb25maWd1cmVkXG4gICAgICBpZiAobG9nU3RhcnQgJiYgIW9uRXJyb3JPbmx5KSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0RW5yaWNobWVudCA9IG9wdGlvbnMuZXh0cmFjdD8uc3RhcnQ/Lih7XG4gICAgICAgICAgaW5zdGFuY2U6IHRoaXMsXG4gICAgICAgICAgYXJnczogYXJncyBhcyBhbnksXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBzdGFydEVucmljaG1lbnQ/Lm1lc3NhZ2UgPz8gb3B0aW9ucy5tZXNzYWdlID8/IGAke29wZXJhdGlvbk5hbWV9IHN0YXJ0ZWRgO1xuXG4gICAgICAgIGNhcHR1cmVSZWNvcmQoJ0xvZ0RlY29yYXRvcicsIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogc3RhcnRFbnJpY2htZW50Py5sZXZlbCA/PyBkZWZhdWx0TGV2ZWwsXG4gICAgICAgICAgb3BlcmF0aW9uOiBsb2dNZXNzYWdlLCAgLy8gTWVzc2FnZSBpbiBvcGVyYXRpb24gZmllbGQgKGxpa2UgTG9nT2JzZXJ2ZXIpXG4gICAgICAgICAgc291cmNlLFxuICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgIC4uLm9wdGlvbnMudGFncyxcbiAgICAgICAgICAgIC4uLnN0YXJ0RW5yaWNobWVudD8udGFncyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1ldHJpY3M6IHN0YXJ0RW5yaWNobWVudD8ubWV0cmljcyxcbiAgICAgICAgICBkYXRhOiBzdGFydEVucmljaG1lbnQ/LmRhdGEsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBFeGVjdXRlIG1ldGhvZCBhbmQgZW1pdCBmaW5pc2ggbG9nXG4gICAgICBjb25zdCBleGVjdXRlQW5kTG9nID0gKHJlc3VsdDogYW55LCBlcnJvcj86IEVycm9yKSA9PiB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICBjb25zdCBzdWNjZXNzID0gIWVycm9yO1xuXG4gICAgICAgIC8vIFNraXAgZmluaXNoIGxvZyBpZiBvbkVycm9yT25seSBhbmQgbm8gZXJyb3JcbiAgICAgICAgaWYgKG9uRXJyb3JPbmx5ICYmICFlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvcikgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChsb2dGaW5pc2gpIHtcbiAgICAgICAgICBjb25zdCBmaW5pc2hFbnJpY2htZW50ID0gb3B0aW9ucy5leHRyYWN0Py5maW5pc2g/Lih7XG4gICAgICAgICAgICBpbnN0YW5jZTogdGhpcyxcbiAgICAgICAgICAgIGFyZ3M6IGFyZ3MgYXMgYW55LFxuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgIHJlc3VsdCxcbiAgICAgICAgICAgIGVycm9yLFxuICAgICAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBjb25zdCBsb2dMZXZlbCA9IGVycm9yXG4gICAgICAgICAgICA/ICdlcnJvcidcbiAgICAgICAgICAgIDogKGZpbmlzaEVucmljaG1lbnQ/LmxldmVsID8/IGRlZmF1bHRMZXZlbCk7XG5cbiAgICAgICAgICBjb25zdCBsb2dNZXNzYWdlID0gZXJyb3JcbiAgICAgICAgICAgID8gYCR7b3BlcmF0aW9uTmFtZX0gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgOiAoZmluaXNoRW5yaWNobWVudD8ubWVzc2FnZSA/PyBvcHRpb25zLm1lc3NhZ2UgPz8gYCR7b3BlcmF0aW9uTmFtZX0gY29tcGxldGVkYCk7XG5cbiAgICAgICAgICBjYXB0dXJlUmVjb3JkKCdMb2dEZWNvcmF0b3InLCB7XG4gICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgIGxldmVsOiBsb2dMZXZlbCxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogbG9nTWVzc2FnZSwgIC8vIE1lc3NhZ2UgaW4gb3BlcmF0aW9uIGZpZWxkIChsaWtlIExvZ09ic2VydmVyKVxuICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IHsgdHlwZTogZXJyb3IubmFtZSwgbWVzc2FnZTogZXJyb3IubWVzc2FnZSwgc3RhY2s6IGVycm9yLnN0YWNrIH0gOiB1bmRlZmluZWQsXG4gICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgIC4uLm9wdGlvbnMudGFncyxcbiAgICAgICAgICAgICAgLi4uZmluaXNoRW5yaWNobWVudD8udGFncyxcbiAgICAgICAgICAgICAgJ2xvZy5tZXRob2Rfc3VjY2Vzcyc6IFN0cmluZyhzdWNjZXNzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICdsb2cuZHVyYXRpb25fbXMnOiBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAuLi5maW5pc2hFbnJpY2htZW50Py5tZXRyaWNzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogZmluaXNoRW5yaWNobWVudD8uZGF0YSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlcnJvcikgdGhyb3cgZXJyb3I7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9O1xuXG4gICAgICAvLyBIYW5kbGUgYXN5bmMvc3luY1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgaWYgKHJlc3VsdCAmJiB0eXBlb2YgcmVzdWx0LnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgICAgICAudGhlbigodmFsdWU6IGFueSkgPT4gZXhlY3V0ZUFuZExvZyh2YWx1ZSkpXG4gICAgICAgICAgICAuY2F0Y2goKGVycm9yOiBFcnJvcikgPT4gZXhlY3V0ZUFuZExvZyh1bmRlZmluZWQsIGVycm9yKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGV4ZWN1dGVBbmRMb2cocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGV4ZWN1dGVBbmRMb2codW5kZWZpbmVkLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICB9XG4gICAgfSBhcyBhbnk7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cbiJdfQ==