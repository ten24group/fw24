import { DynamoDBStreamEvent, SQSEvent, DynamoDBRecord, SQSRecord } from 'aws-lambda';
import { BaseEventRecord, ChangeStreamPayload, IEventDataExtractor } from '../../types/event-processor-types';
export declare class DynamoDBEventDataExtractor implements IEventDataExtractor<DynamoDBStreamEvent | SQSEvent, ChangeStreamPayload> {
    private readonly logger;
    extractData(event: DynamoDBStreamEvent | SQSEvent): BaseEventRecord<ChangeStreamPayload>[];
    protected extractDynamoDBRecords(event: DynamoDBStreamEvent | SQSEvent): DynamoDBRecord[];
    protected mapSQSRecordToDynamoDBRecord(record: SQSRecord): DynamoDBRecord;
}
