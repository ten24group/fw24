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
    getIgnoredEntityNames() {
        const ignoredEntityNames = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.IGNORED_ENTITY_NAMES });
        return ignoredEntityNames ? ignoredEntityNames.split(',') : undefined;
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
        // Check ignored entities first (takes precedence)
        const ignoredEntityNames = this.getIgnoredEntityNames();
        if (ignoredEntityNames && ignoredEntityNames.includes(entityName)) {
            this.logger.warn('Skipping audit log for ignored entity', { entityName, ignoredEntityNames });
            return null;
        }
        // Check allowed entities list
        const allowedEntityNames = this.getAllowedEntityNames();
        if (allowedEntityNames) {
            if (allowedEntityNames.length === 0 || !allowedEntityNames.includes(entityName)) {
                this.logger.warn('Skipping audit log for entity not in allowed list', { entityName, allowedEntityNames });
                return null;
            }
        }
        else if (entityName === 'auditLog') {
            // Default: skip auditLog entities when no allowed list is specified
            this.logger.warn('Skipping audit log', { record });
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
            // Core fields - what we know from the stream
            auditType: 'audit',
            timestamp: timestampIso,
            timestampMs,
            // Entity tracking - what changed
            entityName,
            entityId: entityId,
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
                id: entityId
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUF1TkEsb0RBT0M7QUE1TkQsMEdBQW9HO0FBQ3BHLG9IQUE4RztBQUU5RywyQ0FBNkM7QUFDN0MsdUNBQWlEO0FBQ2pELDhDQUEwRjtBQUMxRix1Q0FBK0M7QUFFL0M7OztHQUdHO0FBQ0gsTUFBYSx5QkFBMEIsU0FBUSxnREFBaUQ7SUFFdEYsV0FBVyxDQUFnQjtJQUVuQztRQUNFLEtBQUssQ0FBQyxJQUFJLDBEQUEwQixFQUFFLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFzQztJQUN2RCxDQUFDO0lBRUQseURBQXlEO0lBQy9DLHFCQUFxQjtRQUU3QixNQUFNLGVBQWUsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSw0QkFBZSxDQUFDLFVBQVUsQ0FBQztRQUV2RyxJQUFJLENBQUMsV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUN6RCxJQUFJLEVBQUUsZUFBa0M7WUFDeEMsT0FBTyxFQUFFLElBQUk7U0FDZCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFDOUUsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBCQUEwQixFQUFFLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztJQUNyRSxDQUFDO0lBRVMsY0FBYztRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFdB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QUMsQ0FBQztRQUN6RixNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRUQsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtRXZlbnQsIFNRU0V2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbmltcG9ydCB7IEJhc2VTUVNFdmVudFByb2Nlc3NvciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yJztcbmltcG9ydCB7IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9keW5hbW9kYi1ldmVudC1kYXRhLWV4dHJhY3Rvcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIENoYW5nZVN0cmVhbVBheWxvYWQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IEFVRElUX0VOVl9LRVlTLCBBdWRpdEVudHJ5LCBBdWRpdExvZ2dlclR5cGUsIElBdWRpdExvZ2dlciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gZnJvbSAnLi9mYWN0b3J5JztcblxuLyoqXG4gKiBEZWZhdWx0IGF1ZGl0IGhhbmRsZXIgdGhhdCBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvclxuICogQ3VzdG9tIGF1ZGl0IGhhbmRsZXJzIGNhbiBleHRlbmQgdGhpcyB0byBhZGQgY3VzdG9tIHByb2Nlc3Npbmcgd2hpbGUgcmV1c2luZyBmcmFtZXdvcmsgdXRpbGl0aWVzXG4gKi9cbmV4cG9ydCBjbGFzcyBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIGV4dGVuZHMgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yPiB7XG5cbiAgcHJpdmF0ZSBhdWRpdExvZ2dlcj86IElBdWRpdExvZ2dlcjtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKSk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gIH1cblxuICAvLyBvdmVycmlkZSB0aGlzIG1ldGhvZCB0byBpbml0aWFsaXplIGN1c3RvbSBhdWRpdC1sb2dnZXJcbiAgcHJvdGVjdGVkIGluaXRpYWxpemVBdWRpdExvZ2dlcigpIHtcblxuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyVHlwZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuVFlQRSB9KSB8fCBBdWRpdExvZ2dlclR5cGUuQ0xPVURXQVRDSDtcblxuICAgIHRoaXMuYXVkaXRMb2dnZXIgPSBBdWRpdExvZ2dlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKS5jcmVhdGUoe1xuICAgICAgdHlwZTogYXVkaXRMb2dnZXJUeXBlIGFzIEF1ZGl0TG9nZ2VyVHlwZSxcbiAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICB9KTtcblxuICAgIGlmICghdGhpcy5hdWRpdExvZ2dlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdWRpdCBsb2dnZXIgbm90IGluaXRpYWxpemVkIGZvciB0eXBlICR7YXVkaXRMb2dnZXJUeXBlfWApO1xuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdBdWRpdCBsb2dnZXIgaW5pdGlhbGl6ZWQnLCB7IGF1ZGl0TG9nZ2VyVHlwZSB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRBdWRpdExvZ2dlcigpOiBJQXVkaXRMb2dnZXIge1xuICAgIGlmICghdGhpcy5hdWRpdExvZ2dlcikge1xuICAgICAgdGhpcy5pbml0aWFsaXplQXVkaXRMb2dnZXIoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hdWRpdExvZ2dlciE7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkFMTE9XRURfRU5USVRZX05BTUVTIH0pO1xuICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMgPyBhbGxvd2VkRW50aXR5TmFtZXMuc3BsaXQoJywnKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRJZ25vcmVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGlnbm9yZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuSUdOT1JFRF9FTlRJVFlfTkFNRVMgfSk7XG4gICAgcmV0dXJuIGlnbm9yZWRFbnRpdHlOYW1lcyA/IGlnbm9yZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPiB8IG51bGw+IHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIH0gPSByZWNvcmQ7XG5cbiAgICBpZiAoIVsgJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJyBdLmluY2x1ZGVzKGV2ZW50VHlwZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghZW50aXR5TmFtZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignTm8gZW50aXR5IG5hbWUgZm91bmQgaW4gcmVjb3JkJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZ25vcmVkIGVudGl0aWVzIGZpcnN0ICh0YWtlcyBwcmVjZWRlbmNlKVxuICAgIGNvbnN0IGlnbm9yZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0SWdub3JlZEVudGl0eU5hbWVzKCk7XG4gICAgaWYgKGlnbm9yZWRFbnRpdHlOYW1lcyAmJiBpZ25vcmVkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGF1ZGl0IGxvZyBmb3IgaWdub3JlZCBlbnRpdHknLCB7IGVudGl0eU5hbWUsIGlnbm9yZWRFbnRpdHlOYW1lcyB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGFsbG93ZWQgZW50aXRpZXMgbGlzdFxuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk7XG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcykge1xuICAgICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcy5sZW5ndGggPT09IDAgfHwgIWFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBhdWRpdCBsb2cgZm9yIGVudGl0eSBub3QgaW4gYWxsb3dlZCBsaXN0JywgeyBlbnRpdHlOYW1lLCBhbGxvd2VkRW50aXR5TmFtZXMgfSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50aXR5TmFtZSA9PT0gJ2F1ZGl0TG9nJykge1xuICAgICAgLy8gRGVmYXVsdDogc2tpcCBhdWRpdExvZyBlbnRpdGllcyB3aGVuIG5vIGFsbG93ZWQgbGlzdCBpcyBzcGVjaWZpZWRcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGF1ZGl0IGxvZycsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG5cbiAgICBjb25zdCBhdWRpdEVudHJ5ID0gdGhpcy5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgaWYgKCFhdWRpdEVudHJ5KSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyBhdWRpdCBlbnRyeSBjcmVhdGVkLCBza2lwcGluZycsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMud3JpdGVBdWRpdEVudHJ5KGF1ZGl0RW50cnkpO1xuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N1Y2Nlc3NmdWxseSB3cm90ZSBhdWRpdCBlbnRyeScsIHsgYXVkaXRFbnRyeSB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRm9yIGF1ZGl0IGxvZ2dpbmcsIHByb2Nlc3MgZWFjaCByZWNvcmQgaW5kaXZpZHVhbGx5IHRvIG1haW50YWluIGRldGFpbGVkIGF1ZGl0IHRyYWlsXG4gICAgY29uc3QgYXVkaXRMb2dnZXIgPSB0aGlzLmdldEF1ZGl0TG9nZ2VyKCk7XG4gICAgXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IHRoaXMubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcbiAgICAgIGlmIChhdWRpdEVudHJ5KSB7XG4gICAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmF1ZGl0KHsgYXVkaXRFbnRyeSB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N1Y2Nlc3NmdWxseSB3cm90ZSBhdWRpdCBlbnRyeSBpbiBiYXRjaCcsIHsgYXVkaXRFbnRyeSB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0RW50cnkocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBBdWRpdEVudHJ5IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIHRpbWVzdGFtcCwgZW50aXR5SWQsIHBheWxvYWQ6IHsgbmV3SW1hZ2UsIG9sZEltYWdlIH0gfSA9IHJlY29yZDtcbiAgICAgICAgLy8gR2V0IG9ubHkgdGhlIGNoYW5nZWQgcHJvcGVydGllc1xuICAgICAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgICAgICAvLyBTa2lwIGlmIG5vIGNoYW5nZXMgd2VyZSBkZXRlY3RlZFxuICAgICAgICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTm8gY2hhbmdlcyBkZXRlY3RlZCwgc2tpcHBpbmcgYXVkaXQgZW50cnknKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIHRoZSBfYWN0b3IgZmllbGRcbiAgICAgICAgY29uc3QgcmF3QWN0b3JDb250ZXh0ID0gbmV3SW1hZ2U/Ll9hY3RvciB8fCBvbGRJbWFnZT8uX2FjdG9yO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgYWN0b3JDb250ZXh0ID0gcmF3QWN0b3JDb250ZXh0O1xuICAgICAgICBcbiAgICAgICAgLy8gRmFsbGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHMgaWYgX2FjdG9yIG5vdCBhdmFpbGFibGUgKGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXG4gICAgICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IGFueSA9IHt9O1xuICAgICAgICBpZiAobmV3SW1hZ2U/LnVwZGF0ZWRCeSB8fCBuZXdJbWFnZT8uY3JlYXRlZEJ5IHx8IG9sZEltYWdlPy51cGRhdGVkQnkgfHwgb2xkSW1hZ2U/LmNyZWF0ZWRCeSkge1xuICAgICAgICAgICAgZmFsbGJhY2tBY3Rvci5hY3RvcklkID0gbmV3SW1hZ2U/LnVwZGF0ZWRCeSB8fCBuZXdJbWFnZT8uY3JlYXRlZEJ5IHx8IG9sZEltYWdlPy51cGRhdGVkQnkgfHwgb2xkSW1hZ2U/LmNyZWF0ZWRCeTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobmV3SW1hZ2U/LnRlbmFudElkIHx8IG9sZEltYWdlPy50ZW5hbnRJZCkge1xuICAgICAgICAgICAgZmFsbGJhY2tBY3Rvci50ZW5hbnRJZCA9IG5ld0ltYWdlPy50ZW5hbnRJZCB8fCBvbGRJbWFnZT8udGVuYW50SWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgYXVkaXQgZW50cnlcbiAgICAgICAgLy8gTm90ZTogdGltZXN0YW1wIGlzIGFscmVhZHkgaW4gbWlsbGlzZWNvbmRzIChjb252ZXJ0ZWQgZnJvbSBEeW5hbW9EQiBzZWNvbmRzIGluIHRoZSBkYXRhIGV4dHJhY3RvcilcbiAgICAgICAgLy8gRXhhbXBsZTogdGltZXN0YW1wID0gMTczNDU2Nzg5MDAwMCAobWlsbGlzZWNvbmRzKSAtPiBcIjIwMjQtMTItMTlUMTA6MzE6MzAuMDAwWlwiXG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcERhdGUgPSB0aW1lc3RhbXAgPyBuZXcgRGF0ZSh0aW1lc3RhbXApIDogbmV3IERhdGUoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wSXNvID0gdGltZXN0YW1wRGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBNcyA9IHRpbWVzdGFtcERhdGUuZ2V0VGltZSgpO1xuICAgICAgICBcbiAgICAgICAgLy8gRGV0ZXJtaW5lIHN1Y2Nlc3MgYW5kIHNldmVyaXR5IGJhc2VkIG9uIGV2ZW50IHR5cGVcbiAgICAgICAgLy8gRGF0YWJhc2UgY2hhbmdlIGV2ZW50cyBhcmUgdHlwaWNhbGx5IHN1Y2Nlc3NmdWwgb3BlcmF0aW9uc1xuICAgICAgICBjb25zdCBzdWNjZXNzID0gdHJ1ZTsgLy8gU3RyZWFtIGV2ZW50cyByZXByZXNlbnQgY29tcGxldGVkIGRhdGFiYXNlIG9wZXJhdGlvbnNcbiAgICAgICAgY29uc3Qgc2V2ZXJpdHkgPSBldmVudFR5cGUgPT09ICdkZWxldGUnID8gJ3dhcm4nIDogJ2luZm8nOyAvLyBEZWxldGlvbnMgbWlnaHQgYmUgbW9yZSBzaWduaWZpY2FudFxuICAgICAgICBcbiAgICAgICAgY29uc3QgYXVkaXRFbnRyeTogQXVkaXRFbnRyeSA9IHtcbiAgICAgICAgICAgIC8vIENvcmUgZmllbGRzIC0gd2hhdCB3ZSBrbm93IGZyb20gdGhlIHN0cmVhbVxuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXBJc28sXG4gICAgICAgICAgICB0aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRW50aXR5IHRyYWNraW5nIC0gd2hhdCBjaGFuZ2VkXG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgZW50aXR5SWQ6IGVudGl0eUlkIGFzIHN0cmluZyxcbiAgICAgICAgICAgIGV2ZW50VHlwZSxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogZXZlbnRUeXBlLCAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5IC0gc2FtZSBhcyBldmVudFR5cGUgZm9yIHN0cmVhbSBldmVudHNcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gT3V0Y29tZSAtIHN0cmVhbSBldmVudHMgcmVwcmVzZW50IGNvbXBsZXRlZCBEQiBvcGVyYXRpb25zXG4gICAgICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgICAgIHN1Y2Nlc3MsXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEFjdG9yIC0gd2hvIG1hZGUgdGhlIGNoYW5nZVxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yQ29udGV4dCB8fCAoT2JqZWN0LmtleXMoZmFsbGJhY2tBY3RvcikubGVuZ3RoID4gMCA/IGZhbGxiYWNrQWN0b3IgOiB7IGFjdG9yVHlwZTogJ3Vua25vd24nIH0pLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBEYXRhIC0gd2hhdCBhY3R1YWxseSBjaGFuZ2VkXG4gICAgICAgICAgICBkYXRhOiBjaGFuZ2VzLFxuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBMZWdhY3kgc3VwcG9ydFxuICAgICAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgICAgICBpZDogZW50aXR5SWQgYXMgc3RyaW5nXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIGF1ZGl0RW50cnk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgd3JpdGVBdWRpdEVudHJ5KGF1ZGl0RW50cnk6IEF1ZGl0RW50cnkpOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyID0gdGhpcy5nZXRBdWRpdExvZ2dlcigpO1xuXG4gICAgdHJ5IHtcblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFdyaXRpbmcgYXVkaXQgZW50cnkgdXNpbmcgbG9nZ2VyICR7YXVkaXRMb2dnZXIuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmF1ZGl0KHsgYXVkaXRFbnRyeSB9KTtcblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N1Y2Nlc3NmdWxseSB3cm90ZSBhdWRpdCBlbnRyeScsIHsgYXVkaXRFbnRyeSB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3Igd3JpdGluZyBhdWRpdCBlbnRyeScsIHsgZXJyb3IsIGF1ZGl0RW50cnkgfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJTdHJlYW1IYW5kbGVyJyk7XG5cbi8qKlxuICogTWFpbiBlbnRyeSBwb2ludCBmb3IgY2hhbmdlIGRldGVjdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q2hhbmdlZFByb3BlcnRpZXMoXG4gIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICBuZXdJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgLy8gVE9ETzogbW9yZSBmaWVsZHMgbGlrZSBHU0kxUEssIEdTSTFTSywgZXRjLlxuICBpZ25vcmVkRmllbGRzOiBzdHJpbmdbXSA9IFsgJ3VwZGF0ZWRBdCcsICdfX2VkYl9lX18nLCAnX19lZGJfdl9fJywgJ3BrJywgJ3NrJywgJ19hY3RvcicgXVxuKTogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiB7XG4gIHJldHVybiBnZXRDaGFuZ2VkUHJvcGVydGllc1JlY3Vyc2l2ZShvbGRJbWFnZSwgbmV3SW1hZ2UsIGlnbm9yZWRGaWVsZHMpO1xufVxuXG4vKipcbiAqIFNpbXBsZSB2YWx1ZSBjb21wYXJpc29uIGhlbHBlclxuICogUmV0dXJucyB0cnVlIGlmIHZhbHVlcyBhcmUgZGlmZmVyZW50LCBmYWxzZSBpZiB0aGV5IGFyZSB0aGUgc2FtZVxuICovXG5mdW5jdGlvbiBpc0RpZmZlcmVudChvbGRWYWx1ZTogYW55LCBuZXdWYWx1ZTogYW55KTogYm9vbGVhbiB7XG4gIGlmIChvbGRWYWx1ZSA9PT0gbmV3VmFsdWUpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBvbGRWYWx1ZSAhPT0gdHlwZW9mIG5ld1ZhbHVlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKG9sZFZhbHVlID09PSBudWxsIHx8IG5ld1ZhbHVlID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHR5cGVvZiBvbGRWYWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBvbGRWYWx1ZSAhPT0gbmV3VmFsdWU7XG4gIGlmIChBcnJheS5pc0FycmF5KG9sZFZhbHVlKSAhPT0gQXJyYXkuaXNBcnJheShuZXdWYWx1ZSkpIHJldHVybiB0cnVlO1xuXG4gIC8vIElmIGJvdGggYXJlIGFycmF5cywgY29tcGFyZSB0aGVtIGFzIGFycmF5c1xuICBpZiAoQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkgJiYgQXJyYXkuaXNBcnJheShuZXdWYWx1ZSkpIHtcbiAgICBpZiAob2xkVmFsdWUubGVuZ3RoICE9PSBuZXdWYWx1ZS5sZW5ndGgpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvbGRWYWx1ZS5zb21lKCh2YWwsIGluZGV4KSA9PiBpc0RpZmZlcmVudCh2YWwsIG5ld1ZhbHVlWyBpbmRleCBdKSk7XG4gIH1cblxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkob2xkVmFsdWUpICE9PSBKU09OLnN0cmluZ2lmeShuZXdWYWx1ZSk7XG59XG5cblxuLyoqXG4gKiBQcm9jZXNzZXMgYSBzaW5nbGUga2V5LXZhbHVlIHBhaXIgYW5kIGRldGVybWluZXMgaWYgaXQgc2hvdWxkIGJlIGluY2x1ZGVkIGluIGNoYW5nZXNcbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc0tleVZhbHVlUGFpcihcbiAga2V5OiBzdHJpbmcsXG4gIG9sZFZhbHVlOiBhbnksXG4gIG5ld1ZhbHVlOiBhbnksXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IG9sZD86IGFueSwgbmV3PzogYW55IH0+IHtcbiAgLy8gU2tpcCBpZ25vcmVkIGZpZWxkc1xuICBpZiAoaWdub3JlZEZpZWxkcy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY2hhbmdlczogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiA9IHt9O1xuXG4gIC8vIEhhbmRsZSBwcm9wZXJ0eSBhZGRpdGlvblxuICBpZiAob2xkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIGNoYW5nZXNbIGtleSBdID0geyBuZXc6IG5ld1ZhbHVlIH07XG4gICAgcmV0dXJuIGNoYW5nZXM7XG4gIH1cblxuICAvLyBIYW5kbGUgcHJvcGVydHkgZGVsZXRpb25cbiAgaWYgKG5ld1ZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICBjaGFuZ2VzWyBrZXkgXSA9IHsgb2xkOiBvbGRWYWx1ZSB9O1xuICAgIHJldHVybiBjaGFuZ2VzO1xuICB9XG5cbiAgLy8gSGFuZGxlIGFycmF5cyBieSBjb21wYXJpbmcgdGhlbSBlbGVtZW50IGJ5IGVsZW1lbnRcbiAgaWYgKEFycmF5LmlzQXJyYXkob2xkVmFsdWUpICYmIEFycmF5LmlzQXJyYXkobmV3VmFsdWUpKSB7XG4gICAgY29uc3QgYXJyYXlDaGFuZ2VzID0gY29tcGFyZUFycmF5cyhvbGRWYWx1ZSwgbmV3VmFsdWUsIGlnbm9yZWRGaWVsZHMpO1xuICAgIGlmIChPYmplY3Qua2V5cyhhcnJheUNoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNoYW5nZXNbIGtleSBdID0gYXJyYXlDaGFuZ2VzO1xuICAgIH1cbiAgfVxuICAvLyBIYW5kbGUgbmVzdGVkIG9iamVjdHNcbiAgZWxzZSBpZiAodHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbmV3VmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgb2xkVmFsdWUgIT09IG51bGwgJiYgbmV3VmFsdWUgIT09IG51bGwpIHtcbiAgICBjb25zdCBuZXN0ZWRDaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUob2xkVmFsdWUsIG5ld1ZhbHVlLCBbXSk7XG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZENoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNoYW5nZXNbIGtleSBdID0ge1xuICAgICAgICBvbGQ6IHt9LFxuICAgICAgICBuZXc6IHt9XG4gICAgICB9O1xuICAgICAgLy8gQ29weSBvbmx5IGNoYW5nZWQgcHJvcGVydGllc1xuICAgICAgT2JqZWN0LmtleXMobmVzdGVkQ2hhbmdlcykuZm9yRWFjaChuZXN0ZWRLZXkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2UgPSBuZXN0ZWRDaGFuZ2VzWyBuZXN0ZWRLZXkgXTtcbiAgICAgICAgaWYgKGNoYW5nZS5vbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNoYW5nZXNbIGtleSBdLm9sZFsgbmVzdGVkS2V5IF0gPSBjaGFuZ2Uub2xkO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaGFuZ2UubmV3ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjaGFuZ2VzWyBrZXkgXS5uZXdbIG5lc3RlZEtleSBdID0gY2hhbmdlLm5ldztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIEhhbmRsZSBwcmltaXRpdmUgdmFsdWVzXG4gIGVsc2UgaWYgKGlzRGlmZmVyZW50KG9sZFZhbHVlLCBuZXdWYWx1ZSkpIHtcbiAgICBjaGFuZ2VzWyBrZXkgXSA9IHtcbiAgICAgIG9sZDogb2xkVmFsdWUsXG4gICAgICBuZXc6IG5ld1ZhbHVlXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBjaGFuZ2VzO1xufVxuXG4vKipcbiAqIENvbXBhcmVzIHR3byBhcnJheXMgYW5kIHJldHVybnMgdGhlIGNoYW5nZXNcbiAqL1xuZnVuY3Rpb24gY29tcGFyZUFycmF5cyhcbiAgb2xkQXJyYXk6IGFueVtdLFxuICBuZXdBcnJheTogYW55W10sXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdXG4pOiB7IG9sZDogYW55W10sIG5ldzogYW55W10gfSB8IFJlY29yZDxzdHJpbmcsIG5ldmVyPiB7XG4gIGNvbnN0IGNoYW5nZXM6IHsgb2xkOiBhbnlbXSwgbmV3OiBhbnlbXSB9ID0ge1xuICAgIG9sZDogW10sXG4gICAgbmV3OiBbXVxuICB9O1xuXG4gIGxldCBoYXNDaGFuZ2VzID0gZmFsc2U7XG5cbiAgLy8gQ29tcGFyZSBlbGVtZW50cyB0aGF0IGV4aXN0IGluIGJvdGggYXJyYXlzXG4gIGNvbnN0IG1pbkxlbmd0aCA9IE1hdGgubWluKG9sZEFycmF5Lmxlbmd0aCwgbmV3QXJyYXkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtaW5MZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IG9sZEl0ZW0gPSBvbGRBcnJheVsgaSBdO1xuICAgIGNvbnN0IG5ld0l0ZW0gPSBuZXdBcnJheVsgaSBdO1xuXG4gICAgaWYgKHR5cGVvZiBvbGRJdGVtID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbmV3SXRlbSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IGl0ZW1DaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUob2xkSXRlbSwgbmV3SXRlbSwgaWdub3JlZEZpZWxkcyk7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoaXRlbUNoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2hhbmdlcy5vbGQucHVzaChvbGRJdGVtKTtcbiAgICAgICAgY2hhbmdlcy5uZXcucHVzaChuZXdJdGVtKTtcbiAgICAgICAgaGFzQ2hhbmdlcyA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChpc0RpZmZlcmVudChvbGRJdGVtLCBuZXdJdGVtKSkge1xuICAgICAgY2hhbmdlcy5vbGQucHVzaChvbGRJdGVtKTtcbiAgICAgIGNoYW5nZXMubmV3LnB1c2gobmV3SXRlbSk7XG4gICAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvLyBIYW5kbGUgYWRkZWQgZWxlbWVudHNcbiAgaWYgKG5ld0FycmF5Lmxlbmd0aCA+IG9sZEFycmF5Lmxlbmd0aCkge1xuICAgIGNoYW5nZXMubmV3LnB1c2goLi4ubmV3QXJyYXkuc2xpY2Uob2xkQXJyYXkubGVuZ3RoKSk7XG4gICAgaGFzQ2hhbmdlcyA9IHRydWU7XG4gIH1cblxuICAvLyBIYW5kbGUgcmVtb3ZlZCBlbGVtZW50c1xuICBpZiAob2xkQXJyYXkubGVuZ3RoID4gbmV3QXJyYXkubGVuZ3RoKSB7XG4gICAgY2hhbmdlcy5vbGQucHVzaCguLi5vbGRBcnJheS5zbGljZShuZXdBcnJheS5sZW5ndGgpKTtcbiAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBoYXNDaGFuZ2VzID8gY2hhbmdlcyA6IHt9O1xufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGNvbXBhcmVzIHR3byBvYmplY3RzIGFuZCBleHRyYWN0cyBjaGFuZ2VkIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUoXG4gIG9sZE9iajogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgbmV3T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICBpZ25vcmVkRmllbGRzOiBzdHJpbmdbXVxuKTogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiB7XG4gIGNvbnN0IGNoYW5nZXM6IFJlY29yZDxzdHJpbmcsIHsgb2xkPzogYW55LCBuZXc/OiBhbnkgfT4gPSB7fTtcblxuICAvLyBIYW5kbGUgYmFzZSBjYXNlc1xuICBpZiAoIW9sZE9iaiAmJiAhbmV3T2JqKSByZXR1cm4gY2hhbmdlcztcblxuICAvLyBIYW5kbGUgY3JlYXRpb24gY2FzZSAobm8gb2xkIG9iamVjdClcbiAgaWYgKCFvbGRPYmopIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMobmV3T2JqISlcbiAgICAgICAgLmZpbHRlcigoWyBrZXkgXSkgPT4gIWlnbm9yZWRGaWVsZHMuaW5jbHVkZXMoa2V5KSlcbiAgICAgICAgLm1hcCgoWyBrZXksIHZhbHVlIF0pID0+IFsga2V5LCB7IG5ldzogdmFsdWUgfSBdKVxuICAgICk7XG4gIH1cblxuICAvLyBIYW5kbGUgZGVsZXRpb24gY2FzZSAobm8gbmV3IG9iamVjdClcbiAgaWYgKCFuZXdPYmopIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMob2xkT2JqKVxuICAgICAgICAuZmlsdGVyKChbIGtleSBdKSA9PiAhaWdub3JlZEZpZWxkcy5pbmNsdWRlcyhrZXkpKVxuICAgICAgICAubWFwKChbIGtleSwgdmFsdWUgXSkgPT4gWyBrZXksIHsgb2xkOiB2YWx1ZSB9IF0pXG4gICAgKTtcbiAgfVxuXG4gIC8vIFByb2Nlc3MgYWxsIGtleXMgZnJvbSBib3RoIG9iamVjdHNcbiAgY29uc3QgYWxsS2V5cyA9IG5ldyBTZXQoWyAuLi5PYmplY3Qua2V5cyhvbGRPYmopLCAuLi5PYmplY3Qua2V5cyhuZXdPYmopIF0pO1xuICBmb3IgKGNvbnN0IGtleSBvZiBhbGxLZXlzKSB7XG4gICAgY29uc3Qga2V5Q2hhbmdlcyA9IHByb2Nlc3NLZXlWYWx1ZVBhaXIoa2V5LCBvbGRPYmpbIGtleSBdLCBuZXdPYmpbIGtleSBdLCBpZ25vcmVkRmllbGRzKTtcbiAgICBPYmplY3QuYXNzaWduKGNoYW5nZXMsIGtleUNoYW5nZXMpO1xuICB9XG5cbiAgcmV0dXJuIGNoYW5nZXM7XG59Il19