"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.DynamoDBStreamAuditLogger = void 0;
exports.getChangedProperties = getChangedProperties;
const base_sqs_event_processor_1 = require("../../core/runtime/event-processor/base-sqs-event-processor");
const dynamodb_event_data_extractor_1 = require("../../core/runtime/event-processor/dynamodb-event-data-extractor");
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
const interfaces_1 = require("../interfaces");
const factory_1 = require("./factory");
/**
 * Default audit handler that extends BaseSQSEventProcessor
 * Custom audit handlers can extend this to add custom processing while reusing framework utilities
 */
class DynamoDBStreamAuditLogger extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    auditLogger;
    constructor() {
        super(new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor());
    }
    async initialize(_event) {
    }
    // override this method to initialize custom audit-logger
    initializeAuditLogger() {
        const auditLoggerType = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.TYPE }) || interfaces_1.AuditLoggerType.CLOUDWATCH;
        this.auditLogger = factory_1.AuditLoggerFactory.getInstance().create({
            type: auditLoggerType,
            enabled: true
        });
        if (!this.auditLogger) {
            throw new Error(`Audit logger not initialized for type ${auditLoggerType}`);
        }
        this.logger.debug('Audit logger initialized', { auditLoggerType });
    }
    getAuditLogger() {
        if (!this.auditLogger) {
            this.initializeAuditLogger();
        }
        return this.auditLogger;
    }
    getAllowedEntityNames() {
        const allowedEntityNames = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.ALLOWED_ENTITY_NAMES });
        return allowedEntityNames ? allowedEntityNames.split(',') : undefined;
    }
    getExcludedEntityNames() {
        const excludedEntityNames = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.EXCLUDED_ENTITY_NAMES });
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
    shouldAuditEntity(entityName) {
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
    async preprocessRecord(record) {
        const { entityName, eventType } = record;
        if (!['create', 'update', 'delete'].includes(eventType)) {
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
            // this.logger.warn('Skipping audit log for entity based on filtering rules', { 
            //   entityName, 
            //   allowedEntityNames, 
            //   excludedEntityNames 
            // });
            return null;
        }
        return record;
    }
    async processRecord(record) {
        const auditEntry = this.makeAuditEntry(record);
        if (!auditEntry) {
            this.logger.info('No audit entry created, skipping', { record });
            return;
        }
        await this.writeAuditEntry(auditEntry);
        this.logger.debug('Successfully wrote audit entry', { auditEntry });
    }
    async processRecordsBatch(records) {
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
    makeAuditEntry(record) {
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
        const fallbackActor = {};
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
        const auditEntry = {
            auditType: 'audit',
            timestamp: timestampIso,
            timestampMs,
            entityName,
            eventType,
            severity,
            success,
            data: changes,
            identifiers: {
                id: entityId
            },
            actor: actorContext || (Object.keys(fallbackActor).length > 0 ? fallbackActor : { actorType: 'unknown' })
        };
        return auditEntry;
    }
    async writeAuditEntry(auditEntry) {
        const auditLogger = this.getAuditLogger();
        try {
            this.logger.debug(`Writing audit entry using logger ${auditLogger.constructor.name}`);
            await auditLogger.audit({ auditEntry });
            this.logger.debug('Successfully wrote audit entry', { auditEntry });
        }
        catch (error) {
            this.logger.error('Error writing audit entry', { error, auditEntry });
            throw error;
        }
    }
}
exports.DynamoDBStreamAuditLogger = DynamoDBStreamAuditLogger;
exports.logger = (0, logging_1.createLogger)('DynamoDBStreamHandler');
/**
 * Main entry point for change detection
 */
function getChangedProperties(oldImage, newImage, 
// TODO: more fields like GSI1PK, GSI1SK, etc.
ignoredFields = ['updatedAt', '__edb_e__', '__edb_v__', 'pk', 'sk', '_actor']) {
    return getChangedPropertiesRecursive(oldImage, newImage, ignoredFields);
}
/**
 * Simple value comparison helper
 * Returns true if values are different, false if they are the same
 */
function isDifferent(oldValue, newValue) {
    if (oldValue === newValue)
        return false;
    if (typeof oldValue !== typeof newValue)
        return true;
    if (oldValue === null || newValue === null)
        return true;
    if (typeof oldValue !== 'object')
        return oldValue !== newValue;
    if (Array.isArray(oldValue) !== Array.isArray(newValue))
        return true;
    // If both are arrays, compare them as arrays
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        if (oldValue.length !== newValue.length)
            return true;
        return oldValue.some((val, index) => isDifferent(val, newValue[index]));
    }
    return JSON.stringify(oldValue) !== JSON.stringify(newValue);
}
/**
 * Processes a single key-value pair and determines if it should be included in changes
 */
