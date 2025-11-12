import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { DynamoDBEventDataExtractor } from '../../core/runtime/event-processor/dynamodb-event-data-extractor';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { resolveEnvValueFor } from '../../utils';
import { MeiliSearchEngine } from '../engines/meili/engine';
import { SearchValidationError } from '../errors';
import { BaseSearchIndexer } from './base-search-indexer';
import { SEARCH_INDEXER_ENV_KEYS, SearchIndexEntry } from './interfaces';
import { RateLimitedApiKey } from 'aws-cdk-lib/aws-apigateway';

/**
 * Search indexer handler [for MeiliSearch]
 */
export class DynamoDBStreamSearchIndexer extends BaseSearchIndexer<DynamoDBEventDataExtractor> {

  searchEngine!: MeiliSearchEngine;
  private isEnabled: boolean = false;

  constructor() {
    super(new DynamoDBEventDataExtractor());
  }

  protected getAllowedEntityNames(): string[] | undefined {
    const allowedEntityNames = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.ALLOWED_ENTITY_NAMES });
    return allowedEntityNames ? allowedEntityNames.split(',') : undefined;
  }

  protected override getExcludedEntityNames(): string[] | undefined {
    const excludedEntityNames = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.EXCLUDED_ENTITY_NAMES });
    return excludedEntityNames ? excludedEntityNames.split(',') : undefined;
  }

  async initialize(_event: DynamoDBStreamEvent | SQSEvent): Promise<void> {
    const enabled = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.ENABLED });
    this.isEnabled = enabled === 'true';

    if (!this.isEnabled) {
      this.logger.info('Search indexing is disabled');
      return;
    }

    const host = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.MEILI_HOST });
    const masterKey = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY });

    if (!host) {
      throw new SearchValidationError(`${SEARCH_INDEXER_ENV_KEYS.MEILI_HOST} environment variable is required for search indexing`);
    }

    this.searchEngine = new MeiliSearchEngine({
      host,
      apiKey: masterKey
    });

    const health = await this.searchEngine.health();
    this.logger.info('MeiliSearch health', { health });

    this.logger.info('Search indexer initialized', { host });
  }

  protected async processRecord(record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {
    if (!this.isEnabled) {
      this.logger.info('Skipping search indexing as it is disabled');
      return;
    }

    const { entityName, eventType, entityId, timestamp, payload: { newImage, oldImage } } = record;

    this.logger.info('Processing search index operation: extractSearchableData', { entityName, eventType, entityId });

    // Extract data for search indexing
    const searchableData = this.extractSearchableData(oldImage, newImage, eventType);

    // Create search index entry
    // Note: timestamp is already in milliseconds (converted from DynamoDB seconds in the data extractor)
    // Example: timestamp = 1734567890000 (milliseconds) -> "2024-12-19T10:31:30.000Z"
    const searchIndexEntry: SearchIndexEntry = {
      id: entityId as string,
      data: searchableData,
      eventType: eventType as 'create' | 'update' | 'delete',
      timestamp: (timestamp ? new Date(timestamp) : new Date()).toISOString(),
      entityName: entityName as string,
    };

    this.logger.info('Processing search index operation: indexDocument', { searchIndexEntry });

    await this.indexOrDeleteDocument(searchIndexEntry);
  }

  private extractSearchableData(
    oldImage: Record<string, any> | undefined,
    newImage: Record<string, any> | undefined,
    eventType: string
  ) {

    // For deletions, we only need the ID to remove from index
    if (eventType === 'delete') {
      this.logger.info('Deleting document', { oldImage });
      return { id: oldImage?.id };
    }

    // For creates and updates, use the new image
    const sourceData = newImage || oldImage;
    if (!sourceData) {
      this.logger.warn('No source data found', { oldImage, newImage });
      return null;
    }

    // Remove DynamoDB internal fields and prepare for search indexing
    const ignoredKeys = [
      '__EDB_E__',
      '__EDB_V__',
      'PK',
      'SK',
      'GSI1PK',
      'GSI1SK',
      'GSI2PK',
      'GSI2SK',
      'PASSWORD'
    ];

    const searchableData: Record<string, any> = {
      ...sourceData,
      // Add a searchable timestamp if not present
      _indexedAt: new Date().toISOString()
    };

    Object.keys(sourceData).forEach(key => {

      if (ignoredKeys.includes(key.toUpperCase())) {
        delete searchableData[ key ];
      }

      if (key.startsWith('__')) {
        delete searchableData[ key ];
      }

      if (key.length > 3) {
        const first3Chars = key.substring(0, 3).toUpperCase();
        if (first3Chars === 'GSI' || first3Chars === 'LSI') {
          delete searchableData[ key ];
        }
      }
    });

    return {
      ...searchableData,
      // Add a searchable timestamp if not present
      _indexedAt: new Date().toISOString()
    };

  }
}