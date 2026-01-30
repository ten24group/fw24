// Path: fw24/src/core/runtime/dynamodb-event-data-extractor.ts
import { DynamoDBStreamEvent, SQSEvent, DynamoDBRecord, SQSRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { BaseEventRecord, ChangeStreamPayload, IEventDataExtractor } from '../../types/event-processor-types';
import { createLogger } from '../../../logging';
import { parseSnsSqsEnvelope } from '../sns-sqs-envelope';

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

      // DynamoDB ApproximateCreationDateTime is in seconds since Unix epoch
      // JavaScript Date constructor expects milliseconds since Unix epoch
      // Example: ApproximateCreationDateTime = 1734567890 (seconds)
      //         Should become: 1734567890000 (milliseconds)
      //         Result: 2024-12-19T10:31:30.000Z
      const timestampInMs = awsRecord.dynamodb.ApproximateCreationDateTime
        ? awsRecord.dynamodb.ApproximateCreationDateTime * 1000
        : undefined;

      processedRecords.push({
        eventId: awsRecord.eventID,
        eventType,
        entityName,
        entityId,
        payload,
        timestamp: timestampInMs,
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
    try {
      const envelope = parseSnsSqsEnvelope(record.body);
      if (!envelope) {
        // Keep existing behavior: this path expects SNS->SQS delivery
        let bodyKeys: string[] | undefined;
        try {
          const raw = JSON.parse(record.body);
          bodyKeys = raw && typeof raw === 'object' ? Object.keys(raw) : undefined;
        } catch {
          bodyKeys = undefined;
        }
        this.logger.error('SNS envelope missing/invalid in SQS body', { bodyKeys });
        throw new Error('SNS Message field is missing from SQS body');
      }

      // Defensive: TS narrowing + runtime safety (even though parseSnsSqsEnvelope validates Message)
      if (!envelope.Message) {
        this.logger.error('SNS envelope missing Message field', { envelopeKeys: Object.keys(envelope) });
        throw new Error('SNS Message field is missing from SQS body');
      }

      const message = JSON.parse(envelope.Message);
      // The actual DynamoDB event might be nested in message.message (from DynamoDB stream processor)
      const actualEvent = message?.message ?? message;



      if (!actualEvent || !actualEvent.eventID) {
        this.logger.error('Invalid SNS message structure', { message, actualEvent });
        throw new Error('SNS message missing required fields');
      }

      // Create a DynamoDB record from the SNS message
      const dynamoRecord: DynamoDBRecord = {
        eventID: actualEvent.eventID,
        eventName: actualEvent.eventName as "INSERT" | "MODIFY" | "REMOVE",
        eventSource: actualEvent.eventSource,
        eventVersion: '1.0',
        awsRegion: record.awsRegion,
        dynamodb: actualEvent.dynamodb
      };

      return dynamoRecord;
    } catch (error) {
      this.logger.error('Error parsing SQS->SNS->DynamoDB message', {
        error: error instanceof Error ? error.message : String(error),
        recordBody: record.body
      });
      throw error;
    }
  }
}