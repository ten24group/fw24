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
        const actor = this.extractActor(newImage);
        // entityName is guaranteed by preprocessRecord check
        const entity = entityName;
        const id = String(entityId);
        // Get original correlationId from _actor to link back to causing request
        const originalCorrelationId = newImage?._actor?.correlationId;
        // Call appropriate AuditObserver method based on event type
        // Explicitly link the Audit Log to the original API Request that caused the change.
        // This allows queries like "Show me all Audit Logs caused by Request X".
        switch (eventType) {
            case 'create':
                observability_1.AuditObserver.entityCreate(entity, id, newImage, {
                    actor,
                    causedBy: originalCorrelationId, // Original API request trace
                });
                this.logger.debug('Captured create audit', {
                    entityName: entity,
                    entityId: id,
                    causedBy: originalCorrelationId
                });
                break;
            case 'update':
                observability_1.AuditObserver.entityUpdate(entity, id, {
                    before: oldImage,
                    after: newImage,
                    diff: changes
                }, {
                    actor,
                    causedBy: originalCorrelationId,
                });
                this.logger.debug('Captured update audit', {
                    entityName: entity,
                    entityId: id,
                    changedFields: Object.keys(changes),
                    causedBy: originalCorrelationId
                });
                break;
            case 'delete':
                observability_1.AuditObserver.entityDelete(entity, id, oldImage, {
                    actor,
                    causedBy: originalCorrelationId,
                });
                this.logger.debug('Captured delete audit', {
                    entityName: entity,
                    entityId: id,
                    causedBy: originalCorrelationId
                });
                break;
        }
    }
    /**
     * Extract actor context from entity images.
     * Tries _actor field first, then falls back to visible actor fields.
     */
    extractActor(newImage) {
        // Try _actor field first (set by crud-service)
        const actorContext = newImage?._actor;
        if (actorContext) {
            return actorContext;
        }
        // Fallback to visible actor fields (backward compatibility)
        const fallbackActor = {};
        const actorId = newImage?.updatedBy || newImage?.createdBy;
        if (actorId) {
            fallbackActor.actorId = actorId;
        }
        const tenantId = newImage?.tenantId;
        if (tenantId) {
            fallbackActor.tenantId = tenantId;
        }
        // Return fallback if we have any info, otherwise undefined (let observability use context)
        return Object.keys(fallbackActor).length > 0
            ? { ...fallbackActor, actorType: 'user' }
            : undefined;
    }
}
exports.DynamoDBStreamAuditLogger = DynamoDBStreamAuditLogger;
exports.logger = (0, logging_1.createLogger)('DynamoDBStreamHandler');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSwwR0FBb0c7QUFDcEcsb0hBQThHO0FBRTlHLDJDQUE2QztBQUM3Qyx1Q0FBaUQ7QUFDakQsOENBQStDO0FBQy9DLHVEQUFvRDtBQUVwRCxrRUFBbUU7QUFFbkU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQWEseUJBQTBCLFNBQVEsZ0RBQWlEO0lBRTlGO1FBQ0UsS0FBSyxDQUFDLElBQUksMERBQTBCLEVBQUUsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQXNDO1FBQ3JELDJEQUEyRDtJQUM3RCxDQUFDO0lBRVMscUJBQXFCO1FBQzdCLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLG9CQUFvQixFQUFFLENBQUMsQ0FBQztRQUM1RixPQUFPLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUN4RSxDQUFDO0lBRVMsc0JBQXNCO1FBQzlCLE1BQU0sbUJBQW1CLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQztRQUM5RixPQUFPLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUMxRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNPLGlCQUFpQixDQUFDLFVBQWtCO1FBQzVDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxD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cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQVVESVRfRU5WX0tFWVMgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBnZXRDaGFuZ2VkUHJvcGVydGllcyB9IGZyb20gJy4uL2hlbHBlcnMvY2hhbmdlLWRldGVjdGlvbic7XG5cbi8qKlxuICogRHluYW1vREIgU3RyZWFtIEF1ZGl0IExvZ2dlclxuICogXG4gKiBQcm9jZXNzZXMgRHluYW1vREIgc3RyZWFtIGV2ZW50cyBhbmQgY2FwdHVyZXMgYXVkaXQgZXZlbnRzIHZpYSB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIFJlc3BvbnNpYmlsaXRpZXM6XG4gKiAtIExpc3RlbiB0byBEeW5hbW9EQiBzdHJlYW0gZXZlbnRzICh2aWEgU1FTKVxuICogLSBGaWx0ZXIgYnkgZW50aXR5IG5hbWVzIChhbGxvd2VkRW50aXR5TmFtZXMvZXhjbHVkZWRFbnRpdHlOYW1lcylcbiAqIC0gRGV0ZWN0IGNoYW5nZXMgYmV0d2VlbiBvbGQgYW5kIG5ldyBpbWFnZXNcbiAqIC0gRXh0cmFjdCBhY3RvciBjb250ZXh0XG4gKiAtIENhbGwgQXVkaXRPYnNlcnZlciB0byBjYXB0dXJlIGV2ZW50cyAoZmlyZS1hbmQtZm9yZ2V0LCBhdXRvLWZsdXNoZWQpXG4gKiBcbiAqIEN1c3RvbSBhdWRpdCBoYW5kbGVycyBjYW4gZXh0ZW5kIHRoaXMgdG8gYWRkIGN1c3RvbSBwcm9jZXNzaW5nIHdoaWxlIHJldXNpbmcgZnJhbWV3b3JrIHV0aWxpdGllcy5cbiAqL1xuZXhwb3J0IGNsYXNzIER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8RHluYW1vREJFdmVudERhdGFFeHRyYWN0b3I+IHtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKSk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8gaW5pdGlhbGl6YXRpb24gbmVlZGVkIC0gQXVkaXRPYnNlcnZlciBpcyByZWFkeSB0byB1c2VcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRBbGxvd2VkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuQUxMT1dFRF9FTlRJVFlfTkFNRVMgfSk7XG4gICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcyA/IGFsbG93ZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkVYQ0xVREVEX0VOVElUWV9OQU1FUyB9KTtcbiAgICByZXR1cm4gZXhjbHVkZWRFbnRpdHlOYW1lcyA/IGV4Y2x1ZGVkRW50aXR5TmFtZXMuc3BsaXQoJywnKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIGVudGl0eSBzaG91bGQgYmUgYXVkaXRlZCBiYXNlZCBvbiBhbGxvd2VkL2V4Y2x1ZGVkIGxpc3RzLlxuICAgKiBMb2dpYzpcbiAgICogLSBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIG9ubHkgYXVkaXQgZW50aXRpZXMgaW4gdGhhdCBsaXN0XG4gICAqIC0gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCAoYW5kIG5vIGFsbG93ZWRFbnRpdHlOYW1lcyksIGF1ZGl0IGFsbCBleGNlcHQgZXhjbHVkZWRcbiAgICogLSBJZiBuZWl0aGVyIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0ICdhdWRpdExvZycgYW5kICdvYnNlcnZhYmlsaXR5TG9nJyAoZGVmYXVsdCBiZWhhdmlvcilcbiAgICogLSBhbGxvd2VkRW50aXR5TmFtZXMgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIGV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICovXG4gIHByb3RlY3RlZCBzaG91bGRBdWRpdEVudGl0eShlbnRpdHlOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcblxuICAgIC8vIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgdXNlIGl0IGV4Y2x1c2l2ZWx5XG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBJZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0IGV4Y2x1ZGVkXG4gICAgaWYgKGV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gIWV4Y2x1ZGVkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBiZWhhdmlvcjogYXVkaXQgYWxsIGV4Y2VwdCBzeXN0ZW0gZW50aXRpZXNcbiAgICByZXR1cm4gZW50aXR5TmFtZSAhPT0gJ2F1ZGl0TG9nJyAmJiBlbnRpdHlOYW1lICE9PSAnb2JzZXJ2YWJpbGl0eUxvZyc7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+IHwgbnVsbD4ge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIH0gPSByZWNvcmQ7XG5cbiAgICBpZiAoIVsgJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJyBdLmluY2x1ZGVzKGV2ZW50VHlwZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ05vIGVudGl0eSBuYW1lIGZvdW5kIGluIHJlY29yZCcsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNob3VsZEF1ZGl0RW50aXR5KGVudGl0eU5hbWUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2tpcHBpbmcgYXVkaXQgZm9yIGZpbHRlcmVkIGVudGl0eScsIHsgZW50aXR5TmFtZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZWNvcmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuY2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGF1ZGl0IGV2ZW50IHVzaW5nIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS5cbiAgICogUGFzc2VzIG1heGltdW0gZGF0YTogYmVmb3JlIGltYWdlLCBhZnRlciBpbWFnZSwgYW5kIGNvbXB1dGVkIGRpZmYuXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgdGltZXN0YW1wLCBlbnRpdHlJZCwgcGF5bG9hZDogeyBuZXdJbWFnZSwgb2xkSW1hZ2UgfSB9ID0gcmVjb3JkO1xuXG4gICAgLy8gQ29tcHV0ZSBjaGFuZ2VzIChkaWZmIGJldHdlZW4gb2xkIGFuZCBuZXcpXG4gICAgY29uc3QgY2hhbmdlcyA9IGdldENoYW5nZWRQcm9wZXJ0aWVzKG9sZEltYWdlLCBuZXdJbWFnZSk7XG5cbiAgICAvLyBGb3IgdXBkYXRlcywgc2tpcCBpZiBubyBhY3R1YWwgY2hhbmdlcyBkZXRlY3RlZFxuICAgIGlmIChldmVudFR5cGUgPT09ICd1cGRhdGUnICYmIE9iamVjdC5rZXlzKGNoYW5nZXMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ05vIGNoYW5nZXMgZGV0ZWN0ZWQsIHNraXBwaW5nIGF1ZGl0IGVudHJ5JywgeyBlbnRpdHlOYW1lLCBlbnRpdHlJZCB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IGFjdG9yIGNvbnRleHRcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yKG5ld0ltYWdlKTtcblxuICAgIC8vIGVudGl0eU5hbWUgaXMgZ3VhcmFudGVlZCBieSBwcmVwcm9jZXNzUmVjb3JkIGNoZWNrXG4gICAgY29uc3QgZW50aXR5ID0gZW50aXR5TmFtZSE7XG4gICAgY29uc3QgaWQgPSBTdHJpbmcoZW50aXR5SWQpO1xuXG4gICAgLy8gR2V0IG9yaWdpbmFsIGNvcnJlbGF0aW9uSWQgZnJvbSBfYWN0b3IgdG8gbGluayBiYWNrIHRvIGNhdXNpbmcgcmVxdWVzdFxuICAgIGNvbnN0IG9yaWdpbmFsQ29ycmVsYXRpb25JZCA9IG5ld0ltYWdlPy5fYWN0b3I/LmNvcnJlbGF0aW9uSWQ7XG5cbiAgICAvLyBDYWxsIGFwcHJvcHJpYXRlIEF1ZGl0T2JzZXJ2ZXIgbWV0aG9kIGJhc2VkIG9uIGV2ZW50IHR5cGVcbiAgICAvLyBFeHBsaWNpdGx5IGxpbmsgdGhlIEF1ZGl0IExvZyB0byB0aGUgb3JpZ2luYWwgQVBJIFJlcXVlc3QgdGhhdCBjYXVzZWQgdGhlIGNoYW5nZS5cbiAgICAvLyBUaGlzIGFsbG93cyBxdWVyaWVzIGxpa2UgXCJTaG93IG1lIGFsbCBBdWRpdCBMb2dzIGNhdXNlZCBieSBSZXF1ZXN0IFhcIi5cbiAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoZW50aXR5LCBpZCwgbmV3SW1hZ2UsIHtcbiAgICAgICAgICBhY3RvcixcbiAgICAgICAgICBjYXVzZWRCeTogb3JpZ2luYWxDb3JyZWxhdGlvbklkLCAgLy8gT3JpZ2luYWwgQVBJIHJlcXVlc3QgdHJhY2VcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCBjcmVhdGUgYXVkaXQnLCB7XG4gICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5LFxuICAgICAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgICAgICBjYXVzZWRCeTogb3JpZ2luYWxDb3JyZWxhdGlvbklkXG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoZW50aXR5LCBpZCwge1xuICAgICAgICAgIGJlZm9yZTogb2xkSW1hZ2UsXG4gICAgICAgICAgYWZ0ZXI6IG5ld0ltYWdlLFxuICAgICAgICAgIGRpZmY6IGNoYW5nZXNcbiAgICAgICAgfSwge1xuICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgIGNhdXNlZEJ5OiBvcmlnaW5hbENvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQ2FwdHVyZWQgdXBkYXRlIGF1ZGl0Jywge1xuICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eSxcbiAgICAgICAgICBlbnRpdHlJZDogaWQsXG4gICAgICAgICAgY2hhbmdlZEZpZWxkczogT2JqZWN0LmtleXMoY2hhbmdlcyksXG4gICAgICAgICAgY2F1c2VkQnk6IG9yaWdpbmFsQ29ycmVsYXRpb25JZFxuICAgICAgICB9KTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5RGVsZXRlKGVudGl0eSwgaWQsIG9sZEltYWdlLCB7XG4gICAgICAgICAgYWN0b3IsXG4gICAgICAgICAgY2F1c2VkQnk6IG9yaWdpbmFsQ29ycmVsYXRpb25JZCxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCBkZWxldGUgYXVkaXQnLCB7XG4gICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5LFxuICAgICAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgICAgICBjYXVzZWRCeTogb3JpZ2luYWxDb3JyZWxhdGlvbklkXG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gZW50aXR5IGltYWdlcy5cbiAgICogVHJpZXMgX2FjdG9yIGZpZWxkIGZpcnN0LCB0aGVuIGZhbGxzIGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHMuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdEFjdG9yKG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkKTogQWN0b3IgfCB1bmRlZmluZWQge1xuICAgIC8vIFRyeSBfYWN0b3IgZmllbGQgZmlyc3QgKHNldCBieSBjcnVkLXNlcnZpY2UpXG4gICAgY29uc3QgYWN0b3JDb250ZXh0ID0gbmV3SW1hZ2U/Ll9hY3RvcjtcbiAgICBpZiAoYWN0b3JDb250ZXh0KSB7XG4gICAgICByZXR1cm4gYWN0b3JDb250ZXh0IGFzIEFjdG9yO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IFBhcnRpYWw8QWN0b3I+ID0ge307XG5cbiAgICBjb25zdCBhY3RvcklkID0gbmV3SW1hZ2U/LnVwZGF0ZWRCeSB8fCBuZXdJbWFnZT8uY3JlYXRlZEJ5O1xuICAgIGlmIChhY3RvcklkKSB7XG4gICAgICBmYWxsYmFja0FjdG9yLmFjdG9ySWQgPSBhY3RvcklkO1xuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudElkID0gbmV3SW1hZ2U/LnRlbmFudElkO1xuICAgIGlmICh0ZW5hbnRJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci50ZW5hbnRJZCA9IHRlbmFudElkO1xuICAgIH1cblxuICAgIC8vIFJldHVybiBmYWxsYmFjayBpZiB3ZSBoYXZlIGFueSBpbmZvLCBvdGhlcndpc2UgdW5kZWZpbmVkIChsZXQgb2JzZXJ2YWJpbGl0eSB1c2UgY29udGV4dClcbiAgICByZXR1cm4gT2JqZWN0LmtleXMoZmFsbGJhY2tBY3RvcikubGVuZ3RoID4gMFxuICAgICAgPyB7IC4uLmZhbGxiYWNrQWN0b3IsIGFjdG9yVHlwZTogJ3VzZXInIH0gYXMgQWN0b3JcbiAgICAgIDogdW5kZWZpbmVkO1xuICB9XG5cbn1cblxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJTdHJlYW1IYW5kbGVyJyk7XG4iXX0=