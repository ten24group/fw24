import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';

import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { BaseEventRecord, IEventDataExtractor } from '../../core/types/event-processor-types';
import { resolveEnvValueFor } from '../../utils';
import { BaseSearchEngine } from '../engines/base';
import { SearchEngineError, SearchValidationError } from '../errors';
import { makeEntitySearchIndexName } from '../search-utils';
import { SEARCH_INDEXER_ENV_KEYS, SearchIndexEntry } from './interfaces';

export abstract class BaseSearchIndexer<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends BaseSQSEventProcessor<T> {

  abstract searchEngine: BaseSearchEngine;


  // override this to provide a list of allowed entity names
  protected getAllowedEntityNames(): string[] | undefined {
    return undefined;
  }

  protected async preprocessRecord(record: BaseEventRecord<any>): Promise<BaseEventRecord<any> | null> {

    const { entityName, eventType } = record;

    if (![ 'create', 'update', 'delete' ].includes(eventType)) {
      this.logger.warn('Skipping record with unsupported event type', { eventType });
      return null;
    }

    if (!entityName) {
      this.logger.warn('Skipping record with no entity name', { record });
      return null;
    }

    const allowedEntityNames = this.getAllowedEntityNames();

    if (allowedEntityNames && allowedEntityNames.length > 0) {

      if (!allowedEntityNames.includes(entityName)) {
        this.logger.warn('Skipping search indexing for entity not in allowed list', { entityName, allowedEntityNames });
        return null;
      }

    } else if (entityName === 'auditLog' || entityName.includes('search-index')) {

      this.logger.warn('Skipping search indexing for system entity', { entityName });
      return null;
    }

    return record;
  }

  protected async indexOrDeleteDocument(searchIndexEntry: SearchIndexEntry): Promise<void> {
    const { entityName, eventType, data, id } = searchIndexEntry;

    this.logger.info('Processing search index operation', { entityName, eventType, id });

    const tableNameKey = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY });
    this.logger.info('tableNameKey', { tableNameKey });
    if (!tableNameKey) {
      throw new SearchValidationError(`${SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY} environment variable is required to calculate the appropriate index-name`);
    }

    const tableName = resolveEnvValueFor({ key: tableNameKey, suffix: 'table' });
    this.logger.info('tableName', { tableName });

    if (!tableName) {
      throw new SearchValidationError(`${tableName} environment variable is required to calculate the appropriate index-name`);
    }

    const indexName = makeEntitySearchIndexName({ tableName, entityName });

    try {
      // Ensure the index exists
      // we won't be able to create an index here as we do-not have access to entity-index config.. 
      // indexes are supposed to be setup by the application; 
      await this.ensureIndexExists(indexName);

      // Handle different event types
      switch (eventType) {
        case 'create':
        case 'update':
          await this.indexDocumentData(indexName, data, id);
          break;
        case 'delete':
          await this.deleteDocument(indexName, id);
          break;
        default:
          this.logger.warn('Unknown event type', { eventType });
          return;
      }

      this.logger.info('Successfully processed search index operation', { indexName, eventType, id });

    } catch (error) {

      this.logger.error('Error processing search index operation', { error, indexName, eventType, id });

      throw error;
    }
  }

  protected async ensureIndexExists(indexName: string): Promise<void> {
    const exists = await this.searchEngine.indexExists(indexName);
    if (!exists) {
      throw new SearchEngineError(`Index ${indexName} does not exist`, { indexName });
    }
  }

  protected async indexDocumentData(indexName: string, data: any, id: string): Promise<void> {
    if (!data || !data.id) {
      // Ensure the document has an ID
      data = { ...data, id };
    }

    await this.searchEngine.indexDocuments([ data ], { indexName }, false);
    this.logger.info('Document indexed successfully', { indexName, id });
  }

  protected async deleteDocument(indexName: string, id: string): Promise<void> {
    await this.searchEngine.deleteDocuments([ id ], indexName, false);
    this.logger.info('Document deleted successfully', { indexName, id });
  }

}