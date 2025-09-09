import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { MeiliSearchEngine } from '../engines/meili/engine';
import { BaseSearchIndexer } from './base-search-indexer';
/**
 * Search indexer handler [for MeiliSearch]
 */
export declare class DynamoDBStreamSearchIndexer extends BaseSearchIndexer<DynamoDBEventDataExtractor> {
    searchEngine: MeiliSearchEngine;
    private isEnabled;
    constructor();
    protected getAllowedEntityNames(): string[] | undefined;
    protected getIgnoredEntityNames(): string[] | undefined;
    initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void>;
    protected processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void>;
    private extractSearchableData;
}
