import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { Actor } from '../../core/types/execution-context';
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
export declare class DynamoDBStreamAuditLogger extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {
    constructor();
    initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void>;
    protected getAllowedEntityNames(): string[] | undefined;
    protected getExcludedEntityNames(): string[] | undefined;
    /**
     * Determines if an entity should be audited based on allowed/excluded lists.
     * Logic:
     * - If allowedEntityNames is provided, only audit entities in that list
     * - If excludedEntityNames is provided (and no allowedEntityNames), audit all except excluded
     * - If neither is provided, audit all except 'auditLog' and 'observabilityLog' (default behavior)
     * - allowedEntityNames takes precedence over excludedEntityNames
     */
    protected shouldAuditEntity(entityName: string): boolean;
    protected preprocessRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<BaseEventRecord<ChangeStreamPayload> | null>;
    protected processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void>;
    protected processRecordsBatch(records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void>;
    /**
     * Capture audit event using the observability system.
     * Passes maximum data: before image, after image, and computed diff.
     */
    protected captureAuditEvent(record: BaseEventRecord<ChangeStreamPayload>): Promise<void>;
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
    protected extractActorWithStalenessCheck(traceImage: Record<string, any> | undefined, eventTimestamp: number): {
        actor: Actor | undefined;
        isFresh: boolean;
        actorTimestamp?: number;
        stalenessMs?: number;
    };
    /**
     * Extract actor context from entity images.
     * Tries _actor field first, then falls back to visible actor fields.
     */
    protected extractActor(traceImage: Record<string, any> | undefined): Actor | undefined;
    /**
     * Get actor staleness threshold from environment.
     * Default: 5000ms (5 seconds)
     */
    protected getActorStalenessThreshold(): number;
}
export declare const logger: import("tslog").Logger<import("tslog").ILogObj>;
