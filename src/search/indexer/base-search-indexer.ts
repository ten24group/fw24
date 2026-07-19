import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';

import { BaseSQSEventProcessor } from '../../core/runtime/event-processor/base-sqs-event-processor';
import { BaseEventRecord, IEventDataExtractor } from '../../core/types/event-processor-types';
import { resolveEnvValueFor } from '../../utils';
import { BaseSearchEngine } from '../engines/base';
import { SearchEngineError, SearchValidationError } from '../errors';
import { makeEntitySearchIndexName } from '../search-utils';
import { SEARCH_INDEXER_ENV_KEYS, SearchIndexEntry } from './interfaces';
import { BatchProgress } from '../../observability/utils/batch-progress';

export abstract class BaseSearchIndexer<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends BaseSQSEventProcessor<T> {

  abstract searchEngine: BaseSearchEngine;


  // override this to provide a list of allowed entity names
  protected getAllowedEntityNames(): string[] | undefined {
    return undefined;
  }

  // override this to provide a list of excluded entity names
  protected getExcludedEntityNames(): string[] | undefined {
    return undefined;
  }

  /**
   * Determines if an entity should be indexed based on allowed/excluded lists.
   * Override in subclasses to implement custom logic.
   * Default behavior: index all except system entities.
   */
  protected shouldIndexEntity(entityName: string): boolean {
    const allowedEntityNames = this.getAllowedEntityNames();
    const excludedEntityNames = this.getExcludedEntityNames();

    // Excluded list ALWAYS wins (safer default).
    if (excludedEntityNames && excludedEntityNames.length > 0 && excludedEntityNames.includes(entityName)) {
      return false;
    }

    // If allowedEntityNames is provided, restrict indexing to that list.
    if (allowedEntityNames && allowedEntityNames.length > 0) {
      return allowedEntityNames.includes(entityName);
    }

    // Otherwise, if excludedEntityNames is provided, index all except excluded (already handled above).
    if (excludedEntityNames && excludedEntityNames.length > 0) {
      return true;
    }

    // Default behavior: index all entities
    return true;
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

    if (!this.shouldIndexEntity(entityName)) {
      const allowedEntityNames = this.getAllowedEntityNames();
      const excludedEntityNames = this.getExcludedEntityNames();
      this.logger.warn('Skipping search indexing for entity based on filtering rules', {
        entityName,
        allowedEntityNames,
        excludedEntityNames
      });
      return null;
    }

    return record;
  }

  // Implementation for per-record processing
  protected override async processRecord(record: BaseEventRecord<TPayload>): Promise<void> {
    const startTime = Date.now();
    const { entityName, eventType, entityId } = record;

    this.logger.info('Processing single record for search indexing', { entityName, eventType, entityId });

    const searchIndexEntry = this.createSearchIndexEntry(record);
    await this.indexOrDeleteDocument(searchIndexEntry);

    const duration = Date.now() - startTime;
    this.logger.info('Single record processing completed', { entityName, eventType, entityId, durationMs: duration });
  }

  // Implementation for batch processing
  protected override async processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void> {
    // Group by entityName and eventType to minimize engine calls
    const groups = new Map<string, BaseEventRecord<TPayload>[]>();

    for (const rec of records) {
      const key = `${rec.entityName || ''}|${rec.eventType}`;
      const arr = groups.get(key) || [];
      arr.push(rec);
      groups.set(key, arr);
    }

    // Hot path: only a cheap summary at debug. The old per-group `groupDetails` array was built on
    // EVERY batch (arguments are evaluated before the log call, so even a suppressed debug paid for it)
    // and added no value at the volume the stream/indexer runs at.
    this.logger.debug('Records grouped for batch processing', {
      totalGroups: groups.size,
      totalRecords: records.length,
    });

    // Process each group using BatchProgress
    for (const [ key, groupRecords ] of groups.entries()) {
      const [ entityName, eventType ] = key.split('|');

      if (![ 'create', 'update', 'delete' ].includes(eventType)) {
        this.logger.warn('Skipping unknown event type', { eventType, count: groupRecords.length });
        continue;
      }

      const indexName = this.getIndexName(entityName);

      try {
        await this.ensureIndexExists(indexName);
      } catch (error) {
        this.logger.error('Index does not exist, skipping group', { indexName, entityName, error });
        continue;
      }

      if (eventType === 'delete') {
        await this.processBatchDelete(groupRecords, indexName, entityName);
      } else {
        await this.processBatchIndex(groupRecords, indexName, entityName);
      }
    }
  }

  /**
   * Process batch index using BatchProgress.chunk
   */
  private async processBatchIndex(
    records: BaseEventRecord<TPayload>[],
    indexName: string,
    entityName: string
  ): Promise<void> {
    // Transform records to documents
    interface DocWithId { doc: any; id: string }
    const docs: DocWithId[] = [];
    const nowIso = new Date().toISOString();

    for (const record of records) {
      const searchIndexEntry = this.createSearchIndexEntry(record);
      const transformedData = searchIndexEntry.data;

      const items: any[] = Array.isArray(transformedData)
        ? transformedData
        : (Array.isArray(transformedData?.items) ? transformedData.items : [ transformedData ]);

      for (const item of items) {
        const id = item?.id || item?.[ `${entityName}Id` ] || (record.entityId as string | undefined);
        if (!id) {
          this.logger.warn('Skipping item without id', { entityName });
          continue;
        }

        const doc = item?.id ? { ...item } : { ...item, id };
        if (!doc._indexedAt) {
          doc._indexedAt = nowIso;
        }
        docs.push({ doc, id });
      }
    }

    if (docs.length === 0) {
      this.logger.info('No documents to index', { entityName, indexName });
      return;
    }

    // Index in chunks (default 25 docs per batch)
    await BatchProgress.chunk(
      `Index ${entityName}`,
      docs,
      async (chunk) => {
        const docsToIndex = chunk.map(c => c.doc);
        await this.searchEngine.indexDocuments(docsToIndex, { indexName }, false);
        return chunk.map(c => c.id);
      },
      { tags: { entity: entityName } }
    );
  }

