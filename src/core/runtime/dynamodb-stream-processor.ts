import { DynamoDBStreamEvent, SQSEvent, Context } from 'aws-lambda';
import { createHash } from 'crypto';
import { Environment } from '../../client';
import { sendTopicMessage, sendTopicMessageBatch, BatchTopicMessage } from '../../client/sns';
import { BaseSQSEventProcessor, EventProcessorContext } from './event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from './event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../types/event-processor-types';

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
    async process(event: DynamoDBStreamEvent | SQSEvent, _context: Context, _ctx: EventProcessorContext<DynamoDBStreamEvent | SQSEvent>): Promise<void> {
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

        this.logger.info('Successfully published all stream records to SNS');
    }

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
    private extractTraceContext(record: any): Record<string, any> {
        const messageAttributes: Record<string, any> = {
            eventType: record.eventName
        };

        // Try NewImage first (for INSERT/MODIFY), then OldImage (for REMOVE)
        const image = record.dynamodb?.NewImage || record.dynamodb?.OldImage;
        if (image) {
            // Extract from _actor field (stored in DynamoDB AttributeValue format)
            const actorMap = image._actor?.M;
            const originalCorrelationId = actorMap?.correlationId?.S;

            if (originalCorrelationId) {
                // The current execution context has a NEW correlationId (the stream Lambda's requestId)
                // Set causedBy to the ORIGINAL correlationId from the DB record to link back to the API request
                messageAttributes.causedBy = originalCorrelationId;

                // Also include the original correlationId for reference
                messageAttributes.originalCorrelationId = originalCorrelationId;

                // Optional trace fields from original request
                if (actorMap.parentObservabilityLogId?.S) {
                    messageAttributes.originalParentObservabilityLogId = actorMap.parentObservabilityLogId.S;
                }
                if (actorMap.sampled?.BOOL !== undefined) {
                    messageAttributes.sampled = actorMap.sampled.BOOL;
                }
            }
        }

        return messageAttributes;
    }

    /**
     * Publish records to FIFO topic individually.
     * 
     * FIFO topics cannot be batched because each DynamoDB record has a different messageGroupId
     * (derived from the record's primary key). SNS batching requires all messages in a batch
     * to have the same messageGroupId.
     * 
     * Publishes are done in parallel for better performance.
     */
    private async publishFifoRecords(records: any[]): Promise<void> {
        const publishPromises = records.map(async (record) => {
            const fifoProps = getFifoProperties(record);

            try {
                const messageAttributes = this.extractTraceContext(record);

                // IMPORTANT: record.dynamodb is preserved in original AttributeValue format
                // This ensures downstream consumers can properly unmarshal the data
                const message = {
                    eventID: record.eventID,
                    eventName: record.eventName,
                    eventSource: record.eventSource,
                    dynamodb: record.dynamodb,  // PRESERVED: Original AttributeValue format
                    messageAttributes,          // Included in body for downstream access
                    ...fifoProps
                };

                await sendTopicMessage(this.topicArn, message);

                this.logger.debug('Successfully published stream record to SNS', {
                    eventID: record.eventID,
                    eventName: record.eventName,
                    fifoProps
                });
            } catch (error) {
                this.logger.error('Failed to publish stream record to SNS', {
                    eventID: record.eventID,
                    error
                });
                throw error;
            }
        });

        await Promise.all(publishPromises);
    }

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
    private async publishStandardBatch(records: any[]): Promise<void> {
        // Process in batches of 10 (SNS PublishBatch limit)
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);

            const messages: BatchTopicMessage[] = batch.map((record, index) => {
                const messageAttributes = this.extractTraceContext(record);

                return {
                    id: `${i + index}`,
                    message: {
                        eventID: record.eventID,
                        eventName: record.eventName,
                        eventSource: record.eventSource,
                        dynamodb: record.dynamodb,  // PRESERVED: Original AttributeValue format
                        messageAttributes: messageAttributes  // Included in body for downstream access
                    }
                };
            });

            try {
                const result = await sendTopicMessageBatch(this.topicArn, messages);

                // Handle partial batch failures
                if (result.Failed && result.Failed.length > 0) {
                    const failedIds = result.Failed.map(f => f.Id).join(', ');
                    this.logger.error('Some messages failed to publish', {
                        failedCount: result.Failed.length,
                        failedIds
                    });
                    throw new Error(`Failed to publish ${result.Failed.length} messages`);
                }

                this.logger.debug('Successfully published batch to SNS', {
                    batchSize: batch.length,
                    successCount: result.Successful?.length || 0
                });
            } catch (error) {
                this.logger.error('Failed to publish batch to SNS', { error });
                throw error;
            }
        }
    }
}

// Export handler using the CreateHandler pattern
export const handler = DynamoDBStreamToSNSProcessor.CreateHandler(DynamoDBStreamToSNSProcessor); 