function processKeyValuePair(key, oldValue, newValue, ignoredFields) {
    // Skip ignored fields
    if (ignoredFields.includes(key)) {
        return {};
    }
    const changes = {};
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
function compareArrays(oldArray, newArray, ignoredFields) {
    const changes = {
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
        }
        else if (isDifferent(oldItem, newItem)) {
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
function getChangedPropertiesRecursive(oldObj, newObj, ignoredFields) {
    const changes = {};
    // Handle base cases
    if (!oldObj && !newObj)
        return changes;
    // Handle creation case (no old object)
    if (!oldObj) {
        return Object.fromEntries(Object.entries(newObj)
            .filter(([key]) => !ignoredFields.includes(key))
            .map(([key, value]) => [key, { new: value }]));
    }
    // Handle deletion case (no new object)
    if (!newObj) {
        return Object.fromEntries(Object.entries(oldObj)
            .filter(([key]) => !ignoredFields.includes(key))
            .map(([key, value]) => [key, { old: value }]));
    }
    // Process all keys from both objects
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const key of allKeys) {
        const keyChanges = processKeyValuePair(key, oldObj[key], newObj[key], ignoredFields);
        Object.assign(changes, keyChanges);
    }
    return changes;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUEyTkEsb0RBT0M7QUFoT0QsMEdBQW9HO0FBQ3BHLG9IQUE4RztBQUU5RywyQ0FBNkM7QUFDN0MsdUNBQWlEO0FBQ2pELDhDQUEwRjtBQUMxRix1Q0FBK0M7QUFFL0M7OztHQUdHO0FBQ0gsTUFBYSx5QkFBMEIsU0FBUSxnREFBaUQ7SUFFdEYsV0FBVyxDQUFnQjtJQUVuQztRQUNFLEtBQUssQ0FBQyxJQUFJLDBEQUEwQixFQUFFLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFzQztJQUN2RCxDQUFDO0lBRUQseURBQXlEO0lBQy9DLHFCQUFxQjtRQUU3QixNQUFNLGVBQWUsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSw0QkFBZSxDQUFDLFVBQVUsQ0FBQztRQUV2RyxJQUFJLENBQUMsV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUN6RCxJQUFJLEVBQUUsZUFBa0M7WUFDeEMsT0FBTyxFQUFFLElBQUk7U0FDZCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFDOUUsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBCQUEwQixFQUFFLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztJQUNyRSxDQUFDO0lBRVMsY0FBYztRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFdB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cnQgeyBEeW5hbW9EQlN0cmVhbUV2ZW50LCBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuXG5pbXBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBDaGFuZ2VTdHJlYW1QYXlsb2FkIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBBVURJVF9FTlZfS0VZUywgQXVkaXRFbnRyeSwgQXVkaXRMb2dnZXJUeXBlLCBJQXVkaXRMb2dnZXIgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyRmFjdG9yeSB9IGZyb20gJy4vZmFjdG9yeSc7XG5cbi8qKlxuICogRGVmYXVsdCBhdWRpdCBoYW5kbGVyIHRoYXQgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3JcbiAqIEN1c3RvbSBhdWRpdCBoYW5kbGVycyBjYW4gZXh0ZW5kIHRoaXMgdG8gYWRkIGN1c3RvbSBwcm9jZXNzaW5nIHdoaWxlIHJldXNpbmcgZnJhbWV3b3JrIHV0aWxpdGllc1xuICovXG5leHBvcnQgY2xhc3MgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlciBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvcjxEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3Rvcj4ge1xuXG4gIHByaXZhdGUgYXVkaXRMb2dnZXI/OiBJQXVkaXRMb2dnZXI7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIobmV3IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yKCkpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICB9XG5cbiAgLy8gb3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gaW5pdGlhbGl6ZSBjdXN0b20gYXVkaXQtbG9nZ2VyXG4gIHByb3RlY3RlZCBpbml0aWFsaXplQXVkaXRMb2dnZXIoKSB7XG5cbiAgICBjb25zdCBhdWRpdExvZ2dlclR5cGUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLlRZUEUgfSkgfHwgQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0g7XG5cbiAgICB0aGlzLmF1ZGl0TG9nZ2VyID0gQXVkaXRMb2dnZXJGYWN0b3J5LmdldEluc3RhbmNlKCkuY3JlYXRlKHtcbiAgICAgIHR5cGU6IGF1ZGl0TG9nZ2VyVHlwZSBhcyBBdWRpdExvZ2dlclR5cGUsXG4gICAgICBlbmFibGVkOiB0cnVlXG4gICAgfSk7XG5cbiAgICBpZiAoIXRoaXMuYXVkaXRMb2dnZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQXVkaXQgbG9nZ2VyIG5vdCBpbml0aWFsaXplZCBmb3IgdHlwZSAke2F1ZGl0TG9nZ2VyVHlwZX1gKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQXVkaXQgbG9nZ2VyIGluaXRpYWxpemVkJywgeyBhdWRpdExvZ2dlclR5cGUgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0QXVkaXRMb2dnZXIoKTogSUF1ZGl0TG9nZ2VyIHtcbiAgICBpZiAoIXRoaXMuYXVkaXRMb2dnZXIpIHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZUF1ZGl0TG9nZ2VyKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYXVkaXRMb2dnZXIhO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5BTExPV0VEX0VOVElUWV9OQU1FUyB9KTtcbiAgICByZXR1cm4gYWxsb3dlZEVudGl0eU5hbWVzID8gYWxsb3dlZEVudGl0eU5hbWVzLnNwbGl0KCcsJykgOiB1bmRlZmluZWQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuRVhDTFVERURfRU5USVRZX05BTUVTIH0pO1xuICAgIHJldHVybiBleGNsdWRlZEVudGl0eU5hbWVzID8gZXhjbHVkZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYW4gZW50aXR5IHNob3VsZCBiZSBhdWRpdGVkIGJhc2VkIG9uIGFsbG93ZWQvZXhjbHVkZWQgbGlzdHMuXG4gICAqIExvZ2ljOlxuICAgKiAtIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgb25seSBhdWRpdCBlbnRpdGllcyBpbiB0aGF0IGxpc3RcbiAgICogLSBJZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkIChhbmQgbm8gYWxsb3dlZEVudGl0eU5hbWVzKSwgYXVkaXQgYWxsIGV4Y2VwdCBleGNsdWRlZFxuICAgKiAtIElmIG5laXRoZXIgaXMgcHJvdmlkZWQsIGF1ZGl0IGFsbCBleGNlcHQgJ2F1ZGl0TG9nJyAoZGVmYXVsdCBiZWhhdmlvcilcbiAgICogLSBhbGxvd2VkRW50aXR5TmFtZXMgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIGV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICovXG4gIHByb3RlY3RlZCBzaG91bGRBdWRpdEVudGl0eShlbnRpdHlOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcblxuICAgIC8vIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgdXNlIGl0IGV4Y2x1c2l2ZWx5XG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBJZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0IGV4Y2x1ZGVkXG4gICAgaWYgKGV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gIWV4Y2x1ZGVkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBiZWhhdmlvcjogYXVkaXQgYWxsIGV4Y2VwdCBzeXN0ZW0gZW50aXRpZXNcbiAgICByZXR1cm4gZW50aXR5TmFtZSAhPT0gJ2F1ZGl0TG9nJztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcmVwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+KTogUHJvbWlzZTxCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4gfCBudWxsPiB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ05vIGVudGl0eSBuYW1lIGZvdW5kIGluIHJlY29yZCcsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNob3VsZEF1ZGl0RW50aXR5KGVudGl0eU5hbWUpKSB7XG4gICAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpO1xuICAgICAgLy8gdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgYXVkaXQgbG9nIGZvciBlbnRpdHkgYmFzZWQgb24gZmlsdGVyaW5nIHJ1bGVzJywgeyBcbiAgICAgIC8vICAgZW50aXR5TmFtZSwgXG4gICAgICAvLyAgIGFsbG93ZWRFbnRpdHlOYW1lcywgXG4gICAgICAvLyAgIGV4Y2x1ZGVkRW50aXR5TmFtZXMgXG4gICAgICAvLyB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZWNvcmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYXVkaXRFbnRyeSA9IHRoaXMubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcblxuICAgIGlmICghYXVkaXRFbnRyeSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gYXVkaXQgZW50cnkgY3JlYXRlZCwgc2tpcHBpbmcnLCB7IHJlY29yZCB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLndyaXRlQXVkaXRFbnRyeShhdWRpdEVudHJ5KTtcblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTdWNjZXNzZnVsbHkgd3JvdGUgYXVkaXQgZW50cnknLCB7IGF1ZGl0RW50cnkgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD5bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEZvciBhdWRpdCBsb2dnaW5nLCBwcm9jZXNzIGVhY2ggcmVjb3JkIGluZGl2aWR1YWxseSB0byBtYWludGFpbiBkZXRhaWxlZCBhdWRpdCB0cmFpbFxuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyID0gdGhpcy5nZXRBdWRpdExvZ2dlcigpO1xuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IHRoaXMubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcbiAgICAgIGlmIChhdWRpdEVudHJ5KSB7XG4gICAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmF1ZGl0KHsgYXVkaXRFbnRyeSB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N1Y2Nlc3NmdWxseSB3cm90ZSBhdWRpdCBlbnRyeSBpbiBiYXRjaCcsIHsgYXVkaXRFbnRyeSB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0RW50cnkocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBBdWRpdEVudHJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgdGltZXN0YW1wLCBlbnRpdHlJZCwgcGF5bG9hZDogeyBuZXdJbWFnZSwgb2xkSW1hZ2UgfSB9ID0gcmVjb3JkO1xuICAgIC8vIEdldCBvbmx5IHRoZSBjaGFuZ2VkIHByb3BlcnRpZXNcbiAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgIC8vIFNraXAgaWYgbm8gY2hhbmdlcyB3ZXJlIGRldGVjdGVkXG4gICAgaWYgKE9iamVjdC5rZXlzKGNoYW5nZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ05vIGNoYW5nZXMgZGV0ZWN0ZWQsIHNraXBwaW5nIGF1ZGl0IGVudHJ5Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gdGhlIF9hY3RvciBmaWVsZFxuICAgIGNvbnN0IHJhd0FjdG9yQ29udGV4dCA9IG5ld0ltYWdlPy5fYWN0b3IgfHwgb2xkSW1hZ2U/Ll9hY3RvcjtcblxuICAgIGNvbnN0IGFjdG9yQ29udGV4dCA9IHJhd0FjdG9yQ29udGV4dDtcblxuICAgIC8vIEZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIGlmIF9hY3RvciBub3QgYXZhaWxhYmxlIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IGFueSA9IHt9O1xuICAgIGlmIChuZXdJbWFnZT8udXBkYXRlZEJ5IHx8IG5ld0ltYWdlPy5jcmVhdGVkQnkgfHwgb2xkSW1hZ2U/LnVwZGF0ZWRCeSB8fCBvbGRJbWFnZT8uY3JlYXRlZEJ5KSB7XG4gICAgICBmYWxsYmFja0FjdG9yLmFjdG9ySWQgPSBuZXdJbWFnZT8udXBkYXRlZEJ5IHx8IG5ld0ltYWdlPy5jcmVhdGVkQnkgfHwgb2xkSW1hZ2U/LnVwZGF0ZWRCeSB8fCBvbGRJbWFnZT8uY3JlYXRlZEJ5O1xuICAgIH1cbiAgICBpZiAobmV3SW1hZ2U/LnRlbmFudElkIHx8IG9sZEltYWdlPy50ZW5hbnRJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci50ZW5hbnRJZCA9IG5ld0ltYWdlPy50ZW5hbnRJZCB8fCBvbGRJbWFnZT8udGVuYW50SWQ7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGF1ZGl0IGVudHJ5XG4gICAgLy8gTm90ZTogdGltZXN0YW1wIGlzIGFscmVhZHkgaW4gbWlsbGlzZWNvbmRzIChjb252ZXJ0ZWQgZnJvbSBEeW5hbW9EQiBzZWNvbmRzIGluIHRoZSBkYXRhIGV4dHJhY3RvcilcbiAgICAvLyBFeGFtcGxlOiB0aW1lc3RhbXAgPSAxNzM0NTY3ODkwMDAwIChtaWxsaXNlY29uZHMpIC0+IFwiMjAyNC0xMi0xOVQxMDozMTozMC4wMDBaXCJcbiAgICBjb25zdCB0aW1lc3RhbXBEYXRlID0gdGltZXN0YW1wID8gbmV3IERhdGUodGltZXN0YW1wKSA6IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgdGltZXN0YW1wSXNvID0gdGltZXN0YW1wRGF0ZS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IHRpbWVzdGFtcE1zID0gdGltZXN0YW1wRGF0ZS5nZXRUaW1lKCk7XG5cbiAgICAvLyBEZXRlcm1pbmUgc3VjY2VzcyBhbmQgc2V2ZXJpdHkgYmFzZWQgb24gZXZlbnQgdHlwZVxuICAgIC8vIERhdGFiYXNlIGNoYW5nZSBldmVudHMgYXJlIHR5cGljYWxseSBzdWNjZXNzZnVsIG9wZXJhdGlvbnNcbiAgICBjb25zdCBzdWNjZXNzID0gdHJ1ZTsgLy8gU3RyZWFtIGV2ZW50cyByZXByZXNlbnQgY29tcGxldGVkIGRhdGFiYXNlIG9wZXJhdGlvbnNcbiAgICBjb25zdCBzZXZlcml0eSA9IGV2ZW50VHlwZSA9PT0gJ2RlbGV0ZScgPyAnd2FybicgOiAnaW5mbyc7IC8vIERlbGV0aW9ucyBtaWdodCBiZSBtb3JlIHNpZ25pZmljYW50XG5cbiAgICBjb25zdCBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5ID0ge1xuICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXBJc28sXG4gICAgICB0aW1lc3RhbXBNcyxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBldmVudFR5cGUsXG4gICAgICBzZXZlcml0eSxcbiAgICAgIHN1Y2Nlc3MsXG4gICAgICBkYXRhOiBjaGFuZ2VzLFxuICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgaWQ6IGVudGl0eUlkIGFzIHN0cmluZ1xuICAgICAgfSxcbiAgICAgIGFjdG9yOiBhY3RvckNvbnRleHQgfHwgKE9iamVjdC5rZXlzKGZhbGxiYWNrQWN0b3IpLmxlbmd0aCA+IDAgPyBmYWxsYmFja0FjdG9yIDogeyBhY3RvclR5cGU6ICd1bmtub3duJyB9KVxuICAgIH07XG5cbiAgICByZXR1cm4gYXVkaXRFbnRyeTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyB3cml0ZUF1ZGl0RW50cnkoYXVkaXRFbnRyeTogQXVkaXRFbnRyeSk6IFByb21pc2U8dm9pZD4ge1xuXG4gICAgY29uc3QgYXVkaXRMb2dnZXIgPSB0aGlzLmdldEF1ZGl0TG9nZ2VyKCk7XG5cbiAgICB0cnkge1xuXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgV3JpdGluZyBhdWRpdCBlbnRyeSB1c2luZyBsb2dnZXIgJHthdWRpdExvZ2dlci5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgYXdhaXQgYXVkaXRMb2dnZXIuYXVkaXQoeyBhdWRpdEVudHJ5IH0pO1xuXG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU3VjY2Vzc2Z1bGx5IHdyb3RlIGF1ZGl0IGVudHJ5JywgeyBhdWRpdEVudHJ5IH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciB3cml0aW5nIGF1ZGl0IGVudHJ5JywgeyBlcnJvciwgYXVkaXRFbnRyeSB9KTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdEeW5hbW9EQlN0cmVhbUhhbmRsZXInKTtcblxuLyoqXG4gKiBNYWluIGVudHJ5IHBvaW50IGZvciBjaGFuZ2UgZGV0ZWN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDaGFuZ2VkUHJvcGVydGllcyhcbiAgb2xkSW1hZ2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAvLyBUT0RPOiBtb3JlIGZpZWxkcyBsaWtlIEdTSTFQSywgR1NJMVNLLCBldGMuXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdID0gWyAndXBkYXRlZEF0JywgJ19fZWRiX2VfXycsICdfX2VkYl92X18nLCAncGsnLCAnc2snLCAnX2FjdG9yJyBdXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IG9sZD86IGFueSwgbmV3PzogYW55IH0+IHtcbiAgcmV0dXJuIGdldENoYW5nZWRQcm9wZXJ0aWVzUmVjdXJzaXZlKG9sZEltYWdlLCBuZXdJbWFnZSwgaWdub3JlZEZpZWxkcyk7XG59XG5cbi8qKlxuICogU2ltcGxlIHZhbHVlIGNvbXBhcmlzb24gaGVscGVyXG4gKiBSZXR1cm5zIHRydWUgaWYgdmFsdWVzIGFyZSBkaWZmZXJlbnQsIGZhbHNlIGlmIHRoZXkgYXJlIHRoZSBzYW1lXG4gKi9cbmZ1bmN0aW9uIGlzRGlmZmVyZW50KG9sZFZhbHVlOiBhbnksIG5ld1ZhbHVlOiBhbnkpOiBib29sZWFuIHtcbiAgaWYgKG9sZFZhbHVlID09PSBuZXdWYWx1ZSkgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIG9sZFZhbHVlICE9PSB0eXBlb2YgbmV3VmFsdWUpIHJldHVybiB0cnVlO1xuICBpZiAob2xkVmFsdWUgPT09IG51bGwgfHwgbmV3VmFsdWUgPT09IG51bGwpIHJldHVybiB0cnVlO1xuICBpZiAodHlwZW9mIG9sZFZhbHVlICE9PSAnb2JqZWN0JykgcmV0dXJuIG9sZFZhbHVlICE9PSBuZXdWYWx1ZTtcbiAgaWYgKEFycmF5LmlzQXJyYXkob2xkVmFsdWUpICE9PSBBcnJheS5pc0FycmF5KG5ld1ZhbHVlKSkgcmV0dXJuIHRydWU7XG5cbiAgLy8gSWYgYm90aCBhcmUgYXJyYXlzLCBjb21wYXJlIHRoZW0gYXMgYXJyYXlzXG4gIGlmIChBcnJheS5pc0FycmF5KG9sZFZhbHVlKSAmJiBBcnJheS5pc0FycmF5KG5ld1ZhbHVlKSkge1xuICAgIGlmIChvbGRWYWx1ZS5sZW5ndGggIT09IG5ld1ZhbHVlLmxlbmd0aCkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9sZFZhbHVlLnNvbWUoKHZhbCwgaW5kZXgpID0+IGlzRGlmZmVyZW50KHZhbCwgbmV3VmFsdWVbIGluZGV4IF0pKTtcbiAgfVxuXG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShvbGRWYWx1ZSkgIT09IEpTT04uc3RyaW5naWZ5KG5ld1ZhbHVlKTtcbn1cblxuXG4vKipcbiAqIFByb2Nlc3NlcyBhIHNpbmdsZSBrZXktdmFsdWUgcGFpciBhbmQgZGV0ZXJtaW5lcyBpZiBpdCBzaG91bGQgYmUgaW5jbHVkZWQgaW4gY2hhbmdlc1xuICovXG5mdW5jdGlvbiBwcm9jZXNzS2V5VmFsdWVQYWlyKFxuICBrZXk6IHN0cmluZyxcbiAgb2xkVmFsdWU6IGFueSxcbiAgbmV3VmFsdWU6IGFueSxcbiAgaWdub3JlZEZpZWxkczogc3RyaW5nW11cbik6IFJlY29yZDxzdHJpbmcsIHsgb2xkPzogYW55LCBuZXc/OiBhbnkgfT4ge1xuICAvLyBTa2lwIGlnbm9yZWQgZmllbGRzXG4gIGlmIChpZ25vcmVkRmllbGRzLmluY2x1ZGVzKGtleSkpIHtcbiAgICByZXR1cm4ge307XG4gIH1cblxuICBjb25zdCBjaGFuZ2VzOiBSZWNvcmQ8c3RyaW5nLCB7IG9sZD86IGFueSwgbmV3PzogYW55IH0+ID0ge307XG5cbiAgLy8gSGFuZGxlIHByb3BlcnR5IGFkZGl0aW9uXG4gIGlmIChvbGRWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgY2hhbmdlc1sga2V5IF0gPSB7IG5ldzogbmV3VmFsdWUgfTtcbiAgICByZXR1cm4gY2hhbmdlcztcbiAgfVxuXG4gIC8vIEhhbmRsZSBwcm9wZXJ0eSBkZWxldGlvblxuICBpZiAobmV3VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIGNoYW5nZXNbIGtleSBdID0geyBvbGQ6IG9sZFZhbHVlIH07XG4gICAgcmV0dXJuIGNoYW5nZXM7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzIGJ5IGNvbXBhcmluZyB0aGVtIGVsZW1lbnQgYnkgZWxlbWVudFxuICBpZiAoQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkgJiYgQXJyYXkuaXNBcnJheShuZXdWYWx1ZSkpIHtcbiAgICBjb25zdCBhcnJheUNoYW5nZXMgPSBjb21wYXJlQXJyYXlzKG9sZFZhbHVlLCBuZXdWYWx1ZSwgaWdub3JlZEZpZWxkcyk7XG4gICAgaWYgKE9iamVjdC5rZXlzKGFycmF5Q2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgY2hhbmdlc1sga2V5IF0gPSBhcnJheUNoYW5nZXM7XG4gICAgfVxuICB9XG4gIC8vIEhhbmRsZSBuZXN0ZWQgb2JqZWN0c1xuICBlbHNlIGlmICh0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBuZXdWYWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICBvbGRWYWx1ZSAhPT0gbnVsbCAmJiBuZXdWYWx1ZSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IG5lc3RlZENoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllc1JlY3Vyc2l2ZShvbGRWYWx1ZSwgbmV3VmFsdWUsIFtdKTtcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQ2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgY2hhbmdlc1sga2V5IF0gPSB7XG4gICAgICAgIG9sZDoge30sXG4gICAgICAgIG5ldzoge31cbiAgICAgIH07XG4gICAgICAvLyBDb3B5IG9ubHkgY2hhbmdlZCBwcm9wZXJ0aWVzXG4gICAgICBPYmplY3Qua2V5cyhuZXN0ZWRDaGFuZ2VzKS5mb3JFYWNoKG5lc3RlZEtleSA9PiB7XG4gICAgICAgIGNvbnN0IGNoYW5nZSA9IG5lc3RlZENoYW5nZXNbIG5lc3RlZEtleSBdO1xuICAgICAgICBpZiAoY2hhbmdlLm9sZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY2hhbmdlc1sga2V5IF0ub2xkWyBuZXN0ZWRLZXkgXSA9IGNoYW5nZS5vbGQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYW5nZS5uZXcgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNoYW5nZXNbIGtleSBdLm5ld1sgbmVzdGVkS2V5IF0gPSBjaGFuZ2UubmV3O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgLy8gSGFuZGxlIHByaW1pdGl2ZSB2YWx1ZXNcbiAgZWxzZSBpZiAoaXNEaWZmZXJlbnQob2xkVmFsdWUsIG5ld1ZhbHVlKSkge1xuICAgIGNoYW5nZXNbIGtleSBdID0ge1xuICAgICAgb2xkOiBvbGRWYWx1ZSxcbiAgICAgIG5ldzogbmV3VmFsdWVcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIGNoYW5nZXM7XG59XG5cbi8qKlxuICogQ29tcGFyZXMgdHdvIGFycmF5cyBhbmQgcmV0dXJucyB0aGUgY2hhbmdlc1xuICovXG5mdW5jdGlvbiBjb21wYXJlQXJyYXlzKFxuICBvbGRBcnJheTogYW55W10sXG4gIG5ld0FycmF5OiBhbnlbXSxcbiAgaWdub3JlZEZpZWxkczogc3RyaW5nW11cbik6IHsgb2xkOiBhbnlbXSwgbmV3OiBhbnlbXSB9IHwgUmVjb3JkPHN0cmluZywgbmV2ZXI+IHtcbiAgY29uc3QgY2hhbmdlczogeyBvbGQ6IGFueVtdLCBuZXc6IGFueVtdIH0gPSB7XG4gICAgb2xkOiBbXSxcbiAgICBuZXc6IFtdXG4gIH07XG5cbiAgbGV0IGhhc0NoYW5nZXMgPSBmYWxzZTtcblxuICAvLyBDb21wYXJlIGVsZW1lbnRzIHRoYXQgZXhpc3QgaW4gYm90aCBhcnJheXNcbiAgY29uc3QgbWluTGVuZ3RoID0gTWF0aC5taW4ob2xkQXJyYXkubGVuZ3RoLCBuZXdBcnJheS5sZW5ndGgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG1pbkxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgb2xkSXRlbSA9IG9sZEFycmF5WyBpIF07XG4gICAgY29uc3QgbmV3SXRlbSA9IG5ld0FycmF5WyBpIF07XG5cbiAgICBpZiAodHlwZW9mIG9sZEl0ZW0gPT09ICdvYmplY3QnICYmIHR5cGVvZiBuZXdJdGVtID09PSAnb2JqZWN0Jykge1xuICAgICAgY29uc3QgaXRlbUNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllc1JlY3Vyc2l2ZShvbGRJdGVtLCBuZXdJdGVtLCBpZ25vcmVkRmllbGRzKTtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhpdGVtQ2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgICBjaGFuZ2VzLm9sZC5wdXNoKG9sZEl0ZW0pO1xuICAgICAgICBjaGFuZ2VzLm5ldy5wdXNoKG5ld0l0ZW0pO1xuICAgICAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGlzRGlmZmVyZW50KG9sZEl0ZW0sIG5ld0l0ZW0pKSB7XG4gICAgICBjaGFuZ2VzLm9sZC5wdXNoKG9sZEl0ZW0pO1xuICAgICAgY2hhbmdlcy5uZXcucHVzaChuZXdJdGVtKTtcbiAgICAgIGhhc0NoYW5nZXMgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIEhhbmRsZSBhZGRlZCBlbGVtZW50c1xuICBpZiAobmV3QXJyYXkubGVuZ3RoID4gb2xkQXJyYXkubGVuZ3RoKSB7XG4gICAgY2hhbmdlcy5uZXcucHVzaCguLi5uZXdBcnJheS5zbGljZShvbGRBcnJheS5sZW5ndGgpKTtcbiAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgfVxuXG4gIC8vIEhhbmRsZSByZW1vdmVkIGVsZW1lbnRzXG4gIGlmIChvbGRBcnJheS5sZW5ndGggPiBuZXdBcnJheS5sZW5ndGgpIHtcbiAgICBjaGFuZ2VzLm9sZC5wdXNoKC4uLm9sZEFycmF5LnNsaWNlKG5ld0FycmF5Lmxlbmd0aCkpO1xuICAgIGhhc0NoYW5nZXMgPSB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGhhc0NoYW5nZXMgPyBjaGFuZ2VzIDoge307XG59XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgY29tcGFyZXMgdHdvIG9iamVjdHMgYW5kIGV4dHJhY3RzIGNoYW5nZWQgcHJvcGVydGllc1xuICovXG5mdW5jdGlvbiBnZXRDaGFuZ2VkUHJvcGVydGllc1JlY3Vyc2l2ZShcbiAgb2xkT2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICBuZXdPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IG9sZD86IGFueSwgbmV3PzogYW55IH0+IHtcbiAgY29uc3QgY2hhbmdlczogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiA9IHt9O1xuXG4gIC8vIEhhbmRsZSBiYXNlIGNhc2VzXG4gIGlmICghb2xkT2JqICYmICFuZXdPYmopIHJldHVybiBjaGFuZ2VzO1xuXG4gIC8vIEhhbmRsZSBjcmVhdGlvbiBjYXNlIChubyBvbGQgb2JqZWN0KVxuICBpZiAoIW9sZE9iaikge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyhuZXdPYmohKVxuICAgICAgICAuZmlsdGVyKChbIGtleSBdKSA9PiAhaWdub3JlZEZpZWxkcy5pbmNsdWRlcyhrZXkpKVxuICAgICAgICAubWFwKChbIGtleSwgdmFsdWUgXSkgPT4gWyBrZXksIHsgbmV3OiB2YWx1ZSB9IF0pXG4gICAgKTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBkZWxldGlvbiBjYXNlIChubyBuZXcgb2JqZWN0KVxuICBpZiAoIW5ld09iaikge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBPYmplY3QuZW50cmllcyhvbGRPYmopXG4gICAgICAgIC5maWx0ZXIoKFsga2V5IF0pID0+ICFpZ25vcmVkRmllbGRzLmluY2x1ZGVzKGtleSkpXG4gICAgICAgIC5tYXAoKFsga2V5LCB2YWx1ZSBdKSA9PiBbIGtleSwgeyBvbGQ6IHZhbHVlIH0gXSlcbiAgICApO1xuICB9XG5cbiAgLy8gUHJvY2VzcyBhbGwga2V5cyBmcm9tIGJvdGggb2JqZWN0c1xuICBjb25zdCBhbGxLZXlzID0gbmV3IFNldChbIC4uLk9iamVjdC5rZXlzKG9sZE9iaiksIC4uLk9iamVjdC5rZXlzKG5ld09iaikgXSk7XG4gIGZvciAoY29uc3Qga2V5IG9mIGFsbEtleXMpIHtcbiAgICBjb25zdCBrZXlDaGFuZ2VzID0gcHJvY2Vzc0tleVZhbHVlUGFpcihrZXksIG9sZE9ialsga2V5IF0sIG5ld09ialsga2V5IF0sIGlnbm9yZWRGaWVsZHMpO1xuICAgIE9iamVjdC5hc3NpZ24oY2hhbmdlcywga2V5Q2hhbmdlcyk7XG4gIH1cblxuICByZXR1cm4gY2hhbmdlcztcbn0iXX0=