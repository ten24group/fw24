import { DynamoDBStreamEvent, DynamoDBRecord, SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDB, AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createLogger } from '../../logging';
import { AUDIT_ENV_KEYS, AuditEntry, AuditLoggerType } from '../interfaces';
import { AuditLoggerFactory } from '../loggers/factory';
import { resolveEnvValueFor } from '../../utils';

const logger = createLogger('DynamoDBStreamHandler');

/**
 * Maps DynamoDB stream event types to CRUD operations
 */
const EVENT_TYPE_MAP = {
    INSERT: 'create',
    MODIFY: 'update',
    REMOVE: 'delete'
} as const;

/**
 * Extracts DynamoDB records from either a DynamoDB stream event or an SQS event
 */
function extractDynamoDBRecords(event: DynamoDBStreamEvent | SQSEvent): DynamoDBRecord[] {
    // Type guard for SQS events
    const isSQSEvent = (event: DynamoDBStreamEvent | SQSEvent): event is SQSEvent => {
        return 'Records' in event && event.Records[0]?.eventSource === 'aws:sqs';
    };

    if (isSQSEvent(event)) {
        // Handle SQS event
        return event.Records.reduce<DynamoDBRecord[]>((acc, record) => {
            try {
                const body = JSON.parse(record.body);
                const message = JSON.parse(body.Message);
                
                // Create a DynamoDB record from the message
                const dynamoRecord: DynamoDBRecord = {
                    eventID: message.message.eventID,
                    eventName: message.message.eventName as "INSERT" | "MODIFY" | "REMOVE",
                    eventSource: message.message.eventSource,
                    eventVersion: '1.0',
                    awsRegion: record.awsRegion,
                    dynamodb: message.message.dynamodb
                };
                
                acc.push(dynamoRecord);
            } catch (error) {
                logger.error('Error parsing SQS message', { error, record });
            }
            return acc;
        }, []);
    }

    // Handle direct DynamoDB stream event
    return event.Records;
}

/**
 * Simple value comparison helper
 * Returns true if values are different, false if they are the same
 */
function isDifferent(oldValue: any, newValue: any): boolean {
    if (oldValue === newValue) return false;
    if (typeof oldValue !== typeof newValue) return true;
    if (oldValue === null || newValue === null) return true;
    if (typeof oldValue !== 'object') return oldValue !== newValue;
    if (Array.isArray(oldValue) !== Array.isArray(newValue)) return true;
    
    // If both are arrays, compare them as arrays
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        if (oldValue.length !== newValue.length) return true;
        return oldValue.some((val, index) => isDifferent(val, newValue[index]));
    }
    
    return JSON.stringify(oldValue) !== JSON.stringify(newValue);
}

/**
 * Extracts the first object from an array or returns the object itself
 */
function extractObject(value: any): any {
    if (Array.isArray(value) && value.length > 0) {
        return value[0];
    }
    return value;
}

/**
 * Processes a single key-value pair and determines if it should be included in changes
 */
function processKeyValuePair(
    key: string,
    oldValue: any,
    newValue: any,
    ignoredFields: string[]
): Record<string, { old?: any, new?: any }> {
    // Skip ignored fields
    if (ignoredFields.includes(key)) {
        return {};
    }

    const changes: Record<string, { old?: any, new?: any }> = {};

    // Handle property addition
    if (oldValue === undefined) {
        changes[key] = { new: newValue };
        return changes;
    }

    // Handle property deletion
    if (newValue === undefined) {
        changes[key] = { old: oldValue };
        return changes;
    }

    // Handle arrays by comparing them element by element
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        const arrayChanges = compareArrays(oldValue, newValue, ignoredFields);
        if (Object.keys(arrayChanges).length > 0) {
            changes[key] = arrayChanges;
        }
    }
    // Handle nested objects
    else if (typeof oldValue === 'object' && typeof newValue === 'object' &&
        oldValue !== null && newValue !== null) {
        const nestedChanges = getChangedPropertiesRecursive(oldValue, newValue, []);
        if (Object.keys(nestedChanges).length > 0) {
            changes[key] = {
                old: {},
                new: {}
            };
            // Copy only changed properties
            Object.keys(nestedChanges).forEach(nestedKey => {
                const change = nestedChanges[nestedKey];
                if (change.old !== undefined) {
                    changes[key].old[nestedKey] = change.old;
                }
                if (change.new !== undefined) {
                    changes[key].new[nestedKey] = change.new;
                }
            });
        }
    }
    // Handle primitive values
    else if (isDifferent(oldValue, newValue)) {
        changes[key] = {
            old: oldValue,
            new: newValue
        };
    }

    return changes;
}

/**
 * Compares two arrays and returns the changes
 */
