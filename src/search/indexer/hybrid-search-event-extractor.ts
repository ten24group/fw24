import { SQSEvent } from 'aws-lambda';
import { BaseEventRecord, ChangeStreamPayload, IEventDataExtractor } from '../../core/types/event-processor-types';
import { createLogger } from '../../logging';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';

/**
 * Hybrid event data extractor that can handle both:
 * 1. DynamoDB stream events (via SQS/SNS) - delegates to DynamoDBEventDataExtractor
 * 2. Direct resync events from search controller
 */
export class HybridSearchEventExtractor implements IEventDataExtractor<SQSEvent, Record<string, any>> {
  private readonly logger = createLogger('HybridSearchEventExtractor');
  private readonly dynamoExtractor = new DynamoDBEventDataExtractor();

  public extractData(event: SQSEvent): BaseEventRecord<Record<string, any>>[] {
    const records: BaseEventRecord<Record<string, any>>[] = [];

    for (const sqsRecord of event.Records) {
      try {
        const body = JSON.parse(sqsRecord.body);



        // Check if this is a resync message (direct from search controller)
        // Support both: { eventName: 'RESYNC', data: ..., entityName: ... }
        // and simple: { data: ..., entityName: ... }
        if (body.eventName === 'RESYNC' || (body.data && body.entityName && !body.Message)) {

          records.push(...this.extractResyncRecords(sqsRecord, body));
        } else {

          // This should be a DynamoDB stream event from SNS
          records.push(...this.extractDynamoStreamRecords(sqsRecord));
        }
      } catch (error) {
        // Log error but continue to try as DynamoDB stream event
        this.logger.error('Failed to parse SQS record body for resync detection:', error);

        records.push(...this.extractDynamoStreamRecords(sqsRecord));
      }
    }

    return records;
  }

  private extractResyncRecords(sqsRecord: any, body: any): BaseEventRecord<Record<string, any>>[] {
    const { data: rawPayload, entityName } = body as { data: any, entityName: string };

    // Handle batch resync: when data is an array, create multiple records
    if (Array.isArray(rawPayload)) {
      return rawPayload.map((item, index) => ({
        eventId: `${sqsRecord.messageId}-${index}`,
        eventType: 'update',
        timestamp: Date.now(),
        eventSource: sqsRecord.eventSource,
        payload: item,
        entityId: item?.id || item?.[`${entityName}Id`],
        entityName,
        metadata: {
          source: 'resync'
        }
      }));
    }

    // Handle individual resync: when data is a single item
    const entityId = rawPayload?.id || rawPayload?.[`${entityName}Id`];
    return [{
      eventId: sqsRecord.messageId,
      eventType: 'update',
      timestamp: Date.now(),
      eventSource: sqsRecord.eventSource,
      payload: rawPayload,
      entityId,
      entityName,
      metadata: {
        source: 'resync'
      }
    }];
  }

  private extractDynamoStreamRecords(sqsRecord: any): BaseEventRecord<Record<string, any>>[] {
    // Create a temporary SQS event for the DynamoDB extractor
    const tempSQSEvent: SQSEvent = { Records: [sqsRecord] };
    const dynamoRecords = this.dynamoExtractor.extractData(tempSQSEvent);

    // Handle case where DynamoDB extractor returns null/undefined
    if (!dynamoRecords || !Array.isArray(dynamoRecords)) {
      this.logger.warn('DynamoDB extractor returned no records', {
        messageId: sqsRecord.messageId
      });
      return [];
    }

    // For stream records, we pass the changeStreamPayload through so the base class can process it
    return dynamoRecords.map(record => {
      const { payload } = record as BaseEventRecord<ChangeStreamPayload>;
      return {
        ...record,
        payload: payload, // Keep the full ChangeStreamPayload
        metadata: {
          ...record.metadata,
          source: 'stream'
        }
      } as BaseEventRecord<Record<string, any>>;
    });
  }
}
