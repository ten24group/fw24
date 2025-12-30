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
    async executeWithSpanAndFlush(spanName, handler, spanOptions) {
        try {
            return await observability_1.SpanObserver.withSpan(spanName, handler, spanOptions);
        }
        finally {
            // Critical: Flush AFTER span completes to ensure "completed" status
            // Flushing inside withSpan() causes span finalizer to mark it as "abandoned"
            await this.flushObservability();
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE2QztBQUM3QyxpREFBZ0U7QUFDaEUsdURBQXNGO0FBQ3RGLHNFQUFnRjtBQUVoRixNQUFzQixxQkFBcUI7SUFDaEMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLFNBQVMsR0FBZSw2QkFBZ0IsQ0FBQztJQUVuRDs7T0FFRztJQUNIO1FBQ0UsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBSUQ7Ozs7OztPQU1HO0lBQ08sdUNBQXVDO1FBQy9DLGlFQUFpRTtRQUNqRSxxRUFBcUU7UUFDckUsSUFBQSw4Q0FBNEIsRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXBELHFEQUFxRDtRQUNyRCxvQ0FBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO0lBQzlDLENBQUM7SUFFRDs7T0FFRztJQUNPLEtBQUssQ0FBQyxrQkFBa0I7UUFDaEMsTUFBTSxvQ0FBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNyQyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0F1REc7SUFDTyxLQUFLLENBQUMsdUJBQXVCLENBQ3JDLFFBQWdCLEVBQ2hCLE9BQTJDLEVBQzNDLFdBQXlCO1FBRXpCLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSw0QkFBWSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3JFLENBQUM7Z0JBQVMsQ0FBQztZQUNULG9FQUFvRTtZQUNwRSw2RUFBNkU7WUFDN0UsTUFBTSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUNsQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxhQUFhLENBQUMsV0FBNkM7UUFDaEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUNuQyxPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUM7SUFDaEMsQ0FBQztDQUNGO0FBbEhELHNEQWtIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyLCBTcGFuT2JzZXJ2ZXIsIFNwYW5PcHRpb25zIH0gZnJvbSBcIi4uLy4uL29ic2VydmFiaWxpdHlcIjtcbmltcG9ydCB7IHRyeUltcG9ydGluZ0VudHJ5UGFja2FnZXNGb3IgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9ycy9kZWNvcmF0b3ItdXRpbHNcIjtcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUpO1xuICBwcm90ZWN0ZWQgdmFsaWRhdG9yOiBJVmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcjtcblxuICAvKipcbiAgICogQmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIHRvIHRoZSBpbnN0YW5jZSBvZiB0aGUgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLkxhbWJkYUhhbmRsZXIgPSB0aGlzLkxhbWJkYUhhbmRsZXIuYmluZCh0aGlzKVxuICB9XG5cbiAgYWJzdHJhY3QgTGFtYmRhSGFuZGxlcihldmVudDogYW55LCBjb250ZXh0OiBhbnkpOiBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgb2JzZXJ2YWJpbGl0eSBmb3IgdGhpcyBpbnZvY2F0aW9uLlxuICAgKiBDYWxsZWQgYXQgdGhlIHN0YXJ0IG9mIGVhY2ggaGFuZGxlciBleGVjdXRpb24uXG4gICAqIFxuICAgKiBFbnN1cmUgZW50cnkgcGFja2FnZXMgYXJlIGxvYWRlZCBwcm9lcHJseSwgYmVmb3JlIFxuICAgKiBiZWZvcmUgb2JzZXJ2YWJpbGl0eSBpbml0aWFsaXphdGlvbiBhdHRlbXB0cyB0byByZXNvbHZlIGNvbmZpZy5cbiAgICovXG4gIHByb3RlY3RlZCBpbml0aWFsaXplRW50cnlQYWNrYWdlc0FuZE9ic2VydmFiaWxpdHkoKTogdm9pZCB7XG4gICAgLy8gTG9hZCBlbnRyeSBwYWNrYWdlcyAoaWRlbXBvdGVudCAtIHNhZmUgdG8gY2FsbCBtdWx0aXBsZSB0aW1lcylcbiAgICAvLyBUaGlzIGVuc3VyZXMgREkgY29uZmlnIGlzIGF2YWlsYWJsZSBmb3IgYnVuZGxlZCBmcmFtZXdvcmsgaGFuZGxlcnNcbiAgICB0cnlJbXBvcnRpbmdFbnRyeVBhY2thZ2VzRm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSk7XG5cbiAgICAvLyBOb3cgaW5pdGlhbGl6ZSBvYnNlcnZhYmlsaXR5IHdpdGggcHJvcGVyIERJIGNvbmZpZ1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gIH1cblxuICAvKipcbiAgICogRmx1c2ggb2JzZXJ2YWJpbGl0eSBkYXRhIGF0IHRoZSBlbmQgb2YgaGFuZGxlciBleGVjdXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZmx1c2hPYnNlcnZhYmlsaXR5KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBoYW5kbGVyIGxvZ2ljIHdpdGhpbiBhIHNwYW4sIGVuc3VyaW5nIG9ic2VydmFiaWxpdHkgaXMgZmx1c2hlZCBhZnRlciBzcGFuIGNvbXBsZXRpb24uXG4gICAqIFxuICAgKiAqKlJFQ09NTUVOREVEIFBBVFRFUk4qKiBmb3IgYWxsIExhbWJkYSBoYW5kbGVycyB0byBlbnN1cmU6XG4gICAqIDEuIFNwYW5zIGFyZSBwcm9wZXJseSBjbG9zZWQgd2l0aCBcImNvbXBsZXRlZFwiIHN0YXR1cyAobm90IFwiYWJhbmRvbmVkXCIpXG4gICAqIDIuIE9ic2VydmFiaWxpdHkgZGF0YSBpcyBmbHVzaGVkIHRvIGJhY2tlbmRzIGJlZm9yZSBmdW5jdGlvbiB0ZXJtaW5hdGVzXG4gICAqIDMuIENvbnNpc3RlbnQgZXJyb3IgaGFuZGxpbmcgYW5kIHNwYW4gbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAgICogXG4gICAqICoqV2h5IHRoaXMgbWF0dGVyczoqKlxuICAgKiAtIEZsdXNoaW5nIG9ic2VydmFiaWxpdHkgSU5TSURFIGB3aXRoU3BhbigpYCBjYXVzZXMgdGhlIHNwYW4gZmluYWxpemVyIHRvIGZvcmNlLWNsb3NlXG4gICAqICAgdGhlIHNwYW4gYXMgXCJhYmFuZG9uZWRcIiBiZWZvcmUgZmx1c2ggY29tcGxldGVzXG4gICAqIC0gVGhpcyBoZWxwZXIgZW5zdXJlcyBmbHVzaCBoYXBwZW5zIEFGVEVSIHRoZSBzcGFuIGlzIHByb3Blcmx5IGVuZGVkXG4gICAqIFxuICAgKiAqKkNoaWxkIGNsYXNzZXMgY2FuOioqXG4gICAqIC0gT3ZlcnJpZGUgYGZsdXNoT2JzZXJ2YWJpbGl0eSgpYCB0byBjdXN0b21pemUgZmx1c2ggYmVoYXZpb3JcbiAgICogLSBBZGQgY3VzdG9tIGVycm9yIGhhbmRsaW5nIGJ5IHdyYXBwaW5nIHRoaXMgY2FsbFxuICAgKiAtIFVzZSB0aGlzIGRpcmVjdGx5IGluIGBMYW1iZGFIYW5kbGVyKClgIGltcGxlbWVudGF0aW9uc1xuICAgKiBcbiAgICogQHBhcmFtIHNwYW5OYW1lIC0gTmFtZSBvZiB0aGUgc3BhbiAoZS5nLiwgXCJTUVMgQmF0Y2ggbXlRdWV1ZVwiLCBcIkFQSSBHYXRld2F5IC91c2Vyc1wiKVxuICAgKiBAcGFyYW0gaGFuZGxlciAtIEFzeW5jIGZ1bmN0aW9uIGNvbnRhaW5pbmcgdGhlIGhhbmRsZXIgbG9naWMgKHJlY2VpdmVzIHRoZSBzcGFuIGZvciBhZGRpbmcgbWV0cmljcy90YWdzKVxuICAgKiBAcGFyYW0gc3Bhbk9wdGlvbnMgLSBPcHRpb25hbCBzcGFuIGNvbmZpZ3VyYXRpb24gKGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCB0YWdzLCBtZXRyaWNzLCBldGMuKVxuICAgKiBAcmV0dXJucyBUaGUgcmVzdWx0IG9mIHRoZSBoYW5kbGVyIGZ1bmN0aW9uXG4gICAqIFxuICAgKiBAZXhhbXBsZSBCYXNpYyB1c2FnZSBpbiBhIHF1ZXVlIGhhbmRsZXJcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCkge1xuICAgKiAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG4gICAqICAgXG4gICAqICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGV4ZWNDdHgsIGFzeW5jICgpID0+IHtcbiAgICogICAgIHJldHVybiB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKFxuICAgKiAgICAgICAnU1FTIEJhdGNoIG15UXVldWUnLFxuICAgKiAgICAgICBhc3luYyAoc3BhbikgPT4ge1xuICAgKiAgICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAqICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzKGV2ZW50LCBjb250ZXh0KTtcbiAgICogICAgICAgICBzcGFuLm1ldHJpY3MoeyAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSB9KTtcbiAgICogICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgKiAgICAgICB9LFxuICAgKiAgICAgICB7IGNvcnJlbGF0aW9uSWQsIGNhdXNlZEJ5LCB0YWdzOiB7IHF1ZXVlX25hbWU6ICdteVF1ZXVlJyB9IH1cbiAgICogICAgICk7XG4gICAqICAgfSk7XG4gICAqIH1cbiAgICogYGBgXG4gICAqIFxuICAgKiBAZXhhbXBsZSBDdXN0b20gZXJyb3IgaGFuZGxpbmdcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiB0cnkge1xuICAgKiAgIHJldHVybiBhd2FpdCB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKCdNeSBPcGVyYXRpb24nLCBhc3luYyAoc3BhbikgPT4ge1xuICAgKiAgICAgLy8gLi4uIGhhbmRsZXIgbG9naWNcbiAgICogICB9KTtcbiAgICogfSBjYXRjaCAoZXJyb3IpIHtcbiAgICogICAvLyBDdXN0b20gZXJyb3IgaGFuZGxpbmcgKGZsdXNoIGFscmVhZHkgaGFwcGVuZWQgaW4gZmluYWxseSBibG9jaylcbiAgICogICB0aGlzLmxvZ2dlci5lcnJvcignSGFuZGxlciBmYWlsZWQnLCBlcnJvcik7XG4gICAqICAgdGhyb3cgZXJyb3I7XG4gICAqIH1cbiAgICogYGBgXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2g8VD4oXG4gICAgc3Bhbk5hbWU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIHNwYW5PcHRpb25zPzogU3Bhbk9wdGlvbnNcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oc3Bhbk5hbWUsIGhhbmRsZXIsIHNwYW5PcHRpb25zKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgLy8gQ3JpdGljYWw6IEZsdXNoIEFGVEVSIHNwYW4gY29tcGxldGVzIHRvIGVuc3VyZSBcImNvbXBsZXRlZFwiIHN0YXR1c1xuICAgICAgLy8gRmx1c2hpbmcgaW5zaWRlIHdpdGhTcGFuKCkgY2F1c2VzIHNwYW4gZmluYWxpemVyIHRvIG1hcmsgaXQgYXMgXCJhYmFuZG9uZWRcIlxuICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgY29udHJvbGxlciBhbmQgcmV0dXJucyBpdHMgTGFtYmRhSGFuZGxlciBtZXRob2QuXG4gICAqIEByZXR1cm5zIFRoZSBMYW1iZGFIYW5kbGVyIG1ldGhvZCBvZiB0aGUgY29udHJvbGxlci5cbiAgICovXG4gIHN0YXRpYyBDcmVhdGVIYW5kbGVyKGhhbmRsZXJGdW5jOiB7IG5ldygpOiBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSkge1xuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGhhbmRsZXJGdW5jKCk7XG4gICAgcmV0dXJuIGluc3RhbmNlLkxhbWJkYUhhbmRsZXI7XG4gIH1cbn0iXX0=