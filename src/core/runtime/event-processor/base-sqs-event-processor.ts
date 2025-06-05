import { SQSEvent, Context, DynamoDBStreamEvent } from "aws-lambda";
import { QueueController } from "../sqs-controller";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";

/**
 * Base class for handling SQS events.
 */
abstract class BaseSQSEventProcessor<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends QueueController {

  protected eventDataExtractor: T;

  constructor(extractor: T) {
    super();
    if (!extractor) {
      throw new Error('IEventDataExtractor is required for BaseSQSEventProcessor');
    }
    this.eventDataExtractor = extractor;
  }

  abstract initialize(event: TEvent | SQSEvent, context: Context): Promise<any>;

  // initialize method can remain as is if no changes needed

  async LambdaHandler(event: TEvent | SQSEvent, context: Context) {
    const eventSource = event.Records && event.Records.length > 0 ? event.Records[ 0 ].eventSource : 'Unknown';
    this.logger.debug('Processing incoming stream event', { eventSourceFromRecord: eventSource, recordCount: event.Records?.length });

    this.logger.debug('Initializing event processor');
    await this.initialize(event, context);

    this.logger.debug('Processing event');
    await this.process(event as TEvent, context);
  }

  async process(event: TEvent, _context: Context) {

    this.logger.debug('Extracting records using data extractor');

    const records: BaseEventRecord<TPayload>[] = this.eventDataExtractor.extractData(event);

    this.logger.debug('Extracted records for processing', { recordCount: records.length });

    if (records.length === 0) {
      this.logger.info('No records extracted for processing from the event.');
      return;
    }

    await this.processRecords(records);
  }

  protected async processRecords(records: BaseEventRecord<TPayload>[]) {

    this.logger.debug('Processing records', { recordCount: records.length });

    const processPromises = records.map(async record => {

      const processedRecord = await this.preprocessRecord(record);

      if (!processedRecord) {
        this.logger.debug('Record filtered out during preprocessing', { eventId: record.eventId, entityName: record.entityName });
        return;
      }

      await this.processRecord(processedRecord);

      await this.postprocessRecord(processedRecord);

    });

    await Promise.all(processPromises);

    this.logger.debug(`Successfully processed ${records.length} extracted records from the event`);
  }

  protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;

  protected async preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null> {
    return record;
  }

  protected async postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void> { }

}

export { BaseSQSEventProcessor };