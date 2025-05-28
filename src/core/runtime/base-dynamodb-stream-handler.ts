import { DynamoDBStreamEvent, SQSEvent, DynamoDBRecord } from 'aws-lambda';
import { AbstractLambdaHandler } from './abstract-lambda-handler';


/**
 * Maps DynamoDB stream event types to CRUD operations
 */
export const EVENT_TYPE_MAP = {
  INSERT: 'create',
  MODIFY: 'update',
  REMOVE: 'delete'
} as const;

/**
 * Base DynamoDB stream handler that can be extended by audit, search indexing, and other stream processors
 */
export abstract class BaseDynamoDBStreamHandler extends AbstractLambdaHandler {

  protected async initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
  }

  /**
   * Lambda handler function required by AbstractLambdaHandler
   */
  async LambdaHandler(event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
    this.logger.debug('Processing DynamoDB stream event', { event });

    try {

      this.logger.debug('Initializing');
      await this.initialize(event);

      this.logger.debug('Extracting records');
      // Extract DynamoDB records using framework utility
      const records = this.extractDynamoDBRecords(event);

      this.logger.debug('Extracted records for processing', { recordCount: records.length });

      await this.process(records);

      this.logger.debug('Successfully processed all DynamoDB stream records');

    } catch (error) {
      this.logger.error('Error processing DynamoDB stream records', error);
      throw error;
    }
  }

  protected extractDynamoDBRecords(event: DynamoDBStreamEvent | SQSEvent): DynamoDBRecord[] {
    // Type guard for SQS events
    const isSQSEvent = (event: DynamoDBStreamEvent | SQSEvent): event is SQSEvent => {
      return 'Records' in event && event.Records[ 0 ]?.eventSource === 'aws:sqs';
    };

    if (isSQSEvent(event)) {
      // Handle SQS event
      return event.Records.reduce<DynamoDBRecord[]>((acc, record) => {
        try {
          const body = JSON.parse(record.body);
          const message = JSON.parse(body.Message);

          // Create a DynamoDB record from the message
          const dynamoRecord: DynamoDBRecord = {
            eventID: message.message.eventID,
            eventName: message.message.eventName as "INSERT" | "MODIFY" | "REMOVE",
            eventSource: message.message.eventSource,
            eventVersion: '1.0',
            awsRegion: record.awsRegion,
            dynamodb: message.message.dynamodb
          };

          acc.push(dynamoRecord);
        } catch (error) {
          this.logger.error('Error parsing SQS message', { error, record });
        }
        return acc;
      }, []);
    }

    // Handle direct DynamoDB stream event
    return event.Records;
  }

  protected async process(records: DynamoDBRecord[]): Promise<void> {

    // Process each record with custom logic
    const processPromises = records.map(async record => {

      // Allow custom preprocessing (filtering, transformation, etc.)
      const processedRecord = await this.preprocessRecord(record);

      if (!processedRecord) {
        this.logger.debug('Record filtered out during preprocessing', { eventID: record.eventID });
        return; // Skip if filtered out
      }

      // Subclasses must implement the actual processing logic
      await this.processRecord(processedRecord);

      // Allow custom postprocessing
      await this.postprocessRecord(processedRecord);

    });
    await Promise.all(processPromises);
  }

  /**
   * Subclasses must implement this to define their specific record processing logic
   */
  protected abstract processRecord(record: DynamoDBRecord): Promise<void>;


  /**
   * Override to add custom preprocessing
   * Return null to skip processing this record
   */
  protected async preprocessRecord(record: DynamoDBRecord): Promise<DynamoDBRecord | null> {
    return record;
  }
  /**
   * Override to add custom postprocessing
   */
  protected async postprocessRecord(_record: DynamoDBRecord): Promise<void> {
  }
} 