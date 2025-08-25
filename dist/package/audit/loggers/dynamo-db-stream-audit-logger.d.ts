import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { AuditEntry, IAuditLogger } from '../interfaces';
/**
 * Default audit handler that extends BaseSQSEventProcessor
 * Custom audit handlers can extend this to add custom processing while reusing framework utilities
 */
export declare class DynamoDBStreamAuditLogger extends BaseSQSEventProcessor<DynamoDBEventDataExtractor> {
    private auditLogger?;
    constructor();
    initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void>;
    protected initializeAuditLogger(): void;
    protected getAuditLogger(): IAuditLogger;
    protected getAllowedEntityNames(): string[] | undefined;
    protected preprocessRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<BaseEventRecord<ChangeStreamPayload> | null>;
    protected processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void>;
    protected processRecordsBatch(records: BaseEventRecord<ChangeStreamPayload>[]): Promise<void>;
    protected makeAuditEntry(record: BaseEventRecord<ChangeStreamPayload>): AuditEntry | undefined;
    protected writeAuditEntry(auditEntry: AuditEntry): Promise<void>;
}
export declare const logger: import("tslog").Logger<import("tslog").ILogObj>;
/**
 * Main entry point for change detection
 */
export declare function getChangedProperties(oldImage: Record<string, any> | undefined, newImage: Record<string, any> | undefined, ignoredFields?: string[]): Record<string, {
    old?: any;
    new?: any;
}>;
