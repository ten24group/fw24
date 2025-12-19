import { DynamoDBStreamEvent, SQSEvent, Context } from 'aws-lambda';
import { BaseSQSEventProcessor, EventProcessorContext } from './event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from './event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../types/event-processor-types';
/**
 * Processor that forwards DynamoDB Stream events to SNS.
 *
 * Key Design Decisions:
 * 1. Preserves DynamoDB AttributeValue format for downstream consumers
 * 2. Extracts trace context from _actor field for distributed tracing
 * 3. Uses SNS batching for standard topics (10x performance improvement)
 * 4. Publishes individually for FIFO topics (required by AWS due to different messageGroupIds)
 */
export declare class DynamoDBStreamToSNSProcessor extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {
    private topicArn;
    constructor();
    initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void>;
    protected processRecord(_record: BaseEventRecord<ChangeStreamPayload>): Promise<void>;
    protected processRecordsBatch(_records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void>;
    /**
     * Override process() to work with raw DynamoDB records.
     * This is critical to preserve the original AttributeValue format (e.g., { S: "value" })
     * that downstream SNS consumers expect. The base class's eventDataExtractor would
     * unmarshall these into plain JavaScript objects, breaking compatibility.
     */
    process(event: DynamoDBStreamEvent | SQSEvent, _context: Context, _ctx: EventProcessorContext<DynamoDBStreamEvent | SQSEvent>): Promise<void>;
    private processRawRecordsBatch;
    /**
     * Extract trace context from DynamoDB record's _actor field.
     * The _actor field is automatically populated by the framework when records are created/updated.
     *
     * Structure: { _actor: { M: { correlationId: { S: "..." }, parentObservabilityLogId: { S: "..." }, sampled: { BOOL: true } } } }
     *
     * This enables distributed tracing by linking DynamoDB changes back to the originating request.
     *
     * IMPORTANT: Sets causedBy = original correlationId to link the stream processing back to the API request that caused the DB change.
     *
     * Note: messageAttributes are included in the SNS message BODY (not SNS message attributes)
     * to preserve them when downstream consumers unmarshal the DynamoDB AttributeValue format.
     */
    private extractTraceContext;
    /**
     * Publish records to FIFO topic individually.
     *
     * FIFO topics cannot be batched because each DynamoDB record has a different messageGroupId
     * (derived from the record's primary key). SNS batching requires all messages in a batch
     * to have the same messageGroupId.
     *
     * Publishes are done in parallel for better performance.
     */
    private publishFifoRecords;
    /**
     * Publish records to standard topic using SNS batching.
     *
     * Standard topics support batching up to 10 messages per API call,
     * providing ~10x performance improvement over individual publishes.
     *
     * Benefits:
     * - Reduced latency (fewer API calls)
     * - Lower cost (fewer requests)
     * - Better throughput
     */
    private publishStandardBatch;
}
export declare const handler: (event: any, context: any) => Promise<any>;
