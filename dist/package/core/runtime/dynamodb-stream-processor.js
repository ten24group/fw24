"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.DynamoDBStreamToSNSProcessor = void 0;
const crypto_1 = require("crypto");
const client_1 = require("../../client");
const sns_1 = require("../../client/sns");
const base_sqs_event_processor_1 = require("./event-processor/base-sqs-event-processor");
const dynamodb_event_data_extractor_1 = require("./event-processor/dynamodb-event-data-extractor");
/**
 * Generates a deterministic deduplication ID from the record.
 * Required for FIFO topics to prevent duplicate processing.
 */
function generateDeduplicationId(record) {
    const data = `${record.eventID}-${record.eventName}-${JSON.stringify(record.dynamodb)}`;
    return (0, crypto_1.createHash)('sha256').update(data).digest('hex');
}
/**
 * Determines if the topic is FIFO based on environment variable.
 * TOPIC_TYPE is set at deployment time in the CDK construct.
 */
function isTopicFifo() {
    return process.env.TOPIC_TYPE?.toLowerCase() === 'fifo';
}
/**
 * Gets FIFO specific message properties if FIFO is enabled.
 * For FIFO topics, each message needs a unique group ID and deduplication ID.
 * Group ID is derived from the DynamoDB record's primary key for proper ordering.
 */
