import type { Context } from "aws-lambda";
import { IValidator } from "../../validation";
import { SpanObserver, SpanOptions } from "../../observability";
export declare abstract class AbstractLambdaHandler {
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    protected validator: IValidator;
    /**
     * Binds the LambdaHandler method to the instance of the class.
     */
    constructor();
    abstract LambdaHandler(event: any, context: any): Promise<any>;
    /**
     * Initialize observability for this invocation.
     * Called at the start of each handler execution.
     *
     * Ensure entry packages are loaded proeprly, before
     * before observability initialization attempts to resolve config.
     */
    protected initializeEntryPackagesAndObservability(): void;
    /**
     * Flush observability data at the end of handler execution.
     */
    protected flushObservability(): Promise<void>;
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
    protected executeWithSpanAndFlush<T>(spanName: string, handler: (span: SpanObserver) => Promise<T>, spanOptions?: SpanOptions, lambdaContext?: Context): Promise<T>;
    /**
     * Enrich the root span with cold start tracking, runtime metrics, and Lambda context.
     * Called automatically by executeWithSpanAndFlush for every handler invocation.
     * Concrete handlers should pass `lambdaContext` for full enrichment.
     */
    protected enrichRootSpan(span: SpanObserver, lambdaContext?: Context): void;
    /**
     * Build Lambda runtime tags from the AWS Lambda context object.
     * Call this from concrete handler types that have access to the Lambda context.
     */
    protected buildRuntimeTags(lambdaContext: Context): Record<string, string>;
    /**
     * Build Lambda runtime metrics from the AWS Lambda context object.
     * Call this from concrete handler types that have access to the Lambda context.
     */
    protected buildRuntimeMetrics(lambdaContext: Context): Record<string, number>;
    /**
     * Creates a new instance of the controller and returns its LambdaHandler method.
     * @returns The LambdaHandler method of the controller.
     */
    static CreateHandler(handlerFunc: {
        new (): AbstractLambdaHandler;
    }): (event: any, context: any) => Promise<any>;
}