  /**
   * Process batch delete using chunked deletion.
   */
  private async processBatchDelete(
    records: BaseEventRecord<TPayload>[],
    indexName: string,
    entityName: string
  ): Promise<void> {
    // Extract IDs from records that have entityId
    const ids = records
      .filter(r => r.entityId)
      .map(r => r.entityId as string);

    if (ids.length === 0) {
      this.logger.info('No records with entityId to delete', { entityName });
      return;
    }

    // Delete in chunks (default 25 IDs per batch)
    await BatchProgress.chunk(
      `Delete ${entityName}`,
      ids,
      async (chunk) => {
        await this.searchEngine.deleteDocuments(chunk, indexName, false);
        return chunk;
      },
      { tags: { entity: entityName } }
    );
  }

  // Helper method to create SearchIndexEntry from a record
  protected createSearchIndexEntry(record: BaseEventRecord<TPayload>): SearchIndexEntry {
    const { entityName, eventType, entityId, timestamp, payload: payloadData, metadata } = record;

    // Extract searchable data based on the source type
    const searchableData = this.transformPayloadForIndexing(payloadData, eventType, metadata?.source);

    // Note: timestamp is already in milliseconds (converted from DynamoDB seconds in the data extractor)
    // Example: timestamp = 1734567890000 (milliseconds) -> "2024-12-19T10:31:30.000Z"
    return {
      id: entityId as string,
      data: searchableData,
      eventType: eventType as 'create' | 'update' | 'delete',
      timestamp: (timestamp ? new Date(timestamp) : new Date()).toISOString(),
      entityName: entityName as string,
    };
  }

  /**
   * Transform payload data for search indexing based on source type
   * Override this method in subclasses for custom data transformation
   */
  protected transformPayloadForIndexing(payloadData: any, eventType: string, source?: string): any {
    // For stream sources, payload is ChangeStreamPayload format
    if (source === 'stream' && payloadData && typeof payloadData === 'object' &&
      ('oldImage' in payloadData || 'newImage' in payloadData || 'keys' in payloadData)) {
      const { oldImage, newImage } = payloadData;
      return this.extractSearchableDataFromChangeStream(oldImage, newImage, eventType);
    }

    // Handle array payloads - add _indexedAt to each item
    if (Array.isArray(payloadData)) {
      return payloadData.map(item => ({
        ...item,
        _indexedAt: new Date().toISOString()
      }));
    }

    // For single object payloads, use payload directly
    return {
      ...payloadData,
      _indexedAt: new Date().toISOString()
    };
  }

  /**
   * Extract searchable data from DynamoDB change stream format
   * Override this method in subclasses for custom field filtering
   */
  protected extractSearchableDataFromChangeStream(
    oldImage: Record<string, any> | undefined,
    newImage: Record<string, any> | undefined,
    eventType: string
  ): any {
    // For deletions, we only need the ID to remove from index
    if (eventType === 'delete') {
      return { id: oldImage?.id };
    }

    // For creates and updates, use the new image
    const sourceData = newImage || oldImage;
    if (!sourceData) {
      return null;
    }

    // Remove DynamoDB internal fields and prepare for search indexing
    const ignoredKeys = [
      '__EDB_E__', '__EDB_V__', 'PK', 'SK',
      'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
      'PASSWORD'
    ];

    const searchableData: Record<string, any> = { ...sourceData };

    Object.keys(sourceData).forEach(key => {
      if (ignoredKeys.includes(key.toUpperCase()) ||
        key.startsWith('__') ||
        (key.length > 3 && [ 'GSI', 'LSI' ].includes(key.substring(0, 3).toUpperCase()))) {
        delete searchableData[ key ];
      }
    });

    return {
      ...searchableData,
      _indexedAt: new Date().toISOString()
    };
  }

  protected async indexOrDeleteDocument(searchIndexEntry: SearchIndexEntry): Promise<void> {
    const { entityName, eventType, data, id } = searchIndexEntry;

    this.logger.info('Processing search index operation', { entityName, eventType, id });

    const indexName = this.getIndexName(entityName);

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

  protected getIndexName(entityName: string): string {
    const tableNameKey = resolveEnvValueFor({ key: SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY });
    this.logger.debug('tableNameKey', { tableNameKey });
    if (!tableNameKey) {
      throw new SearchValidationError(`${SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY} environment variable is required to calculate the appropriate index-name`);
    }

    const tableName = resolveEnvValueFor({ key: tableNameKey, suffix: 'table' });
    this.logger.debug('tableName', { tableName });

    if (!tableName) {
      throw new SearchValidationError(`${tableName} environment variable is required to calculate the appropriate index-name`);
    }

    const indexName = makeEntitySearchIndexName({ tableName, entityName });

    return indexName;
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