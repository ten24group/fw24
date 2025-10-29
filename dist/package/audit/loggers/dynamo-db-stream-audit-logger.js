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
            this.logger.warn('Skipping audit log for entity based on filtering rules', {
                entityName,
                allowedEntityNames,
                excludedEntityNames
            });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUEyTkEsb0RBT0M7QUFoT0QsMEdBQW9HO0FBQ3BHLG9IQUE4RztBQUU5RywyQ0FBNkM7QUFDN0MsdUNBQWlEO0FBQ2pELDhDQUEwRjtBQUMxRix1Q0FBK0M7QUFFL0M7OztHQUdHO0FBQ0gsTUFBYSx5QkFBMEIsU0FBUSxnREFBaUQ7SUFFdEYsV0FBVyxDQUFnQjtJQUVuQztRQUNFLEtBQUssQ0FBQyxJQUFJLDBEQUEwQixFQUFFLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFzQztJQUN2RCxDQUFDO0lBRUQseURBQXlEO0lBQy9DLHFCQUFxQjtRQUU3QixNQUFNLGVBQWUsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSw0QkFBZSxDQUFDLFVBQVUsQ0FBQztRQUV2RyxJQUFJLENBQUMsV0FBVyxHQUFHLDRCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUN6RCxJQUFJLEVBQUUsZUFBa0M7WUFDeEMsT0FBTyxFQUFFLElBQUk7U0FDZCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFDOUUsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBCQUEwQixFQUFFLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztJQUNyRSxDQUFDO0lBRVMsY0FBYztRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFdB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Q0FBQztBQUNqQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQVVESVRfRU5WX0tFWVMsIEF1ZGl0RW50cnksIEF1ZGl0TG9nZ2VyVHlwZSwgSUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckZhY3RvcnkgfSBmcm9tICcuL2ZhY3RvcnknO1xuXG4vKipcbiAqIERlZmF1bHQgYXVkaXQgaGFuZGxlciB0aGF0IGV4dGVuZHMgQmFzZVNRU0V2ZW50UHJvY2Vzc29yXG4gKiBDdXN0b20gYXVkaXQgaGFuZGxlcnMgY2FuIGV4dGVuZCB0aGlzIHRvIGFkZCBjdXN0b20gcHJvY2Vzc2luZyB3aGlsZSByZXVzaW5nIGZyYW1ld29yayB1dGlsaXRpZXNcbiAqL1xuZXhwb3J0IGNsYXNzIER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8RHluYW1vREJFdmVudERhdGFFeHRyYWN0b3I+IHtcblxuICBwcml2YXRlIGF1ZGl0TG9nZ2VyPzogSUF1ZGl0TG9nZ2VyO1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKG5ldyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvcigpKTtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBEeW5hbW9EQlN0cmVhbUV2ZW50IHwgU1FTRXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgfVxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgbWV0aG9kIHRvIGluaXRpYWxpemUgY3VzdG9tIGF1ZGl0LWxvZ2dlclxuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZUF1ZGl0TG9nZ2VyKCkge1xuXG4gICAgY29uc3QgYXVkaXRMb2dnZXJUeXBlID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5UWVBFIH0pIHx8IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENIO1xuXG4gICAgdGhpcy5hdWRpdExvZ2dlciA9IEF1ZGl0TG9nZ2VyRmFjdG9yeS5nZXRJbnN0YW5jZSgpLmNyZWF0ZSh7XG4gICAgICB0eXBlOiBhdWRpdExvZ2dlclR5cGUgYXMgQXVkaXRMb2dnZXJUeXBlLFxuICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgIH0pO1xuXG4gICAgaWYgKCF0aGlzLmF1ZGl0TG9nZ2VyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEF1ZGl0IGxvZ2dlciBub3QgaW5pdGlhbGl6ZWQgZm9yIHR5cGUgJHthdWRpdExvZ2dlclR5cGV9YCk7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0F1ZGl0IGxvZ2dlciBpbml0aWFsaXplZCcsIHsgYXVkaXRMb2dnZXJUeXBlIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEF1ZGl0TG9nZ2VyKCk6IElBdWRpdExvZ2dlciB7XG4gICAgaWYgKCF0aGlzLmF1ZGl0TG9nZ2VyKSB7XG4gICAgICB0aGlzLmluaXRpYWxpemVBdWRpdExvZ2dlcigpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmF1ZGl0TG9nZ2VyITtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRBbGxvd2VkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuQUxMT1dFRF9FTlRJVFlfTkFNRVMgfSk7XG4gICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcyA/IGFsbG93ZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkVYQ0xVREVEX0VOVElUWV9OQU1FUyB9KTtcbiAgICByZXR1cm4gZXhjbHVkZWRFbnRpdHlOYW1lcyA/IGV4Y2x1ZGVkRW50aXR5TmFtZXMuc3BsaXQoJywnKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIGVudGl0eSBzaG91bGQgYmUgYXVkaXRlZCBiYXNlZCBvbiBhbGxvd2VkL2V4Y2x1ZGVkIGxpc3RzLlxuICAgKiBMb2dpYzpcbiAgICogLSBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIG9ubHkgYXVkaXQgZW50aXRpZXMgaW4gdGhhdCBsaXN0XG4gICAqIC0gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCAoYW5kIG5vIGFsbG93ZWRFbnRpdHlOYW1lcyksIGF1ZGl0IGFsbCBleGNlcHQgZXhjbHVkZWRcbiAgICogLSBJZiBuZWl0aGVyIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0ICdhdWRpdExvZycgKGRlZmF1bHQgYmVoYXZpb3IpXG4gICAqIC0gYWxsb3dlZEVudGl0eU5hbWVzIHRha2VzIHByZWNlZGVuY2Ugb3ZlciBleGNsdWRlZEVudGl0eU5hbWVzXG4gICAqL1xuICBwcm90ZWN0ZWQgc2hvdWxkQXVkaXRFbnRpdHkoZW50aXR5TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG5cbiAgICAvLyBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIHVzZSBpdCBleGNsdXNpdmVseVxuICAgIGlmIChhbGxvd2VkRW50aXR5TmFtZXMgJiYgYWxsb3dlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgYXVkaXQgYWxsIGV4Y2VwdCBleGNsdWRlZFxuICAgIGlmIChleGNsdWRlZEVudGl0eU5hbWVzICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuICFleGNsdWRlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgYmVoYXZpb3I6IGF1ZGl0IGFsbCBleGNlcHQgc3lzdGVtIGVudGl0aWVzXG4gICAgcmV0dXJuIGVudGl0eU5hbWUgIT09ICdhdWRpdExvZyc7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+IHwgbnVsbD4ge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSA9IHJlY29yZDtcblxuICAgIGlmICghWyAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnIF0uaW5jbHVkZXMoZXZlbnRUeXBlKSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgcmVjb3JkIHdpdGggZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFlbnRpdHlOYW1lKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdObyBlbnRpdHkgbmFtZSBmb3VuZCBpbiByZWNvcmQnLCB7IHJlY29yZCB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5zaG91bGRBdWRpdEVudGl0eShlbnRpdHlOYW1lKSkge1xuICAgICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGF1ZGl0IGxvZyBmb3IgZW50aXR5IGJhc2VkIG9uIGZpbHRlcmluZyBydWxlcycsIHsgXG4gICAgICAgIGVudGl0eU5hbWUsIFxuICAgICAgICBhbGxvd2VkRW50aXR5TmFtZXMsIFxuICAgICAgICBleGNsdWRlZEVudGl0eU5hbWVzIFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB0aGlzLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICBpZiAoIWF1ZGl0RW50cnkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIGF1ZGl0IGVudHJ5IGNyZWF0ZWQsIHNraXBwaW5nJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy53cml0ZUF1ZGl0RW50cnkoYXVkaXRFbnRyeSk7XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU3VjY2Vzc2Z1bGx5IHdyb3RlIGF1ZGl0IGVudHJ5JywgeyBhdWRpdEVudHJ5IH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBGb3IgYXVkaXQgbG9nZ2luZywgcHJvY2VzcyBlYWNoIHJlY29yZCBpbmRpdmlkdWFsbHkgdG8gbWFpbnRhaW4gZGV0YWlsZWQgYXVkaXQgdHJhaWxcbiAgICBjb25zdCBhdWRpdExvZ2dlciA9IHRoaXMuZ2V0QXVkaXRMb2dnZXIoKTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gdGhpcy5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuICAgICAgaWYgKGF1ZGl0RW50cnkpIHtcbiAgICAgICAgYXdhaXQgYXVkaXRMb2dnZXIuYXVkaXQoeyBhdWRpdEVudHJ5IH0pO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU3VjY2Vzc2Z1bGx5IHdyb3RlIGF1ZGl0IGVudHJ5IGluIGJhdGNoJywgeyBhdWRpdEVudHJ5IH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRFbnRyeShyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IEF1ZGl0RW50cnkgfCB1bmRlZmluZWQge1xuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgdGltZXN0YW1wLCBlbnRpdHlJZCwgcGF5bG9hZDogeyBuZXdJbWFnZSwgb2xkSW1hZ2UgfSB9ID0gcmVjb3JkO1xuICAgICAgICAvLyBHZXQgb25seSB0aGUgY2hhbmdlZCBwcm9wZXJ0aWVzXG4gICAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICAgIC8vIFNraXAgaWYgbm8gY2hhbmdlcyB3ZXJlIGRldGVjdGVkXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhjaGFuZ2VzKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdObyBjaGFuZ2VzIGRldGVjdGVkLCBza2lwcGluZyBhdWRpdCBlbnRyeScpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gdGhlIF9hY3RvciBmaWVsZFxuICAgICAgICBjb25zdCByYXdBY3RvckNvbnRleHQgPSBuZXdJbWFnZT8uX2FjdG9yIHx8IG9sZEltYWdlPy5fYWN0b3I7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBhY3RvckNvbnRleHQgPSByYXdBY3RvckNvbnRleHQ7XG4gICAgICAgIFxuICAgICAgICAvLyBGYWxsYmFjayB0byB2aXNpYmxlIGFjdG9yIGZpZWxkcyBpZiBfYWN0b3Igbm90IGF2YWlsYWJsZSAoYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICAgICAgY29uc3QgZmFsbGJhY2tBY3RvcjogYW55ID0ge307XG4gICAgICAgIGlmIChuZXdJbWFnZT8udXBkYXRlZEJ5IHx8IG5ld0ltYWdlPy5jcmVhdGVkQnkgfHwgb2xkSW1hZ2U/LnVwZGF0ZWRCeSB8fCBvbGRJbWFnZT8uY3JlYXRlZEJ5KSB7XG4gICAgICAgICAgICBmYWxsYmFja0FjdG9yLmFjdG9ySWQgPSBuZXdJbWFnZT8udXBkYXRlZEJ5IHx8IG5ld0ltYWdlPy5jcmVhdGVkQnkgfHwgb2xkSW1hZ2U/LnVwZGF0ZWRCeSB8fCBvbGRJbWFnZT8uY3JlYXRlZEJ5O1xuICAgICAgICB9XG4gICAgICAgIGlmIChuZXdJbWFnZT8udGVuYW50SWQgfHwgb2xkSW1hZ2U/LnRlbmFudElkKSB7XG4gICAgICAgICAgICBmYWxsYmFja0FjdG9yLnRlbmFudElkID0gbmV3SW1hZ2U/LnRlbmFudElkIHx8IG9sZEltYWdlPy50ZW5hbnRJZDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBhdWRpdCBlbnRyeVxuICAgICAgICAvLyBOb3RlOiB0aW1lc3RhbXAgaXMgYWxyZWFkeSBpbiBtaWxsaXNlY29uZHMgKGNvbnZlcnRlZCBmcm9tIER5bmFtb0RCIHNlY29uZHMgaW4gdGhlIGRhdGEgZXh0cmFjdG9yKVxuICAgICAgICAvLyBFeGFtcGxlOiB0aW1lc3RhbXAgPSAxNzM0NTY3ODkwMDAwIChtaWxsaXNlY29uZHMpIC0+IFwiMjAyNC0xMi0xOVQxMDozMTozMC4wMDBaXCJcbiAgICAgICAgY29uc3QgdGltZXN0YW1wRGF0ZSA9IHRpbWVzdGFtcCA/IG5ldyBEYXRlKHRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBJc28gPSB0aW1lc3RhbXBEYXRlLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcE1zID0gdGltZXN0YW1wRGF0ZS5nZXRUaW1lKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBEZXRlcm1pbmUgc3VjY2VzcyBhbmQgc2V2ZXJpdHkgYmFzZWQgb24gZXZlbnQgdHlwZVxuICAgICAgICAvLyBEYXRhYmFzZSBjaGFuZ2UgZXZlbnRzIGFyZSB0eXBpY2FsbHkgc3VjY2Vzc2Z1bCBvcGVyYXRpb25zXG4gICAgICAgIGNvbnN0IHN1Y2Nlc3MgPSB0cnVlOyAvLyBTdHJlYW0gZXZlbnRzIHJlcHJlc2VudCBjb21wbGV0ZWQgZGF0YWJhc2Ugb3BlcmF0aW9uc1xuICAgICAgICBjb25zdCBzZXZlcml0eSA9IGV2ZW50VHlwZSA9PT0gJ2RlbGV0ZScgPyAnd2FybicgOiAnaW5mbyc7IC8vIERlbGV0aW9ucyBtaWdodCBiZSBtb3JlIHNpZ25pZmljYW50XG4gICAgICAgIFxuICAgICAgICBjb25zdCBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5ID0ge1xuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgdGltZXN0YW1wOiB0aW1lc3RhbXBJc28sXG4gICAgICAgICAgICB0aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBldmVudFR5cGUsXG4gICAgICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgICAgIHN1Y2Nlc3MsXG4gICAgICAgICAgICBkYXRhOiBjaGFuZ2VzLFxuICAgICAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgICAgICBpZDogZW50aXR5SWQgYXMgc3RyaW5nXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYWN0b3I6IGFjdG9yQ29udGV4dCB8fCAoT2JqZWN0LmtleXMoZmFsbGJhY2tBY3RvcikubGVuZ3RoID4gMCA/IGZhbGxiYWNrQWN0b3IgOiB7IGFjdG9yVHlwZTogJ3Vua25vd24nIH0pXG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIGF1ZGl0RW50cnk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgd3JpdGVBdWRpdEVudHJ5KGF1ZGl0RW50cnk6IEF1ZGl0RW50cnkpOiBQcm9taXNlPHZvaWQ+IHtcblxuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyID0gdGhpcy5nZXRBdWRpdExvZ2dlcigpO1xuXG4gICAgdHJ5IHtcblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFdyaXRpbmcgYXVkaXQgZW50cnkgdXNpbmcgbG9nZ2VyICR7YXVkaXRMb2dnZXIuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmF1ZGl0KHsgYXVkaXRFbnRyeSB9KTtcblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1N1Y2Nlc3NmdWxseSB3cm90ZSBhdWRpdCBlbnRyeScsIHsgYXVkaXRFbnRyeSB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3Igd3JpdGluZyBhdWRpdCBlbnRyeScsIHsgZXJyb3IsIGF1ZGl0RW50cnkgfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJTdHJlYW1IYW5kbGVyJyk7XG5cbi8qKlxuICogTWFpbiBlbnRyeSBwb2ludCBmb3IgY2hhbmdlIGRldGVjdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q2hhbmdlZFByb3BlcnRpZXMoXG4gIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICBuZXdJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgLy8gVE9ETzogbW9yZSBmaWVsZHMgbGlrZSBHU0kxUEssIEdTSTFTSywgZXRjLlxuICBpZ25vcmVkRmllbGRzOiBzdHJpbmdbXSA9IFsgJ3VwZGF0ZWRBdCcsICdfX2VkYl9lX18nLCAnX19lZGJfdl9fJywgJ3BrJywgJ3NrJywgJ19hY3RvcicgXVxuKTogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiB7XG4gIHJldHVybiBnZXRDaGFuZ2VkUHJvcGVydGllc1JlY3Vyc2l2ZShvbGRJbWFnZSwgbmV3SW1hZ2UsIGlnbm9yZWRGaWVsZHMpO1xufVxuXG4vKipcbiAqIFNpbXBsZSB2YWx1ZSBjb21wYXJpc29uIGhlbHBlclxuICogUmV0dXJucyB0cnVlIGlmIHZhbHVlcyBhcmUgZGlmZmVyZW50LCBmYWxzZSBpZiB0aGV5IGFyZSB0aGUgc2FtZVxuICovXG5mdW5jdGlvbiBpc0RpZmZlcmVudChvbGRWYWx1ZTogYW55LCBuZXdWYWx1ZTogYW55KTogYm9vbGVhbiB7XG4gIGlmIChvbGRWYWx1ZSA9PT0gbmV3VmFsdWUpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBvbGRWYWx1ZSAhPT0gdHlwZW9mIG5ld1ZhbHVlKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKG9sZFZhbHVlID09PSBudWxsIHx8IG5ld1ZhbHVlID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHR5cGVvZiBvbGRWYWx1ZSAhPT0gJ29iamVjdCcpIHJldHVybiBvbGRWYWx1ZSAhPT0gbmV3VmFsdWU7XG4gIGlmIChBcnJheS5pc0FycmF5KG9sZFZhbHVlKSAhPT0gQXJyYXkuaXNBcnJheShuZXdWYWx1ZSkpIHJldHVybiB0cnVlO1xuXG4gIC8vIElmIGJvdGggYXJlIGFycmF5cywgY29tcGFyZSB0aGVtIGFzIGFycmF5c1xuICBpZiAoQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkgJiYgQXJyYXkuaXNBcnJheShuZXdWYWx1ZSkpIHtcbiAgICBpZiAob2xkVmFsdWUubGVuZ3RoICE9PSBuZXdWYWx1ZS5sZW5ndGgpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvbGRWYWx1ZS5zb21lKCh2YWwsIGluZGV4KSA9PiBpc0RpZmZlcmVudCh2YWwsIG5ld1ZhbHVlWyBpbmRleCBdKSk7XG4gIH1cblxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkob2xkVmFsdWUpICE9PSBKU09OLnN0cmluZ2lmeShuZXdWYWx1ZSk7XG59XG5cblxuLyoqXG4gKiBQcm9jZXNzZXMgYSBzaW5nbGUga2V5LXZhbHVlIHBhaXIgYW5kIGRldGVybWluZXMgaWYgaXQgc2hvdWxkIGJlIGluY2x1ZGVkIGluIGNoYW5nZXNcbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc0tleVZhbHVlUGFpcihcbiAga2V5OiBzdHJpbmcsXG4gIG9sZFZhbHVlOiBhbnksXG4gIG5ld1ZhbHVlOiBhbnksXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IG9sZD86IGFueSwgbmV3PzogYW55IH0+IHtcbiAgLy8gU2tpcCBpZ25vcmVkIGZpZWxkc1xuICBpZiAoaWdub3JlZEZpZWxkcy5pbmNsdWRlcyhrZXkpKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgY2hhbmdlczogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiA9IHt9O1xuXG4gIC8vIEhhbmRsZSBwcm9wZXJ0eSBhZGRpdGlvblxuICBpZiAob2xkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIGNoYW5nZXNbIGtleSBdID0geyBuZXc6IG5ld1ZhbHVlIH07XG4gICAgcmV0dXJuIGNoYW5nZXM7XG4gIH1cblxuICAvLyBIYW5kbGUgcHJvcGVydHkgZGVsZXRpb25cbiAgaWYgKG5ld1ZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICBjaGFuZ2VzWyBrZXkgXSA9IHsgb2xkOiBvbGRWYWx1ZSB9O1xuICAgIHJldHVybiBjaGFuZ2VzO1xuICB9XG5cbiAgLy8gSGFuZGxlIGFycmF5cyBieSBjb21wYXJpbmcgdGhlbSBlbGVtZW50IGJ5IGVsZW1lbnRcbiAgaWYgKEFycmF5LmlzQXJyYXkob2xkVmFsdWUpICYmIEFycmF5LmlzQXJyYXkobmV3VmFsdWUpKSB7XG4gICAgY29uc3QgYXJyYXlDaGFuZ2VzID0gY29tcGFyZUFycmF5cyhvbGRWYWx1ZSwgbmV3VmFsdWUsIGlnbm9yZWRGaWVsZHMpO1xuICAgIGlmIChPYmplY3Qua2V5cyhhcnJheUNoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNoYW5nZXNbIGtleSBdID0gYXJyYXlDaGFuZ2VzO1xuICAgIH1cbiAgfVxuICAvLyBIYW5kbGUgbmVzdGVkIG9iamVjdHNcbiAgZWxzZSBpZiAodHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbmV3VmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgb2xkVmFsdWUgIT09IG51bGwgJiYgbmV3VmFsdWUgIT09IG51bGwpIHtcbiAgICBjb25zdCBuZXN0ZWRDaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUob2xkVmFsdWUsIG5ld1ZhbHVlLCBbXSk7XG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZENoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNoYW5nZXNbIGtleSBdID0ge1xuICAgICAgICBvbGQ6IHt9LFxuICAgICAgICBuZXc6IHt9XG4gICAgICB9O1xuICAgICAgLy8gQ29weSBvbmx5IGNoYW5nZWQgcHJvcGVydGllc1xuICAgICAgT2JqZWN0LmtleXMobmVzdGVkQ2hhbmdlcykuZm9yRWFjaChuZXN0ZWRLZXkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2UgPSBuZXN0ZWRDaGFuZ2VzWyBuZXN0ZWRLZXkgXTtcbiAgICAgICAgaWYgKGNoYW5nZS5vbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNoYW5nZXNbIGtleSBdLm9sZFsgbmVzdGVkS2V5IF0gPSBjaGFuZ2Uub2xkO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaGFuZ2UubmV3ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjaGFuZ2VzWyBrZXkgXS5uZXdbIG5lc3RlZEtleSBdID0gY2hhbmdlLm5ldztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIC8vIEhhbmRsZSBwcmltaXRpdmUgdmFsdWVzXG4gIGVsc2UgaWYgKGlzRGlmZmVyZW50KG9sZFZhbHVlLCBuZXdWYWx1ZSkpIHtcbiAgICBjaGFuZ2VzWyBrZXkgXSA9IHtcbiAgICAgIG9sZDogb2xkVmFsdWUsXG4gICAgICBuZXc6IG5ld1ZhbHVlXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBjaGFuZ2VzO1xufVxuXG4vKipcbiAqIENvbXBhcmVzIHR3byBhcnJheXMgYW5kIHJldHVybnMgdGhlIGNoYW5nZXNcbiAqL1xuZnVuY3Rpb24gY29tcGFyZUFycmF5cyhcbiAgb2xkQXJyYXk6IGFueVtdLFxuICBuZXdBcnJheTogYW55W10sXG4gIGlnbm9yZWRGaWVsZHM6IHN0cmluZ1tdXG4pOiB7IG9sZDogYW55W10sIG5ldzogYW55W10gfSB8IFJlY29yZDxzdHJpbmcsIG5ldmVyPiB7XG4gIGNvbnN0IGNoYW5nZXM6IHsgb2xkOiBhbnlbXSwgbmV3OiBhbnlbXSB9ID0ge1xuICAgIG9sZDogW10sXG4gICAgbmV3OiBbXVxuICB9O1xuXG4gIGxldCBoYXNDaGFuZ2VzID0gZmFsc2U7XG5cbiAgLy8gQ29tcGFyZSBlbGVtZW50cyB0aGF0IGV4aXN0IGluIGJvdGggYXJyYXlzXG4gIGNvbnN0IG1pbkxlbmd0aCA9IE1hdGgubWluKG9sZEFycmF5Lmxlbmd0aCwgbmV3QXJyYXkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtaW5MZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IG9sZEl0ZW0gPSBvbGRBcnJheVsgaSBdO1xuICAgIGNvbnN0IG5ld0l0ZW0gPSBuZXdBcnJheVsgaSBdO1xuXG4gICAgaWYgKHR5cGVvZiBvbGRJdGVtID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbmV3SXRlbSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IGl0ZW1DaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUob2xkSXRlbSwgbmV3SXRlbSwgaWdub3JlZEZpZWxkcyk7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoaXRlbUNoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2hhbmdlcy5vbGQucHVzaChvbGRJdGVtKTtcbiAgICAgICAgY2hhbmdlcy5uZXcucHVzaChuZXdJdGVtKTtcbiAgICAgICAgaGFzQ2hhbmdlcyA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChpc0RpZmZlcmVudChvbGRJdGVtLCBuZXdJdGVtKSkge1xuICAgICAgY2hhbmdlcy5vbGQucHVzaChvbGRJdGVtKTtcbiAgICAgIGNoYW5nZXMubmV3LnB1c2gobmV3SXRlbSk7XG4gICAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvLyBIYW5kbGUgYWRkZWQgZWxlbWVudHNcbiAgaWYgKG5ld0FycmF5Lmxlbmd0aCA+IG9sZEFycmF5Lmxlbmd0aCkge1xuICAgIGNoYW5nZXMubmV3LnB1c2goLi4ubmV3QXJyYXkuc2xpY2Uob2xkQXJyYXkubGVuZ3RoKSk7XG4gICAgaGFzQ2hhbmdlcyA9IHRydWU7XG4gIH1cblxuICAvLyBIYW5kbGUgcmVtb3ZlZCBlbGVtZW50c1xuICBpZiAob2xkQXJyYXkubGVuZ3RoID4gbmV3QXJyYXkubGVuZ3RoKSB7XG4gICAgY2hhbmdlcy5vbGQucHVzaCguLi5vbGRBcnJheS5zbGljZShuZXdBcnJheS5sZW5ndGgpKTtcbiAgICBoYXNDaGFuZ2VzID0gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBoYXNDaGFuZ2VzID8gY2hhbmdlcyA6IHt9O1xufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGNvbXBhcmVzIHR3byBvYmplY3RzIGFuZCBleHRyYWN0cyBjaGFuZ2VkIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gZ2V0Q2hhbmdlZFByb3BlcnRpZXNSZWN1cnNpdmUoXG4gIG9sZE9iajogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgbmV3T2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICBpZ25vcmVkRmllbGRzOiBzdHJpbmdbXVxuKTogUmVjb3JkPHN0cmluZywgeyBvbGQ/OiBhbnksIG5ldz86IGFueSB9PiB7XG4gIGNvbnN0IGNoYW5nZXM6IFJlY29yZDxzdHJpbmcsIHsgb2xkPzogYW55LCBuZXc/OiBhbnkgfT4gPSB7fTtcblxuICAvLyBIYW5kbGUgYmFzZSBjYXNlc1xuICBpZiAoIW9sZE9iaiAmJiAhbmV3T2JqKSByZXR1cm4gY2hhbmdlcztcblxuICAvLyBIYW5kbGUgY3JlYXRpb24gY2FzZSAobm8gb2xkIG9iamVjdClcbiAgaWYgKCFvbGRPYmopIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMobmV3T2JqISlcbiAgICAgICAgLmZpbHRlcigoWyBrZXkgXSkgPT4gIWlnbm9yZWRGaWVsZHMuaW5jbHVkZXMoa2V5KSlcbiAgICAgICAgLm1hcCgoWyBrZXksIHZhbHVlIF0pID0+IFsga2V5LCB7IG5ldzogdmFsdWUgfSBdKVxuICAgICk7XG4gIH1cblxuICAvLyBIYW5kbGUgZGVsZXRpb24gY2FzZSAobm8gbmV3IG9iamVjdClcbiAgaWYgKCFuZXdPYmopIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMob2xkT2JqKVxuICAgICAgICAuZmlsdGVyKChbIGtleSBdKSA9PiAhaWdub3JlZEZpZWxkcy5pbmNsdWRlcyhrZXkpKVxuICAgICAgICAubWFwKChbIGtleSwgdmFsdWUgXSkgPT4gWyBrZXksIHsgb2xkOiB2YWx1ZSB9IF0pXG4gICAgKTtcbiAgfVxuXG4gIC8vIFByb2Nlc3MgYWxsIGtleXMgZnJvbSBib3RoIG9iamVjdHNcbiAgY29uc3QgYWxsS2V5cyA9IG5ldyBTZXQoWyAuLi5PYmplY3Qua2V5cyhvbGRPYmopLCAuLi5PYmplY3Qua2V5cyhuZXdPYmopIF0pO1xuICBmb3IgKGNvbnN0IGtleSBvZiBhbGxLZXlzKSB7XG4gICAgY29uc3Qga2V5Q2hhbmdlcyA9IHByb2Nlc3NLZXlWYWx1ZVBhaXIoa2V5LCBvbGRPYmpbIGtleSBdLCBuZXdPYmpbIGtleSBdLCBpZ25vcmVkRmllbGRzKTtcbiAgICBPYmplY3QuYXNzaWduKGNoYW5nZXMsIGtleUNoYW5nZXMpO1xuICB9XG5cbiAgcmV0dXJuIGNoYW5nZXM7XG59Il19