function compareArrays(
    oldArray: any[],
    newArray: any[],
    ignoredFields: string[]
): { old: any[], new: any[] } | Record<string, never> {
    const changes: { old: any[], new: any[] } = {
        old: [],
        new: []
    };

    let hasChanges = false;

    // Compare elements that exist in both arrays
    const minLength = Math.min(oldArray.length, newArray.length);
    for (let i = 0; i < minLength; i++) {
        const oldItem = oldArray[i];
        const newItem = newArray[i];

        if (typeof oldItem === 'object' && typeof newItem === 'object') {
            const itemChanges = getChangedPropertiesRecursive(oldItem, newItem, ignoredFields);
            if (Object.keys(itemChanges).length > 0) {
                changes.old.push(oldItem);
                changes.new.push(newItem);
                hasChanges = true;
            }
        } else if (isDifferent(oldItem, newItem)) {
            changes.old.push(oldItem);
            changes.new.push(newItem);
            hasChanges = true;
        }
    }

    // Handle added elements
    if (newArray.length > oldArray.length) {
        changes.new.push(...newArray.slice(oldArray.length));
        hasChanges = true;
    }

    // Handle removed elements
    if (oldArray.length > newArray.length) {
        changes.old.push(...oldArray.slice(newArray.length));
        hasChanges = true;
    }

    return hasChanges ? changes : {};
}

/**
 * Recursively compares two objects and extracts changed properties
 */
function getChangedPropertiesRecursive(
    oldObj: Record<string, any> | undefined,
    newObj: Record<string, any> | undefined,
    ignoredFields: string[]
): Record<string, { old?: any, new?: any }> {
    const changes: Record<string, { old?: any, new?: any }> = {};

    // Handle base cases
    if (!oldObj && !newObj) return changes;
    
    // Handle creation case (no old object)
    if (!oldObj) {
        return Object.fromEntries(
            Object.entries(newObj!)
                .filter(([key]) => !ignoredFields.includes(key))
                .map(([key, value]) => [key, { new: extractObject(value) }])
        );
    }
    
    // Handle deletion case (no new object)
    if (!newObj) {
        return Object.fromEntries(
            Object.entries(oldObj)
                .filter(([key]) => !ignoredFields.includes(key))
                .map(([key, value]) => [key, { old: extractObject(value) }])
        );
    }

    // Process all keys from both objects
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const key of allKeys) {
        const keyChanges = processKeyValuePair(key, oldObj[key], newObj[key], ignoredFields);
        Object.assign(changes, keyChanges);
    }

    return changes;
}

/**
 * Main entry point for change detection
 */
function getChangedProperties(
    oldImage: Record<string, any> | undefined, 
    newImage: Record<string, any> | undefined
): Record<string, { old?: any, new?: any }> {
    const ignoredFields = ['updatedAt', '__edb_e__', '__edb_v__', 'pk', 'sk'];
    return getChangedPropertiesRecursive(oldImage, newImage, ignoredFields);
}

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

/**
 * Process a single DynamoDB Stream record and create an audit log entry
 */
async function processStreamRecord(record: DynamoDBRecord): Promise<void> {
    if (!record.dynamodb) {
        logger.warn('Record does not contain DynamoDB data', { record });
        return;
    }

    const eventName = record.eventName as keyof typeof EVENT_TYPE_MAP;
    if (!eventName || !EVENT_TYPE_MAP[eventName]) {
        logger.warn('Unknown event type', { eventName });
        return;
    }

    // Get the old and new images of the record
    const oldImage = record.dynamodb.OldImage 
        ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>) 
        : undefined;
    const newImage = record.dynamodb.NewImage 
        ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>) 
        : undefined;

    // Get entity name from __edb_e__
    const entityName = (newImage?.__edb_e__ || oldImage?.__edb_e__) as string;
    if (!entityName) {
        logger.warn('No entity name found in record', { record });
        return;
    }

    // Get only the changed properties
    const changes = getChangedProperties(oldImage, newImage);

    // Skip if no changes were detected
    if (Object.keys(changes).length === 0) {
        logger.debug('No changes detected, skipping audit entry');
        return;
    }

    // Create audit entry
    const auditEntry: AuditEntry = {
        timestamp: new Date().toISOString(),
        entityName,
        eventType: EVENT_TYPE_MAP[eventName],
        data: changes,
        identifiers: {
            id: (newImage?.id || oldImage?.id) as string
        },
        actor: newImage?.updatedBy || 'Unknown'
    };

    const envType = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.TYPE }) || AuditLoggerType.CLOUDWATCH;
    const auditLogger = AuditLoggerFactory.getInstance().create({ type: envType as AuditLoggerType, enabled: true });

    // Write to audit table
    try {
        logger.debug('Writing audit entry using logger', auditLogger);
        await auditLogger.audit({ auditEntry });
        logger.debug('Successfully wrote audit entry', { auditEntry });
    } catch (error) {
        logger.error('Error writing audit entry', { error, auditEntry });
        throw error;
    }
}
