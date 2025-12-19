import { SQSEvent, SQSBatchResponse, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { IQueueConfig } from '../../decorators/queue';
import { SpanObserver, generateTraceId } from '../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
  extractFromSqs,
  setParentObservabilityLogId,
} from './execution-context';

/**
 * Result type for queue processing.
 * - void: All messages processed successfully
 * - SQSBatchResponse: Partial batch failure (some messages need retry)
 */
export type QueueProcessResult = void | SQSBatchResponse;

/**
 * Queue execution context - contains queue-specific data AND execution context.
 */
export interface QueueExecutionContext {
  /** The SQS event */
  readonly event: SQSEvent;
  /** Lambda context */
  readonly lambdaContext: Context;
  /** Execution context (also available via getCurrentExecutionContext()) */
  readonly executionContext: ExecutionContextData;
}

/**
 * Base class for handling SQS events.
 * 
 * Generic TEvent allows subclasses to specify more specific event types
 * while maintaining type safety.
 * 
 * All handler execution is wrapped in execution context.
 * Configure observability via the @Queue decorator:
 * 
 * @example
 * ```typescript
 * @Queue('my-queue', {
 *   observability: {
 *     source: 'domain:queue-type',
 *     tags: { domain: 'sports', priority: 'high' }
 *   }
 * })
 * export class MyQueue extends QueueController { }
 * ```
 */
abstract class QueueController<TEvent extends SQSEvent = SQSEvent> extends AbstractLambdaHandler {

  protected initialize(_event: TEvent, _context: Context): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Process the queue event.
   * 
   * Return `void` if all messages processed successfully.
   * Return `SQSBatchResponse` with `batchItemFailures` for partial batch failures
   * (requires `reportBatchItemFailures: true` in queue config).
   * 
   * @param event - The event
   * @param context - The Lambda context  
   * @param ctx - Queue execution context
   * @returns void or SQSBatchResponse for partial batch failures
   */
  abstract process(event: TEvent, context: Context, ctx?: QueueExecutionContext): Promise<QueueProcessResult>;

  protected getQueueConfig(): IQueueConfig {
    return Reflect.get(this, 'queueConfig') || {};
  }

  protected getQueueName(): string | undefined {
    return Reflect.get(this, 'queueName') as string | undefined;
  }

  async LambdaHandler(event: TEvent, context: Context): Promise<QueueProcessResult> {
    this.logger.debug("SQS-LambdaHandler received", { recordCount: event.Records?.length });
    this.initializeEntryPackagesAndObservability();

    const queueName = this.getQueueName() || this.constructor.name;
    const queueConfig = this.getQueueConfig();
    const obsConfig = queueConfig.observability || {};

    // CRITICAL FIX: Do not use Records[0] for context.
    // Each record has its own trace. The Lambda invocation itself represents a "Batch"
    // and should have its own unique correlation ID (Lambda Request ID).
    // Individual record processing should extract context per record.
    // Use W3C Trace ID format for consistency with observability system
    const correlationId = context.awsRequestId || generateTraceId();

    // Build automatic tags for consistent observability
    const automaticTags: Record<string, string> = {
      handler_type: 'queue',
      queue_name: queueName,
      is_batch: 'true',
    };

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
      correlationId,
      // Batch doesn't have a parent log ID from SQS (records do)
      source: obsConfig.source || `queue:${queueName}`,
      tags: {
        ...automaticTags,
        ...obsConfig.tags, // Decorator tags override automatic
      },
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Create span with merged tags (consistent with API Gateway and Task)
      const queueSpan = SpanObserver.start(`SQS Batch ${queueName}`, {
        correlationId,
        source: obsConfig.source || `queue:${queueName}`,
        tags: {
          ...automaticTags,
          ...obsConfig.tags, // Decorator tags override automatic
        },
        attributes: {
          'sqs.queueName': queueName,
          'sqs.batchSize': event.Records.length,
          'faas.execution': context.awsRequestId,
          ...obsConfig.attributes,
        },
      });

      // Store span ID in execution context for child spans
      setParentObservabilityLogId(queueSpan.id);

      // Build queue execution context
      const ctx: QueueExecutionContext = {
        event: event as SQSEvent,
        lambdaContext: context,
        executionContext: execCtx,
      };

      let spanEnded = false;
      const endSpan = async (success: boolean, error?: Error, metrics?: Record<string, number>): Promise<void> => {
        if (!spanEnded) {
          queueSpan.end({ success, error, metrics });
          spanEnded = true;
        }
        await this.flushObservability();
      };

      const startTime = Date.now();
      try {
        await this.initialize(event, context);
        const result = await this.process(event, context, ctx);
        const duration = Date.now() - startTime;

        // Determine success based on result
        const hasFailures = result && 'batchItemFailures' in result && result.batchItemFailures.length > 0;
        const failureCount = hasFailures ? result.batchItemFailures.length : 0;
        const totalCount = event.Records.length;
        const successCount = totalCount - failureCount;

        if (hasFailures) {
          queueSpan.setAttribute('sqs.failure_count', failureCount);
          queueSpan.setAttribute('sqs.success_count', successCount);
          queueSpan.addEvent('sqs.batch.partial_failure', {
            level: 'warn',
            metrics: {
              'sqs.failure_count': failureCount,
              'sqs.success_count': successCount,
              'sqs.total_count': totalCount,
            },
            attributes: {
              'sqs.has_failures': true,
            },
          });
        }

        await endSpan(!hasFailures, undefined, {
          'sqs.batch.duration_ms': duration,
          'sqs.batch.total_count': totalCount,
          'sqs.batch.success_count': successCount,
          'sqs.batch.failure_count': failureCount,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        await endSpan(false, error as Error, {
          'sqs.batch.duration_ms': duration,
          'sqs.batch.total_count': event.Records.length,
          'sqs.batch.errors': 1,
        });
        throw error;
      }
    });
  }
}

export { QueueController };
