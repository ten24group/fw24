import { SQSEvent, Context, DynamoDBStreamEvent } from "aws-lambda";
import { QueueController } from "../sqs-controller";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";

/**
 * Base class for handling SQS events.
 */
abstract class BaseSQSEventProcessor<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends QueueController {

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

  abstract initialize(event: TEvent | SQSEvent, context: Context): Promise<any>;

  // initialize method can remain as is if no changes needed

  async LambdaHandler(event: TEvent | SQSEvent, context: Context) {
    const eventSource = event.Records && event.Records.length > 0 ? event.Records[ 0 ].eventSource : 'Unknown';
    this.logger.debug('Processing incoming stream event', {
      eventSourceFromRecord: eventSource,
      recordCount: event.Records?.length,
      processMode: this.processMode,
      event: event,
      // context: context
    });

    this.logger.debug('Initializing event processor');
    await this.initialize(event, context);

    this.logger.debug('Processing event');
    await this.process(event as TEvent, context);
  }

  async process(event: TEvent, _context: Context) {

    this.logger.debug('Extracting records using data extractor');

    const records: BaseEventRecord<TPayload>[] = this.eventDataExtractor.extractData(event);

    this.logger.debug('Extracted records for processing', { recordCount: records.length, processMode: this.processMode });

    if (records.length === 0) {
      this.logger.info('No records extracted for processing from the event.');
      return;
    }

    await this.processRecords(records);
  }

  protected async processRecords(records: BaseEventRecord<TPayload>[]) {

    const startTime = Date.now();
    this.logger.debug('Starting record processing', { recordCount: records.length, processMode: this.processMode });

    // Preprocess and filter
    const preprocessed: BaseEventRecord<TPayload>[] = [];
    for (const record of records) {
      const processed = await this.preprocessRecord(record);
      if (!processed) {
        this.logger.debug('Record filtered out during preprocessing', { eventId: record.eventId, entityName: record.entityName });
        continue;
      }
      preprocessed.push(processed);
    }

    this.logger.debug('Preprocessing completed', { 
      originalCount: records.length, 
      preprocessedCount: preprocessed.length, 
      filteredCount: records.length - preprocessed.length,
      processMode: this.processMode 
    });

    if (preprocessed.length === 0) {
      this.logger.info('No records to process after preprocessing.');
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
      avgTimePerRecord: duration / preprocessed.length 
    });
  }

  // Abstract method for per-record processing (used in 'record' mode)
  protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;

  // Abstract method for batch processing (used in 'batch' mode)
  protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;

  protected async preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null> {
    return record;
  }

  protected async postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void> { }

}

export { BaseSQSEventProcessor };