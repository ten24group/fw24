import { DynamoDBRecord, } from 'aws-lambda';
import { BaseDynamoDBStreamHandler, EVENT_TYPE_MAP } from '../../core/runtime/base-dynamodb-stream-handler';

import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { createLogger } from '../../logging';
import { resolveEnvValueFor } from '../../utils';
import { AUDIT_ENV_KEYS, AuditEntry, AuditLoggerType, IAuditLogger } from '../interfaces';
import { AuditLoggerFactory } from './factory';



/**
 * Base audit handler that extends AbstractLambdaHandler
 * Custom audit handlers can extend this to add custom processing while reusing framework utilities
 */
export class DefaultAuditHandler extends BaseDynamoDBStreamHandler {

  private auditLogger?: IAuditLogger;

  constructor() {
    super();
  }

  // override this method to initialize custom audit-logger
  protected initializeAuditLogger() {

    const auditLoggerType = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.TYPE }) || AuditLoggerType.CLOUDWATCH;

    this.auditLogger = AuditLoggerFactory.getInstance().create({
      type: auditLoggerType as AuditLoggerType,
      enabled: true
    });

    if (!this.auditLogger) {
      throw new Error(`Audit logger not initialized for type ${auditLoggerType}`);
    }

    this.logger.debug('Audit logger initialized', { auditLoggerType });
  }

  protected getAuditLogger(): IAuditLogger {
    if (!this.auditLogger) {
      this.initializeAuditLogger();
    }

    return this.auditLogger!;
  }

  protected async processRecord(record: DynamoDBRecord): Promise<void> {

    const auditEntry = this.makeAditEntry(record);

    if (!auditEntry) {
      this.logger.info('No audit entry created, skipping', { record });
      return;
    }

    await this.writeAuditEntry(auditEntry);

    this.logger.debug('Successfully wrote audit entry', { auditEntry });
  }

  protected makeAditEntry(record: DynamoDBRecord): AuditEntry | undefined {
    if (!record.dynamodb) {
      this.logger.warn('Record does not contain DynamoDB data', { record });
      return;
    }

    const eventName = record.eventName as keyof typeof EVENT_TYPE_MAP;
    if (!eventName || !EVENT_TYPE_MAP[ eventName ]) {
      this.logger.warn('Unknown event type', { eventName });
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
      this.logger.warn('No entity name found in record', { record });
      return;
    }

    if (entityName === 'auditLog') {
      this.logger.info('Skipping audit log', { record });
      return;
    }

    // Get only the changed properties
    const changes = getChangedProperties(oldImage, newImage);

    // Skip if no changes were detected
    if (Object.keys(changes).length === 0) {
      this.logger.debug('No changes detected, skipping audit entry');
      return;
    }

    // Create audit entry
    const auditEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      entityName,
      eventType: EVENT_TYPE_MAP[ eventName ],
      data: changes,
      identifiers: {
        id: (newImage?.id || oldImage?.id) as string
      },
      actor: newImage?.updatedBy
    };

    return auditEntry;
  }

  protected async writeAuditEntry(auditEntry: AuditEntry): Promise<void> {

    const auditLogger = this.getAuditLogger();

    try {

      this.logger.debug(`Writing audit entry using logger ${auditLogger.constructor.name}`);
      await auditLogger.audit({ auditEntry });

      this.logger.debug('Successfully wrote audit entry', { auditEntry });

    } catch (error) {
      this.logger.error('Error writing audit entry', { error, auditEntry });
      throw error;
    }
  }
}

export const logger = createLogger('DynamoDBStreamHandler');

/**
 * Main entry point for change detection
 */
export function getChangedProperties(
  oldImage: Record<string, any> | undefined,
  newImage: Record<string, any> | undefined,
  // TODO: more fields like GSI1PK, GSI1SK, etc.
  ignoredFields: string[] = [ 'updatedAt', '__edb_e__', '__edb_v__', 'pk', 'sk' ]
): Record<string, { old?: any, new?: any }> {
  return getChangedPropertiesRecursive(oldImage, newImage, ignoredFields);
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
    return oldValue.some((val, index) => isDifferent(val, newValue[ index ]));
  }

  return JSON.stringify(oldValue) !== JSON.stringify(newValue);
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
    changes[ key ] = { new: newValue };
    return changes;
  }

  // Handle property deletion
  if (newValue === undefined) {
    changes[ key ] = { old: oldValue };
    return changes;
  }

  // Handle arrays by comparing them element by element
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const arrayChanges = compareArrays(oldValue, newValue, ignoredFields);
    if (Object.keys(arrayChanges).length > 0) {
      changes[ key ] = arrayChanges;
    }
  }
  // Handle nested objects
  else if (typeof oldValue === 'object' && typeof newValue === 'object' &&
    oldValue !== null && newValue !== null) {
    const nestedChanges = getChangedPropertiesRecursive(oldValue, newValue, []);
    if (Object.keys(nestedChanges).length > 0) {
      changes[ key ] = {
        old: {},
        new: {}
      };
      // Copy only changed properties
      Object.keys(nestedChanges).forEach(nestedKey => {
        const change = nestedChanges[ nestedKey ];
        if (change.old !== undefined) {
          changes[ key ].old[ nestedKey ] = change.old;
        }
        if (change.new !== undefined) {
          changes[ key ].new[ nestedKey ] = change.new;
        }
      });
    }
  }
  // Handle primitive values
  else if (isDifferent(oldValue, newValue)) {
    changes[ key ] = {
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
    const oldItem = oldArray[ i ];
    const newItem = newArray[ i ];

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
        .filter(([ key ]) => !ignoredFields.includes(key))
        .map(([ key, value ]) => [ key, { new: value } ])
    );
  }

  // Handle deletion case (no new object)
  if (!newObj) {
    return Object.fromEntries(
      Object.entries(oldObj)
        .filter(([ key ]) => !ignoredFields.includes(key))
        .map(([ key, value ]) => [ key, { old: value } ])
    );
  }

  // Process all keys from both objects
  const allKeys = new Set([ ...Object.keys(oldObj), ...Object.keys(newObj) ]);
  for (const key of allKeys) {
    const keyChanges = processKeyValuePair(key, oldObj[ key ], newObj[ key ], ignoredFields);
    Object.assign(changes, keyChanges);
  }

  return changes;
}