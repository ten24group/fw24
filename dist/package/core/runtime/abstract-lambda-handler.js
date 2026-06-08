"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractLambdaHandler = void 0;
const logging_1 = require("../../logging");
const validation_1 = require("../../validation");
const observability_1 = require("../../observability");
const decorator_utils_1 = require("../../decorators/decorator-utils");
class AbstractLambdaHandler {
    logger = (0, logging_1.createLogger)(this.constructor.name);
    validator = validation_1.DefaultValidator;
    /**
     * Binds the LambdaHandler method to the instance of the class.
     */
    constructor() {
        this.LambdaHandler = this.LambdaHandler.bind(this);
    }
    /**
     * Initialize observability for this invocation.
     * Called at the start of each handler execution.
     *
     * Ensure entry packages are loaded proeprly, before
     * before observability initialization attempts to resolve config.
     */
    initializeEntryPackagesAndObservability() {
        // Load entry packages (idempotent - safe to call multiple times)
        // This ensures DI config is available for bundled framework handlers
        (0, decorator_utils_1.tryImportingEntryPackagesFor)(this.constructor.name);
        // Now initialize observability with proper DI config
        observability_1.ObservabilityManager.initializeInvocation();
    }
    /**
     * Flush observability data at the end of handler execution.
     */
    async flushObservability() {
        await observability_1.ObservabilityManager.flush();
    }
    /**
     * Execute handler logic within a span, ensuring observability is flushed after span completion.
     *
     * **RECOMMENDED PATTERN** for all Lambda handlers to ensure:
     * 1. Spans are properly closed with "completed" status (not "abandoned")
     * 2. Observability data is flushed to backends before function terminates
     * 3. Consistent error handling and span lifecycle management
     *
     * **Why this matters:**
     * - Flushing observability INSIDE `withSpan()` causes the span finalizer to force-close
     *   the span as "abandoned" before flush completes
     * - This helper ensures flush happens AFTER the span is properly ended
     *
     * **Child classes can:**
     * - Override `flushObservability()` to customize flush behavior
     * - Add custom error handling by wrapping this call
     * - Use this directly in `LambdaHandler()` implementations
     *
     * @param spanName - Name of the span (e.g., "SQS Batch myQueue", "API Gateway /users")
     * @param handler - Async function containing the handler logic (receives the span for adding metrics/tags)
     * @param spanOptions - Optional span configuration (correlationId, causedBy, tags, metrics, etc.)
     * @returns The result of the handler function
     *
     * @example Basic usage in a queue handler
     * ```typescript
     * async LambdaHandler(event: SQSEvent, context: Context) {
     *   this.initializeEntryPackagesAndObservability();
     *
     *   return runWithExecutionContext(execCtx, async () => {
     *     return this.executeWithSpanAndFlush(
     *       'SQS Batch myQueue',
     *       async (span) => {
     *         await this.initialize(event, context);
     *         const result = await this.process(event, context);
     *         span.metrics({ 'sqs.batch.duration_ms': Date.now() - startTime });
     *         return result;
     *       },
     *       { correlationId, causedBy, tags: { queue_name: 'myQueue' } }
     *     );
     *   });
     * }
     * ```
     *
     * @example Custom error handling
     * ```typescript
     * try {
     *   return await this.executeWithSpanAndFlush('My Operation', async (span) => {
     *     // ... handler logic
     *   });
     * } catch (error) {
     *   // Custom error handling (flush already happened in finally block)
     *   this.logger.error('Handler failed', error);
     *   throw error;
     * }
     * ```
     */
    async executeWithSpanAndFlush(spanName, handler, spanOptions, lambdaContext) {
        try {
            return await observability_1.SpanObserver.withSpan(spanName, (span) => {
                // Enrich root span with cold start info, runtime context, and Lambda metadata
                this.enrichRootSpan(span, lambdaContext);
                return handler(span);
            }, spanOptions);
        }
        finally {
            // Critical: Flush AFTER span completes to ensure "completed" status
            // Flushing inside withSpan() causes span finalizer to mark it as "abandoned"
            await this.flushObservability();
        }
    }
    /**
     * Enrich the root span with cold start tracking, runtime metrics, and Lambda context.
     * Called automatically by executeWithSpanAndFlush for every handler invocation.
     * Concrete handlers should pass `lambdaContext` for full enrichment.
     */
    enrichRootSpan(span, lambdaContext) {
        // Cold start tracking — first invocation of this Lambda container
        if (observability_1.ObservabilityManager.isColdStart()) {
            span.tag('cold_start', 'true');
        }
        span.metric('invocation_number', observability_1.ObservabilityManager.getInvocationCount());
        // Node.js runtime metrics
        const mem = process.memoryUsage();
        span.metrics({
            'node.heap_used_mb': Math.round(mem.heapUsed / (1024 * 1024)),
            'node.heap_total_mb': Math.round(mem.heapTotal / (1024 * 1024)),
            'node.rss_mb': Math.round(mem.rss / (1024 * 1024)),
        });
        // Lambda runtime context (when available)
        if (lambdaContext) {
            const runtimeTags = this.buildRuntimeTags(lambdaContext);
            if (Object.keys(runtimeTags).length > 0) {
                span.tags(runtimeTags);
            }
            const runtimeMetrics = this.buildRuntimeMetrics(lambdaContext);
            if (Object.keys(runtimeMetrics).length > 0) {
                span.metrics(runtimeMetrics);
            }
            // Memory pressure detection — heap > 80% of Lambda memory limit
            const memoryLimitMb = parseInt(lambdaContext.memoryLimitInMB, 10);
            const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
            if (memoryLimitMb > 0 && heapUsedMb / memoryLimitMb > 0.8) {
                span.tag('_memory_pressure', 'true');
            }
            // Timeout risk detection — less than 3s remaining at invocation start.
            // This catches Lambda containers under severe cumulative pressure from prior invocations.
            // Mid-execution timeout risk is tracked via the `lambda.remaining_time_ms` metric.
            if (typeof lambdaContext.getRemainingTimeInMillis === 'function') {
                const remainingMs = lambdaContext.getRemainingTimeInMillis();
                if (remainingMs > 0 && remainingMs < 3000) {
                    span.tag('_timeout_risk', 'true');
                }
            }
        }
    }
    /**
     * Build Lambda runtime tags from the AWS Lambda context object.
     * Call this from concrete handler types that have access to the Lambda context.
     */
    buildRuntimeTags(lambdaContext) {
        const tags = {};
        if (lambdaContext.functionName)
            tags['lambda.function_name'] = lambdaContext.functionName;
        if (lambdaContext.memoryLimitInMB)
            tags['lambda.memory_limit_mb'] = String(lambdaContext.memoryLimitInMB);
        if (lambdaContext.awsRequestId)
            tags['lambda.request_id'] = lambdaContext.awsRequestId;
        if (lambdaContext.logGroupName)
            tags['lambda.log_group'] = lambdaContext.logGroupName;
        return tags;
    }
    /**
     * Build Lambda runtime metrics from the AWS Lambda context object.
     * Call this from concrete handler types that have access to the Lambda context.
     */
    buildRuntimeMetrics(lambdaContext) {
        const metrics = {};
        if (typeof lambdaContext.getRemainingTimeInMillis === 'function') {
            metrics['lambda.remaining_time_ms'] = lambdaContext.getRemainingTimeInMillis();
        }
        return metrics;
    }
    /**
     * Creates a new instance of the controller and returns its LambdaHandler method.
     * @returns The LambdaHandler method of the controller.
     */
    static CreateHandler(handlerFunc) {
        const instance = new handlerFunc();
        return instance.LambdaHandler;
    }
}
exports.AbstractLambdaHandler = AbstractLambdaHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDJDQUE2QztBQUM3QyxpREFBZ0U7QUFDaEUsdURBQXNGO0FBQ3RGLHNFQUFnRjtBQUVoRixNQUFzQixxQkFBcUI7SUFDaEMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLFNBQVMsR0FBZSw2QkFBZ0IsQ0FBQztJQUVuRDs7T0FFRztJQUNIO1FBQ0UsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBSUQ7Ozs7OztPQU1HO0lBQ08sdUNBQXVDO1FBQy9DLGlFQUFpRTtRQUNqRSxxRUFBcUU7UUFDckUsSUFBQSw4Q0FBNEIsRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXBELHFEQUFxRDtRQUNyRCxvQ0FBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO0lBQzlDLENBQUM7SUFFRDs7T0FFRztJQUNPLEtBQUssQ0FBQyxrQkFBa0I7UUFDaEMsTUFBTSxvQ0FBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNyQyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0F1REc7SUFDTyxLQUFLLENBQUMsdUJBQXVCLENBQ3JDLFFBQWdCLEVBQ2hCLE9BQTJDLEVBQzNDLFdBQXlCLEVBQ3pCLGFBQXVCO1FBRXZCLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSw0QkFBWSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRTtnQkFDcEQs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LENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNPLGdCQUFnQixDQUFDLGFBQXNCO1FBQy9DLE1BQU0sSUFBSSxHQUEyQixFQUFFLENBQUM7UUFDeEMsSUFBSSxhQUFhLENBQUMsWUFBWTtZQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxZQUFZLENBQUM7UUFDMUYsSUFBSSxhQUFhLENBQUMsZUFBZTtZQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDMUcsSUFBSSxhQUFhLENBQUMsWUFBWTtZQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxZQUFZLENBQUM7UUFDdkYsSUFBSSxhQUFhLENBQUMsWUFBWTtZQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxZQUFZLENBQUM7UUFDdEYsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQ7OztPQUdHO0lBQ08sbUJBQW1CLENBQUMsYUFBc0I7UUFDbEQsTUFBTSxPQUFPLEdBQTJCLEVBQUUsQ0FBQztRQUMzQyxJQUFJLE9BQU8sYUFBYSxDQUFDLHdCQUF3QixLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ2pFLE9BQU8sQ0FBQywwQkFBMEIsQ0FBQyxHQUFHLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO1FBQ2pGLENBQUM7UUFDRCxPQUFPLE9BQU8sQ0FBQztJQUNqQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLGFBQWEsQ0FBQyxXQUE2QztRQUNoRSxNQUFNLFFBQVEsR0FBRyxJQUFJLFdBQVcsRUFBRSxDQUFDO1FBQ25DLE9BQU8sUUFBUSxDQUFDLGFBQWEsQ0FBQztJQUNoQyxDQUFDO0NBQ0Y7QUFsTUQsc0RBa01DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyLCBTcGFuT2JzZXJ2ZXIsIFNwYW5PcHRpb25zIH0gZnJvbSBcIi4uLy4uL29ic2VydmFiaWxpdHlcIjtcbmltcG9ydCB7IHRyeUltcG9ydGluZ0VudHJ5UGFja2FnZXNGb3IgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9kZWNvcmF0b3ItdXRpbHNcIjtcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUpO1xuICBwcm90ZWN0ZWQgdmFsaWRhdG9yOiBJVmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcjtcblxuICAvKipcbiAgICogQmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIHRvIHRoZSBpbnN0YW5jZSBvZiB0aGUgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLkxhbWJkYUhhbmRsZXIgPSB0aGlzLkxhbWJkYUhhbmRsZXIuYmluZCh0aGlzKVxuICB9XG5cbiAgYWJzdHJhY3QgTGFtYmRhSGFuZGxlcihldmVudDogYW55LCBjb250ZXh0OiBhbnkpOiBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgb2JzZXJ2YWJpbGl0eSBmb3IgdGhpcyBpbnZvY2F0aW9uLlxuICAgKiBDYWxsZWQgYXQgdGhlIHN0YXJ0IG9mIGVhY2ggaGFuZGxlciBleGVjdXRpb24uXG4gICAqIFxuICAgKiBFbnN1cmUgZW50cnkgcGFja2FnZXMgYXJlIGxvYWRlZCBwcm9lcHJseSwgYmVmb3JlIFxuICAgKiBiZWZvcmUgb2JzZXJ2YWJpbGl0eSBpbml0aWFsaXphdGlvbiBhdHRlbXB0cyB0byByZXNvbHZlIGNvbmZpZy5cbiAgICovXG4gIHByb3RlY3RlZCBpbml0aWFsaXplRW50cnlQYWNrYWdlc0FuZE9ic2VydmFiaWxpdHkoKTogdm9pZCB7XG4gICAgLy8gTG9hZCBlbnRyeSBwYWNrYWdlcyAoaWRlbXBvdGVudCAtIHNhZmUgdG8gY2FsbCBtdWx0aXBsZSB0aW1lcylcbiAgICAvLyBUaGlzIGVuc3VyZXMgREkgY29uZmlnIGlzIGF2YWlsYWJsZSBmb3IgYnVuZGxlZCBmcmFtZXdvcmsgaGFuZGxlcnNcbiAgICB0cnlJbXBvcnRpbmdFbnRyeVBhY2thZ2VzRm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSk7XG5cbiAgICAvLyBOb3cgaW5pdGlhbGl6ZSBvYnNlcnZhYmlsaXR5IHdpdGggcHJvcGVyIERJIGNvbmZpZ1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gIH1cblxuICAvKipcbiAgICogRmx1c2ggb2JzZXJ2YWJpbGl0eSBkYXRhIGF0IHRoZSBlbmQgb2YgaGFuZGxlciBleGVjdXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZmx1c2hPYnNlcnZhYmlsaXR5KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBoYW5kbGVyIGxvZ2ljIHdpdGhpbiBhIHNwYW4sIGVuc3VyaW5nIG9ic2VydmFiaWxpdHkgaXMgZmx1c2hlZCBhZnRlciBzcGFuIGNvbXBsZXRpb24uXG4gICAqIFxuICAgKiAqKlJFQ09NTUVOREVEIFBBVFRFUk4qKiBmb3IgYWxsIExhbWJkYSBoYW5kbGVycyB0byBlbnN1cmU6XG4gICAqIDEuIFNwYW5zIGFyZSBwcm9wZXJseSBjbG9zZWQgd2l0aCBcImNvbXBsZXRlZFwiIHN0YXR1cyAobm90IFwiYWJhbmRvbmVkXCIpXG4gICAqIDIuIE9ic2VydmFiaWxpdHkgZGF0YSBpcyBmbHVzaGVkIHRvIGJhY2tlbmRzIGJlZm9yZSBmdW5jdGlvbiB0ZXJtaW5hdGVzXG4gICAqIDMuIENvbnNpc3RlbnQgZXJyb3IgaGFuZGxpbmcgYW5kIHNwYW4gbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAgICogXG4gICAqICoqV2h5IHRoaXMgbWF0dGVyczoqKlxuICAgKiAtIEZsdXNoaW5nIG9ic2VydmFiaWxpdHkgSU5TSURFIGB3aXRoU3BhbigpYCBjYXVzZXMgdGhlIHNwYW4gZmluYWxpemVyIHRvIGZvcmNlLWNsb3NlXG4gICAqICAgdGhlIHNwYW4gYXMgXCJhYmFuZG9uZWRcIiBiZWZvcmUgZmx1c2ggY29tcGxldGVzXG4gICAqIC0gVGhpcyBoZWxwZXIgZW5zdXJlcyBmbHVzaCBoYXBwZW5zIEFGVEVSIHRoZSBzcGFuIGlzIHByb3Blcmx5IGVuZGVkXG4gICAqIFxuICAgKiAqKkNoaWxkIGNsYXNzZXMgY2FuOioqXG4gICAqIC0gT3ZlcnJpZGUgYGZsdXNoT2JzZXJ2YWJpbGl0eSgpYCB0byBjdXN0b21pemUgZmx1c2ggYmVoYXZpb3JcbiAgICogLSBBZGQgY3VzdG9tIGVycm9yIGhhbmRsaW5nIGJ5IHdyYXBwaW5nIHRoaXMgY2FsbFxuICAgKiAtIFVzZSB0aGlzIGRpcmVjdGx5IGluIGBMYW1iZGFIYW5kbGVyKClgIGltcGxlbWVudGF0aW9uc1xuICAgKiBcbiAgICogQHBhcmFtIHNwYW5OYW1lIC0gTmFtZSBvZiB0aGUgc3BhbiAoZS5nLiwgXCJTUVMgQmF0Y2ggbXlRdWV1ZVwiLCBcIkFQSSBHYXRld2F5IC91c2Vyc1wiKVxuICAgKiBAcGFyYW0gaGFuZGxlciAtIEFzeW5jIGZ1bmN0aW9uIGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgbG9naWMgKHJlY2VpdmVzIHRoZSBzcGFuIGZvciBhZGRpbmcgbWV0cmljcy90YWdzKVxuICAgKiBAcGFyYW0gc3Bhbk9wdGlvbnMgLSBPcHRpb25hbCBzcGFuIGNvbmZpZ3VyYXRpb24gKGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCB0YWdzLCBtZXRyaWNzLCBldGMuKVxuICAgKiBAcmV0dXJucyBUaGUgcmVzdWx0IG9mIHRoZSBoYW5kbGVyIGZ1bmN0aW9uXG4gICAqIFxuICAgKiBAZXhhbXBsZSBCYXNpYyB1c2FnZSBpbiBhIHF1ZXVlIGhhbmRsZXJcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCkge1xuICAgKiAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG4gICAqICAgXG4gICAqICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGV4ZWNDdHgsIGFzeW5jICgpID0+IHtcbiAgICogICAgIHJldHVybiB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKFxuICAgKiAgICAgICAnU1FTIEJhdGNoIG15UXVldWUnLFxuICAgKiAgICAgICBhc3luYyAoc3BhbikgPT4ge1xuICAgKiAgICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAqICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzKGV2ZW50LCBjb250ZXh0KTtcbiAgICogICAgICAgICBzcGFuLm1ldHJpY3MoeyAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSB9KTtcbiAgICogICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgKiAgICAgICB9LFxuICAgKiAgICAgICB7IGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCB0YWdzOiB7IHF1ZXVlX25hbWU6ICdteVF1ZXVlJyB9IH1cbiAgICogICAgICk7XG4gICAqICAgfSk7XG4gICAqIH1cbiAgICogYGBgXG4gICAqIFxuICAgKiBAZXhhbXBsZSBDdXN0b20gZXJyb3IgaGFuZGxpbmdcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiB0cnkge1xuICAgKiAgIHJldHVybiBhd2FpdCB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKCdNeSBPcGVyYXRpb24nLCBhc3luYyAoc3BhbikgPT4ge1xuICAgKiAgICAgLy8gLi4uIGhhbmRsZXIgbG9naWNcbiAgICogICB9KTtcbiAgICogfSBjYXRjaCAoZXJyb3IpIHtcbiAgICogICAvLyBDdXN0b20gZXJyb3IgaGFuZGxpbmcgKGZsdXNoIGFscmVhZHkgaGFwcGVuZWQgaW4gZmluYWxseSBibG9jaylcbiAgICogICB0aGlzLmxvZ2dlci5lcnJvcignSGFuZGxlciBmYWlsZWQnLCBlcnJvcik7XG4gICAqICAgdGhyb3cgZXJyb3I7XG4gICAqIH1cbiAgICogYGBgXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2g8VD4oXG4gICAgc3Bhbk5hbWU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIHNwYW5PcHRpb25zPzogU3Bhbk9wdGlvbnMsXG4gICAgbGFtYmRhQ29udGV4dD86IENvbnRleHRcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oc3Bhbk5hbWUsIChzcGFuKSA9PiB7XG4gICAgICAgIC8vIEVucmljaCByb290IHNwYW4gd2l0aCBjb2xkIHN0YXJ0IGluZm8sIHJ1bnRpbWUgY29udGV4dCwgYW5kIExhbWJkYSBtZXRhZGF0YVxuICAgICAgICB0aGlzLmVucmljaFJvb3RTcGFuKHNwYW4sIGxhbWJkYUNvbnRleHQpO1xuICAgICAgICByZXR1cm4gaGFuZGxlcihzcGFuKTtcbiAgICAgIH0sIHNwYW5PcHRpb25zKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gQ3JpdGljYWw6IEZsdXNoIEFGVEVSIHNwYW4gY29tcGxldGVzIHRvIGVuc3VyZSBcImNvbXBsZXRlZFwiIHN0YXR1c1xuICAgICAgLy8gRmx1c2hpbmcgaW5zaWRlIHdpdGhTcGFuKCkgY2F1c2VzIHNwYW4gZmluYWxpemVyIHRvIG1hcmsgaXQgYXMgXCJhYmFuZG9uZWRcIlxuICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5yaWNoIHRoZSByb290IHNwYW4gd2l0aCBjb2xkIHN0YXJ0IHRyYWNraW5nLCBydW50aW1lIG1ldHJpY3MsIGFuZCBMYW1iZGEgY29udGV4dC5cbiAgICogQ2FsbGVkIGF1dG9tYXRpY2FsbHkgYnkgZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2ggZm9yIGV2ZXJ5IGhhbmRsZXIgaW52b2NhdGlvbi5cbiAgICogQ29uY3JldGUgaGFuZGxlcnMgc2hvdWxkIHBhc3MgYGxhbWJkYUNvbnRleHRgIGZvciBmdWxsIGVucmljaG1lbnQuXG4gICAqL1xuICBwcm90ZWN0ZWQgZW5yaWNoUm9vdFNwYW4oc3BhbjogU3Bhbk9ic2VydmVyLCBsYW1iZGFDb250ZXh0PzogQ29udGV4dCk6IHZvaWQge1xuICAgIC8vIENvbGQgc3RhcnQgdHJhY2tpbmcg4oCUIGZpcnN0IGludm9jYXRpb24gb2YgdGhpcyBMYW1iZGEgY29udGFpbmVyXG4gICAgaWYgKE9ic2VydmFiaWxpdHlNYW5hZ2VyLmlzQ29sZFN0YXJ0KCkpIHtcbiAgICAgIHNwYW4udGFnKCdjb2xkX3N0YXJ0JywgJ3RydWUnKTtcbiAgICB9XG4gICAgc3Bhbi5tZXRyaWMoJ2ludm9jYXRpb25fbnVtYmVyJywgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZ2V0SW52b2NhdGlvbkNvdW50KCkpO1xuXG4gICAgLy8gTm9kZS5qcyBydW50aW1lIG1ldHJpY3NcbiAgICBjb25zdCBtZW0gPSBwcm9jZXNzLm1lbW9yeVVzYWdlKCk7XG4gICAgc3Bhbi5tZXRyaWNzKHtcbiAgICAgICdub2RlLmhlYXBfdXNlZF9tYic6IE1hdGgucm91bmQobWVtLmhlYXBVc2VkIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAnbm9kZS5oZWFwX3RvdGFsX21iJzogTWF0aC5yb3VuZChtZW0uaGVhcFRvdGFsIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAnbm9kZS5yc3NfbWInOiBNYXRoLnJvdW5kKG1lbS5yc3MgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBydW50aW1lIGNvbnRleHQgKHdoZW4gYXZhaWxhYmxlKVxuICAgIGlmIChsYW1iZGFDb250ZXh0KSB7XG4gICAgICBjb25zdCBydW50aW1lVGFncyA9IHRoaXMuYnVpbGRSdW50aW1lVGFncyhsYW1iZGFDb250ZXh0KTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhydW50aW1lVGFncykubGVuZ3RoID4gMCkge1xuICAgICAgICBzcGFuLnRhZ3MocnVudGltZVRhZ3MpO1xuICAgICAgfVxuICAgICAgY29uc3QgcnVudGltZU1ldHJpY3MgPSB0aGlzLmJ1aWxkUnVudGltZU1ldHJpY3MobGFtYmRhQ29udGV4dCk7XG4gICAgICBpZiAoT2JqZWN0LmtleXMocnVudGltZU1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3Bhbi5tZXRyaWNzKHJ1bnRpbWVNZXRyaWNzKTtcbiAgICAgIH1cblxuICAgICAgLy8gTWVtb3J5IHByZXNzdXJlIGRldGVjdGlvbiDigJQgaGVhcCA+IDgwJSBvZiBMYW1iZGEgbWVtb3J5IGxpbWl0XG4gICAgICBjb25zdCBtZW1vcnlMaW1pdE1iID0gcGFyc2VJbnQobGFtYmRhQ29udGV4dC5tZW1vcnlMaW1pdEluTUIsIDEwKTtcbiAgICAgIGNvbnN0IGhlYXBVc2VkTWIgPSBNYXRoLnJvdW5kKG1lbS5oZWFwVXNlZCAvICgxMDI0ICogMTAyNCkpO1xuICAgICAgaWYgKG1lbW9yeUxpbWl0TWIgPiAwICYmIGhlYXBVc2VkTWIgLyBtZW1vcnlMaW1pdE1iID4gMC44KSB7XG4gICAgICAgIHNwYW4udGFnKCdfbWVtb3J5X3ByZXNzdXJlJywgJ3RydWUnKTtcbiAgICAgIH1cblxuICAgICAgLy8gVGltZW91dCByaXNrIGRldGVjdGlvbiDigJQgbGVzcyB0aGFuIDNzIHJlbWFpbmluZyBhdCBpbnZvY2F0aW9uIHN0YXJ0LlxuICAgICAgLy8gVGhpcyBjYXRjaGVzIExhbWJkYSBjb250YWluZXJzIHVuZGVyIHNldmVyZSBjdW11bGF0aXZlIHByZXNzdXJlIGZyb20gcHJpb3IgaW52b2NhdGlvbnMuXG4gICAgICAvLyBNaWQtZXhlY3V0aW9uIHRpbWVvdXQgcmlzayBpcyB0cmFja2VkIHZpYSB0aGUgYGxhbWJkYS5yZW1haW5pbmdfdGltZV9tc2AgbWV0cmljLlxuICAgICAgaWYgKHR5cGVvZiBsYW1iZGFDb250ZXh0LmdldFJlbWFpbmluZ1RpbWVJbk1pbGxpcyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zdCByZW1haW5pbmdNcyA9IGxhbWJkYUNvbnRleHQuZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzKCk7XG4gICAgICAgIGlmIChyZW1haW5pbmdNcyA+IDAgJiYgcmVtYWluaW5nTXMgPCAzMDAwKSB7XG4gICAgICAgICAgc3Bhbi50YWcoJ190aW1lb3V0X3Jpc2snLCAndHJ1ZScpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIExhbWJkYSBydW50aW1lIHRhZ3MgZnJvbSB0aGUgQVdTIExhbWJkYSBjb250ZXh0IG9iamVjdC5cbiAgICogQ2FsbCB0aGlzIGZyb20gY29uY3JldGUgaGFuZGxlciB0eXBlcyB0aGF0IGhhdmUgYWNjZXNzIHRvIHRoZSBMYW1iZGEgY29udGV4dC5cbiAgICovXG4gIHByb3RlY3RlZCBidWlsZFJ1bnRpbWVUYWdzKGxhbWJkYUNvbnRleHQ6IENvbnRleHQpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgaWYgKGxhbWJkYUNvbnRleHQuZnVuY3Rpb25OYW1lKSB0YWdzWydsYW1iZGEuZnVuY3Rpb25fbmFtZSddID0gbGFtYmRhQ29udGV4dC5mdW5jdGlvbk5hbWU7XG4gICAgaWYgKGxhbWJkYUNvbnRleHQubWVtb3J5TGltaXRJbk1CKSB0YWdzWydsYW1iZGEubWVtb3J5X2xpbWl0X21iJ10gPSBTdHJpbmcobGFtYmRhQ29udGV4dC5tZW1vcnlMaW1pdEluTUIpO1xuICAgIGlmIChsYW1iZGFDb250ZXh0LmF3c1JlcXVlc3RJZCkgdGFnc1snbGFtYmRhLnJlcXVlc3RfaWQnXSA9IGxhbWJkYUNvbnRleHQuYXdzUmVxdWVzdElkO1xuICAgIGlmIChsYW1iZGFDb250ZXh0LmxvZ0dyb3VwTmFtZSkgdGFnc1snbGFtYmRhLmxvZ19ncm91cCddID0gbGFtYmRhQ29udGV4dC5sb2dHcm91cE5hbWU7XG4gICAgcmV0dXJuIHRhZ3M7XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgTGFtYmRhIHJ1bnRpbWUgbWV0cmljcyBmcm9tIHRoZSBBV1MgTGFtYmRhIGNvbnRleHQgb2JqZWN0LlxuICAgKiBDYWxsIHRoaXMgZnJvbSBjb25jcmV0ZSBoYW5kbGVyIHR5cGVzIHRoYXQgaGF2ZSBhY2Nlc3MgdG8gdGhlIExhbWJkYSBjb250ZXh0LlxuICAgKi9cbiAgcHJvdGVjdGVkIGJ1aWxkUnVudGltZU1ldHJpY3MobGFtYmRhQ29udGV4dDogQ29udGV4dCk6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICBpZiAodHlwZW9mIGxhbWJkYUNvbnRleHQuZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBtZXRyaWNzWydsYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnXSA9IGxhbWJkYUNvbnRleHQuZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzKCk7XG4gICAgfVxuICAgIHJldHVybiBtZXRyaWNzO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgaW5zdGFuY2Ugb2YgdGhlIGNvbnRyb2xsZXIgYW5kIHJldHVybnMgaXRzIExhbWJkYUhhbmRsZXIgbWV0aG9kLlxuICAgKiBAcmV0dXJucyBUaGUgTGFtYmRhSGFuZGxlciBtZXRob2Qgb2YgdGhlIGNvbnRyb2xsZXIuXG4gICAqL1xuICBzdGF0aWMgQ3JlYXRlSGFuZGxlcihoYW5kbGVyRnVuYzogeyBuZXcoKTogQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0pIHtcbiAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyBoYW5kbGVyRnVuYygpO1xuICAgIHJldHVybiBpbnN0YW5jZS5MYW1iZGFIYW5kbGVyO1xuICB9XG59Il19