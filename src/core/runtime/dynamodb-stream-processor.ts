import { DynamoDBStreamEvent, SQSEvent, Context } from 'aws-lambda';
import { createHash } from 'crypto';
import { Environment } from '../../client';
import { sendTopicMessage, sendTopicMessageBatch, BatchTopicMessage } from '../../client/sns';
import { BaseSQSEventProcessor } from './event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from './event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../types/event-processor-types';
import { QueueExecutionContext } from './sqs-controller';
import { BatchProgress } from '../../observability';

// NOTE: Trace propagation is handled by `sendTopicMessage` / `sendTopicMessageBatch`
// via the centralized execution-context propagation helpers.
// Do NOT embed trace context into the message body (it won't be extracted by consumers).

/**
 * Generates a deterministic deduplication ID from the record.
 * Required for FIFO topics to prevent duplicate processing.
 */
function generateDeduplicationId(record: any): string {
    const data = `${record.eventID}-${record.eventName}-${JSON.stringify(record.dynamodb)}`;
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Determines if the topic is FIFO based on environment variable.
 * TOPIC_TYPE is set at deployment time in the CDK construct.
 */
function isTopicFifo(): boolean {
    return process.env.TOPIC_TYPE?.toLowerCase() === 'fifo';
}

/**
 * Gets FIFO specific message properties if FIFO is enabled.
 * For FIFO topics, each message needs a unique group ID and deduplication ID.
 * Group ID is derived from the DynamoDB record's primary key for proper ordering.
 */
function getFifoProperties(record: any) {
    if (!isTopicFifo()) {
        return {};
    }

    return {
        messageGroupId: record.dynamodb?.Keys?.id?.S || record.eventID,
        messageDeduplicationId: generateDeduplicationId(record)
    };
}

/**
 * Processor that forwards DynamoDB Stream events to SNS.
 * 
 * Key Design Decisions:
 * 1. Preserves DynamoDB AttributeValue format for downstream consumers
 * 2. Extracts trace context from _actor field for distributed tracing
 * 3. Uses SNS batching for standard topics (10x performance improvement)
 * 4. Publishes individually for FIFO topics (required by AWS due to different messageGroupIds)
 */
export class DynamoDBStreamToSNSProcessor extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {
    private topicArn!: string;

    constructor() {
        super(new DynamoDBEventDataExtractor());
    }

    async initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
        // Resolve topic ARN from environment variable
        const topicName = process.env.TOPIC_NAME;
        if (!topicName) {
            throw new Error('TOPIC_NAME environment variable not set');
        }
        const topicArn = Environment.topicArn(topicName);
        if (!topicArn) {
            throw new Error(`Topic ARN not found for topic name: ${topicName}`);
        }
        this.topicArn = topicArn;
    }

    protected async processRecord(_record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {
        // No-op: We override process() to handle raw records directly
    }

    protected async processRecordsBatch(_records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void> {
        // No-op: We override process() to handle raw records directly
    }

    /**
     * Override process() to work with raw DynamoDB records.
     * This is critical to preserve the original AttributeValue format (e.g., { S: "value" })
     * that downstream SNS consumers expect. The base class's eventDataExtractor would
     * unmarshall these into plain JavaScript objects, breaking compatibility.
     */
    async process(event: DynamoDBStreamEvent | SQSEvent, _context: Context, _ctx?: QueueExecutionContext<DynamoDBStreamEvent | SQSEvent>): Promise<void> {
        const rawRecords = 'Records' in event ? event.Records : [];
        await this.processRawRecordsBatch(rawRecords);
    }

    private async processRawRecordsBatch(rawRecords: any[]): Promise<void> {
        // Filter out audit logs first
        const recordsToProcess = rawRecords;

        if (recordsToProcess.length === 0) {
            this.logger.info('No records to publish after filtering');
            return;
        }

        // FIFO topics: must publish individually (different messageGroupIds per record)
        if (isTopicFifo()) {
            await this.publishFifoRecords(recordsToProcess);
        } else {
            // Standard topics: can batch up to 10 messages per API call
            await this.publishStandardBatch(recordsToProcess);
        }

        this.logger.debug('Successfully published all stream records to SNS');
    }

    /**
     * Publish records to FIFO topic individually.
     * 
     * FIFO topics cannot be batched because each DynamoDB record has a different messageGroupId
     * (derived from the record's primary key). SNS batching requires all messages in a batch
     * to have the same messageGroupId.
     * 
     * Uses concurrent publishing (5 at a time) for better performance.
     */
    private async publishFifoRecords(records: any[]): Promise<void> {
        await BatchProgress.forEach(
            'Publish FIFO',
            records,
            async (record) => {
                const fifoProps = getFifoProperties(record);
                await sendTopicMessage(this.topicArn, {
                    eventID: record.eventID,
                    eventName: record.eventName,
                    eventSource: record.eventSource,
                    dynamodb: record.dynamodb,  // Preserved: Original AttributeValue format
                    ...fifoProps
                });
            },
            { concurrency: 5 }
        );
    }

    /**
     * Publish records to standard topic using SNS batching.
     * 
     * Standard topics support batching up to 10 messages per API call,
     * providing ~10x performance improvement over individual publishes.
     */
    private async publishStandardBatch(records: any[]): Promise<void> {
        await BatchProgress.chunk(
            'Publish SNS',
            records,
            async (batch, ctx) => {
                // Build batch messages for SNS PublishBatch API
                const messages: BatchTopicMessage[] = batch.map((record, index) => ({
                    id: `${ctx.itemIndex * 10 + index}`,
                    message: {
                        eventID: record.eventID,
                        eventName: record.eventName,
                        eventSource: record.eventSource,
                        dynamodb: record.dynamodb,  // Preserved: Original AttributeValue format
                    },
                }));

                const result = await sendTopicMessageBatch(this.topicArn, messages);

                // Handle partial batch failures
                if (result.Failed?.length) {
                    this.logger.error('Some messages failed to publish', {
                        failedCount: result.Failed.length,
                        failedIds: result.Failed.map(f => f.Id).join(', ')
                    });
                    throw new Error(`Failed to publish ${result.Failed.length} messages`);
                }

                return batch;
            },
            { size: 10 }  // SNS PublishBatch limit
        );
    }
}

// Export handler using the CreateHandler pattern
export const handler = DynamoDBStreamToSNSProcessor.CreateHandler(DynamoDBStreamToSNSProcessor); 