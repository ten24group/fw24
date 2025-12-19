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
    super(new DynamoDBEventDataExtractor());
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

    // For updates, skip if no actual changes detected
    if (eventType === 'update' && Object.keys(changes).length === 0) {
      this.logger.debug('No changes detected, skipping audit entry', { entityName, entityId });
      return;
    }

    // Extract actor context
    const actor = this.extractActor(newImage);

    // entityName is guaranteed by preprocessRecord check
    const entity = entityName!;
    const id = String(entityId);

    // Get original correlationId from _actor to link back to causing request
    const originalCorrelationId = newImage?._actor?.correlationId;

    // Call appropriate AuditObserver method based on event type
    // Explicitly link the Audit Log to the original API Request that caused the change.
    // This allows queries like "Show me all Audit Logs caused by Request X".
    switch (eventType) {
      case 'create':
        AuditObserver.entityCreate(entity, id, newImage, {
          actor,
          causedBy: originalCorrelationId,  // Original API request trace
        });
        this.logger.debug('Captured create audit', {
          entityName: entity,
          entityId: id,
          causedBy: originalCorrelationId
        });
        break;

      case 'update':
        AuditObserver.entityUpdate(entity, id, {
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
        AuditObserver.entityDelete(entity, id, oldImage, {
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
  protected extractActor(newImage: Record<string, any> | undefined): Actor | undefined {
    // Try _actor field first (set by crud-service)
    const actorContext = newImage?._actor;
    if (actorContext) {
      return actorContext as Actor;
    }

    // Fallback to visible actor fields (backward compatibility)
    const fallbackActor: Partial<Actor> = {};

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
      ? { ...fallbackActor, actorType: 'user' } as Actor
      : undefined;
  }

}

export const logger = createLogger('DynamoDBStreamHandler');
