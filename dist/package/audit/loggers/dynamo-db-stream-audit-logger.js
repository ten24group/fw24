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
        // Extract actor + trace context ONLY from newImage.
        // oldImage contains STALE context (who created/last-updated the item), NOT who is performing the current op.
        // For DELETEs (where newImage is null), we unfortunately cannot determine the actor/trace from the stream record alone.
        // Better to have "unknown" actor than "incorrect" actor.
        const traceImage = newImage;
        // Extract actor context
        const actor = this.extractActor(traceImage);
        // Extract causedBy from _actor.correlationId - this links the audit log back to the originating request
        const causedBy = traceImage?._actor?.correlationId;
        // Trace linkage:
        // - parentObservabilityLogId is strict in-slice only (never propagated)
        // - causedBy links audit logs back to the originating request that modified the entity
        // entityName is guaranteed by preprocessRecord check
        const entity = entityName;
        const id = String(entityId);
        // Call appropriate AuditObserver method based on event type
        // Explicitly link the Audit Log to the original API Request that caused the change.
        switch (eventType) {
            case 'create':
                observability_1.AuditObserver.entityCreate(entity, id, newImage, {
                    actor,
                    causedBy,
                });
                this.logger.debug('Captured create audit', {
                    entityName: entity,
                    entityId: id,
                });
                break;
            case 'update':
                // Do NOT skip if no changes detected - these are "touch" updates (e.g., updatedAt only)
                // Mark them as no-op updates so they can be filtered if needed, but still captured.
                const isNoopUpdate = Object.keys(changes).length === 0;
                observability_1.AuditObserver.entityUpdate(entity, id, {
                    // before: oldImage,
                    // after: newImage,
                    diff: changes
                }, {
                    actor,
                    causedBy,
                    attributes: isNoopUpdate ? { noopUpdate: true } : undefined,
                });
                this.logger.debug('Captured update audit', {
                    entityName: entity,
                    entityId: id,
                    changedFields: Object.keys(changes),
                    isNoopUpdate,
                });
                break;
            case 'delete':
                observability_1.AuditObserver.entityDelete(entity, id, oldImage, {
                    actor,
                    causedBy,
                });
                this.logger.debug('Captured delete audit', {
                    entityName: entity,
                    entityId: id,
                });
                break;
        }
    }
    /**
     * Extract actor context from entity images.
     * Tries _actor field first, then falls back to visible actor fields.
     */
    extractActor(traceImage) {
        // Try _actor field first (set by crud-service)
        const actorContext = traceImage?._actor;
        if (actorContext) {
            return actorContext;
        }
        // Fallback to visible actor fields (backward compatibility)
        const fallbackActor = {};
        const actorId = traceImage?.updatedBy || traceImage?.createdBy;
        if (actorId) {
            fallbackActor.actorId = actorId;
        }
        const tenantId = traceImage?.tenantId;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSwwR0FBb0c7QUFDcEcsb0hBQThHO0FBRTlHLDJDQUE2QztBQUM3Qyx1Q0FBaUQ7QUFDakQsOENBQStDO0FBQy9DLHVEQUFvRDtBQUVwRCxrRUFBbUU7QUFFbkU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQWEseUJBQTBCLFNBQVEsZ0RBQWlEO0lBQzlGO1FBQ0UsS0FBSyxDQUFDLElBQUksMERBQTBCLEVBQUUsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQXNDO1FBQ3JELDJEQUEyRDtJQUM3RCxDQUFDO0lBRVMscUJBQXFCO1FBQzdCLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLG9CQUFvQixFQUFFLENBQUMsQ0FBQztRQUM1RixPQUFPLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUN4RSxDQUFDO0lBRVMsc0JBQXNCO1FBQzlCLE1BQU0sbUJBQW1CLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwyQkFBYyxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQztRQUM5RixPQUFPLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUMxRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNPLGlCQUFpQixDQUFDLFVBQWtCO1FBQzVDLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxD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ZW50LCBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuXG5pbXBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBDaGFuZ2VTdHJlYW1QYXlsb2FkIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBBVURJVF9FTlZfS0VZUyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGdldENoYW5nZWRQcm9wZXJ0aWVzIH0gZnJvbSAnLi4vaGVscGVycy9jaGFuZ2UtZGV0ZWN0aW9uJztcblxuLyoqXG4gKiBEeW5hbW9EQiBTdHJlYW0gQXVkaXQgTG9nZ2VyXG4gKiBcbiAqIFByb2Nlc3NlcyBEeW5hbW9EQiBzdHJlYW0gZXZlbnRzIGFuZCBjYXB0dXJlcyBhdWRpdCBldmVudHMgdmlhIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS5cbiAqIFxuICogUmVzcG9uc2liaWxpdGllczpcbiAqIC0gTGlzdGVuIHRvIER5bmFtb0RCIHN0cmVhbSBldmVudHMgKHZpYSBTUVMpXG4gKiAtIEZpbHRlciBieSBlbnRpdHkgbmFtZXMgKGFsbG93ZWRFbnRpdHlOYW1lcy9leGNsdWRlZEVudGl0eU5hbWVzKVxuICogLSBEZXRlY3QgY2hhbmdlcyBiZXR3ZWVuIG9sZCBhbmQgbmV3IGltYWdlc1xuICogLSBFeHRyYWN0IGFjdG9yIGNvbnRleHRcbiAqIC0gQ2FsbCBBdWRpdE9ic2VydmVyIHRvIGNhcHR1cmUgZXZlbnRzIChmaXJlLWFuZC1mb3JnZXQsIGF1dG8tZmx1c2hlZClcbiAqIFxuICogQ3VzdG9tIGF1ZGl0IGhhbmRsZXJzIGNhbiBleHRlbmQgdGhpcyB0byBhZGQgY3VzdG9tIHByb2Nlc3Npbmcgd2hpbGUgcmV1c2luZyBmcmFtZXdvcmsgdXRpbGl0aWVzLlxuICovXG5leHBvcnQgY2xhc3MgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlciBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvcjxEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3Rvcj4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKSk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8gaW5pdGlhbGl6YXRpb24gbmVlZGVkIC0gQXVkaXRPYnNlcnZlciBpcyByZWFkeSB0byB1c2VcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRBbGxvd2VkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuQUxMT1dFRF9FTlRJVFlfTkFNRVMgfSk7XG4gICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcyA/IGFsbG93ZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEFVRElUX0VOVl9LRVlTLkVYQ0xVREVEX0VOVElUWV9OQU1FUyB9KTtcbiAgICByZXR1cm4gZXhjbHVkZWRFbnRpdHlOYW1lcyA/IGV4Y2x1ZGVkRW50aXR5TmFtZXMuc3BsaXQoJywnKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIGVudGl0eSBzaG91bGQgYmUgYXVkaXRlZCBiYXNlZCBvbiBhbGxvd2VkL2V4Y2x1ZGVkIGxpc3RzLlxuICAgKiBMb2dpYzpcbiAgICogLSBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIG9ubHkgYXVkaXQgZW50aXRpZXMgaW4gdGhhdCBsaXN0XG4gICAqIC0gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCAoYW5kIG5vIGFsbG93ZWRFbnRpdHlOYW1lcyksIGF1ZGl0IGFsbCBleGNlcHQgZXhjbHVkZWRcbiAgICogLSBJZiBuZWl0aGVyIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0ICdhdWRpdExvZycgYW5kICdvYnNlcnZhYmlsaXR5TG9nJyAoZGVmYXVsdCBiZWhhdmlvcilcbiAgICogLSBhbGxvd2VkRW50aXR5TmFtZXMgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIGV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICovXG4gIHByb3RlY3RlZCBzaG91bGRBdWRpdEVudGl0eShlbnRpdHlOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcblxuICAgIC8vIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgdXNlIGl0IGV4Y2x1c2l2ZWx5XG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBJZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBhdWRpdCBhbGwgZXhjZXB0IGV4Y2x1ZGVkXG4gICAgaWYgKGV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gIWV4Y2x1ZGVkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBiZWhhdmlvcjogYXVkaXQgYWxsIGV4Y2VwdCBzeXN0ZW0gZW50aXRpZXNcbiAgICByZXR1cm4gZW50aXR5TmFtZSAhPT0gJ2F1ZGl0TG9nJyAmJiBlbnRpdHlOYW1lICE9PSAnb2JzZXJ2YWJpbGl0eUxvZyc7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+IHwgbnVsbD4ge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIH0gPSByZWNvcmQ7XG5cbiAgICBpZiAoIVsgJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJyBdLmluY2x1ZGVzKGV2ZW50VHlwZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ05vIGVudGl0eSBuYW1lIGZvdW5kIGluIHJlY29yZCcsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNob3VsZEF1ZGl0RW50aXR5KGVudGl0eU5hbWUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU2tpcHBpbmcgYXVkaXQgZm9yIGZpbHRlcmVkIGVudGl0eScsIHsgZW50aXR5TmFtZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZWNvcmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuY2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGF1ZGl0IGV2ZW50IHVzaW5nIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS5cbiAgICogUGFzc2VzIG1heGltdW0gZGF0YTogYmVmb3JlIGltYWdlLCBhZnRlciBpbWFnZSwgYW5kIGNvbXB1dGVkIGRpZmYuXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgdGltZXN0YW1wLCBlbnRpdHlJZCwgcGF5bG9hZDogeyBuZXdJbWFnZSwgb2xkSW1hZ2UgfSB9ID0gcmVjb3JkO1xuXG4gICAgLy8gQ29tcHV0ZSBjaGFuZ2VzIChkaWZmIGJldHdlZW4gb2xkIGFuZCBuZXcpXG4gICAgY29uc3QgY2hhbmdlcyA9IGdldENoYW5nZWRQcm9wZXJ0aWVzKG9sZEltYWdlLCBuZXdJbWFnZSk7XG5cbiAgICAvLyBFeHRyYWN0IGFjdG9yICsgdHJhY2UgY29udGV4dCBPTkxZIGZyb20gbmV3SW1hZ2UuXG4gICAgLy8gb2xkSW1hZ2UgY29udGFpbnMgU1RBTEUgY29udGV4dCAod2hvIGNyZWF0ZWQvbGFzdC11cGRhdGVkIHRoZSBpdGVtKSwgTk9UIHdobyBpcyBwZXJmb3JtaW5nIHRoZSBjdXJyZW50IG9wLlxuICAgIC8vIEZvciBERUxFVEVzICh3aGVyZSBuZXdJbWFnZSBpcyBudWxsKSwgd2UgdW5mb3J0dW5hdGVseSBjYW5ub3QgZGV0ZXJtaW5lIHRoZSBhY3Rvci90cmFjZSBmcm9tIHRoZSBzdHJlYW0gcmVjb3JkIGFsb25lLlxuICAgIC8vIEJldHRlciB0byBoYXZlIFwidW5rbm93blwiIGFjdG9yIHRoYW4gXCJpbmNvcnJlY3RcIiBhY3Rvci5cbiAgICBjb25zdCB0cmFjZUltYWdlID0gbmV3SW1hZ2U7XG5cbiAgICAvLyBFeHRyYWN0IGFjdG9yIGNvbnRleHRcbiAgICBjb25zdCBhY3RvciA9IHRoaXMuZXh0cmFjdEFjdG9yKHRyYWNlSW1hZ2UpO1xuXG4gICAgLy8gRXh0cmFjdCBjYXVzZWRCeSBmcm9tIF9hY3Rvci5jb3JyZWxhdGlvbklkIC0gdGhpcyBsaW5rcyB0aGUgYXVkaXQgbG9nIGJhY2sgdG8gdGhlIG9yaWdpbmF0aW5nIHJlcXVlc3RcbiAgICBjb25zdCBjYXVzZWRCeSA9IHRyYWNlSW1hZ2U/Ll9hY3Rvcj8uY29ycmVsYXRpb25JZDtcblxuICAgIC8vIFRyYWNlIGxpbmthZ2U6XG4gICAgLy8gLSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgc3RyaWN0IGluLXNsaWNlIG9ubHkgKG5ldmVyIHByb3BhZ2F0ZWQpXG4gICAgLy8gLSBjYXVzZWRCeSBsaW5rcyBhdWRpdCBsb2dzIGJhY2sgdG8gdGhlIG9yaWdpbmF0aW5nIHJlcXVlc3QgdGhhdCBtb2RpZmllZCB0aGUgZW50aXR5XG5cbiAgICAvLyBlbnRpdHlOYW1lIGlzIGd1YXJhbnRlZWQgYnkgcHJlcHJvY2Vzc1JlY29yZCBjaGVja1xuICAgIGNvbnN0IGVudGl0eSA9IGVudGl0eU5hbWUhO1xuICAgIGNvbnN0IGlkID0gU3RyaW5nKGVudGl0eUlkKTtcblxuICAgIC8vIENhbGwgYXBwcm9wcmlhdGUgQXVkaXRPYnNlcnZlciBtZXRob2QgYmFzZWQgb24gZXZlbnQgdHlwZVxuICAgIC8vIEV4cGxpY2l0bHkgbGluayB0aGUgQXVkaXQgTG9nIHRvIHRoZSBvcmlnaW5hbCBBUEkgUmVxdWVzdCB0aGF0IGNhdXNlZCB0aGUgY2hhbmdlLlxuICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZShlbnRpdHksIGlkLCBuZXdJbWFnZSwge1xuICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgIGNhdXNlZEJ5LFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NhcHR1cmVkIGNyZWF0ZSBhdWRpdCcsIHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHksXG4gICAgICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgICB9KTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIC8vIERvIE5PVCBza2lwIGlmIG5vIGNoYW5nZXMgZGV0ZWN0ZWQgLSB0aGVzZSBhcmUgXCJ0b3VjaFwiIHVwZGF0ZXMgKGUuZy4sIHVwZGF0ZWRBdCBvbmx5KVxuICAgICAgICAvLyBNYXJrIHRoZW0gYXMgbm8tb3AgdXBkYXRlcyBzbyB0aGV5IGNhbiBiZSBmaWx0ZXJlZCBpZiBuZWVkZWQsIGJ1dCBzdGlsbCBjYXB0dXJlZC5cbiAgICAgICAgY29uc3QgaXNOb29wVXBkYXRlID0gT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoID09PSAwO1xuXG4gICAgICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5VXBkYXRlKGVudGl0eSwgaWQsIHtcbiAgICAgICAgICAvLyBiZWZvcmU6IG9sZEltYWdlLFxuICAgICAgICAgIC8vIGFmdGVyOiBuZXdJbWFnZSxcbiAgICAgICAgICBkaWZmOiBjaGFuZ2VzXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBhY3RvcixcbiAgICAgICAgICBjYXVzZWRCeSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBpc05vb3BVcGRhdGUgPyB7IG5vb3BVcGRhdGU6IHRydWUgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCB1cGRhdGUgYXVkaXQnLCB7XG4gICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5LFxuICAgICAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgICAgICBjaGFuZ2VkRmllbGRzOiBPYmplY3Qua2V5cyhjaGFuZ2VzKSxcbiAgICAgICAgICBpc05vb3BVcGRhdGUsXG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUoZW50aXR5LCBpZCwgb2xkSW1hZ2UsIHtcbiAgICAgICAgICBhY3RvcixcbiAgICAgICAgICBjYXVzZWRCeSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCBkZWxldGUgYXVkaXQnLCB7XG4gICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5LFxuICAgICAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBlbnRpdHkgaW1hZ2VzLlxuICAgKiBUcmllcyBfYWN0b3IgZmllbGQgZmlyc3QsIHRoZW4gZmFsbHMgYmFjayB0byB2aXNpYmxlIGFjdG9yIGZpZWxkcy5cbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3IodHJhY2VJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCk6IEFjdG9yIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBUcnkgX2FjdG9yIGZpZWxkIGZpcnN0IChzZXQgYnkgY3J1ZC1zZXJ2aWNlKVxuICAgIGNvbnN0IGFjdG9yQ29udGV4dCA9IHRyYWNlSW1hZ2U/Ll9hY3RvcjtcbiAgICBpZiAoYWN0b3JDb250ZXh0KSB7XG4gICAgICByZXR1cm4gYWN0b3JDb250ZXh0IGFzIEFjdG9yO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IFBhcnRpYWw8QWN0b3I+ID0ge307XG5cbiAgICBjb25zdCBhY3RvcklkID0gdHJhY2VJbWFnZT8udXBkYXRlZEJ5IHx8IHRyYWNlSW1hZ2U/LmNyZWF0ZWRCeTtcbiAgICBpZiAoYWN0b3JJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci5hY3RvcklkID0gYWN0b3JJZDtcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRJZCA9IHRyYWNlSW1hZ2U/LnRlbmFudElkO1xuICAgIGlmICh0ZW5hbnRJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci50ZW5hbnRJZCA9IHRlbmFudElkO1xuICAgIH1cblxuICAgIC8vIFJldHVybiBmYWxsYmFjayBpZiB3ZSBoYXZlIGFueSBpbmZvLCBvdGhlcndpc2UgdW5kZWZpbmVkIChsZXQgb2JzZXJ2YWJpbGl0eSB1c2UgY29udGV4dClcbiAgICByZXR1cm4gT2JqZWN0LmtleXMoZmFsbGJhY2tBY3RvcikubGVuZ3RoID4gMFxuICAgICAgPyB7IC4uLmZhbGxiYWNrQWN0b3IsIGFjdG9yVHlwZTogJ3VzZXInIH0gYXMgQWN0b3JcbiAgICAgIDogdW5kZWZpbmVkO1xuICB9XG5cbn1cblxuZXhwb3J0IGNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRHluYW1vREJTdHJlYW1IYW5kbGVyJyk7XG4iXX0=