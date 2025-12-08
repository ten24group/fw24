import { SQSEvent, Context } from "aws-lambda";
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
 */
abstract class QueueController<TEvent extends SQSEvent = SQSEvent> extends AbstractLambdaHandler {

  protected initialize(_event: TEvent, _context: Context): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Process the queue event.
   * @param event - The event
   * @param context - The Lambda context  
   * @param ctx - Queue execution context
   */
  abstract process(event: TEvent, context: Context, ctx?: QueueExecutionContext): Promise<void>;

  protected getQueueConfig(): IQueueConfig {
    return Reflect.get(this, 'queueConfig') || {};
  }

  protected getQueueName(): string | undefined {
    return Reflect.get(this, 'queueName') as string | undefined;
  }

  async LambdaHandler(event: TEvent, context: Context): Promise<void> {
    this.logger.debug("SQS-LambdaHandler received", { recordCount: event.Records?.length });
    this.initializeObservability();
    
    const queueName = this.getQueueName() || this.constructor.name;
    const messageAttributes = event.Records?.[0]?.messageAttributes || {};
    const traceContext = extractFromSqs(messageAttributes);
    const correlationId = traceContext?.correlationId || context.awsRequestId || crypto.randomUUID();

    // Create execution context
    const execCtx = createExecutionContext({
      correlationId,
      parentLogId: traceContext?.parentLogId,
      sampled: traceContext?.sampled,
      source: `${this.constructor.name}.process`,
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Create span
      const queueSpan = SpanObserver.start(`SQS ${queueName}`, {
        correlationId,
        parentLogId: traceContext?.parentLogId,
        attributes: {
          'sqs.queueName': queueName,
          'sqs.batchSize': event.Records.length,
        },
      });

      // Store span ID in execution context for child spans
      execCtx.parentLogId = queueSpan.id;

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
        await this.process(event, context, ctx);
        await endSpan(true);
      } catch (error) {
        await endSpan(false, error as Error);
        throw error;
      }
    });
  }
}

export { QueueController };
