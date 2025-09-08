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
    const startTime = Date.now();
    this.logger.info('Starting batch search indexing', { recordCount: records.length });
    
    // Group by entityName and eventType to minimize engine calls
    const groups = new Map<string, BaseEventRecord<TPayload>[]>();

    for (const rec of records) {
      const key = `${rec.entityName || ''}|${rec.eventType}`;
      const arr = groups.get(key) || [];
      arr.push(rec);
      groups.set(key, arr);
    }

    this.logger.info('Records grouped for batch processing', { 
      totalGroups: groups.size, 
      groupDetails: Array.from(groups.entries()).map(([key, records]) => ({
        group: key,
        recordCount: records.length
      }))
    });

    let totalIndexed = 0;
    let totalDeleted = 0;
    let totalSkipped = 0;

    for (const [ key, groupRecords ] of groups.entries()) {
      const groupStartTime = Date.now();
      const [ entityName, eventType ] = key.split('|');

      this.logger.info('Processing batch group', { group: key, recordCount: groupRecords.length, entityName, eventType });

      const indexName = this.getIndexName(entityName);

      await this.ensureIndexExists(indexName);

      switch (eventType) {
        case 'create':
        case 'update': {
          // Build documents from each record's payload (supports object, array, or payload.items)
          const documents: any[] = [];
          const nowIso = new Date().toISOString();

          for (const gr of groupRecords) {
            // Use the same transformation logic as individual record processing
            const searchIndexEntry = this.createSearchIndexEntry(gr);
            const transformedData = searchIndexEntry.data;
            
            // Handle both array and single item payloads after transformation
            const items: any[] = Array.isArray(transformedData)
              ? transformedData
              : (Array.isArray(transformedData?.items) ? transformedData.items : [ transformedData ]);

            for (const item of items) {
              const id = item?.id || item?.[ `${entityName}Id` ] || (gr.entityId as string | undefined);
              if (!id) {
                this.logger.warn('Skipping item without id during batch index', { entityName, itemKeys: Object.keys(item || {}) });
                totalSkipped++;
                continue;
              }

              const doc = item?.id ? { ...item } : { ...item, id };
              if (!doc._indexedAt) {
                doc._indexedAt = nowIso;
              }
              documents.push(doc);
            }
          }
          
          if (documents.length === 0) {
            this.logger.info('No documents to index after payload normalization', { group: key });
            break;
          }
          
          this.logger.info('Executing batch index operation', { group: key, documentCount: documents.length, indexName });
          await this.searchEngine.indexDocuments(documents, { indexName }, false);
          totalIndexed += documents.length;
          
          const groupDuration = Date.now() - groupStartTime;
          this.logger.info('Batch index operation completed', { 
            group: key, 
            indexedCount: documents.length, 
            durationMs: groupDuration,
            avgTimePerDocument: groupDuration / documents.length 
          });
          break;
        }
        case 'delete': {
          const ids = groupRecords.map(gr => gr.entityId as string);
          
          this.logger.info('Executing batch delete operation', { group: key, idCount: ids.length, indexName });
          await this.searchEngine.deleteDocuments(ids, indexName, false);
          totalDeleted += ids.length;
          
          const groupDuration = Date.now() - groupStartTime;
          this.logger.info('Batch delete operation completed', { 
            group: key, 
            deletedCount: ids.length, 
            durationMs: groupDuration 
          });
          break;
        }
        default:
          this.logger.warn('Unknown event type in batch', { eventType, groupSize: groupRecords.length });
      }
    }

    const totalDuration = Date.now() - startTime;
    this.logger.info('Batch search indexing completed', { 
      totalRecords: records.length,
      totalGroups: groups.size,
      totalIndexed,
      totalDeleted,
      totalSkipped,
      durationMs: totalDuration,
      avgTimePerRecord: totalDuration / records.length,
      avgTimePerGroup: totalDuration / groups.size
    });
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
          (key.length > 3 && ['GSI', 'LSI'].includes(key.substring(0, 3).toUpperCase()))) {
        delete searchableData[key];
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