import { Context } from "aws-lambda";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";
import { SpanObserver, generateTraceId, BatchProgress, type BatchSummary } from '../../../observability';
import {
  createExecutionContext,
  runWithExecutionContext,
  ParsedTraceContext,
} from '../execution-context';
import { QueueController, QueueStreamEvent, QueueExecutionContext, QueueProcessResult } from '../sqs-controller';
import { Actor } from '../../types/execution-context';

/**
 * Base class for handling stream events (SQS or DynamoDB Streams) with data extraction.
 * 
 * Extends QueueController to reuse trace extraction logic.
 * Adds the data extractor pattern for transforming raw events into BaseEventRecord.
 * 
 * Key difference from QueueController: uses eventId-based matching to attach trace
 * contexts to extracted records, avoiding index misalignment when records fail to parse.
 */
abstract class BaseSQSEventProcessor<
  T extends IEventDataExtractor<TEvent, TPayload>,
  TEvent extends QueueStreamEvent = QueueStreamEvent,
  TPayload extends Record<string, any> = Record<string, any>
> extends QueueController<TEvent> {

  protected eventDataExtractor: T;
  protected processMode: 'record' | 'batch' = 'record';

  constructor(extractor: T, options?: { processMode?: 'record' | 'batch' }) {
    super();
    if (!extractor) {
      throw new Error('IEventDataExtractor is required for BaseSQSEventProcessor');
    }
    this.eventDataExtractor = extractor;
    if (options?.processMode) {
      this.processMode = options.processMode;
    }
  }

  protected getProcessorName(): string {
    return this.constructor.name;
  }

  /**
   * Index pre-extracted traces by eventId for O(1) lookup.
   */
  private indexTracesByEventId(
    event: TEvent,
    traces: (ParsedTraceContext | undefined)[]
  ): Map<string, ParsedTraceContext> {
    const traceMap = new Map<string, ParsedTraceContext>();
    if (!('Records' in event) || !event.Records) return traceMap;

    const rawRecords = event.Records as any[];
    for (let i = 0; i < rawRecords.length; i++) {
      const eventId = rawRecords[ i ].eventID || rawRecords[ i ].messageId;
      const trace = traces[ i ];
      if (eventId && trace?.correlationId) {
        traceMap.set(eventId, trace);
      }
    }
    return traceMap;
  }

  async LambdaHandler(event: TEvent, context: Context): Promise<void> {
    const eventSource = event.Records?.[ 0 ]?.eventSource ?? 'Unknown';
    this.logger.debug('Processing incoming stream event', {
      eventSourceFromRecord: eventSource,
      recordCount: event.Records?.length,
      processMode: this.processMode,
    });

    this.initializeEntryPackagesAndObservability();

    const processorName = this.getProcessorName();

    const recordTraces = this.extractPerRecordTraceContexts(event);
    const { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch } = this.aggregateBatchTraceContext(recordTraces);

    const invocationId = context.awsRequestId || generateTraceId();
    // Strict hierarchy guarantee: correlationId is per-invocation (local slice).
    // Upstream correlationId becomes causedBy.
    const correlationId = invocationId;

    const processorActor: Actor = {
      actorType: 'service',
      authMethod: 'system',
      actorId: `processor:${processorName}`,
      requestId: invocationId,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    const execCtx = createExecutionContext({
      correlationId,
      causedBy: batchCausedBy,
      actor: processorActor,
      source: `${processorName}.process`,
    });

    return runWithExecutionContext(execCtx, async () => {
      // Use the base class helper for span + flush pattern
      return this.executeWithSpanAndFlush(
        `${eventSource} ${processorName}`,
        async (processorSpan) => {
          await this.initialize(event, context);

          // SQS retry detection — tag when messages are being reprocessed
          const rawRecords = (event as unknown as { Records?: Array<{ attributes?: Record<string, string> }> }).Records;
          if (rawRecords && rawRecords.length > 0) {
            const receiveCounts = rawRecords.map(
              (r) => parseInt(r.attributes?.ApproximateReceiveCount ?? '1', 10)
            );
            const maxReceiveCount = Math.max(...receiveCounts);
            const retryCount = receiveCounts.filter((c) => c > 1).length;
            if (retryCount > 0) {
              processorSpan.tag('sqs.has_retries', 'true');
              processorSpan.metrics({
                'sqs.retry_count': retryCount,
                'sqs.max_receive_count': maxReceiveCount,
              });
            }
          }

          await this.process(event, context);
        },
        {
          correlationId: execCtx.correlationId,
          causedBy: batchCausedBy,
          tags: {
            handler_type: 'event_processor',
            processor_name: processorName,
            event_source: eventSource,
            operation_category: 'event_processing',
            'processor.mode': this.processMode,
            ...(isMixedBatch ? { 'trace.mixed': 'true' } : {}),
            invocationId,
          },
          metrics: {
            'event.recordCount': event.Records?.length ?? 0,
          },
        },
        context
      );
    });
  }

  /**
   * Process event with pre-built trace map.
   */
  private async processWithTraceMap(event: TEvent, traceMap: Map<string, ParsedTraceContext>): Promise<void> {
    const records = this.eventDataExtractor.extractData(event);

    // Attach trace by eventId (O(1) lookup, avoids index misalignment)
    for (const record of records) {
      const trace = traceMap.get(record.eventId || '');
      if (trace?.correlationId) {
        record.traceContext = {
          correlationId: trace.correlationId,
          causedBy: trace.causedBy || trace.correlationId,
        };
      }
    }

    this.logger.debug('Extracted records', { count: records.length, mode: this.processMode });

    if (records.length === 0) {
      this.logger.info('No records extracted for processing.');
      return;
    }

    await this.processRecords(records);
  }

  /**
   * Implement QueueController's abstract process method.
   * Called when used directly (not through LambdaHandler).
   */
  async process(event: TEvent, _context: Context, _ctx?: QueueExecutionContext<TEvent>): Promise<QueueProcessResult> {
    const traces = this.extractPerRecordTraceContexts(event);
    const traceMap = this.indexTracesByEventId(event, traces);
    await this.processWithTraceMap(event, traceMap);
    return { batchItemFailures: [] };
  }

  /**
   * Process records using BatchProgress for automatic tracking and observability.
   * Handles both batch and individual record processing modes.
   */
  protected async processRecords(records: BaseEventRecord<TPayload>[]): Promise<void> {
    const processorName = this.getProcessorName();

    // Apply preprocessing filter to all records
    const filteredRecords: BaseEventRecord<TPayload>[] = [];
    for (const record of records) {
      const processed = await this.preprocessRecord(record);
      if (processed) {
        filteredRecords.push(processed);
      }
    }

    if (filteredRecords.length === 0) {
      this.logger.debug('No records after filtering');
      return;
    }

    if (this.processMode === 'batch') {
      // Batch mode: process all records at once (useful for bulk operations)
      const { summary } = await BatchProgress.all(
        `${processorName} Batch`,
        filteredRecords,
        async (items) => {
          await this.processRecordsBatch(items);

          // Run postprocess for each item
          for (const record of items) {
            await this.postprocessRecord(record);
          }
          return items;
        },
        { tags: { processor: processorName } }
      );

      this.onBatchComplete(summary);
    } else {
      // Record mode: process each record individually with its own span
      const { summary } = await BatchProgress.process(
        processorName,
        filteredRecords,
        async (record, ctx) => {
          // In strict-hierarchy mode:
          // - correlationId stays per-invocation (batch context)
          // - causedBy links to the upstream correlationId for this record (if present)
          const upstream = record.traceContext?.correlationId;

          await SpanObserver.withSpan(
            `${processorName} record`,
            async () => {
              await this.processRecord(record);
              await this.postprocessRecord(record);
            },
            {
              causedBy: upstream,
              // Production behavior: per-record span capture can be group-sampled.
              capture: ctx.getCaptureControl(),
              tags: {
                eventId: record.eventId || '',
                entity: record.entityName || '',
                type: record.eventType || '',
              },
            }
          );
          return record;
        },
        { tags: { processor: processorName } }
      );

      this.onBatchComplete(summary);
    }
  }

  /**
   * Called when batch processing completes. Override to add custom behavior.
   */
  protected onBatchComplete(_summary: BatchSummary): void {
    // Override in subclass if needed
  }

  protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;
  protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;

  protected async preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null> {
    return record;
  }

  protected async postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void> { }
}

export { BaseSQSEventProcessor };
