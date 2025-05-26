import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { extractDynamoDBRecords, logger, processStreamRecord } from '../audit-utils';

/**
 * Main handler function that processes both DynamoDB Stream and SQS events
 */
export const handler = async (event: DynamoDBStreamEvent | SQSEvent): Promise<void> => {
    logger.debug('Processing event', { event });

    try {
        // Extract DynamoDB records from either event type
        const records = extractDynamoDBRecords(event);
        logger.debug('Extracted records', { records });
        // Process each record
        const auditPromises = records.map(record => processStreamRecord(record));
        await Promise.all(auditPromises);
    } catch (error) {
        logger.error('Error processing records', error);
        throw error;
    }
};
