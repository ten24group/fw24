import type { Context } from "aws-lambda";
import { createLogger } from "../../logging";
import { DefaultValidator, IValidator } from "../../validation";
import { ObservabilityManager, SpanObserver, SpanOptions } from "../../observability";
import { tryImportingEntryPackagesFor } from "../../decorators/decorator-utils";

export abstract class AbstractLambdaHandler {
  readonly logger = createLogger(this.constructor.name);
  protected validator: IValidator = DefaultValidator;

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract LambdaHandler(event: any, context: any): Promise<any>;

  /**
   * Initialize observability for this invocation.
   * Called at the start of each handler execution.
   * 
   * Ensure entry packages are loaded proeprly, before 
   * before observability initialization attempts to resolve config.
   */
  protected initializeEntryPackagesAndObservability(): void {
    // Load entry packages (idempotent - safe to call multiple times)
    // This ensures DI config is available for bundled framework handlers
    tryImportingEntryPackagesFor(this.constructor.name);

    // Now initialize observability with proper DI config
    ObservabilityManager.initializeInvocation();
  }

  /**
   * Flush observability data at the end of handler execution.
   */
  protected async flushObservability(): Promise<void> {
    await ObservabilityManager.flush();
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
  protected async executeWithSpanAndFlush<T>(
    spanName: string,
    handler: (span: SpanObserver) => Promise<T>,
    spanOptions?: SpanOptions,
    lambdaContext?: Context
  ): Promise<T> {
    try {
      return await SpanObserver.withSpan(spanName, (span) => {
        // Enrich root span with cold start info, runtime context, and Lambda metadata
        this.enrichRootSpan(span, lambdaContext);
        return handler(span);
      }, spanOptions);
    } finally {
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
  protected enrichRootSpan(span: SpanObserver, lambdaContext?: Context): void {
    // Cold start tracking — first invocation of this Lambda container
    if (ObservabilityManager.isColdStart()) {
      span.tag('cold_start', 'true');
    }
    span.metric('invocation_number', ObservabilityManager.getInvocationCount());

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
  protected buildRuntimeTags(lambdaContext: Context): Record<string, string> {
    const tags: Record<string, string> = {};
    if (lambdaContext.functionName) tags['lambda.function_name'] = lambdaContext.functionName;
    if (lambdaContext.memoryLimitInMB) tags['lambda.memory_limit_mb'] = String(lambdaContext.memoryLimitInMB);
    if (lambdaContext.awsRequestId) tags['lambda.request_id'] = lambdaContext.awsRequestId;
    if (lambdaContext.logGroupName) tags['lambda.log_group'] = lambdaContext.logGroupName;
    return tags;
  }

  /**
   * Build Lambda runtime metrics from the AWS Lambda context object.
   * Call this from concrete handler types that have access to the Lambda context.
   */
  protected buildRuntimeMetrics(lambdaContext: Context): Record<string, number> {
    const metrics: Record<string, number> = {};
    if (typeof lambdaContext.getRemainingTimeInMillis === 'function') {
      metrics['lambda.remaining_time_ms'] = lambdaContext.getRemainingTimeInMillis();
    }
    return metrics;
  }

  /**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler(handlerFunc: { new(): AbstractLambdaHandler }) {
    const instance = new handlerFunc();
    return instance.LambdaHandler;
  }
}