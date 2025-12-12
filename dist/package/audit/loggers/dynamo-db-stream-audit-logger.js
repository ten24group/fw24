"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.DynamoDBStreamAuditLogger = void 0;
const base_sqs_event_processor_1 = require("../../core/runtime/event-processor/base-sqs-event-processor");
const dynamodb_event_data_extractor_1 = require("../../core/runtime/event-processor/dynamodb-event-data-extractor");
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
const interfaces_1 = require("../interfaces");
const observability_1 = require("../../observability");
const change_detection_1 = require("../helpers/change-detection");
/**
 * DynamoDB Stream Audit Logger
 *
 * Processes DynamoDB stream events and captures audit events via the observability system.
 *
 * Responsibilities:
 * - Listen to DynamoDB stream events (via SQS)
 * - Filter by entity names (allowedEntityNames/excludedEntityNames)
 * - Detect changes between old and new images
 * - Extract actor context
 * - Call AuditObserver to capture events (fire-and-forget, auto-flushed)
 *
 * Custom audit handlers can extend this to add custom processing while reusing framework utilities.
 */
class DynamoDBStreamAuditLogger extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    constructor() {
        super(new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor());
    }
    async initialize(_event) {
        // No initialization needed - AuditObserver is ready to use
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
     * - If neither is provided, audit all except 'auditLog' and 'observabilityLog' (default behavior)
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
        return entityName !== 'auditLog' && entityName !== 'observabilityLog';
    }
    async preprocessRecord(record) {
        const { entityName, eventType } = record;
        if (!['create', 'update', 'delete'].includes(eventType)) {
            this.logger.debug('Skipping record with unsupported event type', { eventType });
            return null;
        }
        if (!entityName) {
            this.logger.warn('No entity name found in record', { record });
            return null;
        }
        if (!this.shouldAuditEntity(entityName)) {
            this.logger.debug('Skipping audit for filtered entity', { entityName });
            return null;
        }
        return record;
    }
    async processRecord(record) {
        await this.captureAuditEvent(record);
    }
    async processRecordsBatch(records) {
        for (const record of records) {
            await this.captureAuditEvent(record);
        }
    }
    /**
     * Capture audit event using the observability system.
     * Passes maximum data: before image, after image, and computed diff.
     */
    async captureAuditEvent(record) {
        const { entityName, eventType, timestamp, entityId, payload: { newImage, oldImage } } = record;
        // Compute changes (diff between old and new)
        const changes = (0, change_detection_1.getChangedProperties)(oldImage, newImage);
        // For updates, skip if no actual changes detected
        if (eventType === 'update' && Object.keys(changes).length === 0) {
            this.logger.debug('No changes detected, skipping audit entry', { entityName, entityId });
            return;
        }
        // Extract actor context
        const actor = this.extractActor(newImage, oldImage);
        // Get correlationId from _actor if available, otherwise generate one
        const correlationId = this.extractCorrelationId(record, newImage, oldImage);
        // entityName is guaranteed by preprocessRecord check
        const entity = entityName;
        const id = String(entityId);
        // Call appropriate AuditObserver method based on event type
        switch (eventType) {
            case 'create':
                observability_1.AuditObserver.entityCreate(entity, id, newImage, { actor, correlationId });
                this.logger.debug('Captured create audit', { entityName: entity, entityId: id });
                break;
            case 'update':
                observability_1.AuditObserver.entityUpdate(entity, id, {
                    before: oldImage,
                    after: newImage,
                    diff: changes
                }, { actor, correlationId });
                this.logger.debug('Captured update audit', { entityName: entity, entityId: id, changedFields: Object.keys(changes) });
                break;
            case 'delete':
                observability_1.AuditObserver.entityDelete(entity, id, oldImage, { actor, correlationId });
                this.logger.debug('Captured delete audit', { entityName: entity, entityId: id });
                break;
        }
    }
    /**
     * Extract actor context from entity images.
     * Tries _actor field first, then falls back to visible actor fields.
     */
    extractActor(newImage, oldImage) {
        // Try _actor field first (set by crud-service)
        const actorContext = newImage?._actor || oldImage?._actor;
        if (actorContext) {
            return actorContext;
        }
        // Fallback to visible actor fields (backward compatibility)
        const fallbackActor = {};
        const actorId = newImage?.updatedBy || newImage?.createdBy || oldImage?.updatedBy || oldImage?.createdBy;
        if (actorId) {
            fallbackActor.actorId = actorId;
        }
        const tenantId = newImage?.tenantId || oldImage?.tenantId;
        if (tenantId) {
            fallbackActor.tenantId = tenantId;
        }
        // Return fallback if we have any info, otherwise undefined (let observability use context)
        return Object.keys(fallbackActor).length > 0
            ? { ...fallbackActor, actorType: 'user' }
            : undefined;
    }
    /**
     * Extract or generate correlationId for the audit event.
     * Priority:
     * 1. From _actor.correlationId (set by originating request)
     * 2. From DynamoDB eventID (unique per stream record)
     * 3. Generated fallback
     */
    extractCorrelationId(record, newImage, oldImage) {
        // Try to get from _actor (preserves trace from originating request)
        const actorCorrelationId = newImage?._actor?.correlationId || oldImage?._actor?.correlationId;
        if (actorCorrelationId) {
            return actorCorrelationId;
        }
        // Use DynamoDB eventId if available (unique per stream record)
        if (record.eventId) {
            return `stream-${record.eventId}`;
        }
        // Fallback: generate based on entity info
        return `stream-${record.entityName}-${record.entityId}-${Date.now()}`;
    }
}
exports.DynamoDBStreamAuditLogger = DynamoDBStreamAuditLogger;
exports.logger = (0, logging_1.createLogger)('DynamoDBStreamHandler');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSwwR0FBb0c7QUFDcEcsb0hBQThHO0FBRTlHLDJDQUE2QztBQUM3Qyx1Q0FBaUQ7QUFDakQsOENBQStDO0FBQy9DLHVEQUFvRDtBQUVwRCxrRUFBbUU7QUFFbkU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQWEseUJBQTBCLFNBQVEsZ0RBQWlEO0lBRTlGO1FBQ0UsS0FBSyxDQUFDLElBQUksMERBQTBCLEVBQUUsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQXNDO1FBQ3JELDJEQUEyRDtJQUM3RCxDQUFDO0lBRVMscUJBQXFCO1FBQzdCLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLG9CQUFvQixFQUFFLENBQUMsQ0FBQztRQUM1RixPQUFPLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUN4RSxDQUFDO0lBRVMsc0JBQXNCO1FBQzlCLE1BQU0sbUJBQW1CLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQztRQUM5RixPQUFPLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUMxRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNPLGlCQUFpQixDQUFDLFVBQWtCO1FBQzVDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxD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QWEsSUFBSSxRQUFRLEVBQUUsTUFBTSxFQUFFLGFBQWEsQ0FBQztRQUM5RixJQUFJLGtCQUFrQixFQUFFLENBQUM7WUFDdkIsT0FBTyxrQkFBa0IsQ0FBQztRQUM1QixDQUFDO1FBRUQsK0RBQStEO1FBQy9ELElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ25CLE9BQU8sVUFBVSxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDcEMsQ0FBQztRQUVELDBDQUEwQztRQUMxQyxPQUFPLFVBQVUsTUFBTSxDQUFDLFVBQVUsSUFBSSxNQUFNLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO0lBQ3hFLENBQUM7Q0FDRjtBQXRMRCw4REFzTEM7QUFFWSxRQUFBLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsdUJBQXVCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtRXZlbnQsIFNRU0V2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbmltcG9ydCB7IEJhc2VTUVNFdmVudFByb2Nlc3NvciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yJztcbmltcG9ydCB7IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9keW5hbW9kYi1ldmVudC1kYXRhLWV4dHJhY3Rvcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIENoYW5nZVN0cmVhbVBheWxvYWQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IEFVRElUX0VOVl9LRVlTIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdE9ic2VydmVyIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgZ2V0Q2hhbmdlZFByb3BlcnRpZXMgfSBmcm9tICcuLi9oZWxwZXJzL2NoYW5nZS1kZXRlY3Rpb24nO1xuXG4vKipcbiAqIER5bmFtb0RCIFN0cmVhbSBBdWRpdCBMb2dnZXJcbiAqIFxuICogUHJvY2Vzc2VzIER5bmFtb0RCIHN0cmVhbSBldmVudHMgYW5kIGNhcHR1cmVzIGF1ZGl0IGV2ZW50cyB2aWEgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLlxuICogXG4gKiBSZXNwb25zaWJpbGl0aWVzOlxuICogLSBMaXN0ZW4gdG8gRHluYW1vREIgc3RyZWFtIGV2ZW50cyAodmlhIFNRUylcbiAqIC0gRmlsdGVyIGJ5IGVudGl0eSBuYW1lcyAoYWxsb3dlZEVudGl0eU5hbWVzL2V4Y2x1ZGVkRW50aXR5TmFtZXMpXG4gKiAtIERldGVjdCBjaGFuZ2VzIGJldHdlZW4gb2xkIGFuZCBuZXcgaW1hZ2VzXG4gKiAtIEV4dHJhY3QgYWN0b3IgY29udGV4dFxuICogLSBDYWxsIEF1ZGl0T2JzZXJ2ZXIgdG8gY2FwdHVyZSBldmVudHMgKGZpcmUtYW5kLWZvcmdldCwgYXV0by1mbHVzaGVkKVxuICogXG4gKiBDdXN0b20gYXVkaXQgaGFuZGxlcnMgY2FuIGV4dGVuZCB0aGlzIHRvIGFkZCBjdXN0b20gcHJvY2Vzc2luZyB3aGlsZSByZXVzaW5nIGZyYW1ld29yayB1dGlsaXRpZXMuXG4gKi9cbmV4cG9ydCBjbGFzcyBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIGV4dGVuZHMgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yPiB7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIobmV3IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yKCkpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vIGluaXRpYWxpemF0aW9uIG5lZWRlZCAtIEF1ZGl0T2JzZXJ2ZXIgaXMgcmVhZHkgdG8gdXNlXG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkFMTE9XRURfRU5USVRZX05BTUVTIH0pO1xuICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMgPyBhbGxvd2VkRW50aXR5TmFtZXMuc3BsaXQoJywnKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5FWENMVURFRF9FTlRJVFlfTkFNRVMgfSk7XG4gICAgcmV0dXJuIGV4Y2x1ZGVkRW50aXR5TmFtZXMgPyBleGNsdWRlZEVudGl0eU5hbWVzLnNwbGl0KCcsJykgOiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBpZiBhbiBlbnRpdHkgc2hvdWxkIGJlIGF1ZGl0ZWQgYmFzZWQgb24gYWxsb3dlZC9leGNsdWRlZCBsaXN0cy5cbiAgICogTG9naWM6XG4gICAqIC0gSWYgYWxsb3dlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBvbmx5IGF1ZGl0IGVudGl0aWVzIGluIHRoYXQgbGlzdFxuICAgKiAtIElmIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQgKGFuZCBubyBhbGxvd2VkRW50aXR5TmFtZXMpLCBhdWRpdCBhbGwgZXhjZXB0IGV4Y2x1ZGVkXG4gICAqIC0gSWYgbmVpdGhlciBpcyBwcm92aWRlZCwgYXVkaXQgYWxsIGV4Y2VwdCAnYXVkaXRMb2cnIGFuZCAnb2JzZXJ2YWJpbGl0eUxvZycgKGRlZmF1bHQgYmVoYXZpb3IpXG4gICAqIC0gYWxsb3dlZEVudGl0eU5hbWVzIHRha2VzIHByZWNlZGVuY2Ugb3ZlciBleGNsdWRlZEVudGl0eU5hbWVzXG4gICAqL1xuICBwcm90ZWN0ZWQgc2hvdWxkQXVkaXRFbnRpdHkoZW50aXR5TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG5cbiAgICAvLyBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIHVzZSBpdCBleGNsdXNpdmVseVxuICAgIGlmIChhbGxvd2VkRW50aXR5TmFtZXMgJiYgYWxsb3dlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgYXVkaXQgYWxsIGV4Y2VwdCBleGNsdWRlZFxuICAgIGlmIChleGNsdWRlZEVudGl0eU5hbWVzICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuICFleGNsdWRlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgYmVoYXZpb3I6IGF1ZGl0IGFsbCBleGNlcHQgc3lzdGVtIGVudGl0aWVzXG4gICAgcmV0dXJuIGVudGl0eU5hbWUgIT09ICdhdWRpdExvZycgJiYgZW50aXR5TmFtZSAhPT0gJ29ic2VydmFiaWxpdHlMb2cnO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPiB8IG51bGw+IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2tpcHBpbmcgcmVjb3JkIHdpdGggdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFlbnRpdHlOYW1lKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdObyBlbnRpdHkgbmFtZSBmb3VuZCBpbiByZWNvcmQnLCB7IHJlY29yZCB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5zaG91bGRBdWRpdEVudGl0eShlbnRpdHlOYW1lKSkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NraXBwaW5nIGF1ZGl0IGZvciBmaWx0ZXJlZCBlbnRpdHknLCB7IGVudGl0eU5hbWUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmNhcHR1cmVBdWRpdEV2ZW50KHJlY29yZCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD5bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhdWRpdCBldmVudCB1c2luZyB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gICAqIFBhc3NlcyBtYXhpbXVtIGRhdGE6IGJlZm9yZSBpbWFnZSwgYWZ0ZXIgaW1hZ2UsIGFuZCBjb21wdXRlZCBkaWZmLlxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVBdWRpdEV2ZW50KHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIHRpbWVzdGFtcCwgZW50aXR5SWQsIHBheWxvYWQ6IHsgbmV3SW1hZ2UsIG9sZEltYWdlIH0gfSA9IHJlY29yZDtcblxuICAgIC8vIENvbXB1dGUgY2hhbmdlcyAoZGlmZiBiZXR3ZWVuIG9sZCBhbmQgbmV3KVxuICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgLy8gRm9yIHVwZGF0ZXMsIHNraXAgaWYgbm8gYWN0dWFsIGNoYW5nZXMgZGV0ZWN0ZWRcbiAgICBpZiAoZXZlbnRUeXBlID09PSAndXBkYXRlJyAmJiBPYmplY3Qua2V5cyhjaGFuZ2VzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdObyBjaGFuZ2VzIGRldGVjdGVkLCBza2lwcGluZyBhdWRpdCBlbnRyeScsIHsgZW50aXR5TmFtZSwgZW50aXR5SWQgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY3RvciBjb250ZXh0XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3RvcihuZXdJbWFnZSwgb2xkSW1hZ2UpO1xuXG4gICAgLy8gR2V0IGNvcnJlbGF0aW9uSWQgZnJvbSBfYWN0b3IgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZ2VuZXJhdGUgb25lXG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHRoaXMuZXh0cmFjdENvcnJlbGF0aW9uSWQocmVjb3JkLCBuZXdJbWFnZSwgb2xkSW1hZ2UpO1xuXG4gICAgLy8gZW50aXR5TmFtZSBpcyBndWFyYW50ZWVkIGJ5IHByZXByb2Nlc3NSZWNvcmQgY2hlY2tcbiAgICBjb25zdCBlbnRpdHkgPSBlbnRpdHlOYW1lITtcbiAgICBjb25zdCBpZCA9IFN0cmluZyhlbnRpdHlJZCk7XG5cbiAgICAvLyBDYWxsIGFwcHJvcHJpYXRlIEF1ZGl0T2JzZXJ2ZXIgbWV0aG9kIGJhc2VkIG9uIGV2ZW50IHR5cGVcbiAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoZW50aXR5LCBpZCwgbmV3SW1hZ2UsIHsgYWN0b3IsIGNvcnJlbGF0aW9uSWQgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCBjcmVhdGUgYXVkaXQnLCB7IGVudGl0eU5hbWU6IGVudGl0eSwgZW50aXR5SWQ6IGlkIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoZW50aXR5LCBpZCwge1xuICAgICAgICAgIGJlZm9yZTogb2xkSW1hZ2UsXG4gICAgICAgICAgYWZ0ZXI6IG5ld0ltYWdlLFxuICAgICAgICAgIGRpZmY6IGNoYW5nZXNcbiAgICAgICAgfSwgeyBhY3RvciwgY29ycmVsYXRpb25JZCB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NhcHR1cmVkIHVwZGF0ZSBhdWRpdCcsIHsgZW50aXR5TmFtZTogZW50aXR5LCBlbnRpdHlJZDogaWQsIGNoYW5nZWRGaWVsZHM6IE9iamVjdC5rZXlzKGNoYW5nZXMpIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUoZW50aXR5LCBpZCwgb2xkSW1hZ2UsIHsgYWN0b3IsIGNvcnJlbGF0aW9uSWQgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCBkZWxldGUgYXVkaXQnLCB7IGVudGl0eU5hbWU6IGVudGl0eSwgZW50aXR5SWQ6IGlkIH0pO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gZW50aXR5IGltYWdlcy5cbiAgICogVHJpZXMgX2FjdG9yIGZpZWxkIGZpcnN0LCB0aGVuIGZhbGxzIGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHMuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yKG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLCBvbGRJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCk6IEFjdG9yIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBUcnkgX2FjdG9yIGZpZWxkIGZpcnN0IChzZXQgYnkgY3J1ZC1zZXJ2aWNlKVxuICAgIGNvbnN0IGFjdG9yQ29udGV4dCA9IG5ld0ltYWdlPy5fYWN0b3IgfHwgb2xkSW1hZ2U/Ll9hY3RvcjtcbiAgICBpZiAoYWN0b3JDb250ZXh0KSB7XG4gICAgICByZXR1cm4gYWN0b3JDb250ZXh0IGFzIEFjdG9yO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IFBhcnRpYWw8QWN0b3I+ID0ge307XG5cbiAgICBjb25zdCBhY3RvcklkID0gbmV3SW1hZ2U/LnVwZGF0ZWRCeSB8fCBuZXdJbWFnZT8uY3JlYXRlZEJ5IHx8IG9sZEltYWdlPy51cGRhdGVkQnkgfHwgb2xkSW1hZ2U/LmNyZWF0ZWRCeTtcbiAgICBpZiAoYWN0b3JJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci5hY3RvcklkID0gYWN0b3JJZDtcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRJZCA9IG5ld0ltYWdlPy50ZW5hbnRJZCB8fCBvbGRJbWFnZT8udGVuYW50SWQ7XG4gICAgaWYgKHRlbmFudElkKSB7XG4gICAgICBmYWxsYmFja0FjdG9yLnRlbmFudElkID0gdGVuYW50SWQ7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGZhbGxiYWNrIGlmIHdlIGhhdmUgYW55IGluZm8sIG90aGVyd2lzZSB1bmRlZmluZWQgKGxldCBvYnNlcnZhYmlsaXR5IHVzZSBjb250ZXh0KVxuICAgIHJldHVybiBPYmplY3Qua2V5cyhmYWxsYmFja0FjdG9yKS5sZW5ndGggPiAwXG4gICAgICA/IHsgLi4uZmFsbGJhY2tBY3RvciwgYWN0b3JUeXBlOiAndXNlcicgfSBhcyBBY3RvclxuICAgICAgOiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBvciBnZW5lcmF0ZSBjb3JyZWxhdGlvbklkIGZvciB0aGUgYXVkaXQgZXZlbnQuXG4gICAqIFByaW9yaXR5OlxuICAgKiAxLiBGcm9tIF9hY3Rvci5jb3JyZWxhdGlvbklkIChzZXQgYnkgb3JpZ2luYXRpbmcgcmVxdWVzdClcbiAgICogMi4gRnJvbSBEeW5hbW9EQiBldmVudElEICh1bmlxdWUgcGVyIHN0cmVhbSByZWNvcmQpXG4gICAqIDMuIEdlbmVyYXRlZCBmYWxsYmFja1xuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb3JyZWxhdGlvbklkKFxuICAgIHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+LFxuICAgIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkXG4gICk6IHN0cmluZyB7XG4gICAgLy8gVHJ5IHRvIGdldCBmcm9tIF9hY3RvciAocHJlc2VydmVzIHRyYWNlIGZyb20gb3JpZ2luYXRpbmcgcmVxdWVzdClcbiAgICBjb25zdCBhY3RvckNvcnJlbGF0aW9uSWQgPSBuZXdJbWFnZT8uX2FjdG9yPy5jb3JyZWxhdGlvbklkIHx8IG9sZEltYWdlPy5fYWN0b3I/LmNvcnJlbGF0aW9uSWQ7XG4gICAgaWYgKGFjdG9yQ29ycmVsYXRpb25JZCkge1xuICAgICAgcmV0dXJuIGFjdG9yQ29ycmVsYXRpb25JZDtcbiAgICB9XG5cbiAgICAvLyBVc2UgRHluYW1vREIgZXZlbnRJZCBpZiBhdmFpbGFibGUgKHVuaXF1ZSBwZXIgc3RyZWFtIHJlY29yZClcbiAgICBpZiAocmVjb3JkLmV2ZW50SWQpIHtcbiAgICAgIHJldHVybiBgc3RyZWFtLSR7cmVjb3JkLmV2ZW50SWR9YDtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjazogZ2VuZXJhdGUgYmFzZWQgb24gZW50aXR5IGluZm9cbiAgICByZXR1cm4gYHN0cmVhbS0ke3JlY29yZC5lbnRpdHlOYW1lfS0ke3JlY29yZC5lbnRpdHlJZH0tJHtEYXRlLm5vdygpfWA7XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJTdHJlYW1IYW5kbGVyJyk7XG4iXX0=