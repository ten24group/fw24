import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';

import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { createLogger } from '../../logging';
import { resolveEnvValueFor } from '../../utils';
import { AUDIT_ENV_KEYS } from '../interfaces';
import { AuditObserver } from '../../observability';
import { Actor } from '../../core/types/execution-context';
import { getChangedProperties } from '../helpers/change-detection';

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
export class DynamoDBStreamAuditLogger extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {
  constructor() {
    // Use 'batch' mode to avoid creating per-record wrapper spans
    // Audit logs are the primary signal - we don't need intermediate spans for each record
    super(new DynamoDBEventDataExtractor(), { processMode: 'batch' });
  }

  async initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
    // No initialization needed - AuditObserver is ready to use
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
   * - If neither is provided, audit all except 'auditLog' and 'observabilityLog' (default behavior)
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
    return entityName !== 'auditLog' && entityName !== 'observabilityLog';
  }

  protected async preprocessRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<BaseEventRecord<ChangeStreamPayload> | null> {
    const { entityName, eventType } = record;

    if (![ 'create', 'update', 'delete' ].includes(eventType)) {
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

  protected async processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {
    await this.captureAuditEvent(record);
  }

  protected async processRecordsBatch(records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void> {
    for (const record of records) {
      await this.captureAuditEvent(record);
    }
  }

  /**
   * Capture audit event using the observability system.
   * Passes maximum data: before image, after image, and computed diff.
   */
  protected async captureAuditEvent(record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {
    const { entityName, eventType, timestamp, entityId, payload: { newImage, oldImage } } = record;

    // Compute changes (diff between old and new)
    const changes = getChangedProperties(oldImage, newImage);

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
    const entity = entityName!;
    const id = String(entityId);

    // Call appropriate AuditObserver method based on event type
    // Explicitly link the Audit Log to the original API Request that caused the change.
    switch (eventType) {
      case 'create':
        AuditObserver.entityCreate(entity, id, newImage, {
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
        AuditObserver.entityUpdate(entity, id, {
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
        AuditObserver.entityDelete(entity, id, oldImage, {
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
  protected extractActorWithStalenessCheck(
    traceImage: Record<string, any> | undefined,
    eventTimestamp: number
  ): {
    actor: Actor | undefined;
    isFresh: boolean;
    actorTimestamp?: number;
    stalenessMs?: number;
  } {
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
  protected extractActor(traceImage: Record<string, any> | undefined): Actor | undefined {
    // Try _actor field first (set by crud-service)
    const actorContext = traceImage?._actor;
    if (actorContext) {
      return actorContext as Actor;
    }

    // Fallback to visible actor fields (backward compatibility)
    const fallbackActor: Partial<Actor> = {};

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
      ? { ...fallbackActor, actorType: 'user' } as Actor
      : undefined;
  }

  /**
   * Get actor staleness threshold from environment.
   * Default: 5000ms (5 seconds)
   */
  protected getActorStalenessThreshold(): number {
    const threshold = resolveEnvValueFor({ key: AUDIT_ENV_KEYS.ACTOR_STALENESS_THRESHOLD_MS });
    return threshold ? parseInt(threshold, 10) : 5000;
  }

}

export const logger = createLogger('DynamoDBStreamHandler');
