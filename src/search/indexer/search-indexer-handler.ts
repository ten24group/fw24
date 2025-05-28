import { type DynamoDBRecord } from 'aws-lambda';
import { type AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

import { BaseDynamoDBStreamHandler, EVENT_TYPE_MAP } from '../../core/runtime/base-dynamodb-stream-handler';
import { MeiliSearchEngine } from '../engines/meili/engine';
import { resolveEnvValueFor } from '../../utils';
import { SEARCH_INDEXER_ENV_KEYS, SearchIndexEntry } from './interfaces';
import { makeEntitySearchIndexName } from '../search-utils';
import { SearchEngineError } from '../errors';

/**
 * Search indexer handler for MeiliSearch
 */
export class DefaultSearchIndexerHandler extends BaseDynamoDBStreamHandler {

  private searchEngine!: MeiliSearchEngine;
  private isEnabled: boolean = false;

  protected async initialize(_event: any): Promise<void> {
    const enabled = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.ENABLED });
    this.isEnabled = enabled === 'true';

    if (!this.isEnabled) {
      this.logger.debug('Search indexing is disabled');
      return;
    }

    const host = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.MEILI_HOST });
    const masterKey = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY });

    if (!host) {
      throw new Error('MEILI_HOST environment variable is required');
    }

    this.searchEngine = new MeiliSearchEngine({
      host,
      apiKey: masterKey
    });

    const health = await this.searchEngine.health();
    this.logger.info('MeiliSearch health', { health });

    this.logger.debug('Search indexer initialized', { host });
  }

  protected async processRecord(record: DynamoDBRecord): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    if (!record.dynamodb) {
      this.logger.warn('Record does not contain DynamoDB data', { record });
      return;
    }

    const eventName = record.eventName;
    const eventType = EVENT_TYPE_MAP[ eventName as keyof typeof EVENT_TYPE_MAP ];
    if (!eventName || !eventType) {
      this.logger.warn('Unknown event type', { eventName });
      return;
    }

    // Get the old and new images of the record
    const oldImage = record.dynamodb.OldImage
      ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>)
      : undefined;
    const newImage = record.dynamodb.NewImage
      ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
      : undefined;

    // Get entity name from __edb_e__
    const entityName = (newImage?.__edb_e__ || oldImage?.__edb_e__) as string;
    if (!entityName) {
      this.logger.warn('No entity name found in record', { record });
      return;
    }

    // Skip indexing audit logs and search index entries themselves
    if (entityName === 'auditLog' || entityName.includes('search-index')) {
      this.logger.debug('Skipping search indexing for system entity', { entityName });
      return;
    }

    const entityId = (newImage?.id || oldImage?.id) as string;

    if (!entityId) {
      this.logger.warn('No entity ID found in record', { record });
      return;
    }

    // Extract data for search indexing
    const searchableData = this.extractSearchableData(oldImage, newImage, eventType);

    // Create search index entry
    const searchIndexEntry: SearchIndexEntry = {
      entityName,
      eventType,
      data: searchableData,
      id: entityId,
      timestamp: new Date().toISOString(),
      version: 'v1' // Can be made configurable
    };

    await this.indexDocument(searchIndexEntry);
  }

  private extractSearchableData(
    oldImage: Record<string, any> | undefined,
    newImage: Record<string, any> | undefined,
    eventType: string
  ) {

    // For deletions, we only need the ID to remove from index
    if (eventType === 'delete') {
      this.logger.debug('Deleting document', { oldImage });
      return { id: oldImage?.id };
    }

    // For creates and updates, use the new image
    const sourceData = newImage || oldImage;
    if (!sourceData) {
      this.logger.warn('No source data found', { oldImage, newImage });
      return null;
    }

    // Remove DynamoDB internal fields and prepare for search indexing
    const {
      __edb_e__,
      __edb_v__,
      pk,
      sk,
      GSI1PK,
      GSI1SK,
      GSI2PK,
      GSI2SK,
      GSI3PK,
      GSI3SK,
      ...searchableData
    } = sourceData;

    return {
      ...searchableData,
      // Add a searchable timestamp if not present
      _indexedAt: new Date().toISOString()
    };

  }
  private async indexDocument(searchIndexEntry: SearchIndexEntry): Promise<void> {
    const { entityName, eventType, data, id, version } = searchIndexEntry;

    this.logger.debug('Processing search index operation', { entityName, eventType, id });

    // TODO: additional context like tenant, env, app-name etc.
    const indexName = makeEntitySearchIndexName({ entityName, version });

    try {

      // Ensure the index exists
      // we won't be able to create an index here as we do-not have access to entity-index config.. 
      // indexes are supposed to be setup by the application; 
      // TODO: add support for setting up indices in application code
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

      this.logger.debug('Successfully processed search index operation', { indexName, eventType, id });

    } catch (error) {

      this.logger.error('Error processing search index operation', { error, indexName, eventType, id });

      throw error;
    }
  }

  private async ensureIndexExists(indexName: string): Promise<void> {

    const exists = await this.searchEngine.indexExists(indexName);

    if (!exists) {
      throw new SearchEngineError(`Index ${indexName} does not exist`, { indexName });
    }
  }

  private async indexDocumentData(indexName: string, data: any, id: string): Promise<void> {
    if (!data || !data.id) {
      // Ensure the document has an ID
      data = { ...data, id };
    }

    await this.searchEngine.indexDocuments([ data ], { indexName }, false);
    this.logger.debug('Document indexed successfully', { indexName, id });
  }

  private async deleteDocument(indexName: string, id: string): Promise<void> {
    await this.searchEngine.deleteDocuments([ id ], indexName, false);
    this.logger.debug('Document deleted successfully', { indexName, id });
  }
}

/**
 * Default search indexer handler export for framework usage
 */
export const handler = DefaultSearchIndexerHandler.CreateHandler(DefaultSearchIndexerHandler); 