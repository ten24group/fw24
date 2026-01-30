import { SQSEvent } from 'aws-lambda';
import { BaseEventRecord, IEventDataExtractor } from '../../core/types/event-processor-types';
/**
 * Hybrid event data extractor that can handle both:
 * 1. DynamoDB stream events (via SQS/SNS) - delegates to DynamoDBEventDataExtractor
 * 2. Direct resync events from search controller
 */
export declare class HybridSearchEventExtractor implements IEventDataExtractor<SQSEvent, Record<string, any>> {
    private readonly logger;
    private readonly dynamoExtractor;
    extractData(event: SQSEvent): BaseEventRecord<Record<string, any>>[];
    private extractResyncRecords;
    private extractDynamoStreamRecords;
}
