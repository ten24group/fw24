import { DynamoDBStreamEvent, Context } from 'aws-lambda';
import { createLogger } from '../../logging';
import { sendTopicMessage } from '../../client/sns';
import { Environment } from '../../client';
import { createHash } from 'crypto';

const logger = createLogger('StreamProcessor');

/**
 * Generates a deterministic deduplication ID from the record
 */
function generateDeduplicationId(record: any): string {
    const data = `${record.eventID}-${record.eventName}-${JSON.stringify(record.dynamodb)}`;
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Determines if the topic is FIFO based on environment variable
 */
function isTopicFifo(): boolean {
    return process.env.TOPIC_TYPE?.toLowerCase() === 'fifo';
}

/**
 * Gets FIFO specific message properties if FIFO is enabled
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

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
    logger.debug('Processing DynamoDB Stream event', { event });

    try {
        // Get topic ARN from environment variable
        const topicName = process.env.TOPIC_NAME;
        if (!topicName) {
            throw new Error('TOPIC_NAME environment variable not set');
        }
        const topicArn = Environment.topicArn(topicName);
        if (!topicArn) {
            throw new Error(`Topic ARN not found for topic name: ${topicName}`);
        }

        const publishPromises = event.Records.map(async (record) => {
            // Get FIFO properties if enabled
            const fifoProps = getFifoProperties(record);

            // Check if this is a DynamoDB event and if it's an audit log
            if (record.eventSource === 'aws:dynamodb') {
                const newImage = record.dynamodb?.NewImage;
                const oldImage = record.dynamodb?.OldImage;
                const entityName = ((newImage?.__edb_e__ || oldImage?.__edb_e__) as { S?: string })?.S;
                logger.info('Stream entity name', entityName);
                
                // Skip processing only audit log records
                if (entityName === 'auditLog') {
                    logger.debug('Skipping audit log record', { eventID: record.eventID });
                    return Promise.resolve();
                }
            }

            // Continue processing for all non-audit records
            const message = {
                eventID: record.eventID,
                eventName: record.eventName,
                eventSource: record.eventSource,
                dynamodb: record.dynamodb,
                messageAttributes: {
                    eventType: record.eventName
                },
                ...fifoProps // Add FIFO properties only if FIFO is enabled
            };

            await sendTopicMessage(topicArn, message);
            
            logger.debug('Successfully published stream record to SNS', { 
                eventID: record.eventID, 
                eventName: record.eventName,
                ...(isTopicFifo() && { fifoProps }) // Log FIFO properties only if enabled
            });
        });

        await Promise.all(publishPromises);
        logger.debug('Successfully published all stream records to SNS');
    } catch (error) {
        logger.error('Error processing stream records', error);
        throw error;
    }
}; 