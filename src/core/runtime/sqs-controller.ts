import { SQSEvent, SQSBatchResponse, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { IQueueConfig } from '../../decorators/queue';
import { SpanObserver } from '../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
  extractFromSqs,
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
    this.initializeObservability();
    
    const queueName = this.getQueueName() || this.constructor.name;
    const queueConfig = this.getQueueConfig();
    const obsConfig = queueConfig.observability || {};
    const messageAttributes = event.Records?.[0]?.messageAttributes || {};
    const traceContext = extractFromSqs(messageAttributes);
    const correlationId = traceContext?.correlationId || context.awsRequestId || crypto.randomUUID();

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
      correlationId,
      parentObservabilityLogId: traceContext?.parentObservabilityLogId,
      sampled: traceContext?.sampled,
      source: obsConfig.source || `queue:${queueName}`,
      tags: {
        queueName,
        ...obsConfig.tags,
      },
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Create span with custom attributes from decorator
      const queueSpan = SpanObserver.start(`SQS ${queueName}`, {
        correlationId,
        parentObservabilityLogId: traceContext?.parentObservabilityLogId,
        source: obsConfig.source || `queue:${queueName}`,
        tags: obsConfig.tags,
        attributes: {
          'sqs.queueName': queueName,
          'sqs.batchSize': event.Records.length,
          ...obsConfig.attributes,
        },
      });

      // Store span ID in execution context for child spans
      execCtx.parentObservabilityLogId = queueSpan.id;

      // Build queue execution context
      const ctx: QueueExecutionContext = {
        event: event as SQSEvent,
        lambdaContext: context,
        executionContext: execCtx,
      };

      let spanEnded = false;
      const endSpan = async (success: boolean, error?: Error): Promise<void> => {
        if (!spanEnded) {
          queueSpan.end({ success, error });
          spanEnded = true;
        }
        await this.flushObservability();
      };

      try {
        await this.initialize(event, context);
        const result = await this.process(event, context, ctx);
        
        // Determine success based on result
        const hasFailures = result && 'batchItemFailures' in result && result.batchItemFailures.length > 0;
        await endSpan(!hasFailures);
        
        return result;
      } catch (error) {
        await endSpan(false, error as Error);
        throw error;
      }
    });
  }
}

export { QueueController };
