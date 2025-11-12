import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';

import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { createLogger } from '../../logging';
import { resolveEnvValueFor } from '../../utils';
import { AUDIT_ENV_KEYS, AuditEntry, AuditLoggerType, IAuditLogger } from '../interfaces';
import { AuditLoggerFactory } from './factory';

/**
 * Default audit handler that extends BaseSQSEventProcessor
 * Custom audit handlers can extend this to add custom processing while reusing framework utilities
 */
export class DynamoDBStreamAuditLogger extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {

  private auditLogger?: IAuditLogger;

  constructor() {
    super(new DynamoDBEventDataExtractor());
  }

  async initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
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

  protected getAllowedEntityNames(): string[] | undefined {
    const allowedEntityNames = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.ALLOWED_ENTITY_NAMES });
    return allowedEntityNames ? allowedEntityNames.split(',') : undefined;
  }

  protected getExcludedEntityNames(): string[] | undefined {
    const excludedEntityNames = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.EXCLUDED_ENTITY_NAMES });
    return excludedEntityNames ? excludedEntityNames.split(',') : undefined;
  }

  /**
   * Determines if an entity should be audited based on allowed/excluded lists.
   * Logic:
   * - If allowedEntityNames is provided, only audit entities in that list
   * - If excludedEntityNames is provided (and no allowedEntityNames), audit all except excluded
   * - If neither is provided, audit all except 'auditLog' (default behavior)
   * - allowedEntityNames takes precedence over excludedEntityNames
   */
  protected shouldAuditEntity(entityName: string): boolean {
    const allowedEntityNames = this.getAllowedEntityNames();
    const excludedEntityNames = this.getExcludedEntityNames();

    // If allowedEntityNames is provided, use it exclusively
    if (allowedEntityNames && allowedEntityNames.length > 0) {
      return allowedEntityNames.includes(entityName);
    }

    // If excludedEntityNames is provided, audit all except excluded
    if (excludedEntityNames && excludedEntityNames.length > 0) {
      return !excludedEntityNames.includes(entityName);
    }

    // Default behavior: audit all except system entities
    return entityName !== 'auditLog';
  }

  protected async preprocessRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<BaseEventRecord<ChangeStreamPayload> | null> {

    const { entityName, eventType } = record;

    if (![ 'create', 'update', 'delete' ].includes(eventType)) {
      this.logger.warn('Skipping record with event type', { eventType });
      return null;
    }

    if (!entityName) {
      this.logger.warn('No entity name found in record', { record });
      return null;
    }

    if (!this.shouldAuditEntity(entityName)) {
      const allowedEntityNames = this.getAllowedEntityNames();
      const excludedEntityNames = this.getExcludedEntityNames();
      this.logger.warn('Skipping audit log for entity based on filtering rules', { 
        entityName, 
        allowedEntityNames, 
        excludedEntityNames 
      });
      return null;
    }

    return record;
  }

  protected async processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {

    const auditEntry = this.makeAuditEntry(record);

    if (!auditEntry) {
      this.logger.info('No audit entry created, skipping', { record });
      return;
    }

    await this.writeAuditEntry(auditEntry);

    this.logger.debug('Successfully wrote audit entry', { auditEntry });
  }

  protected async processRecordsBatch(records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void> {
    // For audit logging, process each record individually to maintain detailed audit trail
    const auditLogger = this.getAuditLogger();
    
    for (const record of records) {
      const auditEntry = this.makeAuditEntry(record);
      if (auditEntry) {
        await auditLogger.audit({ auditEntry });
        this.logger.debug('Successfully wrote audit entry in batch', { auditEntry });
      }
    }
  }

  protected makeAuditEntry(record: BaseEventRecord<ChangeStreamPayload>): AuditEntry | undefined {
        const { entityName, eventType, timestamp, entityId, payload: { newImage, oldImage } } = record;
        // Get only the changed properties
        const changes = getChangedProperties(oldImage, newImage);

        // Skip if no changes were detected
        if (Object.keys(changes).length === 0) {
            this.logger.debug('No changes detected, skipping audit entry');
            return;
        }

        // Extract actor context from the _actor field
        const rawActorContext = newImage?._actor || oldImage?._actor;
        
        const actorContext = rawActorContext;
        
        // Fallback to visible actor fields if _actor not available (backward compatibility)
        const fallbackActor: any = {};
        if (newImage?.updatedBy || newImage?.createdBy || oldImage?.updatedBy || oldImage?.createdBy) {
            fallbackActor.actorId = newImage?.updatedBy || newImage?.createdBy || oldImage?.updatedBy || oldImage?.createdBy;
        }
        if (newImage?.tenantId || oldImage?.tenantId) {
            fallbackActor.tenantId = newImage?.tenantId || oldImage?.tenantId;
        }

        // Create audit entry
        // Note: timestamp is already in milliseconds (converted from DynamoDB seconds in the data extractor)
        // Example: timestamp = 1734567890000 (milliseconds) -> "2024-12-19T10:31:30.000Z"
        const timestampDate = timestamp ? new Date(timestamp) : new Date();
        const timestampIso = timestampDate.toISOString();
        const timestampMs = timestampDate.getTime();
        
        // Determine success and severity based on event type
        // Database change events are typically successful operations
        const success = true; // Stream events represent completed database operations
        const severity = eventType === 'delete' ? 'warn' : 'info'; // Deletions might be more significant
        
        const auditEntry: AuditEntry = {
            // Core fields - what we know from the stream
            auditType: 'audit',
            timestamp: timestampIso,
            timestampMs,
            
            // Entity tracking - what changed
            entityName,
            entityId: entityId as string,
            eventType,
            operation: eventType, // Backward compatibility - same as eventType for stream events
            
            // Outcome - stream events represent completed DB operations
            severity,
            success,
            
            // Actor - who made the change
            actor: actorContext || (Object.keys(fallbackActor).length > 0 ? fallbackActor : { actorType: 'unknown' }),
            
            // Data - what actually changed
            data: changes,
            
            // Legacy support
            identifiers: {
                id: entityId as string
            }
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
  ignoredFields: string[] = [ 'updatedAt', '__edb_e__', '__edb_v__', 'pk', 'sk', '_actor' ]
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