function getFifoProperties(record) {
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
class DynamoDBStreamToSNSProcessor extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    topicArn;
    constructor() {
        super(new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor());
    }
    async initialize(_event) {
        // Resolve topic ARN from environment variable
        const topicName = process.env.TOPIC_NAME;
        if (!topicName) {
            throw new Error('TOPIC_NAME environment variable not set');
        }
        const topicArn = client_1.Environment.topicArn(topicName);
        if (!topicArn) {
            throw new Error(`Topic ARN not found for topic name: ${topicName}`);
        }
        this.topicArn = topicArn;
    }
    async processRecord(_record) {
        // No-op: We override process() to handle raw records directly
    }
    async processRecordsBatch(_records) {
        // No-op: We override process() to handle raw records directly
    }
    /**
     * Override process() to work with raw DynamoDB records.
     * This is critical to preserve the original AttributeValue format (e.g., { S: "value" })
     * that downstream SNS consumers expect. The base class's eventDataExtractor would
     * unmarshall these into plain JavaScript objects, breaking compatibility.
     */
    async process(event, _context, _ctx) {
        const rawRecords = 'Records' in event ? event.Records : [];
        await this.processRawRecordsBatch(rawRecords);
    }
    async processRawRecordsBatch(rawRecords) {
        // Filter out audit logs first
        const recordsToProcess = rawRecords;
        if (recordsToProcess.length === 0) {
            this.logger.info('No records to publish after filtering');
            return;
        }
        // FIFO topics: must publish individually (different messageGroupIds per record)
        if (isTopicFifo()) {
            await this.publishFifoRecords(recordsToProcess);
        }
        else {
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
    extractTraceContext(record) {
        const messageAttributes = {
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
    async publishFifoRecords(records) {
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
                    dynamodb: record.dynamodb, // PRESERVED: Original AttributeValue format
                    messageAttributes, // Included in body for downstream access
                    ...fifoProps
                };
                await (0, sns_1.sendTopicMessage)(this.topicArn, message);
                this.logger.debug('Successfully published stream record to SNS', {
                    eventID: record.eventID,
                    eventName: record.eventName,
                    fifoProps
                });
            }
            catch (error) {
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
    async publishStandardBatch(records) {
        // Process in batches of 10 (SNS PublishBatch limit)
        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10);
            const messages = batch.map((record, index) => {
                const messageAttributes = this.extractTraceContext(record);
                return {
                    id: `${i + index}`,
                    message: {
                        eventID: record.eventID,
                        eventName: record.eventName,
                        eventSource: record.eventSource,
                        dynamodb: record.dynamodb, // PRESERVED: Original AttributeValue format
                        messageAttributes: messageAttributes // Included in body for downstream access
                    }
                };
            });
            try {
                const result = await (0, sns_1.sendTopicMessageBatch)(this.topicArn, messages);
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
            }
            catch (error) {
                this.logger.error('Failed to publish batch to SNS', { error });
                throw error;
            }
        }
    }
}
exports.DynamoDBStreamToSNSProcessor = DynamoDBStreamToSNSProcessor;
// Export handler using the CreateHandler pattern
exports.handler = DynamoDBStreamToSNSProcessor.CreateHandler(DynamoDBStreamToSNSProcessor);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGItc3RyZWFtLXByb2Nlc3Nvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZHluYW1vZGItc3RyZWFtLXByb2Nlc3Nvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBb0M7QUFDcEMseUNBQTJDO0FBQzNDLDBDQUE4RjtBQUM5Rix5RkFBMEc7QUFDMUcsbUdBQTZGO0FBRzdGOzs7R0FHRztBQUNILFNBQVMsdUJBQXVCLENBQUMsTUFBVztJQUN4QyxNQUFNLElBQUksR0FBRyxHQUFHLE1BQU0sQ0FBQyxPQUFPLElBQUksTUFBTSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO0lBQ3hGLE9BQU8sSUFBQSxtQkFBVSxFQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDM0QsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsV0FBVztJQUNoQixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLFdBQVcsRUFBRSxLQUFLLE1BQU0sQ0FBQztBQUM1RCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUJBQWlCLENBQUMsTUFBVztJQUNsQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztRQUNqQixPQUFPLEVBQUUsQ0FBQztJQUNkLENBQUM7SUFFRCxPQUFPO1FBQ0gsY0FBYyxFQUFFLE1BQU0sQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU87UUFDOUQsc0JBQXNCLEVBQUUsdUJBQXVCLENBQUMsTUFBTSxDQUFDO0tBQzFELENBQUM7QUFDTixDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFhLDRCQUE2QixTQUFRLGdEQUFpRDtJQUN2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QkFBNEIsQ0FBQyxhQUFhLENBQUMsNEJBQTRCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtRXZlbnQsIFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudmlyb25tZW50IH0gZnJvbSAnLi4vLi4vY2xpZW50JztcbmltcG9ydCB7IHNlbmRUb3BpY01lc3NhZ2UsIHNlbmRUb3BpY01lc3NhZ2VCYXRjaCwgQmF0Y2hUb3BpY01lc3NhZ2UgfSBmcm9tICcuLi8uLi9jbGllbnQvc25zJztcbmltcG9ydCB7IEJhc2VTUVNFdmVudFByb2Nlc3NvciwgRXZlbnRQcm9jZXNzb3JDb250ZXh0IH0gZnJvbSAnLi9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yJztcbmltcG9ydCB7IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi9ldmVudC1wcm9jZXNzb3IvZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBDaGFuZ2VTdHJlYW1QYXlsb2FkIH0gZnJvbSAnLi4vdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSBkZXRlcm1pbmlzdGljIGRlZHVwbGljYXRpb24gSUQgZnJvbSB0aGUgcmVjb3JkLlxuICogUmVxdWlyZWQgZm9yIEZJRk8gdG9waWNzIHRvIHByZXZlbnQgZHVwbGljYXRlIHByb2Nlc3NpbmcuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlRGVkdXBsaWNhdGlvbklkKHJlY29yZDogYW55KTogc3RyaW5nIHtcbiAgICBjb25zdCBkYXRhID0gYCR7cmVjb3JkLmV2ZW50SUR9LSR7cmVjb3JkLmV2ZW50TmFtZX0tJHtKU09OLnN0cmluZ2lmeShyZWNvcmQuZHluYW1vZGIpfWA7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShkYXRhKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIERldGVybWluZXMgaWYgdGhlIHRvcGljIGlzIEZJRk8gYmFzZWQgb24gZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gKiBUT1BJQ19UWVBFIGlzIHNldCBhdCBkZXBsb3ltZW50IHRpbWUgaW4gdGhlIENESyBjb25zdHJ1Y3QuXG4gKi9cbmZ1bmN0aW9uIGlzVG9waWNGaWZvKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5UT1BJQ19UWVBFPy50b0xvd2VyQ2FzZSgpID09PSAnZmlmbyc7XG59XG5cbi8qKlxuICogR2V0cyBGSUZPIHNwZWNpZmljIG1lc3NhZ2UgcHJvcGVydGllcyBpZiBGSUZPIGlzIGVuYWJsZWQuXG4gKiBGb3IgRklGTyB0b3BpY3MsIGVhY2ggbWVzc2FnZSBuZWVkcyBhIHVuaXF1ZSBncm91cCBJRCBhbmQgZGVkdXBsaWNhdGlvbiBJRC5cbiAqIEdyb3VwIElEIGlzIGRlcml2ZWQgZnJvbSB0aGUgRHluYW1vREIgcmVjb3JkJ3MgcHJpbWFyeSBrZXkgZm9yIHByb3BlciBvcmRlcmluZy5cbiAqL1xuZnVuY3Rpb24gZ2V0Rmlmb1Byb3BlcnRpZXMocmVjb3JkOiBhbnkpIHtcbiAgICBpZiAoIWlzVG9waWNGaWZvKCkpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG1lc3NhZ2VHcm91cElkOiByZWNvcmQuZHluYW1vZGI/LktleXM/LmlkPy5TIHx8IHJlY29yZC5ldmVudElELFxuICAgICAgICBtZXNzYWdlRGVkdXBsaWNhdGlvbklkOiBnZW5lcmF0ZURlZHVwbGljYXRpb25JZChyZWNvcmQpXG4gICAgfTtcbn1cblxuLyoqXG4gKiBQcm9jZXNzb3IgdGhhdCBmb3J3YXJkcyBEeW5hbW9EQiBTdHJlYW0gZXZlbnRzIHRvIFNOUy5cbiAqIFxuICogS2V5IERlc2lnbiBEZWNpc2lvbnM6XG4gKiAxLiBQcmVzZXJ2ZXMgRHluYW1vREIgQXR0cmlidXRlVmFsdWUgZm9ybWF0IGZvciBkb3duc3RyZWFtIGNvbnN1bWVyc1xuICogMi4gRXh0cmFjdHMgdHJhY2UgY29udGV4dCBmcm9tIF9hY3RvciBmaWVsZCBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogMy4gVXNlcyBTTlMgYmF0Y2hpbmcgZm9yIHN0YW5kYXJkIHRvcGljcyAoMTB4IHBlcmZvcm1hbmNlIGltcHJvdmVtZW50KVxuICogNC4gUHVibGlzaGVzIGluZGl2aWR1YWxseSBmb3IgRklGTyB0b3BpY3MgKHJlcXVpcmVkIGJ5IEFXUyBkdWUgdG8gZGlmZmVyZW50IG1lc3NhZ2VHcm91cElkcylcbiAqL1xuZXhwb3J0IGNsYXNzIER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8RHluYW1vREJFdmVudERhdGFFeHRyYWN0b3I+IHtcbiAgICBwcml2YXRlIHRvcGljQXJuITogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKG5ldyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvcigpKTtcbiAgICB9XG5cbiAgICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIFJlc29sdmUgdG9waWMgQVJOIGZyb20gZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICAgICAgY29uc3QgdG9waWNOYW1lID0gcHJvY2Vzcy5lbnYuVE9QSUNfTkFNRTtcbiAgICAgICAgaWYgKCF0b3BpY05hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVE9QSUNfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSBFbnZpcm9ubWVudC50b3BpY0Fybih0b3BpY05hbWUpO1xuICAgICAgICBpZiAoIXRvcGljQXJuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRvcGljIEFSTiBub3QgZm91bmQgZm9yIHRvcGljIG5hbWU6ICR7dG9waWNOYW1lfWApO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudG9waWNBcm4gPSB0b3BpY0FybjtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChfcmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gTm8tb3A6IFdlIG92ZXJyaWRlIHByb2Nlc3MoKSB0byBoYW5kbGUgcmF3IHJlY29yZHMgZGlyZWN0bHlcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChfcmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gTm8tb3A6IFdlIG92ZXJyaWRlIHByb2Nlc3MoKSB0byBoYW5kbGUgcmF3IHJlY29yZHMgZGlyZWN0bHlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBPdmVycmlkZSBwcm9jZXNzKCkgdG8gd29yayB3aXRoIHJhdyBEeW5hbW9EQiByZWNvcmRzLlxuICAgICAqIFRoaXMgaXMgY3JpdGljYWwgdG8gcHJlc2VydmUgdGhlIG9yaWdpbmFsIEF0dHJpYnV0ZVZhbHVlIGZvcm1hdCAoZS5nLiwgeyBTOiBcInZhbHVlXCIgfSlcbiAgICAgKiB0aGF0IGRvd25zdHJlYW0gU05TIGNvbnN1bWVycyBleHBlY3QuIFRoZSBiYXNlIGNsYXNzJ3MgZXZlbnREYXRhRXh0cmFjdG9yIHdvdWxkXG4gICAgICogdW5tYXJzaGFsbCB0aGVzZSBpbnRvIHBsYWluIEphdmFTY3JpcHQgb2JqZWN0cywgYnJlYWtpbmcgY29tcGF0aWJpbGl0eS5cbiAgICAgKi9cbiAgICBhc3luYyBwcm9jZXNzKGV2ZW50OiBEeW5hbW9EQlN0cmVhbUV2ZW50IHwgU1FTRXZlbnQsIF9jb250ZXh0OiBDb250ZXh0LCBfY3R4OiBFdmVudFByb2Nlc3NvckNvbnRleHQ8RHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50Pik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zdCByYXdSZWNvcmRzID0gJ1JlY29yZHMnIGluIGV2ZW50ID8gZXZlbnQuUmVjb3JkcyA6IFtdO1xuICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NSYXdSZWNvcmRzQmF0Y2gocmF3UmVjb3Jkcyk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzUmF3UmVjb3Jkc0JhdGNoKHJhd1JlY29yZHM6IGFueVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIEZpbHRlciBvdXQgYXVkaXQgbG9ncyBmaXJzdFxuICAgICAgICBjb25zdCByZWNvcmRzVG9Qcm9jZXNzID0gcmF3UmVjb3JkcztcblxuICAgICAgICBpZiAocmVjb3Jkc1RvUHJvY2Vzcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIHJlY29yZHMgdG8gcHVibGlzaCBhZnRlciBmaWx0ZXJpbmcnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZJRk8gdG9waWNzOiBtdXN0IHB1Ymxpc2ggaW5kaXZpZHVhbGx5IChkaWZmZXJlbnQgbWVzc2FnZUdyb3VwSWRzIHBlciByZWNvcmQpXG4gICAgICAgIGlmIChpc1RvcGljRmlmbygpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2hGaWZvUmVjb3JkcyhyZWNvcmRzVG9Qcm9jZXNzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFN0YW5kYXJkIHRvcGljczogY2FuIGJhdGNoIHVwIHRvIDEwIG1lc3NhZ2VzIHBlciBBUEkgY2FsbFxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoU3RhbmRhcmRCYXRjaChyZWNvcmRzVG9Qcm9jZXNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1N1Y2Nlc3NmdWxseSBwdWJsaXNoZWQgYWxsIHN0cmVhbSByZWNvcmRzIHRvIFNOUycpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIER5bmFtb0RCIHJlY29yZCdzIF9hY3RvciBmaWVsZC5cbiAgICAgKiBUaGUgX2FjdG9yIGZpZWxkIGlzIGF1dG9tYXRpY2FsbHkgcG9wdWxhdGVkIGJ5IHRoZSBmcmFtZXdvcmsgd2hlbiByZWNvcmRzIGFyZSBjcmVhdGVkL3VwZGF0ZWQuXG4gICAgICogXG4gICAgICogU3RydWN0dXJlOiB7IF9hY3RvcjogeyBNOiB7IGNvcnJlbGF0aW9uSWQ6IHsgUzogXCIuLi5cIiB9LCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgUzogXCIuLi5cIiB9LCBzYW1wbGVkOiB7IEJPT0w6IHRydWUgfSB9IH0gfVxuICAgICAqIFxuICAgICAqIFRoaXMgZW5hYmxlcyBkaXN0cmlidXRlZCB0cmFjaW5nIGJ5IGxpbmtpbmcgRHluYW1vREIgY2hhbmdlcyBiYWNrIHRvIHRoZSBvcmlnaW5hdGluZyByZXF1ZXN0LlxuICAgICAqIFxuICAgICAqIElNUE9SVEFOVDogU2V0cyBjYXVzZWRCeSA9IG9yaWdpbmFsIGNvcnJlbGF0aW9uSWQgdG8gbGluayB0aGUgc3RyZWFtIHByb2Nlc3NpbmcgYmFjayB0byB0aGUgQVBJIHJlcXVlc3QgdGhhdCBjYXVzZWQgdGhlIERCIGNoYW5nZS5cbiAgICAgKiBcbiAgICAgKiBOb3RlOiBtZXNzYWdlQXR0cmlidXRlcyBhcmUgaW5jbHVkZWQgaW4gdGhlIFNOUyBtZXNzYWdlIEJPRFkgKG5vdCBTTlMgbWVzc2FnZSBhdHRyaWJ1dGVzKVxuICAgICAqIHRvIHByZXNlcnZlIHRoZW0gd2hlbiBkb3duc3RyZWFtIGNvbnN1bWVycyB1bm1hcnNoYWwgdGhlIER5bmFtb0RCIEF0dHJpYnV0ZVZhbHVlIGZvcm1hdC5cbiAgICAgKi9cbiAgICBwcml2YXRlIGV4dHJhY3RUcmFjZUNvbnRleHQocmVjb3JkOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHtcbiAgICAgICAgY29uc3QgbWVzc2FnZUF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgICAgICBldmVudFR5cGU6IHJlY29yZC5ldmVudE5hbWVcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBUcnkgTmV3SW1hZ2UgZmlyc3QgKGZvciBJTlNFUlQvTU9ESUZZKSwgdGhlbiBPbGRJbWFnZSAoZm9yIFJFTU9WRSlcbiAgICAgICAgY29uc3QgaW1hZ2UgPSByZWNvcmQuZHluYW1vZGI/Lk5ld0ltYWdlIHx8IHJlY29yZC5keW5hbW9kYj8uT2xkSW1hZ2U7XG4gICAgICAgIGlmIChpbWFnZSkge1xuICAgICAgICAgICAgLy8gRXh0cmFjdCBmcm9tIF9hY3RvciBmaWVsZCAoc3RvcmVkIGluIER5bmFtb0RCIEF0dHJpYnV0ZVZhbHVlIGZvcm1hdClcbiAgICAgICAgICAgIGNvbnN0IGFjdG9yTWFwID0gaW1hZ2UuX2FjdG9yPy5NO1xuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxDb3JyZWxhdGlvbklkID0gYWN0b3JNYXA/LmNvcnJlbGF0aW9uSWQ/LlM7XG5cbiAgICAgICAgICAgIGlmIChvcmlnaW5hbENvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGUgY3VycmVudCBleGVjdXRpb24gY29udGV4dCBoYXMgYSBORVcgY29ycmVsYXRpb25JZCAodGhlIHN0cmVhbSBMYW1iZGEncyByZXF1ZXN0SWQpXG4gICAgICAgICAgICAgICAgLy8gU2V0IGNhdXNlZEJ5IHRvIHRoZSBPUklHSU5BTCBjb3JyZWxhdGlvbklkIGZyb20gdGhlIERCIHJlY29yZCB0byBsaW5rIGJhY2sgdG8gdGhlIEFQSSByZXF1ZXN0XG4gICAgICAgICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXMuY2F1c2VkQnkgPSBvcmlnaW5hbENvcnJlbGF0aW9uSWQ7XG5cbiAgICAgICAgICAgICAgICAvLyBBbHNvIGluY2x1ZGUgdGhlIG9yaWdpbmFsIGNvcnJlbGF0aW9uSWQgZm9yIHJlZmVyZW5jZVxuICAgICAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzLm9yaWdpbmFsQ29ycmVsYXRpb25JZCA9IG9yaWdpbmFsQ29ycmVsYXRpb25JZDtcblxuICAgICAgICAgICAgICAgIC8vIE9wdGlvbmFsIHRyYWNlIGZpZWxkcyBmcm9tIG9yaWdpbmFsIHJlcXVlc3RcbiAgICAgICAgICAgICAgICBpZiAoYWN0b3JNYXAucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPy5TKSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzLm9yaWdpbmFsUGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gYWN0b3JNYXAucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLlM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChhY3Rvck1hcC5zYW1wbGVkPy5CT09MICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXMuc2FtcGxlZCA9IGFjdG9yTWFwLnNhbXBsZWQuQk9PTDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbWVzc2FnZUF0dHJpYnV0ZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHVibGlzaCByZWNvcmRzIHRvIEZJRk8gdG9waWMgaW5kaXZpZHVhbGx5LlxuICAgICAqIFxuICAgICAqIEZJRk8gdG9waWNzIGNhbm5vdCBiZSBiYXRjaGVkIGJlY2F1c2UgZWFjaCBEeW5hbW9EQiByZWNvcmQgaGFzIGEgZGlmZmVyZW50IG1lc3NhZ2VHcm91cElkXG4gICAgICogKGRlcml2ZWQgZnJvbSB0aGUgcmVjb3JkJ3MgcHJpbWFyeSBrZXkpLiBTTlMgYmF0Y2hpbmcgcmVxdWlyZXMgYWxsIG1lc3NhZ2VzIGluIGEgYmF0Y2hcbiAgICAgKiB0byBoYXZlIHRoZSBzYW1lIG1lc3NhZ2VHcm91cElkLlxuICAgICAqIFxuICAgICAqIFB1Ymxpc2hlcyBhcmUgZG9uZSBpbiBwYXJhbGxlbCBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgcHVibGlzaEZpZm9SZWNvcmRzKHJlY29yZHM6IGFueVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGNvbnN0IHB1Ymxpc2hQcm9taXNlcyA9IHJlY29yZHMubWFwKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpZm9Qcm9wcyA9IGdldEZpZm9Qcm9wZXJ0aWVzKHJlY29yZCk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZUF0dHJpYnV0ZXMgPSB0aGlzLmV4dHJhY3RUcmFjZUNvbnRleHQocmVjb3JkKTtcblxuICAgICAgICAgICAgICAgIC8vIElNUE9SVEFOVDogcmVjb3JkLmR5bmFtb2RiIGlzIHByZXNlcnZlZCBpbiBvcmlnaW5hbCBBdHRyaWJ1dGVWYWx1ZSBmb3JtYXRcbiAgICAgICAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgZG93bnN0cmVhbSBjb25zdW1lcnMgY2FuIHByb3Blcmx5IHVubWFyc2hhbCB0aGUgZGF0YVxuICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICAgICAgICAgICAgICAgIGV2ZW50SUQ6IHJlY29yZC5ldmVudElELFxuICAgICAgICAgICAgICAgICAgICBldmVudE5hbWU6IHJlY29yZC5ldmVudE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50U291cmNlOiByZWNvcmQuZXZlbnRTb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgIGR5bmFtb2RiOiByZWNvcmQuZHluYW1vZGIsICAvLyBQUkVTRVJWRUQ6IE9yaWdpbmFsIEF0dHJpYnV0ZVZhbHVlIGZvcm1hdFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlcywgICAgICAgICAgLy8gSW5jbHVkZWQgaW4gYm9keSBmb3IgZG93bnN0cmVhbSBhY2Nlc3NcbiAgICAgICAgICAgICAgICAgICAgLi4uZmlmb1Byb3BzXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIGF3YWl0IHNlbmRUb3BpY01lc3NhZ2UodGhpcy50b3BpY0FybiwgbWVzc2FnZSk7XG5cbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU3VjY2Vzc2Z1bGx5IHB1Ymxpc2hlZCBzdHJlYW0gcmVjb3JkIHRvIFNOUycsIHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnRJRDogcmVjb3JkLmV2ZW50SUQsXG4gICAgICAgICAgICAgICAgICAgIGV2ZW50TmFtZTogcmVjb3JkLmV2ZW50TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZmlmb1Byb3BzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcHVibGlzaCBzdHJlYW0gcmVjb3JkIHRvIFNOUycsIHtcbiAgICAgICAgICAgICAgICAgICAgZXZlbnRJRDogcmVjb3JkLmV2ZW50SUQsXG4gICAgICAgICAgICAgICAgICAgIGVycm9yXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHB1Ymxpc2hQcm9taXNlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHVibGlzaCByZWNvcmRzIHRvIHN0YW5kYXJkIHRvcGljIHVzaW5nIFNOUyBiYXRjaGluZy5cbiAgICAgKiBcbiAgICAgKiBTdGFuZGFyZCB0b3BpY3Mgc3VwcG9ydCBiYXRjaGluZyB1cCB0byAxMCBtZXNzYWdlcyBwZXIgQVBJIGNhbGwsXG4gICAgICogcHJvdmlkaW5nIH4xMHggcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQgb3ZlciBpbmRpdmlkdWFsIHB1Ymxpc2hlcy5cbiAgICAgKiBcbiAgICAgKiBCZW5lZml0czpcbiAgICAgKiAtIFJlZHVjZWQgbGF0ZW5jeSAoZmV3ZXIgQVBJIGNhbGxzKVxuICAgICAqIC0gTG93ZXIgY29zdCAoZmV3ZXIgcmVxdWVzdHMpXG4gICAgICogLSBCZXR0ZXIgdGhyb3VnaHB1dFxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgcHVibGlzaFN0YW5kYXJkQmF0Y2gocmVjb3JkczogYW55W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gUHJvY2VzcyBpbiBiYXRjaGVzIG9mIDEwIChTTlMgUHVibGlzaEJhdGNoIGxpbWl0KVxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlY29yZHMubGVuZ3RoOyBpICs9IDEwKSB7XG4gICAgICAgICAgICBjb25zdCBiYXRjaCA9IHJlY29yZHMuc2xpY2UoaSwgaSArIDEwKTtcblxuICAgICAgICAgICAgY29uc3QgbWVzc2FnZXM6IEJhdGNoVG9waWNNZXNzYWdlW10gPSBiYXRjaC5tYXAoKHJlY29yZCwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlQXR0cmlidXRlcyA9IHRoaXMuZXh0cmFjdFRyYWNlQ29udGV4dChyZWNvcmQpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGAke2kgKyBpbmRleH1gLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBldmVudElEOiByZWNvcmQuZXZlbnRJRCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50TmFtZTogcmVjb3JkLmV2ZW50TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50U291cmNlOiByZWNvcmQuZXZlbnRTb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBkeW5hbW9kYjogcmVjb3JkLmR5bmFtb2RiLCAgLy8gUFJFU0VSVkVEOiBPcmlnaW5hbCBBdHRyaWJ1dGVWYWx1ZSBmb3JtYXRcbiAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiBtZXNzYWdlQXR0cmlidXRlcyAgLy8gSW5jbHVkZWQgaW4gYm9keSBmb3IgZG93bnN0cmVhbSBhY2Nlc3NcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZW5kVG9waWNNZXNzYWdlQmF0Y2godGhpcy50b3BpY0FybiwgbWVzc2FnZXMpO1xuXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIHBhcnRpYWwgYmF0Y2ggZmFpbHVyZXNcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LkZhaWxlZCAmJiByZXN1bHQuRmFpbGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZmFpbGVkSWRzID0gcmVzdWx0LkZhaWxlZC5tYXAoZiA9PiBmLklkKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignU29tZSBtZXNzYWdlcyBmYWlsZWQgdG8gcHVibGlzaCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZhaWxlZENvdW50OiByZXN1bHQuRmFpbGVkLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGZhaWxlZElkc1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcHVibGlzaCAke3Jlc3VsdC5GYWlsZWQubGVuZ3RofSBtZXNzYWdlc2ApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTdWNjZXNzZnVsbHkgcHVibGlzaGVkIGJhdGNoIHRvIFNOUycsIHtcbiAgICAgICAgICAgICAgICAgICAgYmF0Y2hTaXplOiBiYXRjaC5sZW5ndGgsXG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NDb3VudDogcmVzdWx0LlN1Y2Nlc3NmdWw/Lmxlbmd0aCB8fCAwXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcHVibGlzaCBiYXRjaCB0byBTTlMnLCB7IGVycm9yIH0pO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG4vLyBFeHBvcnQgaGFuZGxlciB1c2luZyB0aGUgQ3JlYXRlSGFuZGxlciBwYXR0ZXJuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IuQ3JlYXRlSGFuZGxlcihEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yKTsgIl19