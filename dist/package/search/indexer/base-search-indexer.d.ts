import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { BaseEventRecord, IEventDataExtractor } from '../../core/types/event-processor-types';
import { BaseSearchEngine } from '../engines/base';
import { SearchIndexEntry } from './interfaces';
export declare abstract class BaseSearchIndexer<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends BaseSQSEventProcessor<T> {
    abstract searchEngine: BaseSearchEngine;
    protected getAllowedEntityNames(): string[] | undefined;
    protected preprocessRecord(record: BaseEventRecord<any>): Promise<BaseEventRecord<any> | null>;
    protected processRecord(record: BaseEventRecord<TPayload>): Promise<void>;
    protected processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;
    private createSearchIndexEntry;
    /**
     * Transform payload data for search indexing based on source type
     * Override this method in subclasses for custom data transformation
     */
    protected transformPayloadForIndexing(payloadData: any, eventType: string, source?: string): any;
    /**
     * Extract searchable data from DynamoDB change stream format
     * Override this method in subclasses for custom field filtering
     */
    protected extractSearchableDataFromChangeStream(oldImage: Record<string, any> | undefined, newImage: Record<string, any> | undefined, eventType: string): any;
    protected indexOrDeleteDocument(searchIndexEntry: SearchIndexEntry): Promise<void>;
    protected getIndexName(entityName: string): string;
    protected ensureIndexExists(indexName: string): Promise<void>;
    protected indexDocumentData(indexName: string, data: any, id: string): Promise<void>;
    protected deleteDocument(indexName: string, id: string): Promise<void>;
}
