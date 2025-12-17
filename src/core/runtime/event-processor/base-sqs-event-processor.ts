import { SQSEvent, Context, DynamoDBStreamEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "../abstract-lambda-handler";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";
import { SpanObserver } from '../../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
  extractFromSqs,
} from '../execution-context';

/**
 * Supported event types for stream/queue processing.
 */
export type StreamEvent = SQSEvent | DynamoDBStreamEvent;

/**
 * Execution context for event processors.
 */
export interface EventProcessorContext<TEvent extends StreamEvent = StreamEvent> {
  readonly event: TEvent;
  readonly lambdaContext: Context;
  readonly executionContext: ExecutionContextData;
}

/**
 * Base class for handling stream events (SQS or DynamoDB Streams).
 * 
 * Extends AbstractLambdaHandler directly since it handles multiple event types
 * that are not compatible with each other (SQSEvent vs DynamoDBStreamEvent).
 * 
 * @typeParam T - Event data extractor type
 * @typeParam TEvent - Event type (SQSEvent, DynamoDBStreamEvent, or union)
 * @typeParam TPayload - Payload type extracted from events
 */
abstract class BaseSQSEventProcessor<
  T extends IEventDataExtractor<TEvent, TPayload>,
  TEvent extends StreamEvent = StreamEvent,
  TPayload extends Record<string, any> = Record<string, any>
> extends AbstractLambdaHandler {

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

  /**
   * Initialize the processor. Override in subclass.
   */
  initialize(_event: TEvent, _context: Context): Promise<void> {
    return Promise.resolve();
  }

  protected getProcessorName(): string {
    return this.constructor.name;
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
    const correlationId = this.extractCorrelationIdFromEvent(event, context);

    // Create execution context
    const execCtx = createExecutionContext({
      correlationId,
      source: `${processorName}.process`,
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      const span = SpanObserver.start(`${eventSource} ${processorName}`, {
        correlationId,
        attributes: {
          'event.source': eventSource,
          'event.recordCount': event.Records?.length ?? 0,
          'processor.mode': this.processMode,
        },
      });

      execCtx.parentObservabilityLogId = span.id;

      const ctx: EventProcessorContext<TEvent> = {
        event,
        lambdaContext: context,
        executionContext: execCtx,
      };

      let spanEnded = false;
      const endSpan = async (success: boolean, error?: Error): Promise<void> => {
        if (!spanEnded) {
          span.end({ success, error });
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

  /**
   * Extract correlation ID from event.
   */
  protected extractCorrelationIdFromEvent(event: TEvent, context: Context): string {
    // Try SQS message attributes
    if ('Records' in event && event.Records?.[ 0 ]) {
      const record = event.Records[ 0 ];
      if ('messageAttributes' in record) {
        const sqsRecord = record as SQSEvent[ 'Records' ][ 0 ];
        const traceCtx = extractFromSqs(sqsRecord.messageAttributes);
        if (traceCtx?.correlationId) return traceCtx.correlationId;
      }
    }
    return context.awsRequestId || crypto.randomUUID();
  }

  /**
   * Process the event. Can be overridden for custom processing.
   */
  async process(
    event: TEvent,
    _context: Context,
    _ctx?: EventProcessorContext<TEvent>
  ): Promise<void> {
    this.logger.debug('Extracting records using data extractor');

    const records = this.eventDataExtractor.extractData(event);

    this.logger.debug('Extracted records for processing', {
      recordCount: records.length,
      processMode: this.processMode,
    });

    if (records.length === 0) {
      this.logger.info('No records extracted for processing from the event.');
      return;
    }

    await this.processRecords(records);
  }

  protected async processRecords(records: BaseEventRecord<TPayload>[]): Promise<void> {
    const startTime = Date.now();
    this.logger.debug('Starting record processing', {
      recordCount: records.length,
      processMode: this.processMode,
    });

    // Preprocess and filter
    const preprocessed: BaseEventRecord<TPayload>[] = [];
    for (const record of records) {
      const processed = await this.preprocessRecord(record);
      if (!processed) {
        this.logger.debug('Record filtered out during preprocessing', {
          eventId: record.eventId,
          entityName: record.entityName,
        });
        continue;
      }
      preprocessed.push(processed);
    }

    this.logger.debug('Preprocessing completed', {
      originalCount: records.length,
      preprocessedCount: preprocessed.length,
      filteredCount: records.length - preprocessed.length,
      processMode: this.processMode,
    });

    if (preprocessed.length === 0) {
      this.logger.debug('No records to process after preprocessing.');
      return;
    }

    if (this.processMode === 'batch') {
      this.logger.debug('Executing batch processing mode', { recordCount: preprocessed.length });
      await this.processRecordsBatch(preprocessed);
      this.logger.debug('Batch processing completed, running postprocessors');
      for (const rec of preprocessed) {
        await this.postprocessRecord(rec);
      }
    } else {
      this.logger.debug('Executing record-by-record processing mode', { recordCount: preprocessed.length });
      const processPromises = preprocessed.map(async (processedRecord) => {
        await this.processRecord(processedRecord);
        await this.postprocessRecord(processedRecord);
      });
      await Promise.all(processPromises);
    }

    const duration = Date.now() - startTime;
    this.logger.debug('Record processing completed', {
      processedCount: preprocessed.length,
      processMode: this.processMode,
      durationMs: duration,
      avgTimePerRecord: duration / preprocessed.length,
    });
  }

  /** Process a single record (used in 'record' mode) */
  protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;

  /** Process all records at once (used in 'batch' mode) */
  protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;

  /** Preprocess a record before processing. Return null to filter out. */
  protected async preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null> {
    return record;
  }

  /** Postprocess a record after processing */
  protected async postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void> { }
}

export { BaseSQSEventProcessor };
