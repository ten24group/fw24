import { SQSEvent, SQSBatchResponse, Context, DynamoDBStreamEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { IQueueConfig } from '../../decorators/queue';
import { SpanObserver, generateTraceId } from '../../observability';
import {
  ExecutionContextData,
  ParsedTraceContext,
  createExecutionContext,
  runWithExecutionContext,
  extractFromSqsRecord,
} from './execution-context';
import { Actor } from '../types/execution-context';

/**
 * Supported event types for queue/stream processing.
 */
export type QueueStreamEvent = SQSEvent | DynamoDBStreamEvent;

/**
 * Result type for queue processing.
 * - void: All messages processed successfully
 * - SQSBatchResponse: Partial batch failure (some messages need retry)
 */
export type QueueProcessResult = void | SQSBatchResponse;

/**
 * Queue execution context - contains queue-specific data AND execution context.
 */
export interface QueueExecutionContext<TEvent extends QueueStreamEvent = SQSEvent> {
  /** The event */
  readonly event: TEvent;
  /** Lambda context */
  readonly lambdaContext: Context;
  /** Execution context (also available via getCurrentExecutionContext()) */
  readonly executionContext: ExecutionContextData;
}

/**
 * Base class for handling SQS events (and optionally DynamoDB Stream events).
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
abstract class QueueController<TEvent extends QueueStreamEvent = SQSEvent> extends AbstractLambdaHandler {

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
  abstract process(event: TEvent, context: Context, ctx?: QueueExecutionContext<TEvent>): Promise<QueueProcessResult>;

  protected getQueueConfig(): IQueueConfig {
    return Reflect.get(this, 'queueConfig') || {};
  }

  protected getQueueName(): string | undefined {
    return Reflect.get(this, 'queueName') as string | undefined;
  }

  /**
   * Extract per-record trace contexts from the event.
   * Override in subclasses for different event types (e.g., DynamoDB streams).
   *
   * @param event - The incoming event
   * @returns Array of trace contexts (one per record, may contain undefined entries)
   */
  protected extractPerRecordTraceContexts(event: TEvent): (ParsedTraceContext | undefined)[] {
    if (!('Records' in event) || !event.Records) return [];
    return event.Records.map((r: any) => {
      // 1. SQS records: extract from messageAttributes or SNS envelope in body
      if (r.messageAttributes !== undefined || r.body !== undefined) {
        const fromSqs = extractFromSqsRecord({ messageAttributes: r.messageAttributes, body: r.body });
        if (fromSqs?.correlationId) return fromSqs;
      }

      // 2. DynamoDB stream records: extract from _actor field in the record
      if (r.dynamodb) {
        // Strict contract:
        // - Only trust NEW image for current operation trace context.
        // - OldImage contains stale context (who last wrote), not who performed the current op.
        // - For deletes (no NewImage), we cannot reliably determine the upstream cause from the stream record alone.
        const image = r.dynamodb.NewImage;
        if (image?._actor) {
          // Handle both marshalled (DynamoDB format) and unmarshalled formats
          const actor = image._actor.M || image._actor;
          const correlationId = actor?.correlationId?.S || actor?.correlationId;
          if (correlationId) {
            return {
              correlationId,
            };
          }
        }
      }

      return undefined;
    });
  }

  /**
   * Aggregate per-record trace contexts into batch-level trace info.
   */
  protected aggregateBatchTraceContext(
    recordTraceContexts: (ParsedTraceContext | undefined)[]
  ): { batchCausedBy?: string; batchUpstreamCorrelationId?: string; isMixedBatch: boolean } {
    const upstreamCorrelationCandidates = recordTraceContexts
      .map((t) => t?.correlationId)
      .filter((v): v is string => !!v);
    const batchUpstreamCorrelationId =
      upstreamCorrelationCandidates.length > 0 && upstreamCorrelationCandidates.every((v) => v === upstreamCorrelationCandidates[ 0 ])
        ? upstreamCorrelationCandidates[ 0 ]
        : undefined;

    // In strict-hierarchy mode, correlationId is per-invocation. Upstream correlationId becomes causedBy.
    const batchCausedBy = batchUpstreamCorrelationId;
    const isMixedBatch = upstreamCorrelationCandidates.length > 1 && batchUpstreamCorrelationId === undefined;

    return { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch };
  }

  async LambdaHandler(event: TEvent, context: Context): Promise<QueueProcessResult> {
    this.logger.debug("SQS-LambdaHandler received", { recordCount: event.Records?.length });
    this.initializeEntryPackagesAndObservability();

    const queueName = this.getQueueName() || this.constructor.name;
    const queueConfig = this.getQueueConfig();
    const obsConfig = queueConfig.observability || {};

    // Extract and aggregate trace contexts
    const recordTraceContexts = this.extractPerRecordTraceContexts(event);
    const { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch } = this.aggregateBatchTraceContext(recordTraceContexts);

    const invocationId = context.awsRequestId || generateTraceId();
    // Strict hierarchy guarantee: correlationId is per-invocation (local slice).
    const correlationId = invocationId;

    const batchActor: Actor = {
      actorType: 'service',
      authMethod: 'system',
      actorId: `queue:${queueName}`,
      requestId: invocationId,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    // Build automatic tags for consistent observability
    const automaticTags: Record<string, string> = {
      handler_type: 'queue',
      queue_name: queueName,
      is_batch: 'true',
    };

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
      correlationId,
      causedBy: batchCausedBy,
      actor: batchActor,
      // Batch doesn't have a parent log ID from SQS (records do)
      source: obsConfig.source || `queue:${queueName}`,
      tags: {
        ...automaticTags,
        ...obsConfig.tags, // Decorator tags override automatic
        invocationId,
      },
    });

    // Build queue execution context
    const ctx: QueueExecutionContext<TEvent> = {
      event,
      lambdaContext: context,
      executionContext: execCtx,
    };

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Use the base class helper for span + flush pattern
      return this.executeWithSpanAndFlush(
        `SQS Batch ${queueName}`,
        async (queueSpan) => {
          const startTime = Date.now();
          try {
            await this.initialize(event, context);

            // SQS retry detection — tag when messages are being reprocessed
            const receiveCounts = (event.Records as Array<{ attributes?: Record<string, string> }>).map(
              (r) => parseInt(r.attributes?.ApproximateReceiveCount ?? '1', 10)
            );
            const maxReceiveCount = Math.max(...receiveCounts);
            const retryCount = receiveCounts.filter((c) => c > 1).length;
            if (retryCount > 0) {
              queueSpan.tag('sqs.has_retries', 'true');
              queueSpan.metrics({
                'sqs.retry_count': retryCount,
                'sqs.max_receive_count': maxReceiveCount,
              });
            }

            const result = await this.process(event, context, ctx);
            const duration = Date.now() - startTime;

            // Determine success based on result
            const hasFailures = result && 'batchItemFailures' in result && result.batchItemFailures.length > 0;
            const failureCount = hasFailures ? result.batchItemFailures.length : 0;
            const totalCount = event.Records.length;
            const successCount = totalCount - failureCount;

            if (hasFailures) {
              SpanObserver.getCurrentSpan()?.checkpoint?.('sqs.batch.partial_failure', {
                tags: {
                  'sqs.has_failures': 'true',
                },
                metrics: {
                  'sqs.batch.failure_count': failureCount,
                },
              });
            }

            // Set final metrics on span
            queueSpan.metrics({
              'sqs.batch.duration_ms': duration,
              'sqs.batch.total_count': totalCount,
              'sqs.batch.success_count': successCount,
              'sqs.batch.failure_count': failureCount,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;
            queueSpan.metrics({
              'sqs.batch.duration_ms': duration,
              'sqs.batch.total_count': event.Records.length,
              'sqs.batch.errors': 1,
            });
            throw error;
          }
        },
        {
          correlationId,
          causedBy: batchCausedBy,
          source: obsConfig.source || `queue:${queueName}`,
          tags: {
            ...automaticTags,
            ...obsConfig.tags,
            'sqs.queueName': queueName,
            'faas.execution': context.awsRequestId,
            ...(isMixedBatch ? { 'trace.mixed': 'true' } : {}),
          },
          metrics: {
            'sqs.batchSize': event.Records.length,
          },
        },
        context
      );
    });
  }
}

export { QueueController };
