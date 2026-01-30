"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.DynamoDBStreamToSNSProcessor = void 0;
const crypto_1 = require("crypto");
const client_1 = require("../../client");
const sns_1 = require("../../client/sns");
const base_sqs_event_processor_1 = require("./event-processor/base-sqs-event-processor");
const dynamodb_event_data_extractor_1 = require("./event-processor/dynamodb-event-data-extractor");
const observability_1 = require("../../observability");
// NOTE: Trace propagation is handled by `sendTopicMessage` / `sendTopicMessageBatch`
// via the centralized execution-context propagation helpers.
// Do NOT embed trace context into the message body (it won't be extracted by consumers).
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
     * Publish records to FIFO topic individually.
     *
     * FIFO topics cannot be batched because each DynamoDB record has a different messageGroupId
     * (derived from the record's primary key). SNS batching requires all messages in a batch
     * to have the same messageGroupId.
     *
     * Uses concurrent publishing (5 at a time) for better performance.
     */
    async publishFifoRecords(records) {
        await observability_1.BatchProgress.forEach('Publish FIFO', records, async (record) => {
            const fifoProps = getFifoProperties(record);
            await (0, sns_1.sendTopicMessage)(this.topicArn, {
                eventID: record.eventID,
                eventName: record.eventName,
                eventSource: record.eventSource,
                dynamodb: record.dynamodb, // Preserved: Original AttributeValue format
                ...fifoProps
            });
        }, { concurrency: 5 });
    }
    /**
     * Publish records to standard topic using SNS batching.
     *
     * Standard topics support batching up to 10 messages per API call,
     * providing ~10x performance improvement over individual publishes.
     */
    async publishStandardBatch(records) {
        await observability_1.BatchProgress.chunk('Publish SNS', records, async (batch, ctx) => {
            // Build batch messages for SNS PublishBatch API
            const messages = batch.map((record, index) => ({
                id: `${ctx.itemIndex * 10 + index}`,
                message: {
                    eventID: record.eventID,
                    eventName: record.eventName,
                    eventSource: record.eventSource,
                    dynamodb: record.dynamodb, // Preserved: Original AttributeValue format
                },
            }));
            const result = await (0, sns_1.sendTopicMessageBatch)(this.topicArn, messages);
            // Handle partial batch failures
            if (result.Failed?.length) {
                this.logger.error('Some messages failed to publish', {
                    failedCount: result.Failed.length,
                    failedIds: result.Failed.map(f => f.Id).join(', ')
                });
                throw new Error(`Failed to publish ${result.Failed.length} messages`);
            }
            return batch;
        }, { size: 10 } // SNS PublishBatch limit
        );
    }
}
exports.DynamoDBStreamToSNSProcessor = DynamoDBStreamToSNSProcessor;
// Export handler using the CreateHandler pattern
exports.handler = DynamoDBStreamToSNSProcessor.CreateHandler(DynamoDBStreamToSNSProcessor);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGItc3RyZWFtLXByb2Nlc3Nvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZHluYW1vZGItc3RyZWFtLXByb2Nlc3Nvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBb0M7QUFDcEMseUNBQTJDO0FBQzNDLDBDQUE4RjtBQUM5Rix5RkFBbUY7QUFDbkYsbUdBQTZGO0FBRzdGLHVEQUFvRDtBQUVwRCxxRkFBcUY7QUFDckYsNkRBQTZEO0FBQzdELHlGQUF5RjtBQUV6Rjs7O0dBR0c7QUFDSCxTQUFTLHVCQUF1QixDQUFDLE1BQVc7SUFDeEMsTUFBTSxJQUFJLEdBQUcsR0FBRyxNQUFNLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztJQUN4RixPQUFPLElBQUEsbUJBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzNELENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLFdBQVc7SUFDaEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsS0FBSyxNQUFNLENBQUM7QUFDNUQsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGlCQUFpQixDQUFDLE1BQVc7SUFDbEMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7UUFDakIsT0FBTyxFQUFFLENBQUM7SUFDZCxDQUFDO0lBRUQsT0FBTztRQUNILGNBQWMsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPO1FBQzlELHNCQUFzQixFQUFFLHVCQUF1QixDQUFDLE1BQU0sQ0FBQztLQUMxRCxDQUFDO0FBQ04sQ0FB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QUUsRUFBRSxDQUFFLHlCQUF5QjtTQUMxQyxDQUFDO0lBQ04sQ0FBQztDQUNKO0FBNUhELG9FQTRIQztBQUVELGlEQUFpRDtBQUNwQyxRQUFBLE9BQU8sR0FBRyw0QkFBNEIsQ0FBQyxhQUFhLENBQUMsNEJBQTRCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtRXZlbnQsIFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudmlyb25tZW50IH0gZnJvbSAnLi4vLi4vY2xpZW50JztcbmltcG9ydCB7IHNlbmRUb3BpY01lc3NhZ2UsIHNlbmRUb3BpY01lc3NhZ2VCYXRjaCwgQmF0Y2hUb3BpY01lc3NhZ2UgfSBmcm9tICcuLi8uLi9jbGllbnQvc25zJztcbmltcG9ydCB7IEJhc2VTUVNFdmVudFByb2Nlc3NvciB9IGZyb20gJy4vZXZlbnQtcHJvY2Vzc29yL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4vZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuL3Nxcy1jb250cm9sbGVyJztcbmltcG9ydCB7IEJhdGNoUHJvZ3Jlc3MgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcblxuLy8gTk9URTogVHJhY2UgcHJvcGFnYXRpb24gaXMgaGFuZGxlZCBieSBgc2VuZFRvcGljTWVzc2FnZWAgLyBgc2VuZFRvcGljTWVzc2FnZUJhdGNoYFxuLy8gdmlhIHRoZSBjZW50cmFsaXplZCBleGVjdXRpb24tY29udGV4dCBwcm9wYWdhdGlvbiBoZWxwZXJzLlxuLy8gRG8gTk9UIGVtYmVkIHRyYWNlIGNvbnRleHQgaW50byB0aGUgbWVzc2FnZSBib2R5IChpdCB3b24ndCBiZSBleHRyYWN0ZWQgYnkgY29uc3VtZXJzKS5cblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSBkZXRlcm1pbmlzdGljIGRlZHVwbGljYXRpb24gSUQgZnJvbSB0aGUgcmVjb3JkLlxuICogUmVxdWlyZWQgZm9yIEZJRk8gdG9waWNzIHRvIHByZXZlbnQgZHVwbGljYXRlIHByb2Nlc3NpbmcuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlRGVkdXBsaWNhdGlvbklkKHJlY29yZDogYW55KTogc3RyaW5nIHtcbiAgICBjb25zdCBkYXRhID0gYCR7cmVjb3JkLmV2ZW50SUR9LSR7cmVjb3JkLmV2ZW50TmFtZX0tJHtKU09OLnN0cmluZ2lmeShyZWNvcmQuZHluYW1vZGIpfWA7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShkYXRhKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIERldGVybWluZXMgaWYgdGhlIHRvcGljIGlzIEZJRk8gYmFzZWQgb24gZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gKiBUT1BJQ19UWVBFIGlzIHNldCBhdCBkZXBsb3ltZW50IHRpbWUgaW4gdGhlIENESyBjb25zdHJ1Y3QuXG4gKi9cbmZ1bmN0aW9uIGlzVG9waWNGaWZvKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5UT1BJQ19UWVBFPy50b0xvd2VyQ2FzZSgpID09PSAnZmlmbyc7XG59XG5cbi8qKlxuICogR2V0cyBGSUZPIHNwZWNpZmljIG1lc3NhZ2UgcHJvcGVydGllcyBpZiBGSUZPIGlzIGVuYWJsZWQuXG4gKiBGb3IgRklGTyB0b3BpY3MsIGVhY2ggbWVzc2FnZSBuZWVkcyBhIHVuaXF1ZSBncm91cCBJRCBhbmQgZGVkdXBsaWNhdGlvbiBJRC5cbiAqIEdyb3VwIElEIGlzIGRlcml2ZWQgZnJvbSB0aGUgRHluYW1vREIgcmVjb3JkJ3MgcHJpbWFyeSBrZXkgZm9yIHByb3BlciBvcmRlcmluZy5cbiAqL1xuZnVuY3Rpb24gZ2V0Rmlmb1Byb3BlcnRpZXMocmVjb3JkOiBhbnkpIHtcbiAgICBpZiAoIWlzVG9waWNGaWZvKCkpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG1lc3NhZ2VHcm91cElkOiByZWNvcmQuZHluYW1vZGI/LktleXM/LmlkPy5TIHx8IHJlY29yZC5ldmVudElELFxuICAgICAgICBtZXNzYWdlRGVkdXBsaWNhdGlvbklkOiBnZW5lcmF0ZURlZHVwbGljYXRpb25JZChyZWNvcmQpXG4gICAgfTtcbn1cblxuLyoqXG4gKiBQcm9jZXNzb3IgdGhhdCBmb3J3YXJkcyBEeW5hbW9EQiBTdHJlYW0gZXZlbnRzIHRvIFNOUy5cbiAqIFxuICogS2V5IERlc2lnbiBEZWNpc2lvbnM6XG4gKiAxLiBQcmVzZXJ2ZXMgRHluYW1vREIgQXR0cmlidXRlVmFsdWUgZm9ybWF0IGZvciBkb3duc3RyZWFtIGNvbnN1bWVyc1xuICogMi4gRXh0cmFjdHMgdHJhY2UgY29udGV4dCBmcm9tIF9hY3RvciBmaWVsZCBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICogMy4gVXNlcyBTTlMgYmF0Y2hpbmcgZm9yIHN0YW5kYXJkIHRvcGljcyAoMTB4IHBlcmZvcm1hbmNlIGltcHJvdmVtZW50KVxuICogNC4gUHVibGlzaGVzIGluZGl2aWR1YWxseSBmb3IgRklGTyB0b3BpY3MgKHJlcXVpcmVkIGJ5IEFXUyBkdWUgdG8gZGlmZmVyZW50IG1lc3NhZ2VHcm91cElkcylcbiAqL1xuZXhwb3J0IGNsYXNzIER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8RHluYW1vREJFdmVudERhdGFFeHRyYWN0b3I+IHtcbiAgICBwcml2YXRlIHRvcGljQXJuITogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKG5ldyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvcigpKTtcbiAgICB9XG5cbiAgICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIFJlc29sdmUgdG9waWMgQVJOIGZyb20gZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgICAgICAgY29uc3QgdG9waWNOYW1lID0gcHJvY2Vzcy5lbnYuVE9QSUNfTkFNRTtcbiAgICAgICAgaWYgKCF0b3BpY05hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVE9QSUNfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBub3Qgc2V0Jyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSBFbnZpcm9ubWVudC50b3BpY0Fybih0b3BpY05hbWUpO1xuICAgICAgICBpZiAoIXRvcGljQXJuKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRvcGljIEFSTiBub3QgZm91bmQgZm9yIHRvcGljIG5hbWU6ICR7dG9waWNOYW1lfWApO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudG9waWNBcm4gPSB0b3BpY0FybjtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChfcmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gTm8tb3A6IFdlIG92ZXJyaWRlIHByb2Nlc3MoKSB0byBoYW5kbGUgcmF3IHJlY29yZHMgZGlyZWN0bHlcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChfcmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gTm8tb3A6IFdlIG92ZXJyaWRlIHByb2Nlc3MoKSB0byBoYW5kbGUgcmF3IHJlY29yZHMgZGlyZWN0bHlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBPdmVycmlkZSBwcm9jZXNzKCkgdG8gd29yayB3aXRoIHJhdyBEeW5hbW9EQiByZWNvcmRzLlxuICAgICAqIFRoaXMgaXMgY3JpdGljYWwgdG8gcHJlc2VydmUgdGhlIG9yaWdpbmFsIEF0dHJpYnV0ZVZhbHVlIGZvcm1hdCAoZS5nLiwgeyBTOiBcInZhbHVlXCIgfSlcbiAgICAgKiB0aGF0IGRvd25zdHJlYW0gU05TIGNvbnN1bWVycyBleHBlY3QuIFRoZSBiYXNlIGNsYXNzJ3MgZXZlbnREYXRhRXh0cmFjdG9yIHdvdWxkXG4gICAgICogdW5tYXJzaGFsbCB0aGVzZSBpbnRvIHBsYWluIEphdmFTY3JpcHQgb2JqZWN0cywgYnJlYWtpbmcgY29tcGF0aWJpbGl0eS5cbiAgICAgKi9cbiAgICBhc3luYyBwcm9jZXNzKGV2ZW50OiBEeW5hbW9EQlN0cmVhbUV2ZW50IHwgU1FTRXZlbnQsIF9jb250ZXh0OiBDb250ZXh0LCBfY3R4PzogUXVldWVFeGVjdXRpb25Db250ZXh0PER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgY29uc3QgcmF3UmVjb3JkcyA9ICdSZWNvcmRzJyBpbiBldmVudCA/IGV2ZW50LlJlY29yZHMgOiBbXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzUmF3UmVjb3Jkc0JhdGNoKHJhd1JlY29yZHMpO1xuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcHJvY2Vzc1Jhd1JlY29yZHNCYXRjaChyYXdSZWNvcmRzOiBhbnlbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBGaWx0ZXIgb3V0IGF1ZGl0IGxvZ3MgZmlyc3RcbiAgICAgICAgY29uc3QgcmVjb3Jkc1RvUHJvY2VzcyA9IHJhd1JlY29yZHM7XG5cbiAgICAgICAgaWYgKHJlY29yZHNUb1Byb2Nlc3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyByZWNvcmRzIHRvIHB1Ymxpc2ggYWZ0ZXIgZmlsdGVyaW5nJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGSUZPIHRvcGljczogbXVzdCBwdWJsaXNoIGluZGl2aWR1YWxseSAoZGlmZmVyZW50IG1lc3NhZ2VHcm91cElkcyBwZXIgcmVjb3JkKVxuICAgICAgICBpZiAoaXNUb3BpY0ZpZm8oKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoRmlmb1JlY29yZHMocmVjb3Jkc1RvUHJvY2Vzcyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBTdGFuZGFyZCB0b3BpY3M6IGNhbiBiYXRjaCB1cCB0byAxMCBtZXNzYWdlcyBwZXIgQVBJIGNhbGxcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucHVibGlzaFN0YW5kYXJkQmF0Y2gocmVjb3Jkc1RvUHJvY2Vzcyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdWNjZXNzZnVsbHkgcHVibGlzaGVkIGFsbCBzdHJlYW0gcmVjb3JkcyB0byBTTlMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQdWJsaXNoIHJlY29yZHMgdG8gRklGTyB0b3BpYyBpbmRpdmlkdWFsbHkuXG4gICAgICogXG4gICAgICogRklGTyB0b3BpY3MgY2Fubm90IGJlIGJhdGNoZWQgYmVjYXVzZSBlYWNoIER5bmFtb0RCIHJlY29yZCBoYXMgYSBkaWZmZXJlbnQgbWVzc2FnZUdyb3VwSWRcbiAgICAgKiAoZGVyaXZlZCBmcm9tIHRoZSByZWNvcmQncyBwcmltYXJ5IGtleSkuIFNOUyBiYXRjaGluZyByZXF1aXJlcyBhbGwgbWVzc2FnZXMgaW4gYSBiYXRjaFxuICAgICAqIHRvIGhhdmUgdGhlIHNhbWUgbWVzc2FnZUdyb3VwSWQuXG4gICAgICogXG4gICAgICogVXNlcyBjb25jdXJyZW50IHB1Ymxpc2hpbmcgKDUgYXQgYSB0aW1lKSBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlLlxuICAgICAqL1xuICAgIHByaXZhdGUgYXN5bmMgcHVibGlzaEZpZm9SZWNvcmRzKHJlY29yZHM6IGFueVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IEJhdGNoUHJvZ3Jlc3MuZm9yRWFjaChcbiAgICAgICAgICAgICdQdWJsaXNoIEZJRk8nLFxuICAgICAgICAgICAgcmVjb3JkcyxcbiAgICAgICAgICAgIGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWZvUHJvcHMgPSBnZXRGaWZvUHJvcGVydGllcyhyZWNvcmQpO1xuICAgICAgICAgICAgICAgIGF3YWl0IHNlbmRUb3BpY01lc3NhZ2UodGhpcy50b3BpY0Fybiwge1xuICAgICAgICAgICAgICAgICAgICBldmVudElEOiByZWNvcmQuZXZlbnRJRCxcbiAgICAgICAgICAgICAgICAgICAgZXZlbnROYW1lOiByZWNvcmQuZXZlbnROYW1lLFxuICAgICAgICAgICAgICAgICAgICBldmVudFNvdXJjZTogcmVjb3JkLmV2ZW50U291cmNlLFxuICAgICAgICAgICAgICAgICAgICBkeW5hbW9kYjogcmVjb3JkLmR5bmFtb2RiLCAgLy8gUHJlc2VydmVkOiBPcmlnaW5hbCBBdHRyaWJ1dGVWYWx1ZSBmb3JtYXRcbiAgICAgICAgICAgICAgICAgICAgLi4uZmlmb1Byb3BzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBjb25jdXJyZW5jeTogNSB9XG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHVibGlzaCByZWNvcmRzIHRvIHN0YW5kYXJkIHRvcGljIHVzaW5nIFNOUyBiYXRjaGluZy5cbiAgICAgKiBcbiAgICAgKiBTdGFuZGFyZCB0b3BpY3Mgc3VwcG9ydCBiYXRjaGluZyB1cCB0byAxMCBtZXNzYWdlcyBwZXIgQVBJIGNhbGwsXG4gICAgICogcHJvdmlkaW5nIH4xMHggcGVyZm9ybWFuY2UgaW1wcm92ZW1lbnQgb3ZlciBpbmRpdmlkdWFsIHB1Ymxpc2hlcy5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHB1Ymxpc2hTdGFuZGFyZEJhdGNoKHJlY29yZHM6IGFueVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IEJhdGNoUHJvZ3Jlc3MuY2h1bmsoXG4gICAgICAgICAgICAnUHVibGlzaCBTTlMnLFxuICAgICAgICAgICAgcmVjb3JkcyxcbiAgICAgICAgICAgIGFzeW5jIChiYXRjaCwgY3R4KSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgYmF0Y2ggbWVzc2FnZXMgZm9yIFNOUyBQdWJsaXNoQmF0Y2ggQVBJXG4gICAgICAgICAgICAgICAgY29uc3QgbWVzc2FnZXM6IEJhdGNoVG9waWNNZXNzYWdlW10gPSBiYXRjaC5tYXAoKHJlY29yZCwgaW5kZXgpID0+ICh7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBgJHtjdHguaXRlbUluZGV4ICogMTAgKyBpbmRleH1gLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBldmVudElEOiByZWNvcmQuZXZlbnRJRCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50TmFtZTogcmVjb3JkLmV2ZW50TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50U291cmNlOiByZWNvcmQuZXZlbnRTb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBkeW5hbW9kYjogcmVjb3JkLmR5bmFtb2RiLCAgLy8gUHJlc2VydmVkOiBPcmlnaW5hbCBBdHRyaWJ1dGVWYWx1ZSBmb3JtYXRcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZW5kVG9waWNNZXNzYWdlQmF0Y2godGhpcy50b3BpY0FybiwgbWVzc2FnZXMpO1xuXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIHBhcnRpYWwgYmF0Y2ggZmFpbHVyZXNcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LkZhaWxlZD8ubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdTb21lIG1lc3NhZ2VzIGZhaWxlZCB0byBwdWJsaXNoJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmFpbGVkQ291bnQ6IHJlc3VsdC5GYWlsZWQubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICAgICAgZmFpbGVkSWRzOiByZXN1bHQuRmFpbGVkLm1hcChmID0+IGYuSWQpLmpvaW4oJywgJylcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHB1Ymxpc2ggJHtyZXN1bHQuRmFpbGVkLmxlbmd0aH0gbWVzc2FnZXNgKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gYmF0Y2g7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBzaXplOiAxMCB9ICAvLyBTTlMgUHVibGlzaEJhdGNoIGxpbWl0XG4gICAgICAgICk7XG4gICAgfVxufVxuXG4vLyBFeHBvcnQgaGFuZGxlciB1c2luZyB0aGUgQ3JlYXRlSGFuZGxlciBwYXR0ZXJuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IuQ3JlYXRlSGFuZGxlcihEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yKTsgIl19