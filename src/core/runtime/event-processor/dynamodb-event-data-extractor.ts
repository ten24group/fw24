// Path: fw24/src/core/runtime/dynamodb-event-data-extractor.ts
import { DynamoDBStreamEvent, SQSEvent, DynamoDBRecord, SQSRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { BaseEventRecord, ChangeStreamPayload, IEventDataExtractor } from '../../types/event-processor-types';
import { createLogger } from '../../../logging';

const DYNAMODB_OPERATION_TO_EVENT_TYPE: Record<string, string> = {
  INSERT: 'create',
  MODIFY: 'update',
  REMOVE: 'delete',
};

export class DynamoDBEventDataExtractor implements IEventDataExtractor<DynamoDBStreamEvent | SQSEvent, ChangeStreamPayload> {
  private readonly logger = createLogger('DynamoDBEventDataExtractor');

  public extractData(event: DynamoDBStreamEvent | SQSEvent): BaseEventRecord<ChangeStreamPayload>[] {
    const awsDynamoDBRecords = this.extractDynamoDBRecords(event);
    const processedRecords: BaseEventRecord<ChangeStreamPayload>[] = [];

    for (const awsRecord of awsDynamoDBRecords) {

      if (!awsRecord.dynamodb) {
        this.logger.warn('AWS Record does not contain DynamoDB data; skipping.', { awsRecordEventID: awsRecord.eventID });
        continue;
      }

      const rawDynamoDBEventName = awsRecord.eventName;
      const eventType = DYNAMODB_OPERATION_TO_EVENT_TYPE[ rawDynamoDBEventName as string ];

      if (!rawDynamoDBEventName || !eventType) {
        this.logger.warn('Unknown DynamoDB event name on AWS Record; skipping.', { rawDynamoDBEventName, awsRecordEventID: awsRecord.eventID });
        continue;
      }

      const oldImage = awsRecord.dynamodb.OldImage
        ? unmarshall(awsRecord.dynamodb.OldImage as Record<string, AttributeValue>)
        : undefined;

      const newImage = awsRecord.dynamodb.NewImage
        ? unmarshall(awsRecord.dynamodb.NewImage as Record<string, AttributeValue>)
        : undefined;

      const keys = awsRecord.dynamodb.Keys
        ? unmarshall(awsRecord.dynamodb.Keys as Record<string, AttributeValue>)
        : undefined;

      // extract entity name
      const entityName = (newImage?.__edb_e__ || oldImage?.__edb_e__ || keys?.__edb_e__) as string | undefined;

      // extract entity identifier
      let entityId: string | undefined;
      const idSource = newImage || oldImage || keys;
      if (idSource) {
        // we only check if there's an `id` or `{entityName}Id` key in the source object
        entityId = idSource[ 'id' ] || (entityName ? idSource[ `${entityName}Id` ] : undefined);
      }

      // create payload
      const payload: ChangeStreamPayload = { oldImage, newImage, keys };

      processedRecords.push({
        eventId: awsRecord.eventID,
        eventType,
        entityName,
        entityId,
        payload,
        timestamp: awsRecord.dynamodb.ApproximateCreationDateTime,
        eventSource: awsRecord.eventSource || 'aws:dynamodb',
        metadata: {
          rawSourceEventName: rawDynamoDBEventName, // Keep the original DynamoDB event name
          awsRegion: awsRecord.awsRegion,
        },
      });
    }

    return processedRecords;
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
          const dynamoRecord = this.mapSQSRecordToDynamoDBRecord(record);
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

  protected mapSQSRecordToDynamoDBRecord(record: SQSRecord): DynamoDBRecord {
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

    return dynamoRecord;
  }
}