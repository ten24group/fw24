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
        // Use 'batch' mode to avoid creating per-record wrapper spans
        // Audit logs are the primary signal - we don't need intermediate spans for each record
        super(new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor(), { processMode: 'batch' });
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
        // Skip no-op updates entirely (no changes detected)
        if (eventType === 'update' && Object.keys(changes).length === 0) {
            this.logger.debug('Skipping no-op update (no changes detected)', {
                entityName,
                entityId,
            });
            return;
        }
        // Extract actor + trace context ONLY from newImage.
        // oldImage contains STALE context (who created/last-updated the item), NOT who is performing the current op.
        // For DELETEs (where newImage is null), we unfortunately cannot determine the actor/trace from the stream record alone.
        // Better to have "unknown" actor than "incorrect" actor.
        const traceImage = newImage;
        // Extract actor context with staleness detection
        // Use current time if event timestamp is not available
        const eventTimestamp = timestamp ?? Date.now();
        const actorData = this.extractActorWithStalenessCheck(traceImage, eventTimestamp);
        // Only use actor and correlation if data is fresh
        const actor = actorData.isFresh ? actorData.actor : undefined;
        const causedBy = actorData.isFresh ? traceImage?._actor?.correlationId : undefined;
        if (!actorData.isFresh && actorData.actor) {
            this.logger.debug('Actor data is stale, skipping correlation', {
                entityName,
                entityId,
                eventType,
                actorTimestamp: actorData.actorTimestamp,
                eventTimestamp: timestamp,
                staleness: actorData.stalenessMs,
            });
        }
        // Trace linkage:
        // - parentObservabilityLogId is strict in-slice only (never propagated)
        // - causedBy links audit logs back to the originating request that modified the entity
        // - Both are only used if actor data is fresh (not stale)
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
                    hasActor: !!actor,
                });
                break;
            case 'update':
                observability_1.AuditObserver.entityUpdate(entity, id, {
                    // before: oldImage,
                    // after: newImage,
                    diff: changes
                }, {
                    actor,
                    causedBy,
                });
                this.logger.debug('Captured update audit', {
                    entityName: entity,
                    entityId: id,
                    changedFields: Object.keys(changes),
                    hasActor: !!actor,
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
                    hasActor: !!actor,
                });
                break;
        }
    }
    /**
     * Extract actor context from entity images with staleness detection.
     *
     * Actor data is considered "fresh" if:
     * 1. It has an actorTimestamp field, AND
     * 2. The timestamp is within the acceptable staleness threshold (default: 5 seconds)
     *
     * If actor data is stale, we should NOT use it for correlation as it represents
     * a previous operation, not the current one.
     *
     * @param traceImage - Entity image to extract actor from
     * @param eventTimestamp - Timestamp of the current event
     * @returns Object containing actor, freshness status, and staleness metrics
     */
    extractActorWithStalenessCheck(traceImage, eventTimestamp) {
        const actor = this.extractActor(traceImage);
        if (!actor) {
            return { actor: undefined, isFresh: false };
        }
        // Check for actorTimestamp in _actor field
        const actorTimestamp = traceImage?._actor?.actorTimestamp;
        if (!actorTimestamp) {
            // No timestamp means we can't verify freshness
            // Log warning but still use the actor (backward compatibility)
            this.logger.debug('Actor data has no timestamp, cannot verify freshness', {
                actorId: actor.actorId,
            });
            return {
                actor,
                isFresh: true, // Assume fresh for backward compatibility
            };
        }
        // Calculate staleness (difference between event time and actor timestamp)
        const stalenessMs = eventTimestamp - actorTimestamp;
        // Get staleness threshold from env (default: 5000ms = 5 seconds)
        const thresholdMs = this.getActorStalenessThreshold();
        // Actor is fresh if staleness is within threshold
        // Also check for negative staleness (clock skew) and allow small negative values
        const isFresh = stalenessMs >= -1000 && stalenessMs <= thresholdMs;
        return {
            actor,
            isFresh,
            actorTimestamp,
            stalenessMs,
        };
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
    /**
     * Get actor staleness threshold from environment.
     * Default: 5000ms (5 seconds)
     */
    getActorStalenessThreshold() {
        const threshold = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.AUDIT_ENV_KEYS.ACTOR_STALENESS_THRESHOLD_MS });
        return threshold ? parseInt(threshold, 10) : 5000;
    }
}
exports.DynamoDBStreamAuditLogger = DynamoDBStreamAuditLogger;
exports.logger = (0, logging_1.createLogger)('DynamoDBStreamHandler');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSwwR0FBb0c7QUFDcEcsb0hBQThHO0FBRTlHLDJDQUE2QztBQUM3Qyx1Q0FBaUQ7QUFDakQsOENBQStDO0FBQy9DLHVEQUFvRDtBQUVwRCxrRUFBbUU7QUFFbkU7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQWEseUJBQTBCLFNBQVEsZ0RBQWlEO0lBQzlGO1FBQ0UsOERBQThEO1FBQzlELHVGQUF1RjtRQUN2RixLQUFLLENBQUMsSUFBSSwwREFBMEIsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVELEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBc0M7UUFDckQsMkRBQTJEO0lBQzdELENBQUM7SUFFUyxxQkFBcUI7UUFDN0IsTUFBTSxrQkFBa0IsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDO1FBQzVGLE9BQU8sa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQ3hFLENBQUM7SUFFUyxzQkFBc0I7UUFDOUIsTUFBTSxtQkFBbUIsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFDO1FBQzlGLE9BQU8sbUJBQW1CLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQzFFLENBQUM7SUFFRDs7Ozs7OztP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QUUsQ0FBQztRQUV6QyxNQUFNLE9BQU8sR0FBRyxVQUFVLEVBQUUsU0FBUyxJQUFJLFVBQVUsRUFBRSxTQUFTLENBQUM7UUFDL0QsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLGFBQWEsQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ2xDLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxVQUFVLEVBQUUsUUFBUSxDQUFDO1FBQ3RDLElBQUksUUFBUSxFQUFFLENBQUM7WUFDYixhQUFhLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUNwQyxDQUFDO1FBRUQsMkZBQTJGO1FBQzNGLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUMxQyxDQUFDLENBQUMsRUFBRSxHQUFHLGFBQWEsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFXO1lBQ2xELENBQUMsQ0FBQyxTQUFTLENBQUM7SUFDaEIsQ0FBQztJQUVEOzs7T0FHRztJQUNPLDBCQUEwQjtRQUNsQyxNQUFNLFNBQVMsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDJCQUFjLENBQUMsNEJBQTRCLEVBQUUsQ0FBQyxDQUFDO1FBQzNGLE9BQU8sU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDcEQsQ0FBQztDQUVGO0FBdlJELDhEQXVSQztBQUVZLFFBQUEsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyx1QkFBdUIsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQVVESVRfRU5WX0tFWVMgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBnZXRDaGFuZ2VkUHJvcGVydGllcyB9IGZyb20gJy4uL2hlbHBlcnMvY2hhbmdlLWRldGVjdGlvbic7XG5cbi8qKlxuICogRHluYW1vREIgU3RyZWFtIEF1ZGl0IExvZ2dlclxuICogXG4gKiBQcm9jZXNzZXMgRHluYW1vREIgc3RyZWFtIGV2ZW50cyBhbmQgY2FwdHVyZXMgYXVkaXQgZXZlbnRzIHZpYSB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIFJlc3BvbnNpYmlsaXRpZXM6XG4gKiAtIExpc3RlbiB0byBEeW5hbW9EQiBzdHJlYW0gZXZlbnRzICh2aWEgU1FTKVxuICogLSBGaWx0ZXIgYnkgZW50aXR5IG5hbWVzIChhbGxvd2VkRW50aXR5TmFtZXMvZXhjbHVkZWRFbnRpdHlOYW1lcylcbiAqIC0gRGV0ZWN0IGNoYW5nZXMgYmV0d2VlbiBvbGQgYW5kIG5ldyBpbWFnZXNcbiAqIC0gRXh0cmFjdCBhY3RvciBjb250ZXh0XG4gKiAtIENhbGwgQXVkaXRPYnNlcnZlciB0byBjYXB0dXJlIGV2ZW50cyAoZmlyZS1hbmQtZm9yZ2V0LCBhdXRvLWZsdXNoZWQpXG4gKiBcbiAqIEN1c3RvbSBhdWRpdCBoYW5kbGVycyBjYW4gZXh0ZW5kIHRoaXMgdG8gYWRkIGN1c3RvbSBwcm9jZXNzaW5nIHdoaWxlIHJldXNpbmcgZnJhbWV3b3JrIHV0aWxpdGllcy5cbiAqL1xuZXhwb3J0IGNsYXNzIER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8RHluYW1vREJFdmVudERhdGFFeHRyYWN0b3I+IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLy8gVXNlICdiYXRjaCcgbW9kZSB0byBhdm9pZCBjcmVhdGluZyBwZXItcmVjb3JkIHdyYXBwZXIgc3BhbnNcbiAgICAvLyBBdWRpdCBsb2dzIGFyZSB0aGUgcHJpbWFyeSBzaWduYWwgLSB3ZSBkb24ndCBuZWVkIGludGVybWVkaWF0ZSBzcGFucyBmb3IgZWFjaCByZWNvcmRcbiAgICBzdXBlcihuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKSwgeyBwcm9jZXNzTW9kZTogJ2JhdGNoJyB9KTtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBEeW5hbW9EQlN0cmVhbUV2ZW50IHwgU1FTRXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBObyBpbml0aWFsaXphdGlvbiBuZWVkZWQgLSBBdWRpdE9ic2VydmVyIGlzIHJlYWR5IHRvIHVzZVxuICB9XG5cbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5BTExPV0VEX0VOVElUWV9OQU1FUyB9KTtcbiAgICByZXR1cm4gYWxsb3dlZEVudGl0eU5hbWVzID8gYWxsb3dlZEVudGl0eU5hbWVzLnNwbGl0KCcsJykgOiB1bmRlZmluZWQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogQVVESVRfRU5WX0tFWVMuRVhDTFVERURfRU5USVRZX05BTUVTIH0pO1xuICAgIHJldHVybiBleGNsdWRlZEVudGl0eU5hbWVzID8gZXhjbHVkZWRFbnRpdHlOYW1lcy5zcGxpdCgnLCcpIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYW4gZW50aXR5IHNob3VsZCBiZSBhdWRpdGVkIGJhc2VkIG9uIGFsbG93ZWQvZXhjbHVkZWQgbGlzdHMuXG4gICAqIExvZ2ljOlxuICAgKiAtIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgb25seSBhdWRpdCBlbnRpdGllcyBpbiB0aGF0IGxpc3RcbiAgICogLSBJZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkIChhbmQgbm8gYWxsb3dlZEVudGl0eU5hbWVzKSwgYXVkaXQgYWxsIGV4Y2VwdCBleGNsdWRlZFxuICAgKiAtIElmIG5laXRoZXIgaXMgcHJvdmlkZWQsIGF1ZGl0IGFsbCBleGNlcHQgJ2F1ZGl0TG9nJyBhbmQgJ29ic2VydmFiaWxpdHlMb2cnIChkZWZhdWx0IGJlaGF2aW9yKVxuICAgKiAtIGFsbG93ZWRFbnRpdHlOYW1lcyB0YWtlcyBwcmVjZWRlbmNlIG92ZXIgZXhjbHVkZWRFbnRpdHlOYW1lc1xuICAgKi9cbiAgcHJvdGVjdGVkIHNob3VsZEF1ZGl0RW50aXR5KGVudGl0eU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk7XG4gICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpO1xuXG4gICAgLy8gSWYgYWxsb3dlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCB1c2UgaXQgZXhjbHVzaXZlbHlcbiAgICBpZiAoYWxsb3dlZEVudGl0eU5hbWVzICYmIGFsbG93ZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYWxsb3dlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIElmIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIGF1ZGl0IGFsbCBleGNlcHQgZXhjbHVkZWRcbiAgICBpZiAoZXhjbHVkZWRFbnRpdHlOYW1lcyAmJiBleGNsdWRlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiAhZXhjbHVkZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IGJlaGF2aW9yOiBhdWRpdCBhbGwgZXhjZXB0IHN5c3RlbSBlbnRpdGllc1xuICAgIHJldHVybiBlbnRpdHlOYW1lICE9PSAnYXVkaXRMb2cnICYmIGVudGl0eU5hbWUgIT09ICdvYnNlcnZhYmlsaXR5TG9nJztcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcmVwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+KTogUHJvbWlzZTxCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4gfCBudWxsPiB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSA9IHJlY29yZDtcblxuICAgIGlmICghWyAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnIF0uaW5jbHVkZXMoZXZlbnRUeXBlKSkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ1NraXBwaW5nIHJlY29yZCB3aXRoIHVuc3VwcG9ydGVkIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghZW50aXR5TmFtZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignTm8gZW50aXR5IG5hbWUgZm91bmQgaW4gcmVjb3JkJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkQXVkaXRFbnRpdHkoZW50aXR5TmFtZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTa2lwcGluZyBhdWRpdCBmb3IgZmlsdGVyZWQgZW50aXR5JywgeyBlbnRpdHlOYW1lIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5jYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBhd2FpdCB0aGlzLmNhcHR1cmVBdWRpdEV2ZW50KHJlY29yZCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYXVkaXQgZXZlbnQgdXNpbmcgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLlxuICAgKiBQYXNzZXMgbWF4aW11bSBkYXRhOiBiZWZvcmUgaW1hZ2UsIGFmdGVyIGltYWdlLCBhbmQgY29tcHV0ZWQgZGlmZi5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlQXVkaXRFdmVudChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCB0aW1lc3RhbXAsIGVudGl0eUlkLCBwYXlsb2FkOiB7IG5ld0ltYWdlLCBvbGRJbWFnZSB9IH0gPSByZWNvcmQ7XG5cbiAgICAvLyBDb21wdXRlIGNoYW5nZXMgKGRpZmYgYmV0d2VlbiBvbGQgYW5kIG5ldylcbiAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgIC8vIFNraXAgbm8tb3AgdXBkYXRlcyBlbnRpcmVseSAobm8gY2hhbmdlcyBkZXRlY3RlZClcbiAgICBpZiAoZXZlbnRUeXBlID09PSAndXBkYXRlJyAmJiBPYmplY3Qua2V5cyhjaGFuZ2VzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTa2lwcGluZyBuby1vcCB1cGRhdGUgKG5vIGNoYW5nZXMgZGV0ZWN0ZWQpJywge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBlbnRpdHlJZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEV4dHJhY3QgYWN0b3IgKyB0cmFjZSBjb250ZXh0IE9OTFkgZnJvbSBuZXdJbWFnZS5cbiAgICAvLyBvbGRJbWFnZSBjb250YWlucyBTVEFMRSBjb250ZXh0ICh3aG8gY3JlYXRlZC9sYXN0LXVwZGF0ZWQgdGhlIGl0ZW0pLCBOT1Qgd2hvIGlzIHBlcmZvcm1pbmcgdGhlIGN1cnJlbnQgb3AuXG4gICAgLy8gRm9yIERFTEVURXMgKHdoZXJlIG5ld0ltYWdlIGlzIG51bGwpLCB3ZSB1bmZvcnR1bmF0ZWx5IGNhbm5vdCBkZXRlcm1pbmUgdGhlIGFjdG9yL3RyYWNlIGZyb20gdGhlIHN0cmVhbSByZWNvcmQgYWxvbmUuXG4gICAgLy8gQmV0dGVyIHRvIGhhdmUgXCJ1bmtub3duXCIgYWN0b3IgdGhhbiBcImluY29ycmVjdFwiIGFjdG9yLlxuICAgIGNvbnN0IHRyYWNlSW1hZ2UgPSBuZXdJbWFnZTtcblxuICAgIC8vIEV4dHJhY3QgYWN0b3IgY29udGV4dCB3aXRoIHN0YWxlbmVzcyBkZXRlY3Rpb25cbiAgICAvLyBVc2UgY3VycmVudCB0aW1lIGlmIGV2ZW50IHRpbWVzdGFtcCBpcyBub3QgYXZhaWxhYmxlXG4gICAgY29uc3QgZXZlbnRUaW1lc3RhbXAgPSB0aW1lc3RhbXAgPz8gRGF0ZS5ub3coKTtcbiAgICBjb25zdCBhY3RvckRhdGEgPSB0aGlzLmV4dHJhY3RBY3RvcldpdGhTdGFsZW5lc3NDaGVjayh0cmFjZUltYWdlLCBldmVudFRpbWVzdGFtcCk7XG5cbiAgICAvLyBPbmx5IHVzZSBhY3RvciBhbmQgY29ycmVsYXRpb24gaWYgZGF0YSBpcyBmcmVzaFxuICAgIGNvbnN0IGFjdG9yID0gYWN0b3JEYXRhLmlzRnJlc2ggPyBhY3RvckRhdGEuYWN0b3IgOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY2F1c2VkQnkgPSBhY3RvckRhdGEuaXNGcmVzaCA/IHRyYWNlSW1hZ2U/Ll9hY3Rvcj8uY29ycmVsYXRpb25JZCA6IHVuZGVmaW5lZDtcblxuICAgIGlmICghYWN0b3JEYXRhLmlzRnJlc2ggJiYgYWN0b3JEYXRhLmFjdG9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnQWN0b3IgZGF0YSBpcyBzdGFsZSwgc2tpcHBpbmcgY29ycmVsYXRpb24nLCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGVudGl0eUlkLFxuICAgICAgICBldmVudFR5cGUsXG4gICAgICAgIGFjdG9yVGltZXN0YW1wOiBhY3RvckRhdGEuYWN0b3JUaW1lc3RhbXAsXG4gICAgICAgIGV2ZW50VGltZXN0YW1wOiB0aW1lc3RhbXAsXG4gICAgICAgIHN0YWxlbmVzczogYWN0b3JEYXRhLnN0YWxlbmVzc01zLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gVHJhY2UgbGlua2FnZTpcbiAgICAvLyAtIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBzdHJpY3QgaW4tc2xpY2Ugb25seSAobmV2ZXIgcHJvcGFnYXRlZClcbiAgICAvLyAtIGNhdXNlZEJ5IGxpbmtzIGF1ZGl0IGxvZ3MgYmFjayB0byB0aGUgb3JpZ2luYXRpbmcgcmVxdWVzdCB0aGF0IG1vZGlmaWVkIHRoZSBlbnRpdHlcbiAgICAvLyAtIEJvdGggYXJlIG9ubHkgdXNlZCBpZiBhY3RvciBkYXRhIGlzIGZyZXNoIChub3Qgc3RhbGUpXG5cbiAgICAvLyBlbnRpdHlOYW1lIGlzIGd1YXJhbnRlZWQgYnkgcHJlcHJvY2Vzc1JlY29yZCBjaGVja1xuICAgIGNvbnN0IGVudGl0eSA9IGVudGl0eU5hbWUhO1xuICAgIGNvbnN0IGlkID0gU3RyaW5nKGVudGl0eUlkKTtcblxuICAgIC8vIENhbGwgYXBwcm9wcmlhdGUgQXVkaXRPYnNlcnZlciBtZXRob2QgYmFzZWQgb24gZXZlbnQgdHlwZVxuICAgIC8vIEV4cGxpY2l0bHkgbGluayB0aGUgQXVkaXQgTG9nIHRvIHRoZSBvcmlnaW5hbCBBUEkgUmVxdWVzdCB0aGF0IGNhdXNlZCB0aGUgY2hhbmdlLlxuICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZShlbnRpdHksIGlkLCBuZXdJbWFnZSwge1xuICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgIGNhdXNlZEJ5LFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NhcHR1cmVkIGNyZWF0ZSBhdWRpdCcsIHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHksXG4gICAgICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgICAgIGhhc0FjdG9yOiAhIWFjdG9yLFxuICAgICAgICB9KTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5VXBkYXRlKGVudGl0eSwgaWQsIHtcbiAgICAgICAgICAvLyBiZWZvcmU6IG9sZEltYWdlLFxuICAgICAgICAgIC8vIGFmdGVyOiBuZXdJbWFnZSxcbiAgICAgICAgICBkaWZmOiBjaGFuZ2VzXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBhY3RvcixcbiAgICAgICAgICBjYXVzZWRCeSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdDYXB0dXJlZCB1cGRhdGUgYXVkaXQnLCB7XG4gICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5LFxuICAgICAgICAgIGVudGl0eUlkOiBpZCxcbiAgICAgICAgICBjaGFuZ2VkRmllbGRzOiBPYmplY3Qua2V5cyhjaGFuZ2VzKSxcbiAgICAgICAgICBoYXNBY3RvcjogISFhY3RvcixcbiAgICAgICAgfSk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZShlbnRpdHksIGlkLCBvbGRJbWFnZSwge1xuICAgICAgICAgIGFjdG9yLFxuICAgICAgICAgIGNhdXNlZEJ5LFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0NhcHR1cmVkIGRlbGV0ZSBhdWRpdCcsIHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHksXG4gICAgICAgICAgZW50aXR5SWQ6IGlkLFxuICAgICAgICAgIGhhc0FjdG9yOiAhIWFjdG9yLFxuICAgICAgICB9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIGVudGl0eSBpbWFnZXMgd2l0aCBzdGFsZW5lc3MgZGV0ZWN0aW9uLlxuICAgKiBcbiAgICogQWN0b3IgZGF0YSBpcyBjb25zaWRlcmVkIFwiZnJlc2hcIiBpZjpcbiAgICogMS4gSXQgaGFzIGFuIGFjdG9yVGltZXN0YW1wIGZpZWxkLCBBTkRcbiAgICogMi4gVGhlIHRpbWVzdGFtcCBpcyB3aXRoaW4gdGhlIGFjY2VwdGFibGUgc3RhbGVuZXNzIHRocmVzaG9sZCAoZGVmYXVsdDogNSBzZWNvbmRzKVxuICAgKiBcbiAgICogSWYgYWN0b3IgZGF0YSBpcyBzdGFsZSwgd2Ugc2hvdWxkIE5PVCB1c2UgaXQgZm9yIGNvcnJlbGF0aW9uIGFzIGl0IHJlcHJlc2VudHNcbiAgICogYSBwcmV2aW91cyBvcGVyYXRpb24sIG5vdCB0aGUgY3VycmVudCBvbmUuXG4gICAqIFxuICAgKiBAcGFyYW0gdHJhY2VJbWFnZSAtIEVudGl0eSBpbWFnZSB0byBleHRyYWN0IGFjdG9yIGZyb21cbiAgICogQHBhcmFtIGV2ZW50VGltZXN0YW1wIC0gVGltZXN0YW1wIG9mIHRoZSBjdXJyZW50IGV2ZW50XG4gICAqIEByZXR1cm5zIE9iamVjdCBjb250YWluaW5nIGFjdG9yLCBmcmVzaG5lc3Mgc3RhdHVzLCBhbmQgc3RhbGVuZXNzIG1ldHJpY3NcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3JXaXRoU3RhbGVuZXNzQ2hlY2soXG4gICAgdHJhY2VJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBldmVudFRpbWVzdGFtcDogbnVtYmVyXG4gICk6IHtcbiAgICBhY3RvcjogQWN0b3IgfCB1bmRlZmluZWQ7XG4gICAgaXNGcmVzaDogYm9vbGVhbjtcbiAgICBhY3RvclRpbWVzdGFtcD86IG51bWJlcjtcbiAgICBzdGFsZW5lc3NNcz86IG51bWJlcjtcbiAgfSB7XG4gICAgY29uc3QgYWN0b3IgPSB0aGlzLmV4dHJhY3RBY3Rvcih0cmFjZUltYWdlKTtcblxuICAgIGlmICghYWN0b3IpIHtcbiAgICAgIHJldHVybiB7IGFjdG9yOiB1bmRlZmluZWQsIGlzRnJlc2g6IGZhbHNlIH07XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIGFjdG9yVGltZXN0YW1wIGluIF9hY3RvciBmaWVsZFxuICAgIGNvbnN0IGFjdG9yVGltZXN0YW1wID0gdHJhY2VJbWFnZT8uX2FjdG9yPy5hY3RvclRpbWVzdGFtcDtcblxuICAgIGlmICghYWN0b3JUaW1lc3RhbXApIHtcbiAgICAgIC8vIE5vIHRpbWVzdGFtcCBtZWFucyB3ZSBjYW4ndCB2ZXJpZnkgZnJlc2huZXNzXG4gICAgICAvLyBMb2cgd2FybmluZyBidXQgc3RpbGwgdXNlIHRoZSBhY3RvciAoYmFja3dhcmQgY29tcGF0aWJpbGl0eSlcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdBY3RvciBkYXRhIGhhcyBubyB0aW1lc3RhbXAsIGNhbm5vdCB2ZXJpZnkgZnJlc2huZXNzJywge1xuICAgICAgICBhY3RvcklkOiBhY3Rvci5hY3RvcklkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhY3RvcixcbiAgICAgICAgaXNGcmVzaDogdHJ1ZSwgLy8gQXNzdW1lIGZyZXNoIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIENhbGN1bGF0ZSBzdGFsZW5lc3MgKGRpZmZlcmVuY2UgYmV0d2VlbiBldmVudCB0aW1lIGFuZCBhY3RvciB0aW1lc3RhbXApXG4gICAgY29uc3Qgc3RhbGVuZXNzTXMgPSBldmVudFRpbWVzdGFtcCAtIGFjdG9yVGltZXN0YW1wO1xuXG4gICAgLy8gR2V0IHN0YWxlbmVzcyB0aHJlc2hvbGQgZnJvbSBlbnYgKGRlZmF1bHQ6IDUwMDBtcyA9IDUgc2Vjb25kcylcbiAgICBjb25zdCB0aHJlc2hvbGRNcyA9IHRoaXMuZ2V0QWN0b3JTdGFsZW5lc3NUaHJlc2hvbGQoKTtcblxuICAgIC8vIEFjdG9yIGlzIGZyZXNoIGlmIHN0YWxlbmVzcyBpcyB3aXRoaW4gdGhyZXNob2xkXG4gICAgLy8gQWxzbyBjaGVjayBmb3IgbmVnYXRpdmUgc3RhbGVuZXNzIChjbG9jayBza2V3KSBhbmQgYWxsb3cgc21hbGwgbmVnYXRpdmUgdmFsdWVzXG4gICAgY29uc3QgaXNGcmVzaCA9IHN0YWxlbmVzc01zID49IC0xMDAwICYmIHN0YWxlbmVzc01zIDw9IHRocmVzaG9sZE1zO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdG9yLFxuICAgICAgaXNGcmVzaCxcbiAgICAgIGFjdG9yVGltZXN0YW1wLFxuICAgICAgc3RhbGVuZXNzTXMsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBlbnRpdHkgaW1hZ2VzLlxuICAgKiBUcmllcyBfYWN0b3IgZmllbGQgZmlyc3QsIHRoZW4gZmFsbHMgYmFjayB0byB2aXNpYmxlIGFjdG9yIGZpZWxkcy5cbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0QWN0b3IodHJhY2VJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCk6IEFjdG9yIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBUcnkgX2FjdG9yIGZpZWxkIGZpcnN0IChzZXQgYnkgY3J1ZC1zZXJ2aWNlKVxuICAgIGNvbnN0IGFjdG9yQ29udGV4dCA9IHRyYWNlSW1hZ2U/Ll9hY3RvcjtcbiAgICBpZiAoYWN0b3JDb250ZXh0KSB7XG4gICAgICByZXR1cm4gYWN0b3JDb250ZXh0IGFzIEFjdG9yO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIChiYWNrd2FyZCBjb21wYXRpYmlsaXR5KVxuICAgIGNvbnN0IGZhbGxiYWNrQWN0b3I6IFBhcnRpYWw8QWN0b3I+ID0ge307XG5cbiAgICBjb25zdCBhY3RvcklkID0gdHJhY2VJbWFnZT8udXBkYXRlZEJ5IHx8IHRyYWNlSW1hZ2U/LmNyZWF0ZWRCeTtcbiAgICBpZiAoYWN0b3JJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci5hY3RvcklkID0gYWN0b3JJZDtcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRJZCA9IHRyYWNlSW1hZ2U/LnRlbmFudElkO1xuICAgIGlmICh0ZW5hbnRJZCkge1xuICAgICAgZmFsbGJhY2tBY3Rvci50ZW5hbnRJZCA9IHRlbmFudElkO1xuICAgIH1cblxuICAgIC8vIFJldHVybiBmYWxsYmFjayBpZiB3ZSBoYXZlIGFueSBpbmZvLCBvdGhlcndpc2UgdW5kZWZpbmVkIChsZXQgb2JzZXJ2YWJpbGl0eSB1c2UgY29udGV4dClcbiAgICByZXR1cm4gT2JqZWN0LmtleXMoZmFsbGJhY2tBY3RvcikubGVuZ3RoID4gMFxuICAgICAgPyB7IC4uLmZhbGxiYWNrQWN0b3IsIGFjdG9yVHlwZTogJ3VzZXInIH0gYXMgQWN0b3JcbiAgICAgIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhY3RvciBzdGFsZW5lc3MgdGhyZXNob2xkIGZyb20gZW52aXJvbm1lbnQuXG4gICAqIERlZmF1bHQ6IDUwMDBtcyAoNSBzZWNvbmRzKVxuICAgKi9cbiAgcHJvdGVjdGVkIGdldEFjdG9yU3RhbGVuZXNzVGhyZXNob2xkKCk6IG51bWJlciB7XG4gICAgY29uc3QgdGhyZXNob2xkID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBBVURJVF9FTlZfS0VZUy5BQ1RPUl9TVEFMRU5FU1NfVEhSRVNIT0xEX01TIH0pO1xuICAgIHJldHVybiB0aHJlc2hvbGQgPyBwYXJzZUludCh0aHJlc2hvbGQsIDEwKSA6IDUwMDA7XG4gIH1cblxufVxuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdEeW5hbW9EQlN0cmVhbUhhbmRsZXInKTtcbiJdfQ==