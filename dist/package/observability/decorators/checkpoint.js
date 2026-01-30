"use strict";
/**
 * @Checkpoint Decorator - Lightweight checkpoint tracking without creating spans
 *
 * Adds checkpoints to the CURRENT span (if one exists) instead of creating new spans.
 * Perfect for tracking steps within an operation without span overhead.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed() // Creates span
 *   async processOrder(order: Order) {
 *     await this.validateOrder(order);    // Checkpoint added
 *     await this.chargePayment(order);    // Checkpoint added
 *     await this.shipOrder(order);        // Checkpoint added
 *     return order;
 *   }
 *
 *   @Checkpoint('order.validation')
 *   private async validateOrder(order: Order) {
 *     // Just adds checkpoint, no span created
 *   }
 *
 *   @Checkpoint({
 *     name: 'order.payment',
 *     extract: {
 *       start: (ctx) => ({
 *         tags: { paymentMethod: ctx.args[0].paymentMethod }
 *       }),
 *       finish: (ctx) => ({
 *         metrics: { amount: ctx.args[0].amount }
 *       })
 *     }
 *   })
 *   private async chargePayment(order: Order) {
 *     // Checkpoint with extracted context
 *   }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Checkpoint = Checkpoint;
const span_1 = require("../observers/span");
const decorator_utils_1 = require("./decorator-utils");
function Checkpoint(nameOrOptions) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        // Parse options
        const options = typeof nameOrOptions === 'string'
            ? { name: nameOrOptions }
            : (nameOrOptions ?? {});
        const methodName = String(propertyKey);
        const className = target.constructor.name;
        const source = (0, decorator_utils_1.resolveSource)(target, methodName, className);
        const operationName = options.name ?? `${className}.${methodName}`;
        const checkpointStart = options.checkpointStart ?? false;
        const checkpointFinish = options.checkpointFinish ?? true;
        const warnIfNoSpan = options.warnIfNoSpan ?? true;
        descriptor.value = function (...args) {
            const startTime = Date.now();
            // Get current span (if exists)
            const span = span_1.SpanObserver.getCurrentSpan();
            if (!span) {
                if (warnIfNoSpan) {
                    console.warn(`[@Checkpoint] No active span for checkpoint: ${operationName}. ` +
                        `Did you forget @Observed on the parent method?`);
                }
                // No span - just execute method normally
                return originalMethod.apply(this, args);
            }
            // Add start checkpoint if configured
            if (checkpointStart) {
                const startEnrichment = options.extract?.start?.({
                    instance: this,
                    args,
                    operationName,
                    source,
                });
                span.checkpoint(`${operationName}.start`, {
                    tags: { ...options.tags, ...startEnrichment?.tags },
                    metrics: startEnrichment?.metrics,
                    data: startEnrichment?.data,
                });
            }
            // Execute method
            const executeAndCheckpoint = (result, error) => {
                const durationMs = Date.now() - startTime;
                const success = !error;
                if (checkpointFinish) {
                    const finishEnrichment = options.extract?.finish?.({
                        instance: this,
                        args,
                        operationName,
                        source,
                        result,
                        error,
                        success,
                        durationMs,
                    });
                    const checkpointName = checkpointStart
                        ? `${operationName}.finish`
                        : operationName;
                    span.checkpoint(checkpointName, {
                        tags: {
                            ...options.tags,
                            ...finishEnrichment?.tags,
                            ...(error ? { 'checkpoint.error': 'true' } : {})
                        },
                        metrics: {
                            'checkpoint.duration_ms': durationMs,
                            ...finishEnrichment?.metrics
                        },
                        data: finishEnrichment?.data,
                        error: error ? error : undefined,
                    });
                }
                // Re-throw error if present
                if (error)
                    throw error;
                return result;
            };
            // Handle async/sync
            try {
                const result = originalMethod.apply(this, args);
                if (result && typeof result.then === 'function') {
                    // Async method
                    return result
                        .then((value) => executeAndCheckpoint(value))
                        .catch((error) => executeAndCheckpoint(undefined, error));
                }
                else {
                    // Sync method
                    return executeAndCheckpoint(result);
                }
            }
            catch (error) {
                return executeAndCheckpoint(undefined, error);
            }
        };
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hlY2twb2ludC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvY2hlY2twb2ludC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0NHOztBQTRISCxnQ0F1SEM7QUFqUEQsNENBQWlEO0FBQ2pELHVEQUFrRDtBQXlIbEQsU0FBZ0IsVUFBVSxDQUFDLGFBQTBDO0lBQ25FLE9BQU8sVUFDTCxNQUFjLEVBQ2QsV0FBNEIsRUFDNUIsVUFBc0M7UUFFdEMsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUN4QyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pDLE9BQU8sVUFBVSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxnQkFBZ0I7UUFDaEIsTUFBTSxPQUFPLEdBQXNCLE9BQU8sYUFBYSxLQUFLLFFBQVE7WUFDbEUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN6QixDQUFDLENBQUMsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDLENBQUM7UUFFMUIsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sTUFBTSxHQUFHLElBQUEsK0JBQWEsRUFBQyxNQUFhLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ25FLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxJQUFJLElBQUksR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7UUFFbkUsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLGVBQWUsSUFBSSxLQUFLLENBQUM7UUFDekQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLElBQUksSUFB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LENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUVoRCxJQUFJLE1BQU0sSUFBSSxPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7b0JBQ2hELGVBQWU7b0JBQ2YsT0FBTyxNQUFNO3lCQUNWLElBQUksQ0FBQyxDQUFDLEtBQVUsRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7eUJBQ2pELEtBQUssQ0FBQyxDQUFDLEtBQVksRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7Z0JBQ3JFLENBQUM7cUJBQU0sQ0FBQztvQkFDTixjQUFjO29CQUNkLE9BQU8sb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ3RDLENBQUM7WUFDSCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixPQUFPLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxLQUFjLENBQUMsQ0FBQztZQUN6RCxDQUFDO1FBQ0gsQ0FBUSxDQUFDO1FBRVQsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQENoZWNrcG9pbnQgRGVjb3JhdG9yIC0gTGlnaHR3ZWlnaHQgY2hlY2twb2ludCB0cmFja2luZyB3aXRob3V0IGNyZWF0aW5nIHNwYW5zXG4gKiBcbiAqIEFkZHMgY2hlY2twb2ludHMgdG8gdGhlIENVUlJFTlQgc3BhbiAoaWYgb25lIGV4aXN0cykgaW5zdGVhZCBvZiBjcmVhdGluZyBuZXcgc3BhbnMuXG4gKiBQZXJmZWN0IGZvciB0cmFja2luZyBzdGVwcyB3aXRoaW4gYW4gb3BlcmF0aW9uIHdpdGhvdXQgc3BhbiBvdmVyaGVhZC5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICBAT2JzZXJ2ZWQoKSAvLyBDcmVhdGVzIHNwYW5cbiAqICAgYXN5bmMgcHJvY2Vzc09yZGVyKG9yZGVyOiBPcmRlcikge1xuICogICAgIGF3YWl0IHRoaXMudmFsaWRhdGVPcmRlcihvcmRlcik7ICAgIC8vIENoZWNrcG9pbnQgYWRkZWRcbiAqICAgICBhd2FpdCB0aGlzLmNoYXJnZVBheW1lbnQob3JkZXIpOyAgICAvLyBDaGVja3BvaW50IGFkZGVkXG4gKiAgICAgYXdhaXQgdGhpcy5zaGlwT3JkZXIob3JkZXIpOyAgICAgICAgLy8gQ2hlY2twb2ludCBhZGRlZFxuICogICAgIHJldHVybiBvcmRlcjtcbiAqICAgfVxuICogICBcbiAqICAgQENoZWNrcG9pbnQoJ29yZGVyLnZhbGlkYXRpb24nKVxuICogICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlT3JkZXIob3JkZXI6IE9yZGVyKSB7XG4gKiAgICAgLy8gSnVzdCBhZGRzIGNoZWNrcG9pbnQsIG5vIHNwYW4gY3JlYXRlZFxuICogICB9XG4gKiAgIFxuICogICBAQ2hlY2twb2ludCh7XG4gKiAgICAgbmFtZTogJ29yZGVyLnBheW1lbnQnLFxuICogICAgIGV4dHJhY3Q6IHtcbiAqICAgICAgIHN0YXJ0OiAoY3R4KSA9PiAoeyBcbiAqICAgICAgICAgdGFnczogeyBwYXltZW50TWV0aG9kOiBjdHguYXJnc1swXS5wYXltZW50TWV0aG9kIH0gXG4gKiAgICAgICB9KSxcbiAqICAgICAgIGZpbmlzaDogKGN0eCkgPT4gKHsgXG4gKiAgICAgICAgIG1ldHJpY3M6IHsgYW1vdW50OiBjdHguYXJnc1swXS5hbW91bnQgfSBcbiAqICAgICAgIH0pXG4gKiAgICAgfVxuICogICB9KVxuICogICBwcml2YXRlIGFzeW5jIGNoYXJnZVBheW1lbnQob3JkZXI6IE9yZGVyKSB7XG4gKiAgICAgLy8gQ2hlY2twb2ludCB3aXRoIGV4dHJhY3RlZCBjb250ZXh0XG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IHJlc29sdmVTb3VyY2UgfSBmcm9tICcuL2RlY29yYXRvci11dGlscyc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFcnJvciB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IG1hcEVycm9yIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFR5cGVzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGludGVyZmFjZSBDaGVja3BvaW50RW5yaWNobWVudCB7XG4gIC8qKiBDaGVja3BvaW50LXNwZWNpZmljIHRhZ3MgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBDaGVja3BvaW50LXNwZWNpZmljIG1ldHJpY3MgKi9cbiAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIC8qKiBDaGVja3BvaW50LXNwZWNpZmljIGRhdGEgKi9cbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENoZWNrcG9pbnRFeHRyYWN0Q29udGV4dDxUSW5zdGFuY2UsIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdLCBUUmVzdWx0PiB7XG4gIGluc3RhbmNlOiBUSW5zdGFuY2U7XG4gIGFyZ3M6IFRBcmdzO1xuICBvcGVyYXRpb25OYW1lOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xuICAvKiogT25seSBhdmFpbGFibGUgaW4gZmluaXNoKCkgKi9cbiAgcmVzdWx0PzogVFJlc3VsdDtcbiAgLyoqIE9ubHkgYXZhaWxhYmxlIGluIGZpbmlzaCgpICovXG4gIGVycm9yPzogRXJyb3I7XG4gIC8qKiBPbmx5IGF2YWlsYWJsZSBpbiBmaW5pc2goKSAqL1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgLyoqIE9ubHkgYXZhaWxhYmxlIGluIGZpbmlzaCgpICovXG4gIGR1cmF0aW9uTXM/OiBudW1iZXI7XG59XG5cbnR5cGUgQml2YXJpYW50Rm48VCBleHRlbmRzICguLi5hcmdzOiBhbnlbXSkgPT4gYW55PiA9IHtcbiAgYml2YXJpYW5jZUhhY2s6IFQ7XG59WyAnYml2YXJpYW5jZUhhY2snIF07XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2hlY2twb2ludEV4dHJhY3RvcjxUSW5zdGFuY2UsIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdLCBUUmVzdWx0PiB7XG4gIC8qKlxuICAgKiBFeHRyYWN0IGVucmljaG1lbnQgYmVmb3JlIG1ldGhvZCBleGVjdXRpb24uXG4gICAqIFVzZWZ1bCBmb3IgY2FwdHVyaW5nIGlucHV0IHBhcmFtZXRlcnMgYXMgY2hlY2twb2ludCBkYXRhLlxuICAgKi9cbiAgc3RhcnQ/OiBCaXZhcmlhbnRGbjwoY3R4OiBDaGVja3BvaW50RXh0cmFjdENvbnRleHQ8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD4pID0+IENoZWNrcG9pbnRFbnJpY2htZW50IHwgdm9pZD47XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgZW5yaWNobWVudCBhZnRlciBtZXRob2QgZXhlY3V0aW9uLlxuICAgKiBVc2VmdWwgZm9yIGNhcHR1cmluZyByZXN1bHQvZXJyb3IgaW5mb3JtYXRpb24uXG4gICAqL1xuICBmaW5pc2g/OiBCaXZhcmlhbnRGbjwoY3R4OiBDaGVja3BvaW50RXh0cmFjdENvbnRleHQ8VEluc3RhbmNlLCBUQXJncywgVFJlc3VsdD4pID0+IENoZWNrcG9pbnRFbnJpY2htZW50IHwgdm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2hlY2twb2ludE9wdGlvbnM8VEluc3RhbmNlID0gdW5rbm93biwgVEFyZ3MgZXh0ZW5kcyB1bmtub3duW10gPSB1bmtub3duW10sIFRSZXN1bHQgPSB1bmtub3duPiB7XG4gIC8qKiBcbiAgICogQ2hlY2twb2ludCBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkuXG4gICAqIENhbiB1c2UgcGF0dGVybnM6ICdvcGVyYXRpb24uc3RlcCcsICdlbnRpdHkuYWN0aW9uJywgZXRjLlxuICAgKi9cbiAgbmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogRXh0cmFjdGlvbiBBUEkgZm9yIGVucmljaGluZyBjaGVja3BvaW50cyB3aXRoIGNvbnRleHQuXG4gICAqIEFsbG93cyBjYXB0dXJpbmcgYXJncy9yZXN1bHQgd2l0aG91dCBzZXJpYWxpemluZyBlbnRpcmUgcGF5bG9hZHMuXG4gICAqL1xuICBleHRyYWN0PzogQ2hlY2twb2ludEV4dHJhY3RvcjxUSW5zdGFuY2UsIFRBcmdzLCBUUmVzdWx0PjtcblxuICAvKipcbiAgICogU3RhdGljIHRhZ3MgdG8gYXBwbHkgdG8gdGhlIGNoZWNrcG9pbnQuXG4gICAqIEZvciBkeW5hbWljIHRhZ3MsIHVzZSBleHRyYWN0LnN0YXJ0IG9yIGV4dHJhY3QuZmluaXNoLlxuICAgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gYWRkIGNoZWNrcG9pbnQgb24gbWV0aG9kIHN0YXJ0IChiZWZvcmUgZXhlY3V0aW9uKS5cbiAgICogRGVmYXVsdDogZmFsc2UgKG9ubHkgY2hlY2twb2ludCBvbiBmaW5pc2gpXG4gICAqL1xuICBjaGVja3BvaW50U3RhcnQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGFkZCBjaGVja3BvaW50IG9uIG1ldGhvZCBmaW5pc2ggKGFmdGVyIGV4ZWN1dGlvbikuXG4gICAqIERlZmF1bHQ6IHRydWVcbiAgICovXG4gIGNoZWNrcG9pbnRGaW5pc2g/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBJZiB0cnVlLCBsb2dzIGEgd2FybmluZyB3aGVuIG5vIHNwYW4gZXhpc3RzIHRvIGF0dGFjaCBjaGVja3BvaW50IHRvLlxuICAgKiBEZWZhdWx0OiB0cnVlICh3YXJucyB0byBjYXRjaCBtaXNzaW5nIEBPYnNlcnZlZCBwYXJlbnQpXG4gICAqL1xuICB3YXJuSWZOb1NwYW4/OiBib29sZWFuO1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIERlY29yYXRvclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogQENoZWNrcG9pbnQgZGVjb3JhdG9yIHdpdGggc3RyaW5nIG5hbWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIENoZWNrcG9pbnQobmFtZTogc3RyaW5nKTogPFQgZXh0ZW5kcyAoLi4uYXJnczogYW55W10pID0+IGFueT4oXG4gIHRhcmdldDogb2JqZWN0LFxuICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPlxuKSA9PiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPjtcblxuLyoqXG4gKiBAQ2hlY2twb2ludCBkZWNvcmF0b3Igd2l0aCBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBDaGVja3BvaW50PFRJbnN0YW5jZSA9IHVua25vd24sIFRBcmdzIGV4dGVuZHMgdW5rbm93bltdID0gdW5rbm93bltdLCBUUmVzdWx0ID0gdW5rbm93bj4oXG4gIG9wdGlvbnM6IENoZWNrcG9pbnRPcHRpb25zPFRJbnN0YW5jZSwgVEFyZ3MsIFRSZXN1bHQ+XG4pOiA8VCBleHRlbmRzICguLi5hcmdzOiBhbnlbXSkgPT4gYW55PihcbiAgdGFyZ2V0OiBvYmplY3QsXG4gIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4pID0+IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+O1xuXG4vKipcbiAqIEBDaGVja3BvaW50IGRlY29yYXRvciB3aXRoIG5vIGFyZ3MgKHVzZXMgbWV0aG9kIG5hbWUpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBDaGVja3BvaW50KCk6IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+KFxuICB0YXJnZXQ6IG9iamVjdCxcbiAgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCxcbiAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbikgPT4gVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD47XG5cbmV4cG9ydCBmdW5jdGlvbiBDaGVja3BvaW50KG5hbWVPck9wdGlvbnM/OiBzdHJpbmcgfCBDaGVja3BvaW50T3B0aW9ucykge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogYW55W10pID0+IGFueT4oXG4gICAgdGFyZ2V0OiBvYmplY3QsXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPlxuICApOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPiB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIG9wdGlvbnNcbiAgICBjb25zdCBvcHRpb25zOiBDaGVja3BvaW50T3B0aW9ucyA9IHR5cGVvZiBuYW1lT3JPcHRpb25zID09PSAnc3RyaW5nJ1xuICAgICAgPyB7IG5hbWU6IG5hbWVPck9wdGlvbnMgfVxuICAgICAgOiAobmFtZU9yT3B0aW9ucyA/PyB7fSk7XG5cbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBzb3VyY2UgPSByZXNvbHZlU291cmNlKHRhcmdldCBhcyBhbnksIG1ldGhvZE5hbWUsIGNsYXNzTmFtZSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgY29uc3QgY2hlY2twb2ludFN0YXJ0ID0gb3B0aW9ucy5jaGVja3BvaW50U3RhcnQgPz8gZmFsc2U7XG4gICAgY29uc3QgY2hlY2twb2ludEZpbmlzaCA9IG9wdGlvbnMuY2hlY2twb2ludEZpbmlzaCA/PyB0cnVlO1xuICAgIGNvbnN0IHdhcm5JZk5vU3BhbiA9IG9wdGlvbnMud2FybklmTm9TcGFuID8/IHRydWU7XG5cbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKHRoaXM6IGFueSwgLi4uYXJnczogYW55W10pIHtcbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgIC8vIEdldCBjdXJyZW50IHNwYW4gKGlmIGV4aXN0cylcbiAgICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKTtcblxuICAgICAgaWYgKCFzcGFuKSB7XG4gICAgICAgIGlmICh3YXJuSWZOb1NwYW4pIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICBgW0BDaGVja3BvaW50XSBObyBhY3RpdmUgc3BhbiBmb3IgY2hlY2twb2ludDogJHtvcGVyYXRpb25OYW1lfS4gYCArXG4gICAgICAgICAgICBgRGlkIHlvdSBmb3JnZXQgQE9ic2VydmVkIG9uIHRoZSBwYXJlbnQgbWV0aG9kP2BcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vIHNwYW4gLSBqdXN0IGV4ZWN1dGUgbWV0aG9kIG5vcm1hbGx5XG4gICAgICAgIHJldHVybiBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIHN0YXJ0IGNoZWNrcG9pbnQgaWYgY29uZmlndXJlZFxuICAgICAgaWYgKGNoZWNrcG9pbnRTdGFydCkge1xuICAgICAgICBjb25zdCBzdGFydEVucmljaG1lbnQgPSBvcHRpb25zLmV4dHJhY3Q/LnN0YXJ0Py4oe1xuICAgICAgICAgIGluc3RhbmNlOiB0aGlzLFxuICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgICBzb3VyY2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHNwYW4uY2hlY2twb2ludChgJHtvcGVyYXRpb25OYW1lfS5zdGFydGAsIHtcbiAgICAgICAgICB0YWdzOiB7IC4uLm9wdGlvbnMudGFncywgLi4uc3RhcnRFbnJpY2htZW50Py50YWdzIH0sXG4gICAgICAgICAgbWV0cmljczogc3RhcnRFbnJpY2htZW50Py5tZXRyaWNzLFxuICAgICAgICAgIGRhdGE6IHN0YXJ0RW5yaWNobWVudD8uZGF0YSxcbiAgICAgICAgfSBhcyBhbnkpO1xuICAgICAgfVxuXG4gICAgICAvLyBFeGVjdXRlIG1ldGhvZFxuICAgICAgY29uc3QgZXhlY3V0ZUFuZENoZWNrcG9pbnQgPSAocmVzdWx0OiBhbnksIGVycm9yPzogRXJyb3IpID0+IHtcbiAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgIGNvbnN0IHN1Y2Nlc3MgPSAhZXJyb3I7XG5cbiAgICAgICAgaWYgKGNoZWNrcG9pbnRGaW5pc2gpIHtcbiAgICAgICAgICBjb25zdCBmaW5pc2hFbnJpY2htZW50ID0gb3B0aW9ucy5leHRyYWN0Py5maW5pc2g/Lih7XG4gICAgICAgICAgICBpbnN0YW5jZTogdGhpcyxcbiAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgcmVzdWx0LFxuICAgICAgICAgICAgZXJyb3IsXG4gICAgICAgICAgICBzdWNjZXNzLFxuICAgICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIGNvbnN0IGNoZWNrcG9pbnROYW1lID0gY2hlY2twb2ludFN0YXJ0XG4gICAgICAgICAgICA/IGAke29wZXJhdGlvbk5hbWV9LmZpbmlzaGBcbiAgICAgICAgICAgIDogb3BlcmF0aW9uTmFtZTtcblxuICAgICAgICAgIHNwYW4uY2hlY2twb2ludChjaGVja3BvaW50TmFtZSwge1xuICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAuLi5vcHRpb25zLnRhZ3MsXG4gICAgICAgICAgICAgIC4uLmZpbmlzaEVucmljaG1lbnQ/LnRhZ3MsXG4gICAgICAgICAgICAgIC4uLihlcnJvciA/IHsgJ2NoZWNrcG9pbnQuZXJyb3InOiAndHJ1ZScgfSA6IHt9KVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgJ2NoZWNrcG9pbnQuZHVyYXRpb25fbXMnOiBkdXJhdGlvbk1zLFxuICAgICAgICAgICAgICAuLi5maW5pc2hFbnJpY2htZW50Py5tZXRyaWNzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YTogZmluaXNoRW5yaWNobWVudD8uZGF0YSxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IGVycm9yIDogdW5kZWZpbmVkLFxuICAgICAgICAgIH0gYXMgYW55KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlLXRocm93IGVycm9yIGlmIHByZXNlbnRcbiAgICAgICAgaWYgKGVycm9yKSB0aHJvdyBlcnJvcjtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG5cbiAgICAgIC8vIEhhbmRsZSBhc3luYy9zeW5jXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcblxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEFzeW5jIG1ldGhvZFxuICAgICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgICAgIC50aGVuKCh2YWx1ZTogYW55KSA9PiBleGVjdXRlQW5kQ2hlY2twb2ludCh2YWx1ZSkpXG4gICAgICAgICAgICAuY2F0Y2goKGVycm9yOiBFcnJvcikgPT4gZXhlY3V0ZUFuZENoZWNrcG9pbnQodW5kZWZpbmVkLCBlcnJvcikpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFN5bmMgbWV0aG9kXG4gICAgICAgICAgcmV0dXJuIGV4ZWN1dGVBbmRDaGVja3BvaW50KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiBleGVjdXRlQW5kQ2hlY2twb2ludCh1bmRlZmluZWQsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIH1cbiAgICB9IGFzIGFueTtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuIl19